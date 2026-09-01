import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";

import {
  cancelled,
  failed,
  rejected,
  succeeded,
  type ArtifactCommitMetadata,
  type ArtifactStorePort,
  type OperationContext,
  type PortResult,
} from "../core/contracts.js";
import type { FailureDraft } from "../core/errors.js";
import {
  assertDigestEquals,
  assertSameScope,
  ContractViolation,
  digestBytes,
  digestEquals,
  digestValue,
  type ArtifactReadPurpose,
  type ArtifactRef,
  type ContentDigest,
  type IsoDateTime,
  type RunId,
  type ScopeRef,
  validateContentDigest,
  validateIsoDateTime,
  validatePortablePath,
  validateScope,
  validateStableId,
  withContentDigest,
} from "../core/models.js";
import {
  appendCanonicalJsonLine,
  assertAbsoluteStorageRoot,
  atomicCreateImmutable,
  atomicReplace,
  ensureSafeDirectory,
} from "./repositories.js";

export interface FileArtifactStoreOptions {
  readonly artifactRoot: string;
  readonly runRoot: string;
  /** Preallocated partition key; it does not imply that EvaluationRun has been created. */
  readonly runId: RunId | string;
  readonly scope: ScopeRef;
  readonly maxArtifactBytes: number;
}

export interface ArtifactRecoveryIssue {
  readonly code:
    | "STALE_TEMP_FILE"
    | "BAD_INDEX"
    | "DUPLICATE_ARTIFACT_ID"
    | "MISSING_ARTIFACT"
    | "ORPHAN_ARTIFACT"
    | "ARTIFACT_INTEGRITY";
  readonly portableLocation: string;
  readonly detail: string;
}

const PURPOSES = new Set<ArtifactReadPurpose>([
  "TASK_INPUT",
  "INSPECTION",
  "EVIDENCE_CAPTURE",
  "JUDGE_INPUT",
  "REPORT_INPUT",
]);

const ARTIFACT_REF_FIELDS = new Set([
  "schema",
  "artifactId",
  "scope",
  "artifactType",
  "logicalName",
  "mediaType",
  "portablePath",
  "byteLength",
  "artifactContentDigest",
  "producerVersion",
  "createdAt",
  "sensitivity",
  "redactionState",
  "state",
  "contentDigest",
]);

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

function assertScopeAnchored(anchor: ScopeRef, candidate: ScopeRef): void {
  const expected = validateScope(anchor, "artifact store scope");
  const actual = validateScope(candidate, "artifact scope");
  const fields = ["targetId", "targetSnapshotId", "runId", "caseId", "attemptId"] as const;
  for (const field of fields) {
    if (expected[field] !== undefined && actual[field] !== undefined && expected[field] !== actual[field]) {
      throw new ContractViolation("SCOPE_MISMATCH", `artifact ${field} belongs to another partition`);
    }
  }
}

function verifyArtifactRefMetadata(ref: ArtifactRef): void {
  if (ref === null || typeof ref !== "object" || Array.isArray(ref)) {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "ArtifactRef must be an object");
  }
  const unknownFields = Object.keys(ref).filter((field) => !ARTIFACT_REF_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "ArtifactRef contains unknown fields");
  }
  if (ref.schema !== "dsheval.mvp.artifact/v1" || ref.state !== "COMMITTED") {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "ArtifactRef is not a committed MVP artifact");
  }
  validateStableId(ref.artifactId, "artifactId");
  validateScope(ref.scope, "artifact scope");
  validatePortablePath(ref.portablePath, "portablePath");
  validateContentDigest(ref.artifactContentDigest, "artifactContentDigest");
  validateIsoDateTime(ref.createdAt, "createdAt");
  validateStableId(ref.artifactType, "artifactType");
  if (
    typeof ref.logicalName !== "string" ||
    ref.logicalName.length === 0 ||
    ref.logicalName.length > 256 ||
    ref.logicalName.includes("/") ||
    ref.logicalName.includes("\\") ||
    ref.logicalName.includes("\0") ||
    typeof ref.mediaType !== "string" ||
    ref.mediaType.length === 0 ||
    ref.mediaType.length > 128 ||
    /[\u0000-\u001f\u007f]/u.test(ref.mediaType) ||
    typeof ref.producerVersion !== "string" ||
    ref.producerVersion.length === 0 ||
    ref.producerVersion.includes("\0") ||
    !["EXPORTABLE", "RESTRICTED"].includes(ref.sensitivity) ||
    !["NOT_REQUIRED", "APPLIED", "FAILED"].includes(ref.redactionState)
  ) {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "ArtifactRef metadata values are invalid");
  }
  const declared = validateContentDigest(ref.contentDigest, "contentDigest");
  const actual = digestValue(ref, ["contentDigest"]);
  assertDigestEquals(actual, declared);
  if (!Number.isSafeInteger(ref.byteLength) || ref.byteLength < 0) {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "ArtifactRef byteLength is invalid");
  }
  if (ref.portablePath !== `objects/${ref.artifactId}`) {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "ArtifactRef portablePath is not canonical");
  }
  if (ref.sensitivity === "EXPORTABLE" && ref.redactionState === "FAILED") {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "failed redaction cannot be exportable");
  }
}

function parseIndex(text: string): readonly ArtifactRef[] {
  if (text.length > 0 && !text.endsWith("\n")) {
    throw new ContractViolation("BAD_ARTIFACT_INDEX", "artifact index has an incomplete tail");
  }
  const result: ArtifactRef[] = [];
  const ids = new Set<string>();
  for (const [index, line] of text.split("\n").entries()) {
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      throw new ContractViolation("BAD_ARTIFACT_INDEX", `artifact index line ${index + 1} is invalid`, {
        cause: error,
      });
    }
    verifyArtifactRefMetadata(parsed as ArtifactRef);
    const ref = parsed as ArtifactRef;
    if (ids.has(ref.artifactId)) {
      throw new ContractViolation("DUPLICATE_ARTIFACT_ID", "artifact index repeats an artifact ID");
    }
    ids.add(ref.artifactId);
    result.push(ref);
  }
  return result;
}

export class FileArtifactStore implements ArtifactStorePort {
  readonly #artifactRoot: string;
  readonly #runRoot: string;
  readonly #scope: Readonly<ScopeRef>;
  readonly #runId: RunId;
  readonly #maxArtifactBytes: number;
  readonly #idempotency = new Map<string, { readonly input: ContentDigest; readonly result: Promise<PortResult<unknown>> }>();
  #writeQueue: Promise<void> = Promise.resolve();
  #initialization: Promise<void> | undefined;
  #poisoned = false;

  public constructor(options: FileArtifactStoreOptions) {
    assertAbsoluteStorageRoot(options.artifactRoot, "artifactRoot");
    assertAbsoluteStorageRoot(options.runRoot, "runRoot");
    const scope = validateScope(options.scope, "artifact store scope");
    const runId = validateStableId<"RunId">(options.runId, "runId");
    if (scope.runId !== undefined && scope.runId !== runId) {
      throw new ContractViolation("SCOPE_MISMATCH", "artifact anchor runId differs from its partition key");
    }
    if (!Number.isSafeInteger(options.maxArtifactBytes) || options.maxArtifactBytes <= 0) {
      throw new ContractViolation("INVALID_INPUT", "maxArtifactBytes must be a positive integer");
    }
    this.#artifactRoot = resolve(options.artifactRoot);
    this.#runRoot = resolve(options.runRoot);
    this.#scope = scope;
    this.#runId = runId;
    this.#maxArtifactBytes = options.maxArtifactBytes;
  }

  public async commit(
    context: OperationContext,
    bytes: Uint8Array | string,
    metadata: ArtifactCommitMetadata,
  ): Promise<PortResult<Readonly<ArtifactRef>>> {
    const input = {
      bytesDigest: digestBytes(bytes),
      metadata,
    };
    return this.#idempotent("commit", context, input, async () => {
      if (context.cancellationToken.isCancellationRequested) {
        return cancelled(
          this.#failure(context, "CANCELLED", "OPERATION_CANCELLED", "Artifact commit was cancelled", "USER"),
        );
      }
      try {
        const ref = await this.#withWriteLock(async () => this.#commit(bytes, metadata));
        return succeeded(ref);
      } catch (error) {
        return this.#mapError(context, error, "ARTIFACT_COMMIT_FAILED");
      }
    });
  }

  public async readVerified(
    context: OperationContext,
    ref: ArtifactRef,
    scope: ScopeRef,
    purpose: ArtifactReadPurpose,
  ): Promise<PortResult<Uint8Array>> {
    return this.#idempotent("readVerified", context, { ref, scope, purpose }, async () => {
      if (context.cancellationToken.isCancellationRequested) {
        return cancelled(
          this.#failure(context, "CANCELLED", "OPERATION_CANCELLED", "Artifact read was cancelled", "USER"),
        );
      }
      try {
        return succeeded(await this.#readVerified(ref, scope, purpose));
      } catch (error) {
        return this.#mapError(context, error, "ARTIFACT_READ_FAILED");
      }
    });
  }

  /** Atomically replaces the explicitly non-authoritative status page. */
  public async replaceStatusHtml(context: OperationContext, html: string): Promise<PortResult<void>> {
    return this.#idempotent("replaceStatusHtml", context, { html }, async () => {
      if (context.cancellationToken.isCancellationRequested) {
        return cancelled(
          this.#failure(context, "CANCELLED", "OPERATION_CANCELLED", "Status update was cancelled", "USER"),
        );
      }
      try {
        await this.#ensureInitialized();
        const partition = await ensureSafeDirectory(this.#runRoot, [this.#runId]);
        const path = join(partition, "status.html");
        await this.#withWriteLock(async () => atomicReplace(path, html));
        return succeeded(undefined);
      } catch (error) {
        return this.#mapError(context, error, "STATUS_WRITE_FAILED");
      }
    });
  }

  public async inspectRecoveryState(): Promise<readonly ArtifactRecoveryIssue[]> {
    await this.#partitionDirectory();
    return this.#scanRecoveryIssues();
  }

  async #commit(
    source: Uint8Array | string,
    metadata: ArtifactCommitMetadata,
  ): Promise<Readonly<ArtifactRef>> {
    await this.#ensureInitialized();
    if (this.#poisoned) {
      throw new ContractViolation("STORAGE_RECOVERY_REQUIRED", "artifact store has an incomplete commit");
    }
    const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
    if (bytes.byteLength > this.#maxArtifactBytes) {
      throw new ContractViolation("INVALID_INPUT", "artifact exceeds maxArtifactBytes");
    }
    const artifactId = validateStableId<"ArtifactId">(metadata.artifactId, "artifactId");
    const scope = validateScope(metadata.scope, "artifact scope");
    if (scope.runId !== undefined && scope.runId !== this.#runId) {
      throw new ContractViolation("SCOPE_MISMATCH", "artifact belongs to another run partition");
    }
    assertScopeAnchored(this.#scope, scope);
    validateStableId(metadata.artifactType, "artifactType");
    validateIsoDateTime(metadata.createdAt, "createdAt");
    if (
      !["EXPORTABLE", "RESTRICTED"].includes(metadata.sensitivity) ||
      !["NOT_REQUIRED", "APPLIED", "FAILED"].includes(metadata.redactionState) ||
      metadata.producerVersion.length === 0 ||
      metadata.producerVersion.includes("\0")
    ) {
      throw new ContractViolation("INVALID_INPUT", "artifact sensitivity, redaction or producerVersion is invalid");
    }
    if (
      metadata.logicalName.length === 0 ||
      metadata.logicalName.length > 256 ||
      metadata.logicalName.includes("/") ||
      metadata.logicalName.includes("\\") ||
      metadata.logicalName.includes("\0")
    ) {
      throw new ContractViolation("INVALID_INPUT", "logicalName must be a path-free display name");
    }
    if (
      metadata.mediaType.length === 0 ||
      metadata.mediaType.length > 128 ||
      /[\u0000-\u001f\u007f]/u.test(metadata.mediaType)
    ) {
      throw new ContractViolation("INVALID_INPUT", "mediaType is invalid");
    }
    if (metadata.sensitivity === "EXPORTABLE" && metadata.redactionState === "FAILED") {
      throw new ContractViolation("AUTHORIZATION_DENIED", "failed redaction must remain restricted");
    }
    const artifactContentDigest = digestBytes(bytes);
    const withoutDigest = {
      schema: "dsheval.mvp.artifact/v1" as const,
      artifactId,
      scope,
      artifactType: metadata.artifactType,
      logicalName: metadata.logicalName,
      mediaType: metadata.mediaType,
      portablePath: validatePortablePath(`objects/${artifactId}`),
      byteLength: bytes.byteLength,
      artifactContentDigest,
      producerVersion: metadata.producerVersion,
      createdAt: metadata.createdAt,
      sensitivity: metadata.sensitivity,
      redactionState: metadata.redactionState,
      state: "COMMITTED" as const,
    };
    const proposed: ArtifactRef = withContentDigest(withoutDigest);
    const index = await this.#loadIndex();
    const existing = index.find((item) => item.artifactId === artifactId);
    if (existing !== undefined) {
      if (!digestEquals(existing.contentDigest, proposed.contentDigest)) {
        throw new ContractViolation("IMMUTABILITY_CONFLICT", "artifact ID already has different content or metadata");
      }
      await this.#readVerified(existing, scope, "EVIDENCE_CAPTURE");
      return existing;
    }

    const objects = await this.#objectsDirectory();
    const finalPath = join(objects, artifactId);
    if (await this.#pathExists(finalPath)) {
      throw new ContractViolation("STORAGE_RECOVERY_REQUIRED", "artifact bytes exist without a committed index entry");
    }
    await atomicCreateImmutable(finalPath, bytes);
    try {
      const partition = await this.#partitionDirectory();
      await appendCanonicalJsonLine(join(partition, "index.jsonl"), proposed);
    } catch (error) {
      this.#poisoned = true;
      throw error;
    }
    return proposed;
  }

  async #readVerified(
    suppliedRef: ArtifactRef,
    suppliedScope: ScopeRef,
    purpose: ArtifactReadPurpose,
  ): Promise<Uint8Array> {
    await this.#ensureInitialized();
    verifyArtifactRefMetadata(suppliedRef);
    if (!PURPOSES.has(purpose)) {
      throw new ContractViolation("AUTHORIZATION_DENIED", "artifact read purpose is not an MVP purpose");
    }
    const scope = validateScope(suppliedScope, "read scope");
    assertSameScope(suppliedRef.scope, scope);
    if (scope.runId !== undefined && scope.runId !== this.#runId) {
      throw new ContractViolation("SCOPE_MISMATCH", "artifact read belongs to another run partition");
    }
    assertScopeAnchored(this.#scope, scope);
    if (
      suppliedRef.sensitivity === "RESTRICTED" &&
      (purpose === "TASK_INPUT" || purpose === "REPORT_INPUT")
    ) {
      throw new ContractViolation("AUTHORIZATION_DENIED", "restricted artifact is not authorized for this purpose");
    }
    const committed = (await this.#loadIndex()).find(
      (item) => item.artifactId === suppliedRef.artifactId,
    );
    if (committed === undefined) {
      throw new ContractViolation("NOT_FOUND", "ArtifactRef is not present in the committed index");
    }
    if (!digestEquals(committed.contentDigest, suppliedRef.contentDigest)) {
      throw new ContractViolation("EVIDENCE_INTEGRITY", "supplied ArtifactRef metadata was altered");
    }
    const objects = await this.#objectsDirectory();
    const path = resolve(objects, suppliedRef.artifactId);
    const canonicalObjects = await realpath(objects);
    if (!isWithin(canonicalObjects, path)) {
      throw new ContractViolation("PATH_ESCAPE", "artifact path escaped the object root");
    }
    let before: Awaited<ReturnType<typeof lstat>>;
    let data: Buffer;
    let after: Awaited<ReturnType<typeof lstat>>;
    try {
      before = await lstat(path);
      if (!before.isFile() || before.isSymbolicLink()) {
        throw new ContractViolation("PATH_ESCAPE", "artifact object is not a regular file");
      }
      const resolved = await realpath(path);
      if (!isWithin(canonicalObjects, resolved)) {
        throw new ContractViolation("PATH_ESCAPE", "artifact object resolved outside the object root");
      }
      data = await readFile(resolved);
      after = await lstat(resolved);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new ContractViolation("EVIDENCE_INTEGRITY", "committed artifact bytes are missing");
      }
      throw error;
    }
    if (
      !after.isFile() ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      data.byteLength !== suppliedRef.byteLength
    ) {
      throw new ContractViolation("EVIDENCE_INTEGRITY", "artifact changed while it was being read");
    }
    const actualDigest = digestBytes(data);
    assertDigestEquals(actualDigest, suppliedRef.artifactContentDigest);
    return new Uint8Array(data);
  }

  async #loadIndex(): Promise<readonly ArtifactRef[]> {
    const partition = await this.#partitionDirectory();
    const indexPath = join(partition, "index.jsonl");
    try {
      const info = await lstat(indexPath);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new ContractViolation("PATH_ESCAPE", "artifact index is not a regular file");
      }
      return parseIndex(await readFile(indexPath, "utf8"));
    } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw error;
    }
  }

  async #partitionDirectory(): Promise<string> {
    return ensureSafeDirectory(this.#artifactRoot, [this.#runId]);
  }

  async #objectsDirectory(): Promise<string> {
    return ensureSafeDirectory(await this.#partitionDirectory(), ["objects"]);
  }

  async #ensureInitialized(): Promise<void> {
    this.#initialization ??= (async () => {
      await this.#partitionDirectory();
      const issues = await this.#scanRecoveryIssues();
      if (issues.length > 0) {
        throw new ContractViolation(
          "STORAGE_RECOVERY_REQUIRED",
          `artifact recovery is required (${issues.map((issue) => issue.code).join(", ")})`,
        );
      }
    })();
    return this.#initialization;
  }

  async #scanRecoveryIssues(): Promise<readonly ArtifactRecoveryIssue[]> {
    const issues: ArtifactRecoveryIssue[] = [];
    let refs: readonly ArtifactRef[] = [];
    try {
      refs = await this.#loadIndex();
    } catch {
      issues.push({ code: "BAD_INDEX", portableLocation: "index.jsonl", detail: "index cannot be verified" });
    }
    const indexed = new Set<string>(refs.map((ref) => ref.artifactId));
    const objects = await this.#objectsDirectory();
    const entries = await readdir(objects, { withFileTypes: true });
    for (const entry of entries) {
      const location = `objects/${entry.name}`;
      if (entry.name.startsWith(".tmp-") || entry.name.endsWith(".partial")) {
        issues.push({ code: "STALE_TEMP_FILE", portableLocation: location, detail: "uncommitted artifact stage" });
        continue;
      }
      if (entry.isSymbolicLink() || !entry.isFile()) {
        issues.push({ code: "ARTIFACT_INTEGRITY", portableLocation: location, detail: "object is not a regular file" });
        continue;
      }
      if (!indexed.has(entry.name)) {
        issues.push({ code: "ORPHAN_ARTIFACT", portableLocation: location, detail: "object has no committed index entry" });
      }
    }
    for (const ref of refs) {
      const path = join(objects, ref.artifactId);
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink() || info.size !== ref.byteLength) {
          issues.push({
            code: "ARTIFACT_INTEGRITY",
            portableLocation: ref.portablePath,
            detail: "indexed object type or length does not match",
          });
          continue;
        }
        const digest = digestBytes(await readFile(path));
        if (!digestEquals(digest, ref.artifactContentDigest)) {
          issues.push({ code: "ARTIFACT_INTEGRITY", portableLocation: ref.portablePath, detail: "indexed object digest does not match" });
        }
      } catch (error) {
        if (errorCode(error) === "ENOENT") {
          issues.push({ code: "MISSING_ARTIFACT", portableLocation: ref.portablePath, detail: "indexed object is missing" });
        } else {
          issues.push({ code: "ARTIFACT_INTEGRITY", portableLocation: ref.portablePath, detail: "indexed object cannot be verified" });
        }
      }
    }
    return issues;
  }

  async #pathExists(path: string): Promise<boolean> {
    try {
      await lstat(path);
      return true;
    } catch (error) {
      if (errorCode(error) === "ENOENT") return false;
      throw error;
    }
  }

  async #withWriteLock<T>(action: () => Promise<T>): Promise<T> {
    const preceding = this.#writeQueue;
    let release!: () => void;
    this.#writeQueue = new Promise<void>((resolvePromise) => {
      release = resolvePromise;
    });
    await preceding;
    try {
      return await action();
    } finally {
      release();
    }
  }

  async #idempotent<T>(
    operation: string,
    context: OperationContext,
    input: unknown,
    action: () => Promise<PortResult<T>>,
  ): Promise<PortResult<T>> {
    let inputDigest: ContentDigest;
    try {
      inputDigest = digestValue(input);
    } catch (error) {
      return this.#mapError(context, error, "INVALID_OPERATION_INPUT");
    }
    const key = `${operation}:${context.idempotencyKey}`;
    const existing = this.#idempotency.get(key);
    if (existing !== undefined) {
      if (!digestEquals(existing.input, inputDigest)) {
        return rejected("CONFLICT", [
          this.#failure(context, "PERSISTENCE_FAILURE", "IDEMPOTENCY_KEY_REUSED", "Idempotency key was reused with different input"),
        ]);
      }
      return existing.result as Promise<PortResult<T>>;
    }
    const result = action();
    this.#idempotency.set(key, { input: inputDigest, result: result as Promise<PortResult<unknown>> });
    return result;
  }

  #mapError<T>(context: OperationContext, error: unknown, fallbackReason: string): PortResult<T> {
    if (error instanceof ContractViolation) {
      const rejection =
        error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "IMMUTABILITY_CONFLICT"
            ? "CONFLICT"
            : error.code === "AUTHORIZATION_DENIED" || error.code === "PATH_ESCAPE" || error.code === "SCOPE_MISMATCH"
              ? "AUTHORIZATION_DENIED"
              : error.code === "STORAGE_RECOVERY_REQUIRED" || error.code === "BAD_ARTIFACT_INDEX"
                ? "PRECONDITION_FAILED"
                : "INVALID_INPUT";
      const category = error.code === "EVIDENCE_INTEGRITY" ? "EVIDENCE_INTEGRITY" : "PERSISTENCE_FAILURE";
      return rejected(rejection, [
        this.#failure(context, category, error.code || fallbackReason, "Artifact operation was rejected as unsafe or invalid"),
      ]);
    }
    return failed(
      this.#failure(context, "PERSISTENCE_FAILURE", fallbackReason, "Artifact storage could not persist or verify bytes"),
    );
  }

  #failure(
    _context: OperationContext,
    category: FailureDraft["category"],
    reasonCode: string,
    messageRedacted: string,
    origin: FailureDraft["origin"] = "DSHEVAL",
  ): FailureDraft {
    return {
      scope: this.#scope,
      category,
      origin,
      actor: "STORAGE",
      phase: "STORAGE",
      severity: "ERROR",
      retryable: false,
      messageRedacted,
      reasonCode,
      evidenceRefs: [],
      artifactRefs: [],
      occurredAt: new Date().toISOString() as IsoDateTime,
    };
  }
}

export { FileArtifactStore as ArtifactStore };
