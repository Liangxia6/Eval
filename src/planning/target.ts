/**
 * 文件功能：获取被测 Agent 的静态信息，并保证执行前后使用的是同一个 Agent。
 *
 * 本文件先冻结源码、DSH Home、Profile、锁文件和有效配置，生成 TargetSnapshot；再从这些
 * 冻结材料中提取 DSH、Probe、工具和权限能力，生成 InspectionSnapshot；执行前还会重新检查
 * 关键文件是否被修改。
 *
 * 主要交互：`app/workflow.ts` 依次调用冻结、能力检查和完整性复核；`planning/planner.ts`
 * 使用 TargetSnapshot 与 InspectionSnapshot 生成计划；产物通过应用层提供的存储接口保存。
 */
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
  validateRef,
  validateStableId,
} from "../core/models.js";
import type {
  ArtifactRef,
  ConfigSnapshot,
  ContentDigest,
  DriverFingerprint,
  InspectionSnapshot,
  IsoDateTime,
  JsonObject,
  JsonValue,
  Ref,
  ScopeRef,
  TargetDescriptor,
  TargetSnapshot,
} from "../core/models.js";

/** TargetDescriptor 允许的精确字段注册表，由 assertDescriptor 拒绝未知输入。 */
const DESCRIPTOR_FIELDS = new Set([
  "schema",
  "targetId",
  "targetType",
  "sourceRoot",
  "dshExecutable",
  "dshHome",
  "profile",
  "targetIdentity",
  "contentDigest",
]);

/** 目标根目录中需要纳入依赖冻结的支持锁文件名注册表。 */
const LOCKFILE_NAMES = [
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
] as const;

/** 递归目录清单中的单个文件系统条目。 */
interface ManifestFileEntry {
  readonly portablePath: string;
  readonly entryType: "FILE" | "DIRECTORY" | "SYMLINK" | "OTHER";
  readonly mode: number;
  readonly byteLength?: number;
  readonly contentDigest?: ContentDigest;
  readonly linkTarget?: string;
  readonly resolvedWithinRoot?: boolean;
}

/** 提交为规划产物的确定性目录清单结构。 */
interface DirectoryManifest {
  readonly schema: "dsheval.mvp.target-directory-manifest/v1";
  readonly rootPath: string;
  readonly entries: readonly ManifestFileEntry[];
}

/** freezeTarget 请求提交一份规划 JSON 产物时传给应用层的完整元数据。 */
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

/** 规划目标冻结所需的产物提交回调，由应用层用 ArtifactStorePort 适配。 */
export type PlanningArtifactCommit = (
  request: PlanningArtifactCommitRequest,
) => Promise<ArtifactRef>;

/** Inspector 与完整性验证所需的授权产物读取回调。 */
export type PlanningArtifactRead = (ref: Ref<ArtifactRef>) => Promise<Uint8Array>;

/** freezeTarget 的记录时间、版本、产物写入能力与已脱敏配置。 */
export interface FreezeTargetOptions {
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly commitArtifact: PlanningArtifactCommit;
  /** A normalized, already-redacted effective config and Inspector facts. */
  readonly effectiveConfig: JsonObject;
  readonly secretRefNames?: readonly string[];
  readonly headlessBundleVersion?: string;
}

/** 运行前完整性验证的稳定结论与已去重原因码。 */
export interface TargetIntegrityResult {
  readonly status: "VALID" | "INVALID";
  readonly reasonCodes: readonly string[];
}

/** 完整性复核使用的产物读取能力和当前有效配置。 */
export interface VerifyTargetIntegrityOptions {
  readonly readArtifact: PlanningArtifactRead;
  readonly effectiveConfig: JsonObject;
}

/** 目标描述、路径、清单或持久化回调违反冻结契约时的带码异常。 */
export class TargetFreezeError extends ContractViolation {
  /** 初始化冻结错误并保留 cause，供 Result 边界映射拒绝或失败。 */
  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "TargetFreezeError";
  }
}

/** 判断规范化候选路径是否位于给定根目录内，供所有 realpath 边界检查复用。 */
function isInside(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`));
}

/** 校验普通 JSON 对象并运行规范化检查，供有效配置和已提交清单解码复用。 */
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

/** 递归检查有效配置中的敏感字段已脱敏或改用引用名。 */
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

/** 校验 TargetDescriptor 的字段白名单、MVP 类型/范围、路径字符串、ID 与摘要。 */
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

/** 流式计算文件摘要和字节长度，供目录清单、入口与锁文件冻结复用。 */
async function digestFile(filePath: string): Promise<ContentDigest> {
  const hash = createHash("sha256");
  let byteLength = 0;
  const sink = new Transform({
    /** 将每个文件流分块累加到摘要和总字节数。 */
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

/** 递归扫描目录，稳定排序并记录类型、权限、摘要及符号链接边界。 */
async function scanDirectory(rootPath: string): Promise<DirectoryManifest> {
  const entries: ManifestFileEntry[] = [];
  /** 深度优先遍历当前子目录，并把条目追加到外层稳定清单。 */
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

/** 从语义输入摘要派生确定性规划产物 ID。 */
function artifactId(prefix: string, semanticInput: unknown): string {
  return `${prefix}.${digestValue(semanticInput).value.slice(0, 24)}`;
}

/** 将完整 ArtifactRef 收窄为领域关系中使用的轻量 Ref。 */
function toArtifactRef(artifact: ArtifactRef): Ref<ArtifactRef> {
  return Object.freeze({
    schema: artifact.schema,
    id: artifact.artifactId,
    digest: artifact.contentDigest,
  });
}

/**
 * 规范序列化并提交一类目标清单，随后核验 ArtifactStore 返回值与字节摘要；
 * freezeTarget 并行调用它保存五项冻结输入。
 */
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

/** 将描述符中的绝对或相对路径解析为 sourceRoot 内的规范真实路径。 */
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

/** 从 DSH 入口向上查找其 package.json，提取包身份、版本和清单摘要。 */
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

/** 在 DSH Home 支持的候选位置冻结指定 Profile 的文件或目录清单。 */
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

/** 扫描目标根目录中的支持锁文件并生成依赖清单。 */
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

/** 由入口摘要、包版本与 Headless bundle 版本构造运行驱动指纹。 */
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

/**
 * 冻结 FULL_AGENT 的关键文件与配置并返回仅引用已提交产物的 TargetSnapshot；
 * 由 freezeTargetResult 和聚焦单元测试调用。
 */
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

/** 解码完整性验证读取的 JSON 清单，并统一转换解析异常。 */
function decodeManifest(bytes: Uint8Array, label: string): JsonObject {
  try {
    return assertPlainJsonObject(JSON.parse(Buffer.from(bytes).toString("utf8")), label);
  } catch (error) {
    if (error instanceof TargetFreezeError) throw error;
    throw new TargetFreezeError("TARGET_INTEGRITY", `${label} is not valid JSON`, { cause: error });
  }
}

/** 比较当前清单规范内容与已保存产物字节的 SHA-256。 */
async function manifestsEqual(current: unknown, savedBytes: Uint8Array): Promise<boolean> {
  return digestBytes(canonicalize(current)).value === digestBytes(savedBytes).value;
}

/**
 * 在创建 Run 前重新读取所有冻结关键输入，返回去重排序后的变更或读取失败原因；
 * 应用编排通过 verifyTargetIntegrityResult 调用。
 */
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

/** 将目标冻结或完整性异常转换为规划阶段 FailureDraft。 */
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

/**
 * 目标冻结的工作流边界：先安全提取 ID/时间并处理取消，再把直接函数异常映射为 PortResult；
 * 应用启动流程调用它，成功 Snapshot 随后交给 Inspector。
 */
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

/** 运行前完整性验证的 PortResult 边界，处理取消并返回直接复核结果。 */
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

/** 从 TargetSnapshot 构造冻结与验证失败使用的规划层级作用域。 */
function planningScopeFromSnapshot(snapshot: TargetSnapshot): ScopeRef {
  return Object.freeze({
    targetId: snapshot.targetId,
    targetSnapshotId: snapshot.targetSnapshotId,
  });
}
/** Inspector 的时间、生产者版本和授权产物读取依赖。 */
export interface InspectTargetOptions {
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly readArtifact: PlanningArtifactRead;
}

/** 目标检查输入或冻结产物无法解析时抛出的带码契约异常。 */
export class InspectionError extends ContractViolation {
  /** 初始化检查错误并保留 cause，供 PortResult 边界分类。 */
  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "InspectionError";
  }
}

/** 将未知值窄化为 JSON 对象；各事实提取 helper 共同调用。 */
function asObject(value: unknown): Record<string, JsonValue> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, JsonValue>;
}

/** 解码并规范校验已读取 JSON 产物，失败时转换为 InspectionError。 */
function decodeObject(bytes: Uint8Array, label: string): Record<string, JsonValue> {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    const result = asObject(parsed);
    if (result === undefined) throw new Error("not an object");
    canonicalize(result);
    return result;
  } catch (error) {
    throw new InspectionError("INSPECTION_ARTIFACT_INVALID", `${label} is not valid JSON`, {
      cause: error,
    });
  }
}

/** 汇总并稳定排序 Snapshot 的五项来源产物引用，写入 InspectionSnapshot。 */
function artifactRefs(snapshot: TargetSnapshot): readonly Ref<ArtifactRef>[] {
  return Object.freeze([
    snapshot.dshHomeManifestRef,
    snapshot.effectiveConfigRef,
    snapshot.lockfileRef,
    snapshot.profileManifestRef,
    snapshot.sourceManifestRef,
  ].sort((left, right) => left.id.localeCompare(right.id, "en")));
}

/** 将可选 JSON 数组按规范序列化结果排序并冻结，消除声明顺序差异。 */
function normalizeJsonArray(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Object.freeze(
    [...value].sort((left, right) => canonicalize(left).localeCompare(canonicalize(right), "en")),
  );
}

/** 合并 Snapshot Profile 名称、有效配置插件列表与 Profile 清单状态。 */
function normalizedProfile(
  snapshot: TargetSnapshot,
  config: Record<string, JsonValue>,
  profileArtifact: Record<string, JsonValue> | undefined,
): JsonObject {
  const declaredProfile = asObject(config.profile);
  const declaredPlugins = normalizeJsonArray(declaredProfile?.plugins);
  const manifestStatus =
    profileArtifact === undefined || profileArtifact.status === "UNKNOWN" ? "UNKNOWN" : "KNOWN";
  return Object.freeze({
    name: snapshot.profile,
    manifestStatus,
    plugins:
      declaredPlugins === undefined
        ? Object.freeze({ status: "UNKNOWN", values: Object.freeze([]) })
        : Object.freeze({ status: "KNOWN", values: declaredPlugins }),
  });
}

/** 提取 Probe 配置、schema、启动顺序和必要能力，并同时生成限制项。 */
function probeFacts(config: Record<string, JsonValue>): {
  readonly configured: boolean | "UNKNOWN";
  readonly schema: string;
  readonly orderStatus: string;
  readonly limitations: JsonObject[];
} {
  const probe = asObject(config.probe);
  const limitations: JsonObject[] = [];
  const configured =
    typeof probe?.configured === "boolean" ? probe.configured : ("UNKNOWN" as const);
  if (configured === "UNKNOWN") {
    limitations.push(
      Object.freeze({
        code: "PROBE_CONFIGURATION_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "Probe configuration was not declared by a frozen source",
      }),
    );
  }
  const schema = typeof probe?.schema === "string" ? probe.schema : "UNKNOWN";
  if (schema === "UNKNOWN") {
    limitations.push(
      Object.freeze({
        code: "PROBE_SCHEMA_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "Probe schema could not be established",
      }),
    );
  }
  let orderStatus = "UNKNOWN";
  if (probe?.order === "BEFORE_HEADLESS") orderStatus = "VALID";
  else if (probe?.order === "AFTER_HEADLESS") orderStatus = "INVALID";
  if (orderStatus === "UNKNOWN") {
    limitations.push(
      Object.freeze({
        code: "PROBE_ORDER_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "Probe ordering relative to Headless was not declared",
      }),
    );
  }
  /** Planner 要求 Inspector 明确确认的 Probe 能力字段。 */
  const requiredFlags = [
    "captureDispatch",
    "captureLogs",
    "oneShot",
    "sourceRunIdEcho",
  ] as const;
  for (const flag of requiredFlags) {
    if (probe?.[flag] !== true) {
      limitations.push(
        Object.freeze({
          code: `PROBE_${flag.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_UNKNOWN_OR_MISSING`,
          status: probe?.[flag] === false ? "ABSENT" : "UNKNOWN",
          messageRedacted: `Required Probe capability ${flag} is not confirmed`,
        }),
      );
    }
  }
  const contentModes = normalizeJsonArray(probe?.contentModes);
  if (contentModes === undefined || !contentModes.includes("STRUCTURED")) {
    limitations.push(
      Object.freeze({
        code: "PROBE_CONTENT_MODE_UNKNOWN_OR_MISSING",
        status: contentModes === undefined ? "UNKNOWN" : "ABSENT",
        messageRedacted: "Probe STRUCTURED content mode is not confirmed",
      }),
    );
  }
  return Object.freeze({ configured, schema, orderStatus, limitations });
}

/** 比较包清单版本和有效配置版本，产出 KNOWN、UNKNOWN 或 CONFLICT 事实。 */
function versionStatus(snapshot: TargetSnapshot, config: Record<string, JsonValue>): JsonObject {
  const configuredVersion =
    typeof config.dshVersion === "string" ? config.dshVersion : undefined;
  if (snapshot.dshPackageVersion === undefined) {
    return Object.freeze({
      status: "UNKNOWN",
      configuredVersion: configuredVersion ?? "UNKNOWN",
      source: "TARGET_PACKAGE_MANIFEST",
    });
  }
  if (configuredVersion !== undefined && configuredVersion !== snapshot.dshPackageVersion) {
    return Object.freeze({
      status: "CONFLICT",
      packageVersion: snapshot.dshPackageVersion,
      configuredVersion,
      source: "TARGET_PACKAGE_AND_EFFECTIVE_CONFIG",
    });
  }
  return Object.freeze({
    status: "KNOWN",
    version: snapshot.dshPackageVersion,
    source: "TARGET_PACKAGE_MANIFEST",
  });
}

/** 用入口摘要和 CLI grammar 判断冻结 Headless Driver 是否兼容。 */
function headlessStatus(snapshot: TargetSnapshot): string {
  try {
    assertDigestEquals(
      snapshot.driverFingerprint.dshEntrypointDigest,
      snapshot.dshEntrypointDigest,
      "DRIVER_ENTRYPOINT_MISMATCH",
    );
  } catch {
    return "INCOMPATIBLE";
  }
  return snapshot.driverFingerprint.cliGrammarId === "dsh.headless.profile-task.v1"
    ? "COMPATIBLE"
    : "INCOMPATIBLE";
}

/** 为 InspectionSnapshot 构造所依赖 TargetSnapshot 的轻量引用。 */
function targetSnapshotRef(snapshot: TargetSnapshot): Ref<TargetSnapshot> {
  return Object.freeze({
    schema: snapshot.schema,
    id: snapshot.targetSnapshotId,
    digest: snapshot.contentDigest,
  });
}

/**
 * 从 TargetSnapshot 的已提交产物生成确定性的 InspectionSnapshot。
 * 调用方是应用规划编排；内部调用解码与事实归一化 helper，并将缺失声明表示为 UNKNOWN 和限制项。
 */
export async function inspectTarget(
  snapshot: TargetSnapshot,
  options: InspectTargetOptions,
): Promise<InspectionSnapshot> {
  if (snapshot.schema !== "dsheval.mvp.target-snapshot/v1") {
    throw new InspectionError("INVALID_TARGET_SNAPSHOT", `unsupported TargetSnapshot schema`);
  }
  validateRef(snapshot.effectiveConfigRef, { fieldName: "effectiveConfigRef" });
  validateRef(snapshot.profileManifestRef, { fieldName: "profileManifestRef" });
  const createdAt: IsoDateTime = validateIsoDateTime(options.createdAt, "InspectTargetOptions.createdAt");
  if (options.producerVersion.length === 0) {
    throw new InspectionError("INVALID_INPUT", `producerVersion must not be empty`);
  }

  const limitations: JsonObject[] = [];
  let frozenConfig: Record<string, JsonValue> = {};
  try {
    const envelope = decodeObject(
      await options.readArtifact(snapshot.effectiveConfigRef),
      "effective config artifact",
    );
    const extracted = asObject(envelope.config);
    if (extracted === undefined) {
      limitations.push(
        Object.freeze({
          code: "EFFECTIVE_CONFIG_UNKNOWN",
          status: "UNKNOWN",
          messageRedacted: "Effective config artifact contains no normalized config facts",
        }),
      );
    } else {
      frozenConfig = extracted;
    }
  } catch {
    limitations.push(
      Object.freeze({
        code: "EFFECTIVE_CONFIG_READ_FAILED",
        status: "UNKNOWN",
        messageRedacted: "Effective config could not be read through the authorized artifact source",
      }),
    );
  }

  let frozenProfile: Record<string, JsonValue> | undefined;
  try {
    frozenProfile = decodeObject(
      await options.readArtifact(snapshot.profileManifestRef),
      "profile manifest artifact",
    );
  } catch {
    limitations.push(
      Object.freeze({
        code: "PROFILE_MANIFEST_READ_FAILED",
        status: "UNKNOWN",
        messageRedacted: "Profile manifest could not be read through the authorized artifact source",
      }),
    );
  }

  const probe = probeFacts(frozenConfig);
  limitations.push(...probe.limitations);
  if (snapshot.dshPackageVersion === undefined) {
    limitations.push(
      Object.freeze({
        code: "DSH_VERSION_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "The DSH entrypoint could not be bound to a package version",
      }),
    );
  }
  const toolSchemas = normalizeJsonArray(frozenConfig.toolSchemas) ??
    Object.freeze([
      Object.freeze({
        status: "UNKNOWN",
        reasonCode: "TOOL_SCHEMAS_NOT_DECLARED",
      }),
    ]);
  if (frozenConfig.fixture === true) {
    limitations.push(
      Object.freeze({
        code: "FIXTURE_TARGET",
        status: "DECLARED",
        messageRedacted: "This inspection describes a test fixture, not a real DSH acceptance run",
      }),
    );
  }
  const declaredLimitations = normalizeJsonArray(frozenConfig.limitations);
  if (declaredLimitations !== undefined) {
    for (const limitation of declaredLimitations) {
      const object = asObject(limitation);
      limitations.push(
        object === undefined
          ? Object.freeze({
              code: "DECLARED_LIMITATION",
              status: "DECLARED",
              messageRedacted: String(limitation),
            })
          : Object.freeze({ ...object }),
      );
    }
  }
  limitations.sort((left, right) => canonicalize(left).localeCompare(canonicalize(right), "en"));

  const normalized = {
    targetSnapshotRef: targetSnapshotRef(snapshot),
    dshVersionStatus: versionStatus(snapshot, frozenConfig),
    profile: normalizedProfile(snapshot, frozenConfig, frozenProfile),
    probeConfigured: probe.configured,
    probeSchema: probe.schema,
    probeOrderStatus: probe.orderStatus,
    headlessDriverStatus: headlessStatus(snapshot),
    toolSchemas,
    permissionPreset:
      typeof frozenConfig.permissionPreset === "string"
        ? frozenConfig.permissionPreset
        : "UNKNOWN",
    sandboxMode:
      typeof frozenConfig.sandboxMode === "string" ? frozenConfig.sandboxMode : "UNKNOWN",
    limitations: Object.freeze(limitations),
    sourceArtifactRefs: artifactRefs(snapshot),
  };
  const semanticFacts = {
    targetSnapshotId: snapshot.targetSnapshotId,
    dshVersionStatus: normalized.dshVersionStatus,
    profile: normalized.profile,
    probeConfigured: normalized.probeConfigured,
    probeSchema: normalized.probeSchema,
    probeOrderStatus: normalized.probeOrderStatus,
    headlessDriverStatus: normalized.headlessDriverStatus,
    toolSchemas: normalized.toolSchemas,
    permissionPreset: normalized.permissionPreset,
    sandboxMode: normalized.sandboxMode,
    limitations: normalized.limitations,
    sourceArtifactIds: normalized.sourceArtifactRefs.map((ref) => String(ref.id)).sort(),
  };
  const inspectionId = validateStableId<"InspectionId">(
    `inspection.${digestValue(semanticFacts).value.slice(0, 24)}`,
    "inspectionId",
  );
  const withoutDigest = {
    schema: "dsheval.mvp.inspection/v1" as const,
    inspectionId,
    scope: Object.freeze({
      targetId: snapshot.targetId,
      targetSnapshotId: snapshot.targetSnapshotId,
    }),
    createdAt,
    producerVersion: options.producerVersion,
    ...normalized,
  };
  return Object.freeze({
    ...withoutDigest,
    contentDigest: digestValue(withoutDigest),
  });
}

/** 把 Inspector 异常映射为规划阶段 FailureDraft，供 inspectTargetResult 的各失败分支复用。 */
function inspectionFailureDraft(
  scope: ScopeRef,
  occurredAt: IsoDateTime,
  category: FailureDraft["category"],
  reasonCode: string,
  messageRedacted: string,
): FailureDraft {
  return Object.freeze({
    scope,
    category,
    origin: category === "INTERNAL_INVARIANT" ? "DSHEVAL" as const : "TARGET" as const,
    actor: "PLANNING" as const,
    phase: "INSPECTION",
    severity: "ERROR" as const,
    retryable: false as const,
    messageRedacted,
    reasonCode,
    evidenceRefs: Object.freeze([]),
    artifactRefs: Object.freeze([]),
    occurredAt,
  });
}

/**
 * Inspector 的工作流边界：处理时间校验与取消，并将直接函数的异常转换为 PortResult；
 * `app/bootstrap.ts` 在冻结目标后调用，成功值随后交给 Planner。
 */
export async function inspectTargetResult(
  context: OperationContext,
  snapshot: TargetSnapshot,
  options: InspectTargetOptions,
): Promise<PortResult<InspectionSnapshot>> {
  const scope = Object.freeze({
    targetId: snapshot.targetId,
    targetSnapshotId: snapshot.targetSnapshotId,
  });
  let occurredAt: IsoDateTime;
  try {
    occurredAt = validateIsoDateTime(options.createdAt, "inspection occurredAt");
  } catch {
    return rejected("INVALID_INPUT", [], [
      Object.freeze({
        code: "INSPECTION_TIME_INVALID",
        messageRedacted: "Inspection timestamp is invalid",
      }),
    ]);
  }
  if (context.cancellationToken.isCancellationRequested) {
    return cancelled(
      Object.freeze({
        ...inspectionFailureDraft(
          scope,
          occurredAt,
          "CANCELLED",
          "INSPECTION_CANCELLED",
          "Target inspection was cancelled",
        ),
        origin: "USER" as const,
      }),
    );
  }
  try {
    return succeeded(await inspectTarget(snapshot, options));
  } catch (error) {
    const reasonCode = error instanceof ContractViolation
      ? error.code
      : "INSPECTION_INTERNAL_ERROR";
    const draft = inspectionFailureDraft(
      scope,
      occurredAt,
      reasonCode === "INSPECTION_INTERNAL_ERROR" ? "INTERNAL_INVARIANT" : "TARGET_INTEGRITY",
      reasonCode,
      reasonCode === "INSPECTION_INTERNAL_ERROR"
        ? "DSHEval could not complete target inspection"
        : "Frozen target facts are invalid for inspection",
    );
    if (error instanceof ContractViolation) return rejected("INVALID_INPUT", [draft]);
    return failed(draft);
  }
}
