import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import { cancelled, failed, rejected, succeeded } from "../core/contracts.js";
import type { OperationContext, PortResult } from "../core/contracts.js";
import type { FailureDraft } from "../core/errors.js";
import {
  ContractViolation,
  assertDigestEquals,
  canonicalize,
  digestBytes,
  digestValue,
  validateContentDigest,
  validateIsoDateTime,
  validatePortablePath,
  validateStableId,
} from "../core/models.js";
import type {
  ArtifactRef,
  ConfigSnapshot,
  ContentDigest,
  DriverFingerprint,
  IsoDateTime,
  JsonObject,
  JsonValue,
  Ref,
  ScopeRef,
  TargetDescriptor,
  TargetSnapshot,
} from "../core/models.js";

const DESCRIPTOR_FIELDS = new Set([
  "schema",
  "targetId",
  "targetType",
  "sourceRoot",
  "dshExecutable",
  "dshHome",
  "profile",
  "targetIdentity",
  "requestedScope",
  "contentDigest",
]);

const LOCKFILE_NAMES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;

interface ManifestFileEntry {
  readonly portablePath: string;
  readonly entryType: "FILE" | "DIRECTORY" | "SYMLINK" | "OTHER";
  readonly mode: number;
  readonly byteLength?: number;
  readonly contentDigest?: ContentDigest;
  readonly linkTarget?: string;
  readonly resolvedWithinRoot?: boolean;
}

interface DirectoryManifest {
  readonly schema: "dsheval.mvp.target-directory-manifest/v1";
  readonly rootPath: string;
  readonly entries: readonly ManifestFileEntry[];
}

export interface PlanningArtifactCommitRequest {
  readonly artifactId: string;
  readonly scope: ScopeRef;
  readonly artifactType: string;
  readonly logicalName: string;
  readonly mediaType: string;
  readonly portablePath: string;
  readonly bytes: Uint8Array;
  readonly sensitivity: "EXPORTABLE" | "RESTRICTED";
  readonly createdAt: IsoDateTime;
  readonly producerVersion: string;
}

export type PlanningArtifactCommit = (
  request: PlanningArtifactCommitRequest,
) => Promise<ArtifactRef>;

export type PlanningArtifactRead = (ref: Ref<ArtifactRef>) => Promise<Uint8Array>;

export interface FreezeTargetOptions {
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly commitArtifact: PlanningArtifactCommit;
  /** A normalized, already-redacted effective config and Inspector facts. */
  readonly effectiveConfig: JsonObject;
  readonly secretRefNames?: readonly string[];
  readonly headlessBundleVersion?: string;
}

export interface TargetIntegrityResult {
  readonly status: "VALID" | "INVALID";
  readonly reasonCodes: readonly string[];
}

export interface VerifyTargetIntegrityOptions {
  readonly readArtifact: PlanningArtifactRead;
  readonly effectiveConfig: JsonObject;
}

export class TargetFreezeError extends ContractViolation {
  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "TargetFreezeError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

function assertPlainJsonObject(value: unknown, fieldName: string): JsonObject {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TargetFreezeError("INVALID_INPUT", `${fieldName} must be a plain JSON object`);
  }
  canonicalize(value);
  return value as JsonObject;
}

function assertRedacted(value: JsonValue, path = "effectiveConfig"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertRedacted(item, `${path}[${index}]`));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const sensitiveName = /(?:secret|token|password|credential|api[_-]?key)/iu.test(key);
    const referenceName = /(?:ref|refs|refname|refnames)$/iu.test(key);
    if (sensitiveName && !referenceName && child !== "REDACTED" && child !== null) {
      throw new TargetFreezeError(
        "SECRET_VALUE_REJECTED",
        `${path}.${key} must be removed, REDACTED, or represented by a reference name`,
      );
    }
    assertRedacted(child, `${path}.${key}`);
  }
}

function assertDescriptor(descriptor: TargetDescriptor): void {
  const raw = descriptor as unknown as Record<string, unknown>;
  const unknownFields = Object.keys(raw).filter((field) => !DESCRIPTOR_FIELDS.has(field)).sort();
  if (unknownFields.length > 0) {
    throw new TargetFreezeError(
      "INVALID_TARGET_DESCRIPTOR",
      `TargetDescriptor contains unknown fields: ${unknownFields.join(", ")}`,
    );
  }
  if (raw.schema !== "dsheval.mvp.target-descriptor/v1") {
    throw new TargetFreezeError("INVALID_TARGET_DESCRIPTOR", `unsupported TargetDescriptor schema`);
  }
  if (raw.targetType !== "FULL_AGENT") {
    throw new TargetFreezeError(
      "UNSUPPORTED_TARGET_KIND",
      `MVP supports only FULL_AGENT targets`,
    );
  }
  if (raw.requestedScope !== "FILESYSTEM_MVP") {
    throw new TargetFreezeError(
      "UNSUPPORTED_SCOPE",
      `MVP supports only FILESYSTEM_MVP scope`,
    );
  }
  validateStableId<"TargetId">(raw.targetId, "TargetDescriptor.targetId");
  for (const field of ["sourceRoot", "dshExecutable", "dshHome", "profile", "targetIdentity"] as const) {
    const value = raw[field];
    if (typeof value !== "string" || value.length === 0 || value.includes("\0") || /[\r\n]/u.test(value)) {
      throw new TargetFreezeError(
        "INVALID_TARGET_DESCRIPTOR",
        `TargetDescriptor.${field} must be a non-empty NUL/newline-free string`,
      );
    }
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(descriptor.profile)) {
    throw new TargetFreezeError(
      "INVALID_PROFILE",
      `profile must be a name accepted as one argv value, not a path or command`,
    );
  }
  const declared = validateContentDigest(raw.contentDigest, "TargetDescriptor.contentDigest");
  assertDigestEquals(
    digestValue(raw, ["contentDigest"]),
    declared,
    "TARGET_DESCRIPTOR_DIGEST_MISMATCH",
  );
}

async function digestFile(filePath: string): Promise<ContentDigest> {
  const hash = createHash("sha256");
  let byteLength = 0;
  const sink = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      byteLength += chunk.byteLength;
      callback();
    },
  });
  await pipeline(createReadStream(filePath), sink);
  return Object.freeze({
    algorithm: "sha256" as const,
    value: hash.digest("hex"),
    byteLength,
  });
}

async function scanDirectory(rootPath: string): Promise<DirectoryManifest> {
  const entries: ManifestFileEntry[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => Buffer.from(left.name).compare(Buffer.from(right.name)));
    for (const child of children) {
      const portablePath = prefix === "" ? child.name : `${prefix}/${child.name}`;
      validatePortablePath(portablePath, "manifest portablePath");
      const absolutePath = join(directory, child.name);
      const metadata = await lstat(absolutePath);
      const mode = metadata.mode & 0o7777;
      if (metadata.isSymbolicLink()) {
        const actualTarget = await readlink(absolutePath);
        let resolvedWithinRoot = false;
        try {
          resolvedWithinRoot = isInside(rootPath, await realpath(absolutePath));
        } catch {
          resolvedWithinRoot = false;
        }
        entries.push(
          Object.freeze({
            portablePath,
            entryType: "SYMLINK",
            mode,
            linkTarget: actualTarget,
            resolvedWithinRoot,
          }),
        );
      } else if (metadata.isDirectory()) {
        entries.push(Object.freeze({ portablePath, entryType: "DIRECTORY", mode }));
        await visit(absolutePath, portablePath);
      } else if (metadata.isFile()) {
        const contentDigest = await digestFile(absolutePath);
        entries.push(
          Object.freeze({
            portablePath,
            entryType: "FILE",
            mode,
            byteLength: contentDigest.byteLength,
            contentDigest,
          }),
        );
      } else {
        entries.push(Object.freeze({ portablePath, entryType: "OTHER", mode }));
      }
    }
  };
  await visit(rootPath, "");
  return Object.freeze({
    schema: "dsheval.mvp.target-directory-manifest/v1",
    rootPath,
    entries: Object.freeze(entries),
  });
}

function artifactId(prefix: string, semanticInput: unknown): string {
  return `${prefix}.${digestValue(semanticInput).value.slice(0, 24)}`;
}

function toArtifactRef(artifact: ArtifactRef): Ref<ArtifactRef> {
  return Object.freeze({
    schema: artifact.schema,
    id: artifact.artifactId,
    digest: artifact.contentDigest,
  });
}

async function commitJsonArtifact(
  options: FreezeTargetOptions,
  scope: ScopeRef,
  kind: string,
  value: unknown,
): Promise<Ref<ArtifactRef>> {
  const bytes = Buffer.from(canonicalize(value), "utf8");
  if (bytes.byteLength > 16 * 1024 * 1024) {
    throw new TargetFreezeError(
      "TARGET_MANIFEST_TOO_LARGE",
      `${kind} exceeds the 16 MiB planning artifact safety bound`,
    );
  }
  const requestedId = artifactId(`target-${kind}`, value);
  const artifact = await options.commitArtifact({
    artifactId: requestedId,
    scope,
    artifactType: `TARGET_${kind.toUpperCase().replaceAll("-", "_")}`,
    logicalName: `${kind}.json`,
    mediaType: "application/json",
    portablePath: `planning/${requestedId}.json`,
    bytes,
    sensitivity: "RESTRICTED",
    createdAt: validateIsoDateTime(options.createdAt, "FreezeTargetOptions.createdAt"),
    producerVersion: options.producerVersion,
  });
  if (
    artifact.schema !== "dsheval.mvp.artifact/v1" ||
    artifact.state !== "COMMITTED" ||
    artifact.artifactId !== requestedId ||
    artifact.byteLength !== bytes.byteLength ||
    artifact.scope.targetId !== scope.targetId
  ) {
    throw new TargetFreezeError(
      "PERSISTENCE_FAILURE",
      `artifact callback returned an invalid committed ${kind} ArtifactRef`,
    );
  }
  assertDigestEquals(
    artifact.artifactContentDigest,
    digestBytes(bytes),
    "PERSISTENCE_FAILURE",
  );
  return toArtifactRef(artifact);
}

async function resolveTargetPath(
  sourceRoot: string,
  configuredPath: string,
  fieldName: string,
): Promise<string> {
  const absolute = isAbsolute(configuredPath) ? resolve(configuredPath) : resolve(sourceRoot, configuredPath);
  const canonical = await realpath(absolute);
  if (!isInside(sourceRoot, canonical)) {
    throw new TargetFreezeError(
      "TARGET_ROOT_ESCAPE",
      `${fieldName} resolves outside sourceRoot`,
    );
  }
  return canonical;
}

async function resolvePackage(
  executablePath: string,
  sourceRoot: string,
): Promise<{ readonly name?: string; readonly version?: string; readonly manifestDigest?: ContentDigest }> {
  let directory = dirname(executablePath);
  while (isInside(sourceRoot, directory)) {
    const manifestPath = join(directory, "package.json");
    try {
      const bytes = await readFile(manifestPath);
      const parsed = JSON.parse(bytes.toString("utf8")) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const name = typeof record.name === "string" ? record.name : undefined;
        const version = typeof record.version === "string" ? record.version : undefined;
        if (name !== undefined || version !== undefined) {
          return {
            ...(name === undefined ? {} : { name }),
            ...(version === undefined ? {} : { version }),
            manifestDigest: digestBytes(bytes),
          };
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw new TargetFreezeError(
          "TARGET_PACKAGE_INVALID",
          `cannot read package manifest bound to the DSH entrypoint`,
          { cause: error },
        );
      }
    }
    if (directory === sourceRoot) break;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return {};
}

async function profileManifest(dshHome: string, profile: string): Promise<unknown> {
  const candidates = [`profiles/${profile}`, `profile/${profile}`, profile];
  for (const portableCandidate of candidates) {
    const candidate = join(dshHome, portableCandidate);
    try {
      const resolved = await realpath(candidate);
      if (!isInside(dshHome, resolved)) {
        throw new TargetFreezeError("PROFILE_ROOT_ESCAPE", `profile resolves outside dshHome`);
      }
      const metadata = await lstat(resolved);
      if (metadata.isDirectory()) return scanDirectory(resolved);
      if (metadata.isFile()) {
        return Object.freeze({
          schema: "dsheval.mvp.target-profile-manifest/v1",
          rootPath: resolved,
          entries: Object.freeze([
            Object.freeze({
              portablePath: profile,
              entryType: "FILE",
              mode: metadata.mode & 0o7777,
              byteLength: metadata.size,
              contentDigest: await digestFile(resolved),
            }),
          ]),
        });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return Object.freeze({
    schema: "dsheval.mvp.target-profile-manifest/v1",
    rootPath: dshHome,
    status: "UNKNOWN",
    profile,
    searchedPortablePaths: Object.freeze(candidates),
    entries: Object.freeze([]),
  });
}

async function lockfileManifest(sourceRoot: string): Promise<unknown> {
  const entries: object[] = [];
  for (const name of LOCKFILE_NAMES) {
    const lockPath = join(sourceRoot, name);
    try {
      const metadata = await lstat(lockPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new TargetFreezeError("LOCKFILE_INVALID", `${name} is not a regular file`);
      }
      entries.push(
        Object.freeze({
          portablePath: name,
          byteLength: metadata.size,
          contentDigest: await digestFile(lockPath),
        }),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return Object.freeze({
    schema: "dsheval.mvp.target-lockfile-manifest/v1",
    rootPath: sourceRoot,
    status: entries.length === 0 ? "UNKNOWN" : "KNOWN",
    entries: Object.freeze(entries),
  });
}

function buildDriverFingerprint(
  entrypointDigest: ContentDigest,
  dshPackageVersion: string | undefined,
  headlessBundleVersion: string | undefined,
): DriverFingerprint {
  return Object.freeze({
    driverCapabilityId: validateStableId("dsh.headless.full-agent.v1", "driverCapabilityId"),
    dshEntrypointDigest: entrypointDigest,
    ...(dshPackageVersion === undefined ? {} : { dshPackageVersion }),
    headlessBundleVersion:
      headlessBundleVersion ?? `@deepseek-ai/dsh@${dshPackageVersion ?? "UNKNOWN"}`,
    headlessBundleDigest: entrypointDigest,
    cliGrammarId: validateStableId("dsh.headless.profile-task.v1", "cliGrammarId"),
    cancelSupported: true,
    stdoutSemantics: "CAPTURED_BYTES_BOUNDED",
    stderrSemantics: "CAPTURED_BYTES_BOUNDED",
    exitSemantics: "ZERO_SUCCESS_NONZERO_TARGET_FAILED",
    workspaceSemantics: "FROZEN_CWD",
    profileMutationSemantics: "RUNTIME_CLONE_ONLY",
  });
}

/** Freeze a FULL_AGENT using only committed artifact references. */
export async function freezeTarget(
  descriptor: TargetDescriptor,
  config: ConfigSnapshot,
  options: FreezeTargetOptions,
): Promise<TargetSnapshot> {
  assertDescriptor(descriptor);
  const effectiveConfig = assertPlainJsonObject(options.effectiveConfig, "effectiveConfig");
  assertRedacted(effectiveConfig);
  const createdAt = validateIsoDateTime(options.createdAt, "FreezeTargetOptions.createdAt");
  if (options.producerVersion.length === 0) {
    throw new TargetFreezeError("INVALID_INPUT", `producerVersion must not be empty`);
  }

  const sourceRoot = await realpath(descriptor.sourceRoot);
  if (!isAbsolute(descriptor.sourceRoot) || !isAbsolute(config.targetRoot)) {
    throw new TargetFreezeError("TARGET_ROOT_INVALID", `sourceRoot and Config targetRoot must be absolute`);
  }
  const configTargetRoot = await realpath(config.targetRoot);
  if (sourceRoot !== configTargetRoot) {
    throw new TargetFreezeError(
      "TARGET_ROOT_MISMATCH",
      `TargetDescriptor sourceRoot does not match frozen Config targetRoot`,
    );
  }
  const sourceMetadata = await lstat(sourceRoot);
  if (!sourceMetadata.isDirectory()) {
    throw new TargetFreezeError("TARGET_ROOT_INVALID", `sourceRoot must be a directory`);
  }
  const dshExecutablePath = await resolveTargetPath(
    sourceRoot,
    descriptor.dshExecutable,
    "dshExecutable",
  );
  const executableMetadata = await lstat(dshExecutablePath);
  if (!executableMetadata.isFile()) {
    throw new TargetFreezeError("TARGET_ENTRYPOINT_INVALID", `dshExecutable must be a regular file`);
  }
  const dshHome = await resolveTargetPath(sourceRoot, descriptor.dshHome, "dshHome");
  const dshHomeMetadata = await lstat(dshHome);
  if (!dshHomeMetadata.isDirectory()) {
    throw new TargetFreezeError("TARGET_HOME_INVALID", `dshHome must be a directory`);
  }

  const entrypointDigest = await digestFile(dshExecutablePath);
  const packageBinding = await resolvePackage(dshExecutablePath, sourceRoot);
  const sourceManifest = await scanDirectory(sourceRoot);
  const homeManifest = await scanDirectory(dshHome);
  const frozenProfile = await profileManifest(dshHome, descriptor.profile);
  const frozenLockfiles = await lockfileManifest(sourceRoot);
  const frozenEffectiveConfig = Object.freeze({
    schema: "dsheval.mvp.target-effective-config/v1",
    status: "KNOWN",
    config: effectiveConfig,
    secretRefNames: Object.freeze([...(options.secretRefNames ?? [])].sort()),
  });
  const scope = Object.freeze({ targetId: descriptor.targetId });
  const [sourceManifestRef, dshHomeManifestRef, profileManifestRef, lockfileRef, effectiveConfigRef] =
    await Promise.all([
      commitJsonArtifact(options, scope, "source-manifest", sourceManifest),
      commitJsonArtifact(options, scope, "dsh-home-manifest", homeManifest),
      commitJsonArtifact(options, scope, "profile-manifest", frozenProfile),
      commitJsonArtifact(options, scope, "lockfile", frozenLockfiles),
      commitJsonArtifact(options, scope, "effective-config", frozenEffectiveConfig),
    ]);

  const driverFingerprint = buildDriverFingerprint(
    entrypointDigest,
    packageBinding.version,
    options.headlessBundleVersion,
  );
  const semanticIdentity = {
    targetId: descriptor.targetId,
    sourceManifestDigest: digestValue(sourceManifest),
    dshExecutablePortablePath: relative(sourceRoot, dshExecutablePath).split(sep).join("/"),
    entrypointDigest,
    dshHomePortablePath: relative(sourceRoot, dshHome).split(sep).join("/"),
    dshHomeManifestDigest: digestValue(homeManifest),
    profile: descriptor.profile,
    profileManifestDigest: digestValue(frozenProfile),
    lockfileDigest: digestValue(frozenLockfiles),
    effectiveConfigDigest: digestValue(frozenEffectiveConfig),
    packageBinding: {
      name: packageBinding.name ?? "UNKNOWN",
      version: packageBinding.version ?? "UNKNOWN",
      manifestDigest: packageBinding.manifestDigest ?? null,
    },
    driverFingerprint,
    platform: { platform: process.platform, arch: process.arch, nodeVersion: process.version },
    secretRefNames: [...(options.secretRefNames ?? [])].sort(),
  };
  const targetSnapshotId = validateStableId<"TargetSnapshotId">(
    `target-snapshot.${digestValue(semanticIdentity).value.slice(0, 24)}`,
    "targetSnapshotId",
  );
  const snapshotCommon = {
    schema: "dsheval.mvp.target-snapshot/v1" as const,
    targetSnapshotId,
    targetId: descriptor.targetId,
    scope,
    createdAt,
    producerVersion: options.producerVersion,
    sourceManifestRef,
    dshExecutablePath,
    dshEntrypointDigest: entrypointDigest,
    dshHomeManifestRef,
    profile: descriptor.profile,
    profileManifestRef,
    lockfileRef,
    effectiveConfigRef,
    driverFingerprint,
    platform: Object.freeze({
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      packageName: packageBinding.name ?? "UNKNOWN",
      packageManifestDigest: packageBinding.manifestDigest?.value ?? "UNKNOWN",
    }),
    secretRefNames: Object.freeze([...(options.secretRefNames ?? [])].sort()),
  };
  if (packageBinding.version === undefined) {
    return Object.freeze({
      ...snapshotCommon,
      contentDigest: digestValue(snapshotCommon),
    });
  }
  const snapshotWithVersion = {
    ...snapshotCommon,
    dshPackageVersion: packageBinding.version,
  };
  return Object.freeze({
    ...snapshotWithVersion,
    contentDigest: digestValue(snapshotWithVersion),
  });
}

function decodeManifest(bytes: Uint8Array, label: string): JsonObject {
  try {
    return assertPlainJsonObject(JSON.parse(Buffer.from(bytes).toString("utf8")), label);
  } catch (error) {
    if (error instanceof TargetFreezeError) throw error;
    throw new TargetFreezeError("TARGET_INTEGRITY", `${label} is not valid JSON`, { cause: error });
  }
}

async function manifestsEqual(current: unknown, savedBytes: Uint8Array): Promise<boolean> {
  return digestBytes(canonicalize(current)).value === digestBytes(savedBytes).value;
}

/** Re-reads every frozen critical input immediately before Run creation. */
export async function verifyTargetIntegrity(
  snapshot: TargetSnapshot,
  options: VerifyTargetIntegrityOptions,
): Promise<TargetIntegrityResult> {
  const reasons: string[] = [];
  try {
    const currentEntrypoint = await digestFile(snapshot.dshExecutablePath);
    if (currentEntrypoint.value !== snapshot.dshEntrypointDigest.value) {
      reasons.push("DSH_ENTRYPOINT_CHANGED");
    }

    const sourceBytes = await options.readArtifact(snapshot.sourceManifestRef);
    const sourceSaved = decodeManifest(sourceBytes, "source manifest");
    const sourceRoot = typeof sourceSaved.rootPath === "string" ? sourceSaved.rootPath : undefined;
    if (sourceRoot === undefined || !(await manifestsEqual(await scanDirectory(sourceRoot), sourceBytes))) {
      reasons.push("SOURCE_MANIFEST_CHANGED");
    }

    const homeBytes = await options.readArtifact(snapshot.dshHomeManifestRef);
    const homeSaved = decodeManifest(homeBytes, "DSH home manifest");
    const dshHome = typeof homeSaved.rootPath === "string" ? homeSaved.rootPath : undefined;
    if (dshHome === undefined || !(await manifestsEqual(await scanDirectory(dshHome), homeBytes))) {
      reasons.push("DSH_HOME_MANIFEST_CHANGED");
    }

    const profileBytes = await options.readArtifact(snapshot.profileManifestRef);
    if (
      dshHome === undefined ||
      !(await manifestsEqual(await profileManifest(dshHome, snapshot.profile), profileBytes))
    ) {
      reasons.push("PROFILE_MANIFEST_CHANGED");
    }

    const lockBytes = await options.readArtifact(snapshot.lockfileRef);
    if (sourceRoot === undefined || !(await manifestsEqual(await lockfileManifest(sourceRoot), lockBytes))) {
      reasons.push("LOCKFILE_CHANGED");
    }

    const currentEffectiveConfig = Object.freeze({
      schema: "dsheval.mvp.target-effective-config/v1",
      status: "KNOWN",
      config: options.effectiveConfig,
      secretRefNames: Object.freeze([...snapshot.secretRefNames].sort()),
    });
    assertRedacted(assertPlainJsonObject(options.effectiveConfig, "effectiveConfig"));
    const effectiveConfigBytes = await options.readArtifact(snapshot.effectiveConfigRef);
    if (!(await manifestsEqual(currentEffectiveConfig, effectiveConfigBytes))) {
      reasons.push("EFFECTIVE_CONFIG_CHANGED");
    }

    const packageBinding =
      sourceRoot === undefined
        ? {}
        : await resolvePackage(snapshot.dshExecutablePath, sourceRoot);
    if (packageBinding.version !== snapshot.dshPackageVersion) {
      reasons.push("DSH_PACKAGE_VERSION_CHANGED");
    }
  } catch (error) {
    if (error instanceof TargetFreezeError || error instanceof ContractViolation) {
      reasons.push(error.code);
    } else {
      reasons.push("TARGET_INTEGRITY_READ_FAILED");
    }
  }
  const uniqueReasons = Object.freeze([...new Set(reasons)].sort());
  return Object.freeze({
    status: uniqueReasons.length === 0 ? "VALID" : "INVALID",
    reasonCodes: uniqueReasons,
  });
}

function targetFailureDraft(
  scope: ScopeRef,
  occurredAt: IsoDateTime,
  category: FailureDraft["category"],
  origin: FailureDraft["origin"],
  reasonCode: string,
  messageRedacted: string,
): FailureDraft {
  return Object.freeze({
    scope,
    category,
    origin,
    actor: "PLANNING" as const,
    phase: "TARGET_FREEZE",
    severity: "ERROR" as const,
    retryable: false as const,
    messageRedacted,
    reasonCode,
    evidenceRefs: Object.freeze([]),
    artifactRefs: Object.freeze([]),
    occurredAt,
  });
}

/** PortResult boundary used by the workflow; the direct function remains useful for focused tests. */
export async function freezeTargetResult(
  context: OperationContext,
  descriptor: TargetDescriptor,
  config: ConfigSnapshot,
  options: FreezeTargetOptions,
): Promise<PortResult<TargetSnapshot>> {
  let targetId: TargetDescriptor["targetId"];
  let occurredAt: IsoDateTime;
  try {
    targetId = validateStableId<"TargetId">(
      (descriptor as unknown as Record<string, unknown>).targetId,
      "TargetDescriptor.targetId",
    );
    occurredAt = validateIsoDateTime(options.createdAt, "FreezeTargetOptions.createdAt");
  } catch {
    return rejected("INVALID_INPUT", [], [
      Object.freeze({
        code: "TARGET_DESCRIPTOR_ID_OR_TIME_INVALID",
        messageRedacted: "Target descriptor identity or freeze timestamp is invalid",
      }),
    ]);
  }
  const scope = Object.freeze({ targetId });
  if (context.cancellationToken.isCancellationRequested) {
    return cancelled(
      targetFailureDraft(
        scope,
        occurredAt,
        "CANCELLED",
        "USER",
        "TARGET_FREEZE_CANCELLED",
        "Target freeze was cancelled before filesystem access",
      ),
    );
  }
  try {
    return succeeded(await freezeTarget(descriptor, config, options));
  } catch (error) {
    const reasonCode =
      error instanceof ContractViolation ? error.code :
      (error as NodeJS.ErrnoException).code === "ENOENT" ? "TARGET_PATH_NOT_FOUND" :
      "TARGET_FREEZE_INTERNAL_ERROR";
    if (reasonCode === "UNSUPPORTED_TARGET_KIND" || reasonCode === "UNSUPPORTED_SCOPE") {
      return rejected(
        "UNSUPPORTED",
        [
          targetFailureDraft(
            scope,
            occurredAt,
            "TARGET_RESOLUTION",
            "USER",
            reasonCode,
            "The requested target kind or scope is unsupported by the MVP",
          ),
        ],
      );
    }
    if (
      reasonCode === "TARGET_PATH_NOT_FOUND" ||
      reasonCode.startsWith("INVALID_") ||
      reasonCode.includes("MISMATCH") ||
      reasonCode.includes("ROOT_ESCAPE") ||
      reasonCode.includes("SECRET_VALUE")
    ) {
      return rejected(
        reasonCode === "TARGET_PATH_NOT_FOUND" ? "NOT_FOUND" : "INVALID_INPUT",
        [
          targetFailureDraft(
            scope,
            occurredAt,
            reasonCode.includes("DIGEST") ? "TARGET_INTEGRITY" : "TARGET_RESOLUTION",
            "USER",
            reasonCode,
            "Target descriptor or frozen target input is invalid",
          ),
        ],
      );
    }
    return failed(
      targetFailureDraft(
        scope,
        occurredAt,
        reasonCode === "PERSISTENCE_FAILURE" ? "PERSISTENCE_FAILURE" : "TARGET_RESOLUTION",
        "DSHEVAL",
        reasonCode,
        "DSHEval could not freeze the target without partial success",
      ),
    );
  }
}

export async function verifyTargetIntegrityResult(
  context: OperationContext,
  snapshot: TargetSnapshot,
  options: VerifyTargetIntegrityOptions,
  occurredAtValue: string,
): Promise<PortResult<TargetIntegrityResult>> {
  const occurredAt = validateIsoDateTime(occurredAtValue, "integrity verification occurredAt");
  const scope = planningScopeFromSnapshot(snapshot);
  if (context.cancellationToken.isCancellationRequested) {
    return cancelled(
      targetFailureDraft(
        scope,
        occurredAt,
        "CANCELLED",
        "USER",
        "TARGET_INTEGRITY_CANCELLED",
        "Target integrity verification was cancelled",
      ),
    );
  }
  return succeeded(await verifyTargetIntegrity(snapshot, options));
}

function planningScopeFromSnapshot(snapshot: TargetSnapshot): ScopeRef {
  return Object.freeze({
    targetId: snapshot.targetId,
    targetSnapshotId: snapshot.targetSnapshotId,
  });
}
