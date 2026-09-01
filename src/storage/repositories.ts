import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

import {
  cancelled,
  failed,
  rejected,
  succeeded,
  type OperationContext,
  type PortResult,
  type RepositoryPort,
} from "../core/contracts.js";
import { type FailureDraft } from "../core/errors.js";
import {
  assertDigestEquals,
  assertLegalTransition,
  assertSameScope,
  canonicalJson,
  ContractViolation,
  digestEquals,
  digestValue,
  isLifecycleSchema,
  refForProjection,
  type ContentDigest,
  type IsoDateTime,
  type LifecycleAggregateSchema,
  type LifecycleEvent,
  type LifecycleProjectionBase,
  type Ref,
  type RunId,
  type ScopeRef,
  type StableId,
  type StateTransition,
  validateContentDigest,
  validateRef,
  validateSchemaId,
  validateScope,
  validateStableId,
  withContentDigest,
} from "../core/models.js";

export interface FileRepositoryOptions {
  readonly runRoot: string;
  /** Preallocated partition key; the EvaluationRun itself is still created only at step 4. */
  readonly runId: RunId | string;
  /** Target-level or deeper anchor used for cross-target checks and storage failures. */
  readonly scope: ScopeRef;
  readonly producerVersion: string;
}

export interface RecoveryIssue {
  readonly code:
    | "STALE_TEMP_FILE"
    | "BAD_JSONL"
    | "DUPLICATE_EVENT_ID"
    | "ORPHAN_PROJECTION_REVISION";
  readonly portableLocation: string;
  readonly detail: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const SCOPELESS_SCHEMAS = new Set([
  "dsheval.mvp.target-descriptor/v1",
  "dsheval.mvp.filesystem-pack/v1",
  "dsheval.mvp.config/v1",
]);

const ID_FIELDS: Readonly<Record<string, string>> = {
  "dsheval.mvp.target-descriptor/v1": "targetId",
  "dsheval.mvp.target-snapshot/v1": "targetSnapshotId",
  "dsheval.mvp.inspection/v1": "inspectionId",
  "dsheval.mvp.filesystem-pack/v1": "packId",
  "dsheval.mvp.config/v1": "configId",
  "dsheval.mvp.evaluation-plan/v1": "evaluationPlanId",
  "dsheval.mvp.observation-plan/v1": "observationPlanId",
  "dsheval.mvp.evidence-contract/v1": "evidenceContractId",
  "dsheval.mvp.control-event/v1": "controlEventId",
  "dsheval.mvp.seed-manifest/v1": "seedManifestId",
  "dsheval.mvp.security-preflight/v1": "preflightId",
  "dsheval.mvp.reset-verification/v1": "verificationId",
  "dsheval.mvp.lease/v1": "leaseId",
  "dsheval.mvp.source/v1": "sourceId",
  "dsheval.mvp.raw-observation/v1": "observationId",
  "dsheval.mvp.collection-status/v1": "collectionStatusId",
  "dsheval.mvp.file-snapshot/v1": "snapshotId",
  "dsheval.mvp.file-diff/v1": "diffId",
  "dsheval.mvp.evidence/v1": "evidenceId",
  "dsheval.mvp.evidence-bundle/v1": "bundleId",
  "dsheval.mvp.evidence-closure/v1": "closureId",
  "dsheval.mvp.judgement/v1": "judgementId",
  "dsheval.mvp.finding/v1": "findingId",
  "dsheval.mvp.check-result/v1": "checkResultId",
  "dsheval.mvp.gate/v1": "gateDecisionId",
  "dsheval.mvp.report/v1": "reportId",
  "dsheval.mvp.artifact/v1": "artifactId",
  "dsheval.mvp.failure/v1": "failureId",
  "dsheval.mvp.lifecycle-event/v1": "eventId",
};

const PROJECTION_ID_FIELDS: Readonly<Record<LifecycleAggregateSchema, string>> = {
  "dsheval.mvp.run/v1": "runId",
  "dsheval.mvp.case/v1": "caseId",
  "dsheval.mvp.attempt/v1": "attemptId",
  "dsheval.mvp.environment/v1": "environmentInstanceId",
  "dsheval.mvp.observation-session/v1": "observationSessionId",
};

const EVENT_FILES: Readonly<Record<string, string>> = {
  "dsheval.mvp.failure/v1": "failures.jsonl",
  "dsheval.mvp.raw-observation/v1": "raw-observations.jsonl",
};

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const value = (error as { readonly code?: unknown }).code;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

export function assertAbsoluteStorageRoot(root: string, fieldName: string): void {
  if (!isAbsolute(root) || root === parse(root).root || root.includes("\0")) {
    throw new ContractViolation(
      "INVALID_STORAGE_ROOT",
      `${fieldName} must be a non-root absolute path`,
    );
  }
}

async function existingLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  }
}

export async function ensureSafeDirectory(root: string, segments: readonly string[]): Promise<string> {
  assertAbsoluteStorageRoot(root, "storage root");
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new ContractViolation("PATH_ESCAPE", "storage root must be a real directory, not a symlink");
  }
  const canonicalRoot = await realpath(root);
  let current = canonicalRoot;
  for (const [index, segment] of segments.entries()) {
    validateStableId(segment, `path segment[${index}]`);
    const candidate = resolve(current, segment);
    if (!isWithin(canonicalRoot, candidate)) {
      throw new ContractViolation("PATH_ESCAPE", "storage path escaped its configured root");
    }
    const before = await existingLstat(candidate);
    if (before === undefined) {
      await mkdir(candidate, { mode: 0o700 });
    } else if (!before.isDirectory() || before.isSymbolicLink()) {
      throw new ContractViolation("PATH_ESCAPE", "storage path component is not a real directory");
    }
    const after = await lstat(candidate);
    if (!after.isDirectory() || after.isSymbolicLink()) {
      throw new ContractViolation("PATH_ESCAPE", "storage path component became unsafe");
    }
    current = await realpath(candidate);
    if (!isWithin(canonicalRoot, current)) {
      throw new ContractViolation("PATH_ESCAPE", "storage path resolved outside its configured root");
    }
  }
  return current;
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export async function atomicCreateImmutable(path: string, bytes: Uint8Array | string): Promise<void> {
  const parent = dirname(path);
  const parentReal = await realpath(parent);
  const target = resolve(parentReal, validateStableId(path.slice(path.lastIndexOf(sep) + 1), "file name"));
  if (!isWithin(parentReal, target)) {
    throw new ContractViolation("PATH_ESCAPE", "immutable target escaped its parent directory");
  }
  if ((await existingLstat(target)) !== undefined) {
    throw new ContractViolation("IMMUTABILITY_CONFLICT", "immutable target already exists");
  }
  const tempPath = join(parentReal, `.tmp-${randomUUID()}`);
  const handle = await open(tempPath, "wx", 0o600);
  let published = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await chmod(tempPath, 0o400);
    try {
      await link(tempPath, target);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw new ContractViolation("IMMUTABILITY_CONFLICT", "immutable target already exists");
      }
      throw error;
    }
    published = true;
    await unlink(tempPath);
    await syncDirectory(parentReal);
  } finally {
    try {
      await handle.close();
    } catch {
      // Closing an already closed descriptor is harmless; write/flush failures still propagate above.
    }
    if (!published) {
      try {
        await unlink(tempPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
}

export async function atomicReplace(path: string, bytes: Uint8Array | string): Promise<void> {
  const parent = dirname(path);
  const parentReal = await realpath(parent);
  const targetName = path.slice(path.lastIndexOf(sep) + 1);
  validateStableId(targetName, "file name");
  const target = resolve(parentReal, targetName);
  if (!isWithin(parentReal, target)) {
    throw new ContractViolation("PATH_ESCAPE", "replace target escaped its parent directory");
  }
  const existing = await existingLstat(target);
  if (existing?.isSymbolicLink() === true || (existing !== undefined && !existing.isFile())) {
    throw new ContractViolation("PATH_ESCAPE", "replace target must be a regular file");
  }
  const tempPath = join(parentReal, `.tmp-${randomUUID()}`);
  const handle = await open(tempPath, "wx", 0o600);
  let renamed = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await chmod(tempPath, 0o400);
    await rename(tempPath, target);
    renamed = true;
    await syncDirectory(parentReal);
  } finally {
    try {
      await handle.close();
    } catch {
      // See atomicCreateImmutable.
    }
    if (!renamed) {
      try {
        await unlink(tempPath);
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
      }
    }
  }
}

export async function appendCanonicalJsonLine(path: string, value: unknown): Promise<void> {
  const line = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
  const parent = await realpath(dirname(path));
  const name = path.slice(path.lastIndexOf(sep) + 1);
  validateStableId(name, "JSONL file name");
  const target = resolve(parent, name);
  if (!isWithin(parent, target)) throw new ContractViolation("PATH_ESCAPE", "JSONL path escaped parent");
  const existing = await existingLstat(target);
  if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new ContractViolation("PATH_ESCAPE", "JSONL target must be a regular file");
  }
  const handle = await open(
    target,
    constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const { bytesWritten } = await handle.write(line, 0, line.byteLength, null);
    if (bytesWritten !== line.byteLength) {
      throw new ContractViolation("PERSISTENCE_FAILURE", "JSONL append was not a complete line write");
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(parent);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value as Readonly<T>;
}

function schemaKind(schema: string): string {
  validateSchemaId(schema);
  const match = /^dsheval\.mvp\.([a-z0-9-]+)\/v1$/u.exec(schema);
  if (match?.[1] === undefined) {
    throw new ContractViolation("INVALID_SCHEMA", "schema cannot be routed to a record kind");
  }
  return match[1];
}

function immutableIdentity(record: UnknownRecord): { readonly schema: string; readonly id: StableId } {
  const schema = validateSchemaId(record.schema);
  if (isLifecycleSchema(schema)) {
    throw new ContractViolation("INVALID_INPUT", "lifecycle records must use projection methods");
  }
  const idField = ID_FIELDS[schema];
  if (idField === undefined) {
    throw new ContractViolation("UNSUPPORTED_SCHEMA", `schema ${schema} is not part of the MVP catalog`);
  }
  return { schema, id: validateStableId(record[idField], idField) };
}

function projectionIdentity(
  projection: LifecycleProjectionBase,
): { readonly schema: LifecycleAggregateSchema; readonly id: StableId } {
  if (!isLifecycleSchema(projection.schema)) {
    throw new ContractViolation("INVALID_SCHEMA", "projection schema is not an MVP lifecycle schema");
  }
  const idField = PROJECTION_ID_FIELDS[projection.schema];
  const raw = projection as unknown as Record<string, unknown>;
  const businessId = validateStableId(raw[idField], idField);
  const aggregateId = validateStableId(projection.aggregateId, "aggregateId");
  if (businessId !== aggregateId) {
    throw new ContractViolation("INVALID_PROJECTION", `${idField} must equal aggregateId`);
  }
  return { schema: projection.schema, id: aggregateId };
}

function verifyImmutableDigest(record: UnknownRecord): ContentDigest {
  const declared = validateContentDigest(record.contentDigest, "contentDigest");
  const actual = digestValue(record, ["contentDigest"]);
  assertDigestEquals(actual, declared);
  return declared;
}

function verifyProjectionDigest(projection: LifecycleProjectionBase): ContentDigest {
  const declared = validateContentDigest(projection.projectionDigest, "projectionDigest");
  const actual = digestValue(projection, ["projectionDigest"]);
  assertDigestEquals(actual, declared);
  return declared;
}

function assertScopeCompatible(owner: ScopeRef, referenced: ScopeRef): void {
  const current = validateScope(owner, "record scope");
  const dependency = validateScope(referenced, "referenced scope");
  const fields = ["targetId", "targetSnapshotId", "runId", "caseId", "attemptId"] as const;
  for (const field of fields) {
    if (current[field] !== undefined && dependency[field] !== undefined && current[field] !== dependency[field]) {
      throw new ContractViolation("SCOPE_MISMATCH", `referenced ${field} belongs to another scope`);
    }
  }
}

function collectRefs(value: unknown, refs: Ref[], visited = new Set<object>()): void {
  if (value === null || typeof value !== "object") return;
  if (visited.has(value)) return;
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, refs, visited);
    return;
  }
  const record = value as Record<string, unknown>;
  if ("schema" in record && "id" in record && "digest" in record) {
    refs.push(validateRef(record, { lifecycle: record.revision !== undefined }));
    return;
  }
  for (const nested of Object.values(record)) collectRefs(nested, refs, visited);
}

export class FileRepository implements RepositoryPort {
  readonly #runRoot: string;
  readonly #scope: Readonly<ScopeRef>;
  readonly #runId: RunId;
  readonly #idempotency = new Map<string, { readonly input: ContentDigest; readonly result: Promise<PortResult<unknown>> }>();
  #writeQueue: Promise<void> = Promise.resolve();
  #initialization: Promise<void> | undefined;

  public constructor(options: FileRepositoryOptions) {
    assertAbsoluteStorageRoot(options.runRoot, "runRoot");
    const scope = validateScope(options.scope, "repository scope");
    const runId = validateStableId<"RunId">(options.runId, "runId");
    if (scope.runId !== undefined && scope.runId !== runId) {
      throw new ContractViolation("SCOPE_MISMATCH", "repository anchor runId differs from its partition key");
    }
    this.#runRoot = resolve(options.runRoot);
    this.#scope = scope;
    this.#runId = runId;
  }

  public async putImmutable<T extends object>(
    context: OperationContext,
    record: T,
  ): Promise<PortResult<Readonly<Ref<T>>>> {
    return this.#idempotent("putImmutable", context, record, async () => {
      const cancelledResult = this.#cancelledIfRequested<T>(context);
      if (cancelledResult !== undefined) return cancelledResult as PortResult<Readonly<Ref<T>>>;
      try {
        const result = await this.#withWriteLock(async () => this.#putImmutable(record));
        return succeeded(result);
      } catch (error) {
        return this.#mapError<Readonly<Ref<T>>>(context, error, "PUT_IMMUTABLE_FAILED");
      }
    });
  }

  public async createProjection<T extends LifecycleProjectionBase>(
    context: OperationContext,
    initialProjection: T,
  ): Promise<PortResult<Readonly<Ref<T> & { readonly revision: 0 }>>> {
    return this.#idempotent("createProjection", context, initialProjection, async () => {
      const cancelledResult = this.#cancelledIfRequested<T>(context);
      if (cancelledResult !== undefined) {
        return cancelledResult as PortResult<Readonly<Ref<T> & { readonly revision: 0 }>>;
      }
      try {
        const result = await this.#withWriteLock(async () => this.#createProjection(initialProjection));
        return succeeded(result);
      } catch (error) {
        return this.#mapError<Readonly<Ref<T> & { readonly revision: 0 }>>(
          context,
          error,
          "CREATE_PROJECTION_FAILED",
        );
      }
    });
  }

  public async appendTransition<T extends LifecycleProjectionBase>(
    context: OperationContext,
    transition: StateTransition<T>,
  ): Promise<PortResult<Readonly<Ref<T> & { readonly revision: number }>>> {
    return this.#idempotent("appendTransition", context, transition, async () => {
      const cancelledResult = this.#cancelledIfRequested<T>(context);
      if (cancelledResult !== undefined) {
        return cancelledResult as PortResult<Readonly<Ref<T> & { readonly revision: number }>>;
      }
      try {
        const result = await this.#withWriteLock(async () => this.#appendTransition(transition));
        return succeeded(result);
      } catch (error) {
        return this.#mapError<Readonly<Ref<T> & { readonly revision: number }>>(
          context,
          error,
          "APPEND_TRANSITION_FAILED",
        );
      }
    });
  }

  public async get<T>(context: OperationContext, ref: Ref<T>): Promise<PortResult<Readonly<T>>> {
    return this.#idempotent("get", context, ref, async () => {
      const cancelledResult = this.#cancelledIfRequested<T>(context);
      if (cancelledResult !== undefined) return cancelledResult as PortResult<Readonly<T>>;
      try {
        await this.#ensureInitialized();
        return succeeded(await this.#readRef(ref));
      } catch (error) {
        return this.#mapError<Readonly<T>>(context, error, "READ_RECORD_FAILED");
      }
    });
  }

  public async inspectRecoveryState(): Promise<readonly RecoveryIssue[]> {
    const partition = await this.#partitionDirectory();
    return this.#scanRecoveryIssues(partition);
  }

  async #putImmutable<T extends object>(record: T): Promise<Readonly<Ref<T>>> {
    await this.#ensureInitialized();
    const raw = record as UnknownRecord;
    const { schema, id } = immutableIdentity(raw);
    const digest = verifyImmutableDigest(raw);
    await this.#validateRecordScopeAndRefs(raw);
    const path = await this.#immutablePath(schema, id);
    const existing = await existingLstat(path);
    if (existing !== undefined) {
      const stored = await this.#readJson(path);
      const storedDigest = verifyImmutableDigest(stored);
      if (!digestEquals(digest, storedDigest)) {
        throw new ContractViolation("IMMUTABILITY_CONFLICT", "same schema/id has different content");
      }
      return Object.freeze({ schema, id, digest });
    }
    if (schema === "dsheval.mvp.gate/v1") {
      const siblings = await readdir(dirname(path), { withFileTypes: true });
      const otherGate = siblings.find(
        (entry) => entry.name.endsWith(".json") && entry.name !== `${id}.json`,
      );
      if (otherGate !== undefined) {
        throw new ContractViolation("IMMUTABILITY_CONFLICT", "the run already has its unique GateDecision");
      }
      await this.#validateGateCommitOrder(raw);
    }
    await atomicCreateImmutable(path, canonicalJson(raw));
    const eventFile = EVENT_FILES[schema];
    if (eventFile !== undefined) {
      const events = await ensureSafeDirectory(await this.#partitionDirectory(), ["events"]);
      await appendCanonicalJsonLine(join(events, eventFile), raw);
    }
    return Object.freeze({ schema, id, digest });
  }

  async #createProjection<T extends LifecycleProjectionBase>(
    projection: T,
  ): Promise<Readonly<Ref<T> & { readonly revision: 0 }>> {
    await this.#ensureInitialized();
    const { schema, id } = projectionIdentity(projection);
    if (projection.revision !== 0) {
      throw new ContractViolation("INVALID_PROJECTION", "initial lifecycle revision must be 0");
    }
    verifyProjectionDigest(projection);
    this.#assertPartitionScope(projection.scope);
    await this.#validateReferences(projection, projection.scope);
    const revisionPath = await this.#projectionRevisionPath(schema, id, 0);
    const currentPath = await this.#projectionCurrentPath(schema, id);
    const existingRevision = await existingLstat(revisionPath);
    if (existingRevision !== undefined) {
      const existing = (await this.#readJson(revisionPath)) as unknown as T;
      const existingDigest = verifyProjectionDigest(existing);
      if (!digestEquals(existingDigest, projection.projectionDigest)) {
        throw new ContractViolation("IMMUTABILITY_CONFLICT", "revision 0 already has different content");
      }
      return refForProjection(existing) as Readonly<Ref<T> & { readonly revision: 0 }>;
    }
    if ((await existingLstat(currentPath)) !== undefined) {
      throw new ContractViolation("IMMUTABILITY_CONFLICT", "lifecycle aggregate already exists");
    }
    const bytes = canonicalJson(projection);
    await atomicCreateImmutable(revisionPath, bytes);
    await atomicCreateImmutable(currentPath, bytes);
    return refForProjection(projection) as Readonly<Ref<T> & { readonly revision: 0 }>;
  }

  async #appendTransition<T extends LifecycleProjectionBase>(
    transition: StateTransition<T>,
  ): Promise<Readonly<Ref<T> & { readonly revision: number }>> {
    await this.#ensureInitialized();
    const next = transition.nextProjection;
    const { schema, id } = projectionIdentity(next);
    const aggregateRef = validateRef<T>(transition.aggregateRef, {
      lifecycle: true,
      fieldName: "aggregateRef",
    });
    if (aggregateRef.schema !== schema || aggregateRef.id !== id) {
      throw new ContractViolation("INVALID_TRANSITION", "transition aggregate Ref does not match projection");
    }
    if (aggregateRef.revision !== transition.expectedRevision) {
      throw new ContractViolation("STALE_REVISION", "aggregate Ref revision differs from expectedRevision");
    }
    const priorByRef = await this.#readRef(aggregateRef);
    if (priorByRef.state !== transition.fromState) {
      throw new ContractViolation("STALE_REVISION", "aggregate Ref state differs from transition fromState");
    }
    if (
      next.revision !== transition.expectedRevision + 1 ||
      next.state !== transition.toState ||
      next.aggregateId !== priorByRef.aggregateId ||
      next.schema !== priorByRef.schema
    ) {
      throw new ContractViolation("INVALID_TRANSITION", "next projection identity, revision or state is inconsistent");
    }
    assertSameScope(priorByRef.scope, next.scope);
    assertLegalTransition(schema, String(transition.fromState), String(transition.toState));
    verifyProjectionDigest(next);
    await this.#validateReferences(next, next.scope);
    await this.#validateReferences(
      { supportingRefs: transition.supportingRefs, failureRefs: transition.failureRefs },
      next.scope,
    );
    const currentPath = await this.#projectionCurrentPath(schema, id);
    const current = (await this.#readJson(currentPath)) as unknown as T;
    projectionIdentity(current);
    const currentDigest = verifyProjectionDigest(current);
    if (current.revision === transition.expectedRevision + 1) {
      const replayDigest = verifyProjectionDigest(next);
      if (current.revision === next.revision && digestEquals(currentDigest, replayDigest)) {
        return refForProjection(current);
      }
    }
    if (current.revision !== transition.expectedRevision) {
      throw new ContractViolation("STALE_REVISION", "expected lifecycle revision is stale");
    }
    if (
      aggregateRef.revision !== current.revision ||
      !digestEquals(aggregateRef.digest, currentDigest) ||
      transition.fromState !== current.state
    ) {
      throw new ContractViolation("STALE_REVISION", "aggregate Ref does not identify current projection");
    }
    const nextPath = await this.#projectionRevisionPath(schema, id, next.revision);
    if ((await existingLstat(nextPath)) !== undefined) {
      throw new ContractViolation("IMMUTABILITY_CONFLICT", "next revision file already exists");
    }
    await atomicCreateImmutable(nextPath, canonicalJson(next));

    const eventWithoutDigest = {
      schema: "dsheval.mvp.lifecycle-event/v1" as const,
      eventId: validateStableId<"LifecycleEventId">(
        `lifecycle-${digestValue({ schema, id, revision: next.revision }).value}`,
        "eventId",
      ),
      aggregateSchema: schema,
      aggregateId: id,
      scope: next.scope,
      revision: next.revision,
      fromState: current.state,
      toState: next.state,
      reasonCode: transition.reasonCode,
      supportingRefs: transition.supportingRefs,
      failureRefs: transition.failureRefs,
      occurredAt: transition.occurredAt,
      priorProjectionRef: refForProjection(current),
      nextProjectionDigest: next.projectionDigest,
    };
    const event: LifecycleEvent = withContentDigest(eventWithoutDigest);
    const events = await ensureSafeDirectory(await this.#partitionDirectory(), ["events"]);
    await appendCanonicalJsonLine(join(events, "lifecycle.jsonl"), event);
    await atomicReplace(currentPath, canonicalJson(next));
    return refForProjection(next);
  }

  async #validateRecordScopeAndRefs(record: UnknownRecord): Promise<void> {
    const schema = String(record.schema);
    if (SCOPELESS_SCHEMAS.has(schema)) {
      if (record.scope !== undefined) {
        throw new ContractViolation("INVALID_SCOPE", `${schema} must be scope-less`);
      }
      if (
        schema === "dsheval.mvp.target-descriptor/v1" &&
        record.targetId !== this.#scope.targetId
      ) {
        throw new ContractViolation("SCOPE_MISMATCH", "TargetDescriptor belongs to another target partition");
      }
    } else {
      this.#assertPartitionScope(record.scope);
    }
    if (schema === "dsheval.mvp.gate/v1") {
      if (record.runId !== this.#runId) {
        throw new ContractViolation("SCOPE_MISMATCH", "GateDecision runId differs from its partition");
      }
      if (!Array.isArray(record.inputCheckResultRefs) || record.inputCheckResultRefs.length !== 3) {
        throw new ContractViolation("INVALID_INPUT", "GateDecision requires exactly three saved CheckResult Refs");
      }
      const ids = new Set<string>();
      for (const item of record.inputCheckResultRefs) {
        const ref = validateRef(item, { lifecycle: false, fieldName: "inputCheckResultRef" });
        if (ref.schema !== "dsheval.mvp.check-result/v1" || ids.has(ref.id)) {
          throw new ContractViolation("INVALID_INPUT", "GateDecision CheckResult Refs must be unique CheckResults");
        }
        ids.add(ref.id);
      }
    }
    if (record.scope !== undefined) {
      await this.#validateReferences(record, validateScope(record.scope));
    }
  }

  async #validateGateCommitOrder(gate: UnknownRecord): Promise<void> {
    const gateScope = validateScope(gate.scope, "GateDecision scope");
    if (gateScope.runId !== this.#runId) {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        "GateDecision scope must identify the current run partition",
      );
    }

    const run = await this.#readCurrentProjectionForGate(
      "dsheval.mvp.run/v1",
      this.#runId,
      "EvaluationRun",
    );
    assertScopeCompatible(gateScope, run.scope);
    if (run.state !== "FINALIZING") {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        "GateDecision can only be committed while the current EvaluationRun is FINALIZING",
      );
    }

    const environment = await this.#readUniqueCurrentProjectionForGate(
      "dsheval.mvp.environment/v1",
      "EnvironmentInstance",
    );
    const environmentScope = validateScope(environment.scope, "EnvironmentInstance scope");
    if (environmentScope.runId !== this.#runId) {
      throw new ContractViolation(
        "SCOPE_MISMATCH",
        "EnvironmentInstance does not belong to the current run",
      );
    }
    assertScopeCompatible(gateScope, environmentScope);
    if (
      environment.state !== "CLEANED" &&
      environment.state !== "QUARANTINED" &&
      environment.state !== "CLEANUP_FAILED"
    ) {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        "GateDecision requires a terminal EnvironmentInstance",
      );
    }

    const resetVerification = await this.#readOptionalUniqueImmutableForGate(
      "dsheval.mvp.reset-verification/v1",
      "ResetVerification",
    );
    if (resetVerification === undefined) {
      if (
        environment.state !== "QUARANTINED" &&
        environment.state !== "CLEANUP_FAILED"
      ) {
        throw new ContractViolation(
          "GATE_COMMIT_ORDER",
          "A clean Environment requires exactly one ResetVerification before GateDecision",
        );
      }
      const failureRefs = Array.isArray(environment.failureRefs)
        ? environment.failureRefs
        : [];
      let explicitResetFailure = false;
      for (const value of failureRefs) {
        const failureRef = validateRef(value, {
          lifecycle: false,
          fieldName: "EnvironmentInstance.failureRef",
        });
        if (failureRef.schema !== "dsheval.mvp.failure/v1") continue;
        const failure = await this.#readRef(failureRef) as unknown as UnknownRecord;
        if (
          (failure.phase === "RESET" || failure.phase === "RESET_VERIFY") &&
          (failure.category === "ENVIRONMENT_FAILURE" ||
            failure.category === "OBSERVATION_FAILURE" ||
            failure.category === "CLEANUP_FAILURE")
        ) {
          explicitResetFailure = true;
        }
      }
      if (!explicitResetFailure) {
        throw new ContractViolation(
          "GATE_COMMIT_ORDER",
          "A missing ResetVerification requires an explicit Reset or verification FailureRecord",
        );
      }
      return;
    }

    const resetScope = validateScope(resetVerification.scope, "ResetVerification scope");
    if (resetScope.runId !== this.#runId) {
      throw new ContractViolation(
        "SCOPE_MISMATCH",
        "ResetVerification does not belong to the current run",
      );
    }
    assertScopeCompatible(gateScope, resetScope);
    await this.#validateReferences(resetVerification, resetScope);
    if (!Number.isSafeInteger(environment.resetGeneration) || Number(environment.resetGeneration) < 1) {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        "GateDecision requires EnvironmentInstance resetGeneration >= 1",
      );
    }

    const environmentRef = validateRef(resetVerification.environmentInstanceRef, {
      lifecycle: true,
      fieldName: "ResetVerification.environmentInstanceRef",
    });
    if (
      environmentRef.schema !== "dsheval.mvp.environment/v1" ||
      environmentRef.id !== environment.aggregateId
    ) {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        "ResetVerification must identify the current EnvironmentInstance",
      );
    }
    if (
      !Number.isSafeInteger(resetVerification.resetGeneration) ||
      resetVerification.resetGeneration !== environment.resetGeneration
    ) {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        "ResetVerification generation must match the current EnvironmentInstance",
      );
    }
  }

  async #readCurrentProjectionForGate(
    schema: LifecycleAggregateSchema,
    id: StableId,
    label: string,
  ): Promise<Readonly<LifecycleProjectionBase> & UnknownRecord> {
    const path = await this.#projectionCurrentPath(schema, id);
    if ((await existingLstat(path)) === undefined) {
      throw new ContractViolation("GATE_COMMIT_ORDER", `${label} current projection is missing`);
    }
    return this.#readAndVerifyCurrentProjectionForGate(path, schema, label, `${id}.json`);
  }

  async #readUniqueCurrentProjectionForGate(
    schema: LifecycleAggregateSchema,
    label: string,
  ): Promise<Readonly<LifecycleProjectionBase> & UnknownRecord> {
    const directory = await ensureSafeDirectory(await this.#partitionDirectory(), [
      "records",
      schemaKind(schema),
    ]);
    const candidates = (await readdir(directory, { withFileTypes: true })).filter(
      (entry) => entry.name.endsWith(".json") && !/\.r[0-9]+\.json$/u.test(entry.name),
    );
    if (candidates.length !== 1 || candidates[0] === undefined) {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        `${label} requires exactly one current projection; found ${candidates.length}`,
      );
    }
    return this.#readAndVerifyCurrentProjectionForGate(
      join(directory, candidates[0].name),
      schema,
      label,
      candidates[0].name,
    );
  }

  async #readAndVerifyCurrentProjectionForGate(
    path: string,
    schema: LifecycleAggregateSchema,
    label: string,
    fileName?: string,
  ): Promise<Readonly<LifecycleProjectionBase> & UnknownRecord> {
    const record = await this.#readJson(path);
    const projection = record as unknown as LifecycleProjectionBase;
    const identity = projectionIdentity(projection);
    if (identity.schema !== schema || (fileName !== undefined && fileName !== `${identity.id}.json`)) {
      throw new ContractViolation(
        "EVIDENCE_INTEGRITY",
        `${label} current projection identity does not match its storage location`,
      );
    }
    if (!Number.isSafeInteger(projection.revision) || projection.revision < 0) {
      throw new ContractViolation("EVIDENCE_INTEGRITY", `${label} has an invalid revision`);
    }
    verifyProjectionDigest(projection);
    this.#assertPartitionScope(projection.scope);
    return record as Readonly<LifecycleProjectionBase> & UnknownRecord;
  }

  async #readOptionalUniqueImmutableForGate(
    schema: string,
    label: string,
  ): Promise<UnknownRecord | undefined> {
    const directory = await ensureSafeDirectory(await this.#partitionDirectory(), [
      "records",
      schemaKind(schema),
    ]);
    const candidates = (await readdir(directory, { withFileTypes: true })).filter((entry) =>
      entry.name.endsWith(".json"),
    );
    if (candidates.length === 0) return undefined;
    if (candidates.length !== 1 || candidates[0] === undefined) {
      throw new ContractViolation(
        "GATE_COMMIT_ORDER",
        `${label} requires exactly one committed record; found ${candidates.length}`,
      );
    }
    const record = await this.#readJson(join(directory, candidates[0].name));
    const identity = immutableIdentity(record);
    if (identity.schema !== schema || candidates[0].name !== `${identity.id}.json`) {
      throw new ContractViolation(
        "EVIDENCE_INTEGRITY",
        `${label} identity does not match its storage location`,
      );
    }
    verifyImmutableDigest(record);
    this.#assertPartitionScope(record.scope);
    return record;
  }

  async #validateReferences(value: unknown, ownerScope: ScopeRef): Promise<void> {
    const refs: Ref[] = [];
    collectRefs(value, refs);
    for (const ref of refs) {
      if (ref.schema === "dsheval.mvp.artifact/v1") continue;
      const target = await this.#readRef(ref);
      if (
        target !== null &&
        typeof target === "object" &&
        "scope" in (target as Record<string, unknown>)
      ) {
        assertScopeCompatible(ownerScope, validateScope((target as Record<string, unknown>).scope));
      }
    }
  }

  #assertPartitionScope(scope: unknown): void {
    const recordScope = validateScope(scope, "record scope");
    if (recordScope.runId !== undefined && recordScope.runId !== this.#runId) {
      throw new ContractViolation("SCOPE_MISMATCH", "record does not belong to repository run partition");
    }
    assertScopeCompatible(this.#scope, recordScope);
  }

  async #readRef<T>(unvalidatedRef: Ref<T>): Promise<Readonly<T>> {
    const lifecycle = isLifecycleSchema(unvalidatedRef.schema);
    const ref = validateRef<T>(unvalidatedRef, { lifecycle });
    const path = lifecycle
      ? await this.#projectionRevisionPath(
          ref.schema as LifecycleAggregateSchema,
          ref.id,
          ref.revision as number,
        )
      : await this.#immutablePath(ref.schema, ref.id);
    const record = await this.#readJson(path);
    if (record.schema !== ref.schema) {
      throw new ContractViolation("EVIDENCE_INTEGRITY", "stored schema does not match Ref");
    }
    let actualDigest: ContentDigest;
    if (lifecycle) {
      const projection = record as unknown as LifecycleProjectionBase;
      const identity = projectionIdentity(projection);
      if (identity.id !== ref.id || projection.revision !== ref.revision) {
        throw new ContractViolation("EVIDENCE_INTEGRITY", "stored lifecycle identity does not match Ref");
      }
      actualDigest = verifyProjectionDigest(projection);
      this.#assertPartitionScope(projection.scope);
    } else {
      const identity = immutableIdentity(record);
      if (identity.id !== ref.id) {
        throw new ContractViolation("EVIDENCE_INTEGRITY", "stored immutable identity does not match Ref");
      }
      actualDigest = verifyImmutableDigest(record);
      if (!SCOPELESS_SCHEMAS.has(identity.schema)) this.#assertPartitionScope(record.scope);
    }
    assertDigestEquals(actualDigest, ref.digest);
    return deepFreeze(record as unknown as T);
  }

  async #readJson(path: string): Promise<UnknownRecord> {
    let bytes: Buffer;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new ContractViolation("PATH_ESCAPE", "record path is not a regular file");
      }
      bytes = await readFile(path);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw new ContractViolation("NOT_FOUND", "committed record was not found");
      }
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(bytes.toString("utf8")) as unknown;
    } catch (error) {
      throw new ContractViolation("EVIDENCE_INTEGRITY", "committed record is not valid JSON", {
        cause: error,
      });
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new ContractViolation("EVIDENCE_INTEGRITY", "committed record is not a JSON object");
    }
    return parsed as UnknownRecord;
  }

  async #partitionDirectory(): Promise<string> {
    return ensureSafeDirectory(this.#runRoot, [this.#runId]);
  }

  async #immutablePath(schema: string, id: StableId): Promise<string> {
    if (isLifecycleSchema(schema)) {
      throw new ContractViolation("INVALID_REF", "lifecycle Ref requires a revision");
    }
    if (ID_FIELDS[schema] === undefined) {
      throw new ContractViolation("UNSUPPORTED_SCHEMA", `schema ${schema} is not in the MVP catalog`);
    }
    const records = await ensureSafeDirectory(await this.#partitionDirectory(), [
      "records",
      schemaKind(schema),
    ]);
    return join(records, `${validateStableId(id)}.json`);
  }

  async #projectionRevisionPath(
    schema: LifecycleAggregateSchema,
    id: StableId,
    revision: number,
  ): Promise<string> {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new ContractViolation("INVALID_REF", "revision must be a non-negative integer");
    }
    const records = await ensureSafeDirectory(await this.#partitionDirectory(), [
      "records",
      schemaKind(schema),
    ]);
    return join(records, `${validateStableId(id)}.r${revision}.json`);
  }

  async #projectionCurrentPath(schema: LifecycleAggregateSchema, id: StableId): Promise<string> {
    const records = await ensureSafeDirectory(await this.#partitionDirectory(), [
      "records",
      schemaKind(schema),
    ]);
    return join(records, `${validateStableId(id)}.json`);
  }

  async #ensureInitialized(): Promise<void> {
    this.#initialization ??= (async () => {
      const partition = await this.#partitionDirectory();
      const issues = await this.#scanRecoveryIssues(partition);
      if (issues.length > 0) {
        throw new ContractViolation(
          "STORAGE_RECOVERY_REQUIRED",
          `storage recovery is required (${issues.map((issue) => issue.code).join(", ")})`,
        );
      }
    })();
    return this.#initialization;
  }

  async #scanRecoveryIssues(partition: string): Promise<readonly RecoveryIssue[]> {
    const issues: RecoveryIssue[] = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(directory, entry.name);
        const location = relative(partition, path).split(sep).join("/");
        if (entry.isSymbolicLink()) {
          issues.push({ code: "STALE_TEMP_FILE", portableLocation: location, detail: "symlink in data partition" });
          continue;
        }
        if (entry.isDirectory()) {
          await walk(path);
          continue;
        }
        if (entry.name.startsWith(".tmp-") || entry.name.endsWith(".partial")) {
          issues.push({ code: "STALE_TEMP_FILE", portableLocation: location, detail: "uncommitted temporary file" });
        }
        if (entry.name.endsWith(".jsonl")) {
          const text = await readFile(path, "utf8");
          if (text.length > 0 && !text.endsWith("\n")) {
            issues.push({ code: "BAD_JSONL", portableLocation: location, detail: "JSONL has an incomplete tail" });
            continue;
          }
          const eventIds = new Set<string>();
          for (const [index, line] of text.split("\n").entries()) {
            if (line.length === 0) continue;
            try {
              const parsed = JSON.parse(line) as unknown;
              if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
              const eventId = (parsed as Record<string, unknown>).eventId;
              if (typeof eventId === "string") {
                if (eventIds.has(eventId)) {
                  issues.push({
                    code: "DUPLICATE_EVENT_ID",
                    portableLocation: location,
                    detail: `duplicate event ID at line ${index + 1}`,
                  });
                }
                eventIds.add(eventId);
              }
            } catch {
              issues.push({
                code: "BAD_JSONL",
                portableLocation: location,
                detail: `invalid JSON at line ${index + 1}`,
              });
            }
          }
        }
      }
    };
    await walk(partition);
    const recordsRoot = join(partition, "records");
    for (const schema of Object.keys(PROJECTION_ID_FIELDS) as LifecycleAggregateSchema[]) {
      const directory = join(recordsRoot, schemaKind(schema));
      const directoryMetadata = await existingLstat(directory);
      if (directoryMetadata === undefined) continue;
      if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) continue;
      const entries = await readdir(directory, { withFileTypes: true });
      const revisions = new Map<string, Set<number>>();
      for (const entry of entries) {
        const match = /^(.+)\.r([0-9]+)\.json$/u.exec(entry.name);
        if (match?.[1] === undefined || match[2] === undefined) continue;
        const revision = Number(match[2]);
        if (!Number.isSafeInteger(revision)) continue;
        const set = revisions.get(match[1]) ?? new Set<number>();
        set.add(revision);
        revisions.set(match[1], set);
      }
      for (const [id, savedRevisions] of revisions) {
        const currentPath = join(directory, `${id}.json`);
        try {
          const current = (await this.#readJson(currentPath)) as unknown as LifecycleProjectionBase;
          const identity = projectionIdentity(current);
          verifyProjectionDigest(current);
          const expected = new Set(
            Array.from({ length: current.revision + 1 }, (_unused, revision) => revision),
          );
          const historyMatches =
            identity.schema === schema &&
            identity.id === id &&
            expected.size === savedRevisions.size &&
            [...expected].every((revision) => savedRevisions.has(revision));
          if (!historyMatches) {
            issues.push({
              code: "ORPHAN_PROJECTION_REVISION",
              portableLocation: relative(partition, directory).split(sep).join("/"),
              detail: `${schema}/${id} revision history does not match its current projection`,
            });
          }
        } catch {
          issues.push({
            code: "ORPHAN_PROJECTION_REVISION",
            portableLocation: relative(partition, directory).split(sep).join("/"),
            detail: `${schema}/${id} has no verifiable current projection`,
          });
        }
      }
    }
    return issues;
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
      return this.#mapError<T>(context, error, "INVALID_OPERATION_INPUT");
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

  #cancelledIfRequested<T>(context: OperationContext): PortResult<T> | undefined {
    if (!context.cancellationToken.isCancellationRequested) return undefined;
    return cancelled(
      this.#failure(context, "CANCELLED", "OPERATION_CANCELLED", "Storage operation was cancelled", "USER"),
    );
  }

  #mapError<T>(context: OperationContext, error: unknown, fallbackReason: string): PortResult<T> {
    if (error instanceof ContractViolation) {
      const rejection =
        error.code === "NOT_FOUND"
          ? "NOT_FOUND"
          : error.code === "IMMUTABILITY_CONFLICT"
            ? "CONFLICT"
            : error.code === "STALE_REVISION"
              ? "STALE_REVISION"
              : error.code === "PATH_ESCAPE"
                ? "AUTHORIZATION_DENIED"
                : error.code === "STORAGE_RECOVERY_REQUIRED"
                  ? "PRECONDITION_FAILED"
                  : error.code === "GATE_COMMIT_ORDER"
                    ? "PRECONDITION_FAILED"
                  : "INVALID_INPUT";
      const category =
        error.code === "EVIDENCE_INTEGRITY" ? "EVIDENCE_INTEGRITY" : "PERSISTENCE_FAILURE";
      return rejected(rejection, [
        this.#failure(context, category, error.code || fallbackReason, "Storage rejected an invalid or unsafe operation"),
      ]);
    }
    return failed(
      this.#failure(context, "PERSISTENCE_FAILURE", fallbackReason, "Storage could not persist or verify data"),
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

export { FileRepository as Repository };
