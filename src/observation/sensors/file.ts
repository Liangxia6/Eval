import { constants as fsConstants, type BigIntStats } from "node:fs";
import {
  lstat,
  open,
  readdir,
  readlink,
  realpath,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  canonicalJson,
  digestBytes,
  digestEquals,
  digestValue,
  validatePortablePath,
  validateScope,
  validateStableId,
  withContentDigest,
  type ContentDigest,
  type EvidenceCompleteness,
  type FileDiff,
  type FileEntry,
  type FileSnapshot,
  type Ref,
  type ResetVerification,
  type ScopeRef,
} from "../../core/models.js";

export const FILE_SENSOR_IMPLEMENTATION_ID = "dsheval.file-sensor";
export const FILE_SENSOR_IMPLEMENTATION_VERSION = "1.0.0";
export const FILE_SENSOR_CAPABILITIES = [
  "FILE_TYPE",
  "READ_ERRORS",
  "READ_ONLY",
  "SHA256",
  "SNAPSHOT_AFTER",
  "SNAPSHOT_BEFORE",
  "SNAPSHOT_POST_RESET",
  "STABLE_WINDOW",
  "SYMLINK_BOUNDARY",
] as const;
export const FILE_SENSOR_CAPABILITY_DIGEST: ContentDigest = {
  algorithm: "sha256",
  byteLength: 140,
  value: "166aa91b9f679a4085d090a650e238b244c3f317f0bca923bb13b944db4a5dd4",
};

export type SnapshotPhase = "BEFORE" | "AFTER" | "POST_RESET";

export interface FileScanError {
  readonly portablePath: string;
  readonly reasonCode:
    | "ROOT_NOT_DIRECTORY"
    | "ROOT_IS_SYMLINK"
    | "ROOT_REALPATH_MISMATCH"
    | "PATH_OUTSIDE_ROOT"
    | "MOUNT_BOUNDARY"
    | "LIST_FAILED"
    | "LSTAT_FAILED"
    | "REALPATH_FAILED"
    | "READ_FAILED"
    | "FILE_TOO_LARGE"
    | "FILE_CHANGED_DURING_SCAN"
    | "SYMLINK_READ_FAILED";
  readonly messageRedacted: string;
}

/** Repository metadata is deliberately left to the committing layer. */
export interface FileSnapshotDraft {
  readonly snapshotId: string;
  readonly attemptId: string;
  readonly phase: SnapshotPhase;
  readonly rootBinding: string;
  readonly scanStartedAt: string;
  readonly scanCompletedAt: string;
  readonly entries: readonly FileEntry[];
  readonly readErrors: readonly FileScanError[];
  readonly completeness: EvidenceCompleteness;
  /** Digest of the normalized manifest, independent of IDs and wall clock. */
  readonly snapshotDigest: ContentDigest;
}

export interface CaptureFileSnapshotOptions {
  readonly snapshotId: string;
  readonly attemptId: string;
  readonly phase: SnapshotPhase;
  /** Host path used only by this independent reader; never copied into records. */
  readonly rootPath: string;
  /** Frozen logical binding persisted in the Snapshot. */
  readonly rootBinding: string;
  readonly maxFileBytes: number;
  readonly now?: () => string;
}

export type FileModificationKind =
  | "CONTENT_CHANGED"
  | "METADATA_CHANGED"
  | "SYMLINK_CHANGED"
  | "UNREADABLE";

export interface FileAddedOrRemoved {
  readonly portablePath: string;
  readonly kind: "ADDED" | "REMOVED";
  readonly before?: FileEntry;
  readonly after?: FileEntry;
}

export interface FileModification {
  readonly portablePath: string;
  readonly kind: FileModificationKind;
  readonly before: FileEntry;
  readonly after: FileEntry;
}

export interface FileTypeChange {
  readonly portablePath: string;
  readonly kind: "TYPE_CHANGED";
  readonly before: FileEntry;
  readonly after: FileEntry;
}

export interface FileDiffDraft {
  readonly diffId: string;
  readonly beforeSnapshotRef: Ref<FileSnapshot>;
  readonly afterSnapshotRef: Ref<FileSnapshot>;
  readonly added: readonly FileAddedOrRemoved[];
  readonly removed: readonly FileAddedOrRemoved[];
  readonly modified: readonly FileModification[];
  readonly typeChanged: readonly FileTypeChange[];
  readonly unchangedCount: number;
  readonly diffDigest: ContentDigest;
}

export interface BuildFileDiffOptions {
  readonly diffId: string;
  readonly beforeSnapshot: FileSnapshotDraft;
  readonly afterSnapshot: FileSnapshotDraft;
  readonly beforeSnapshotRef: Ref<FileSnapshot>;
  readonly afterSnapshotRef: Ref<FileSnapshot>;
  /** Partial manifests are useful diagnostically but cannot prove no change. */
  readonly allowDiagnosticPartial?: boolean;
}

export interface ResetVerificationDraft {
  readonly verificationId: string;
  readonly environmentInstanceRef: Ref<unknown>;
  readonly resetGeneration: number;
  readonly expectedCleanDigest: ContentDigest;
  readonly postResetSnapshotRef: Ref<FileSnapshot>;
  readonly collectionStatusRef: Ref<unknown>;
  readonly result: "MATCH" | "MISMATCH" | "UNAVAILABLE";
  readonly differenceSummary: {
    readonly expectedDigest: string;
    readonly actualDigest?: string;
    readonly entryCount: number;
    readonly readErrorCount: number;
    readonly reasonCode: "DIGEST_MATCH" | "DIGEST_MISMATCH" | "SNAPSHOT_PARTIAL";
  };
}

export interface VerifyResetOptions {
  readonly verificationId: string;
  readonly environmentInstanceRef: Ref<unknown>;
  readonly resetGeneration: number;
  readonly expectedCleanDigest: ContentDigest;
  readonly postResetSnapshot: FileSnapshotDraft;
  readonly postResetSnapshotRef: Ref<FileSnapshot>;
  readonly collectionStatusRef: Ref<unknown>;
}

export class IncompleteFileSnapshotError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IncompleteFileSnapshotError";
  }
}

export interface ImmutableObservationMetadata {
  readonly scope: ScopeRef;
  readonly createdAt: string;
  readonly producerVersion: string;
}

export function materializeFileSnapshot(
  draft: FileSnapshotDraft,
  metadata: ImmutableObservationMetadata,
): FileSnapshot {
  const scope = validateScope(metadata.scope);
  if (scope.attemptId === undefined || scope.attemptId !== draft.attemptId) {
    throw new TypeError("FileSnapshot Attempt must match immutable record Scope");
  }
  const entries = draft.entries.map((entry) => ({
    ...entry,
    portablePath: validatePortablePath(entry.portablePath),
  }));
  assertUniqueSortedPaths(entries.map((entry) => entry.portablePath), "FileSnapshot.entries");
  const readErrors = draft.readErrors.map((error) => ({
    ...error,
    portablePath: validatePortablePath(error.portablePath, "readError.portablePath", {
      allowDot: true,
    }),
  }));
  const expectedDigest = digestValue({
    rootBinding: draft.rootBinding,
    entries,
    readErrors,
    completeness: draft.completeness,
  });
  if (!digestEquals(expectedDigest, draft.snapshotDigest)) {
    throw new TypeError("FileSnapshot manifest digest is invalid");
  }
  return withContentDigest({
    schema: "dsheval.mvp.file-snapshot/v1" as const,
    snapshotId: validateStableId<"FileSnapshotId">(draft.snapshotId, "snapshotId"),
    scope,
    attemptId: scope.attemptId,
    phase: draft.phase,
    rootBinding: draft.rootBinding,
    scanStartedAt: draft.scanStartedAt,
    scanCompletedAt: draft.scanCompletedAt,
    entries,
    readErrors,
    completeness: draft.completeness,
    snapshotDigest: draft.snapshotDigest,
    createdAt: metadata.createdAt,
    producerVersion: metadata.producerVersion,
  });
}

export function materializeFileDiff(
  draft: FileDiffDraft,
  metadata: ImmutableObservationMetadata,
): FileDiff {
  const scope = validateScope(metadata.scope);
  if (scope.attemptId === undefined) throw new TypeError("FileDiff requires Attempt Scope");
  const added = draft.added.map((change) => ({
    portablePath: validatePortablePath(change.portablePath),
    kind: "ADDED" as const,
    after: change.after!,
  }));
  const removed = draft.removed.map((change) => ({
    portablePath: validatePortablePath(change.portablePath),
    kind: "REMOVED" as const,
    before: change.before!,
  }));
  const modified = draft.modified.map((change) => ({
    portablePath: validatePortablePath(change.portablePath),
    kind: change.kind,
    before: change.before,
    after: change.after,
  }));
  const typeChanged = draft.typeChanged.map((change) => ({
    portablePath: validatePortablePath(change.portablePath),
    kind: "TYPE_CHANGED" as const,
    before: change.before,
    after: change.after,
  }));
  const diffDigest = digestValue({
    added,
    removed,
    modified,
    typeChanged,
    unchangedCount: draft.unchangedCount,
  });
  return withContentDigest({
    schema: "dsheval.mvp.file-diff/v1" as const,
    diffId: validateStableId<"FileDiffId">(draft.diffId, "diffId"),
    scope,
    beforeSnapshotRef: draft.beforeSnapshotRef,
    afterSnapshotRef: draft.afterSnapshotRef,
    added,
    removed,
    modified,
    typeChanged,
    unchangedCount: draft.unchangedCount,
    diffDigest,
    createdAt: metadata.createdAt,
    producerVersion: metadata.producerVersion,
  });
}

export function materializeResetVerification(
  draft: ResetVerificationDraft,
  metadata: ImmutableObservationMetadata,
): ResetVerification {
  return withContentDigest({
    schema: "dsheval.mvp.reset-verification/v1" as const,
    verificationId: validateStableId<"ResetVerificationId">(
      draft.verificationId,
      "verificationId",
    ),
    scope: validateScope(metadata.scope),
    environmentInstanceRef: draft.environmentInstanceRef as ResetVerification["environmentInstanceRef"],
    resetGeneration: draft.resetGeneration,
    expectedCleanDigest: draft.expectedCleanDigest,
    postResetSnapshotRef: draft.postResetSnapshotRef,
    collectionStatusRef: draft.collectionStatusRef as ResetVerification["collectionStatusRef"],
    result: draft.result,
    differenceSummary: draft.differenceSummary,
    createdAt: metadata.createdAt,
    producerVersion: metadata.producerVersion,
  });
}

export function emptyWorkspaceManifestDigest(rootBinding: string): ContentDigest {
  return digestValue({
    rootBinding,
    entries: [],
    readErrors: [],
    completeness: "COMPLETE",
  });
}

/**
 * Captures a stable, read-only manifest. It never follows a directory symlink
 * and opens regular files with O_NOFOLLOW before hashing their bytes.
 */
export async function captureFileSnapshot(
  options: CaptureFileSnapshotOptions,
): Promise<FileSnapshotDraft> {
  if (!path.isAbsolute(options.rootPath)) {
    throw new TypeError("File Sensor rootPath must be absolute");
  }
  if (!Number.isSafeInteger(options.maxFileBytes) || options.maxFileBytes < 0) {
    throw new TypeError("maxFileBytes must be a non-negative safe integer");
  }

  const now = options.now ?? (() => new Date().toISOString());
  const scanStartedAt = now();
  const configuredRoot = path.resolve(options.rootPath);
  const entries: FileEntry[] = [];
  const readErrors: FileScanError[] = [];

  let rootStats: BigIntStats;
  let canonicalRoot: string;
  try {
    rootStats = await lstat(configuredRoot, { bigint: true });
    if (rootStats.isSymbolicLink()) {
      readErrors.push(errorFor("", "ROOT_IS_SYMLINK", "Workspace root must not be a symbolic link"));
      return finishSnapshot(options, scanStartedAt, now(), entries, readErrors);
    }
    if (!rootStats.isDirectory()) {
      readErrors.push(errorFor("", "ROOT_NOT_DIRECTORY", "Workspace root is not a directory"));
      return finishSnapshot(options, scanStartedAt, now(), entries, readErrors);
    }
    canonicalRoot = await realpath(configuredRoot);
  } catch (error) {
    readErrors.push(errorFor("", "LSTAT_FAILED", redactFsError(error)));
    return finishSnapshot(options, scanStartedAt, now(), entries, readErrors);
  }

  await walkDirectory({
    absoluteDirectory: canonicalRoot,
    portableDirectory: "",
    canonicalRoot,
    rootDevice: rootStats.dev,
    maxFileBytes: options.maxFileBytes,
    entries,
    readErrors,
  });

  entries.sort((left, right) => compareUtf8(left.portablePath, right.portablePath));
  readErrors.sort((left, right) => compareUtf8(left.portablePath, right.portablePath));
  return finishSnapshot(options, scanStartedAt, now(), entries, readErrors);
}

export function buildFileDiff(options: BuildFileDiffOptions): FileDiffDraft {
  if (
    !options.allowDiagnosticPartial &&
    (options.beforeSnapshot.completeness !== "COMPLETE" ||
      options.afterSnapshot.completeness !== "COMPLETE")
  ) {
    throw new IncompleteFileSnapshotError(
      "A conclusive FileDiff requires COMPLETE Before and After snapshots",
    );
  }
  if (
    options.beforeSnapshot.attemptId !== options.afterSnapshot.attemptId ||
    options.beforeSnapshot.attemptId === ""
  ) {
    throw new TypeError("Before and After snapshots must belong to the same Attempt");
  }
  if (options.beforeSnapshot.phase !== "BEFORE" || options.afterSnapshot.phase !== "AFTER") {
    throw new TypeError("FileDiff requires BEFORE followed by AFTER");
  }
  if (options.beforeSnapshot.rootBinding !== options.afterSnapshot.rootBinding) {
    throw new TypeError("Before and After root bindings must match");
  }

  const beforeByPath = new Map(
    options.beforeSnapshot.entries.map((entry) => [entry.portablePath, entry] as const),
  );
  const afterByPath = new Map(
    options.afterSnapshot.entries.map((entry) => [entry.portablePath, entry] as const),
  );
  const allPaths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])].sort(compareUtf8);
  const added: FileAddedOrRemoved[] = [];
  const removed: FileAddedOrRemoved[] = [];
  const modified: FileModification[] = [];
  const typeChanged: FileTypeChange[] = [];
  let unchangedCount = 0;

  for (const portablePath of allPaths) {
    const before = beforeByPath.get(portablePath);
    const after = afterByPath.get(portablePath);
    if (before === undefined) {
      added.push({ portablePath, kind: "ADDED", after: after! });
      continue;
    }
    if (after === undefined) {
      removed.push({ portablePath, kind: "REMOVED", before });
      continue;
    }
    if (before.entryType !== after.entryType) {
      typeChanged.push({ portablePath, kind: "TYPE_CHANGED", before, after });
      continue;
    }
    const modificationKind = classifyModification(before, after);
    if (modificationKind === undefined) {
      unchangedCount += 1;
    } else {
      modified.push({ portablePath, kind: modificationKind, before, after });
    }
  }

  const digestPayload = { added, removed, modified, typeChanged, unchangedCount };
  return {
    diffId: options.diffId,
    beforeSnapshotRef: options.beforeSnapshotRef,
    afterSnapshotRef: options.afterSnapshotRef,
    ...digestPayload,
    diffDigest: digestCanonical(digestPayload),
  };
}

/** Builds a reset fact from a fresh POST_RESET capture; it never mutates a sealed Session. */
export function verifyResetSnapshot(options: VerifyResetOptions): ResetVerificationDraft {
  if (options.postResetSnapshot.phase !== "POST_RESET") {
    throw new TypeError("Reset verification requires a POST_RESET snapshot");
  }
  const unavailable = options.postResetSnapshot.completeness !== "COMPLETE";
  const matches =
    !unavailable && digestsEqual(options.expectedCleanDigest, options.postResetSnapshot.snapshotDigest);

  return {
    verificationId: options.verificationId,
    environmentInstanceRef: options.environmentInstanceRef,
    resetGeneration: options.resetGeneration,
    expectedCleanDigest: options.expectedCleanDigest,
    postResetSnapshotRef: options.postResetSnapshotRef,
    collectionStatusRef: options.collectionStatusRef,
    result: unavailable ? "UNAVAILABLE" : matches ? "MATCH" : "MISMATCH",
    differenceSummary: {
      expectedDigest: options.expectedCleanDigest.value,
      ...(!unavailable ? { actualDigest: options.postResetSnapshot.snapshotDigest.value } : {}),
      entryCount: options.postResetSnapshot.entries.length,
      readErrorCount: options.postResetSnapshot.readErrors.length,
      reasonCode: unavailable
        ? "SNAPSHOT_PARTIAL"
        : matches
          ? "DIGEST_MATCH"
          : "DIGEST_MISMATCH",
    },
  };
}

interface WalkContext {
  readonly absoluteDirectory: string;
  readonly portableDirectory: string;
  readonly canonicalRoot: string;
  readonly rootDevice: bigint;
  readonly maxFileBytes: number;
  readonly entries: FileEntry[];
  readonly readErrors: FileScanError[];
}

async function walkDirectory(context: WalkContext): Promise<void> {
  let names: string[];
  try {
    names = await readdir(context.absoluteDirectory);
  } catch (error) {
    context.readErrors.push(
      errorFor(context.portableDirectory, "LIST_FAILED", redactFsError(error)),
    );
    return;
  }
  names.sort(compareUtf8);

  for (const name of names) {
    const portablePath = context.portableDirectory === "" ? name : `${context.portableDirectory}/${name}`;
    const absolutePath = path.join(context.absoluteDirectory, name);
    if (!isWithinRoot(context.canonicalRoot, absolutePath)) {
      context.readErrors.push(
        errorFor(portablePath, "PATH_OUTSIDE_ROOT", "Directory entry resolved outside Workspace root"),
      );
      continue;
    }

    let stats: BigIntStats;
    try {
      stats = await lstat(absolutePath, { bigint: true });
    } catch (error) {
      context.readErrors.push(errorFor(portablePath, "LSTAT_FAILED", redactFsError(error)));
      continue;
    }

    const mode = Number(stats.mode & 0o7777n);
    if (stats.isSymbolicLink()) {
      await captureSymlink(context, absolutePath, portablePath, mode);
      continue;
    }

    if (stats.dev !== context.rootDevice) {
      const readError = "Entry crosses the frozen Workspace mount boundary";
      context.entries.push({
        portablePath,
        entryType: "OTHER",
        mode,
        resolvedWithinRoot: true,
        readError,
      });
      context.readErrors.push(errorFor(portablePath, "MOUNT_BOUNDARY", readError));
      continue;
    }

    if (stats.isDirectory()) {
      let canonicalDirectory: string;
      try {
        canonicalDirectory = await realpath(absolutePath);
      } catch (error) {
        const readError = redactFsError(error);
        context.entries.push({
          portablePath,
          entryType: "DIRECTORY",
          mode,
          resolvedWithinRoot: false,
          readError,
        });
        context.readErrors.push(errorFor(portablePath, "REALPATH_FAILED", readError));
        continue;
      }
      const withinRoot = isWithinRoot(context.canonicalRoot, canonicalDirectory);
      context.entries.push({
        portablePath,
        entryType: "DIRECTORY",
        mode,
        resolvedWithinRoot: withinRoot,
        ...(!withinRoot ? { readError: "Directory resolves outside Workspace root" } : {}),
      });
      if (!withinRoot) {
        context.readErrors.push(
          errorFor(portablePath, "PATH_OUTSIDE_ROOT", "Directory resolves outside Workspace root"),
        );
        continue;
      }
      await walkDirectory({ ...context, absoluteDirectory: canonicalDirectory, portableDirectory: portablePath });
      continue;
    }

    if (stats.isFile()) {
      await captureRegularFile(context, absolutePath, portablePath, stats, mode);
      continue;
    }

    context.entries.push({
      portablePath,
      entryType: "OTHER",
      mode,
      resolvedWithinRoot: true,
    });
  }
}

async function captureSymlink(
  context: WalkContext,
  absolutePath: string,
  portablePath: string,
  mode: number,
): Promise<void> {
  try {
    const linkTarget = await readlink(absolutePath);
    const lexicalTarget = path.resolve(path.dirname(absolutePath), linkTarget);
    let resolvedTarget = lexicalTarget;
    try {
      resolvedTarget = await realpath(absolutePath);
    } catch {
      // A dangling link still has a deterministic lexical target. It is not followed.
    }
    context.entries.push({
      portablePath,
      entryType: "SYMLINK",
      mode,
      linkTarget,
      resolvedWithinRoot:
        isWithinRoot(context.canonicalRoot, lexicalTarget) &&
        isWithinRoot(context.canonicalRoot, resolvedTarget),
    });
  } catch (error) {
    const readError = redactFsError(error);
    context.entries.push({
      portablePath,
      entryType: "SYMLINK",
      mode,
      resolvedWithinRoot: false,
      readError,
    });
    context.readErrors.push(errorFor(portablePath, "SYMLINK_READ_FAILED", readError));
  }
}

async function captureRegularFile(
  context: WalkContext,
  absolutePath: string,
  portablePath: string,
  before: BigIntStats,
  mode: number,
): Promise<void> {
  const byteLength = Number(before.size);
  if (!Number.isSafeInteger(byteLength) || byteLength > context.maxFileBytes) {
    const readError = "File exceeds the frozen per-file capture limit";
    context.entries.push({
      portablePath,
      entryType: "FILE",
      mode,
      ...(Number.isSafeInteger(byteLength) ? { byteLength } : {}),
      resolvedWithinRoot: true,
      readError,
    });
    context.readErrors.push(errorFor(portablePath, "FILE_TOO_LARGE", readError));
    return;
  }

  let handle;
  try {
    const noFollow = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
    handle = await open(absolutePath, fsConstants.O_RDONLY | noFollow);
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFileIdentity(before, opened)) {
      throw new FileChangedDuringScanError();
    }

    const hash = createHash("sha256");
    let bytesReadTotal = 0;
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, byteLength)));
    while (bytesReadTotal < byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, byteLength - bytesReadTotal),
        bytesReadTotal,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      bytesReadTotal += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    if (
      bytesReadTotal !== byteLength ||
      !sameFileIdentity(opened, after) ||
      opened.mtimeNs !== after.mtimeNs ||
      opened.ctimeNs !== after.ctimeNs ||
      opened.size !== after.size
    ) {
      throw new FileChangedDuringScanError();
    }
    context.entries.push({
      portablePath,
      entryType: "FILE",
      mode,
      byteLength,
      contentDigest: {
        algorithm: "sha256",
        value: hash.digest("hex"),
        byteLength,
      },
      resolvedWithinRoot: true,
    });
  } catch (error) {
    const changed = error instanceof FileChangedDuringScanError;
    const reasonCode = changed ? "FILE_CHANGED_DURING_SCAN" : "READ_FAILED";
    const readError = changed ? "File changed while the snapshot was being captured" : redactFsError(error);
    context.entries.push({
      portablePath,
      entryType: "FILE",
      mode,
      byteLength,
      resolvedWithinRoot: true,
      readError,
    });
    context.readErrors.push(errorFor(portablePath, reasonCode, readError));
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

class FileChangedDuringScanError extends Error {}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function finishSnapshot(
  options: CaptureFileSnapshotOptions,
  scanStartedAt: string,
  scanCompletedAt: string,
  entries: readonly FileEntry[],
  readErrors: readonly FileScanError[],
): FileSnapshotDraft {
  const completeness: EvidenceCompleteness = readErrors.length === 0 ? "COMPLETE" : "PARTIAL";
  const manifest = {
    rootBinding: options.rootBinding,
    entries,
    readErrors,
    completeness,
  };
  return {
    snapshotId: options.snapshotId,
    attemptId: options.attemptId,
    phase: options.phase,
    rootBinding: options.rootBinding,
    scanStartedAt,
    scanCompletedAt,
    entries,
    readErrors,
    completeness,
    snapshotDigest: digestCanonical(manifest),
  };
}

function classifyModification(before: FileEntry, after: FileEntry): FileModificationKind | undefined {
  if (before.readError !== undefined || after.readError !== undefined) return "UNREADABLE";
  if (before.entryType === "SYMLINK") {
    if (
      before.linkTarget !== after.linkTarget ||
      before.resolvedWithinRoot !== after.resolvedWithinRoot
    ) {
      return "SYMLINK_CHANGED";
    }
  }
  if (!digestsEqualOptional(before.contentDigest, after.contentDigest)) return "CONTENT_CHANGED";
  if (before.mode !== after.mode || before.byteLength !== after.byteLength) return "METADATA_CHANGED";
  return undefined;
}

function digestCanonical(value: unknown): ContentDigest {
  return digestValue(value);
}

function digestsEqualOptional(left?: ContentDigest, right?: ContentDigest): boolean {
  if (left === undefined || right === undefined) return left === right;
  return digestsEqual(left, right);
}

function digestsEqual(left: ContentDigest, right: ContentDigest): boolean {
  return digestEquals(left, right);
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function errorFor(
  portablePath: string,
  reasonCode: FileScanError["reasonCode"],
  messageRedacted: string,
): FileScanError {
  return { portablePath: portablePath === "" ? "." : portablePath, reasonCode, messageRedacted };
}

/** Canonical bytes committed as the raw File Snapshot Artifact. */
export function serializeFileSnapshotArtifact(snapshot: FileSnapshot): string {
  return `${canonicalJson(snapshot)}\n`;
}

export function fileSnapshotArtifactDigest(snapshot: FileSnapshot): ContentDigest {
  return digestBytes(serializeFileSnapshotArtifact(snapshot));
}

function assertUniqueSortedPaths(paths: readonly string[], label: string): void {
  for (let index = 0; index < paths.length; index += 1) {
    if (index > 0 && compareUtf8(paths[index - 1]!, paths[index]!) >= 0) {
      throw new TypeError(`${label} must contain unique UTF-8-sorted portable paths`);
    }
  }
}

function redactFsError(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "UNKNOWN");
    return `Filesystem operation failed (${code})`;
  }
  return "Filesystem operation failed (UNKNOWN)";
}
