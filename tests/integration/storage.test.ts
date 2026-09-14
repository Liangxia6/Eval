/**
 * 测试职责：在真实文件系统中验证 Repository/ArtifactStore 的不可变写入、CAS、
 * 幂等、摘要复核、跨 Scope 拒绝、故障恢复以及 Gate 单次提交约束。
 */
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ArtifactCommitMetadata, OperationContext, PortResult } from "../../src/core/contracts.js";
import {
  canonicalJson,
  type AttemptState,
  type ExecutionAttempt,
  type Ref,
  type ScopeRef,
  type StableId,
  type StateTransition,
  validateScope,
  validateStableId,
  withContentDigest,
  withProjectionDigest,
} from "../../src/core/models.js";
import { FileArtifactStore } from "../../src/storage/artifacts.js";
import { FileRepository } from "../../src/storage/repositories.js";

const now = "2026-09-01T00:00:00.000Z";
let operationCounter = 0;

const ids = {
  target: validateStableId<"TargetId">("target-storage"),
  snapshot: validateStableId<"TargetSnapshotId">("snapshot-storage"),
  run: validateStableId<"RunId">("run-storage"),
  case: validateStableId<"CaseId">("case-storage"),
  attempt: validateStableId<"AttemptId">("attempt-storage"),
};

const targetScope = validateScope({ targetId: ids.target });
const attemptScope = validateScope({
  targetId: ids.target,
  targetSnapshotId: ids.snapshot,
  runId: ids.run,
  caseId: ids.case,
  attemptId: ids.attempt,
});

function context(idempotencyKey = `key-${operationCounter + 1}`): OperationContext {
  operationCounter += 1;
  return {
    operationId: validateStableId(`operation-${operationCounter}`),
    idempotencyKey,
    deadlineAt: "2099-01-01T00:00:00.000Z",
    cancellationToken: { isCancellationRequested: false },
    actorRole: "STORAGE",
    traceId: validateStableId(`trace-${operationCounter}`),
  };
}

function resultValue<T>(result: PortResult<T>): T {
  assert.equal(result.status, "SUCCEEDED", JSON.stringify(result));
  if (result.status !== "SUCCEEDED") throw new Error("unreachable");
  return result.value;
}

async function roots() {
  const base = await mkdtemp(join(tmpdir(), "dsheval-storage-"));
  return {
    base,
    runRoot: join(base, "records"),
    artifactRoot: join(base, "artifacts"),
  };
}

function repository(runRoot: string, scope: ScopeRef = targetScope) {
  return new FileRepository({
    runRoot,
    runId: ids.run,
    scope,
    producerVersion: "0.1.0",
  });
}

function targetDescriptor(label = "original") {
  return withContentDigest({
    schema: "dsheval.mvp.target-descriptor/v1" as const,
    targetId: ids.target,
    targetType: "FULL_AGENT" as const,
    sourceRoot: `/fixture/${label}`,
    dshExecutable: "/fixture/dsh",
    dshHome: "/fixture/home",
    profile: "default",
    targetIdentity: "dshagent",
  });
}

function attemptProjection(
  state: AttemptState,
  revision: number,
  aggregateId: StableId = ids.attempt,
): ExecutionAttempt {
  return withProjectionDigest({
    schema: "dsheval.mvp.attempt/v1" as const,
    aggregateId,
    scope: attemptScope,
    state,
    revision,
    createdAt: now,
    updatedAt: now,
    failureRefs: [],
    attemptId: aggregateId as ExecutionAttempt["attemptId"],
    caseId: ids.case,
    ordinal: 1 as const,
    workspacePath: "/fixture/workspace",
    runtimeDshHomePath: "/fixture/runtime-home",
    sourceRunId: validateStableId<"SourceRunId">("source-run-storage"),
  });
}

function transition(
  aggregateRef: Ref<ExecutionAttempt> & { readonly revision: number },
  fromState: AttemptState,
  toState: AttemptState,
  nextProjection: ExecutionAttempt,
): StateTransition<ExecutionAttempt> {
  return {
    aggregateRef,
    expectedRevision: aggregateRef.revision,
    fromState,
    toState,
    reasonCode: `TO_${toState}`,
    supportingRefs: [],
    failureRefs: [],
    occurredAt: now,
    nextProjection,
  };
}

function artifactMetadata(
  artifactId = "artifact-probe",
  scope: ScopeRef = attemptScope,
): ArtifactCommitMetadata {
  return {
    artifactId: validateStableId<"ArtifactId">(artifactId),
    scope,
    artifactType: "PROBE_JSONL",
    logicalName: "probe.jsonl",
    mediaType: "application/x-ndjson",
    producerVersion: "0.1.0",
    createdAt: now,
    sensitivity: "EXPORTABLE",
    redactionState: "NOT_REQUIRED",
  };
}

test("immutable records are idempotent and reject replacement", async () => {
  const { runRoot } = await roots();
  const store = repository(runRoot);
  const record = targetDescriptor();
  const first = resultValue(await store.putImmutable(context(), record));
  const replay = resultValue(await store.putImmutable(context(), record));
  assert.deepEqual(replay, first);
  assert.deepEqual(resultValue(await store.get(context(), first)), record);

  const conflict = await store.putImmutable(context(), targetDescriptor("changed"));
  assert.equal(conflict.status, "REJECTED");
  if (conflict.status === "REJECTED") {
    assert.equal(conflict.rejectionCode, "CONFLICT");
    assert.equal(conflict.failureDrafts[0]?.reasonCode, "IMMUTABILITY_CONFLICT");
  }
});

test("ancestor scopes are accepted, cross-run and cross-target scopes are rejected", async () => {
  const { runRoot } = await roots();
  const store = repository(runRoot);
  const ancestor = withContentDigest({
    schema: "dsheval.mvp.target-snapshot/v1" as const,
    targetSnapshotId: ids.snapshot,
    targetId: ids.target,
    scope: validateScope({ targetId: ids.target, targetSnapshotId: ids.snapshot }),
    createdAt: now,
    producerVersion: "0.1.0",
  });
  assert.equal((await store.putImmutable(context(), ancestor)).status, "SUCCEEDED");

  const crossRun = withContentDigest({
    schema: "dsheval.mvp.control-event/v1" as const,
    controlEventId: validateStableId("control-other-run"),
    scope: validateScope({
      targetId: ids.target,
      targetSnapshotId: ids.snapshot,
      runId: "run-other",
    }),
    createdAt: now,
    producerVersion: "0.1.0",
  });
  assert.equal((await store.putImmutable(context(), crossRun)).status, "REJECTED");

  const otherTarget = withContentDigest({
    schema: "dsheval.mvp.target-snapshot/v1" as const,
    targetSnapshotId: validateStableId("snapshot-other"),
    targetId: validateStableId("target-other"),
    scope: validateScope({ targetId: "target-other", targetSnapshotId: "snapshot-other" }),
    createdAt: now,
    producerVersion: "0.1.0",
  });
  assert.equal((await store.putImmutable(context(), otherTarget)).status, "REJECTED");
});

test("lifecycle CAS saves each revision and rejects illegal/stale transitions", async () => {
  const { runRoot } = await roots();
  const store = repository(runRoot, attemptScope);
  const initial = attemptProjection("PENDING", 0);
  const initialRef = resultValue(await store.createProjection(context(), initial));

  const illegal = await store.appendTransition(
    context(),
    transition(initialRef, "PENDING", "SUCCEEDED", attemptProjection("SUCCEEDED", 1)),
  );
  assert.equal(illegal.status, "REJECTED");
  if (illegal.status === "REJECTED") {
    assert.equal(illegal.failureDrafts[0]?.reasonCode, "ILLEGAL_STATE_TRANSITION");
  }

  const runningProjection = attemptProjection("RUNNING", 1);
  const runningRef = resultValue(
    await store.appendTransition(
      context(),
      transition(initialRef, "PENDING", "RUNNING", runningProjection),
    ),
  );
  assert.equal(runningRef.revision, 1);
  assert.deepEqual(resultValue(await store.get(context(), initialRef)), initial);
  assert.deepEqual(resultValue(await store.get(context(), runningRef)), runningProjection);

  const stale = await store.appendTransition(
    context(),
    transition(initialRef, "RUNNING", "TARGET_FAILED", attemptProjection("TARGET_FAILED", 1)),
  );
  assert.equal(stale.status, "REJECTED");
  if (stale.status === "REJECTED") assert.equal(stale.rejectionCode, "STALE_REVISION");

  const lifecycle = await readFile(
    join(runRoot, ids.run, "events", "lifecycle.jsonl"),
    "utf8",
  );
  assert.equal(lifecycle.trim().split("\n").length, 1);
});

test("repository detects committed JSON tampering", async () => {
  const { runRoot } = await roots();
  const store = repository(runRoot);
  const ref = resultValue(await store.putImmutable(context(), targetDescriptor()));
  const path = join(runRoot, ids.run, "records", "target-descriptor", `${ids.target}.json`);
  await chmod(path, 0o600);
  const altered = { ...targetDescriptor(), sourceRoot: "/tampered" };
  await writeFile(path, JSON.stringify(altered), "utf8");
  const read = await store.get(context(), ref);
  assert.notEqual(read.status, "SUCCEEDED");
  assert.equal(read.failureDrafts[0]?.reasonCode, "EVIDENCE_INTEGRITY");
});

test("Artifact commit and verified read preserve two digests", async () => {
  const { runRoot, artifactRoot } = await roots();
  const store = new FileArtifactStore({
    artifactRoot,
    runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const ref = resultValue(await store.commit(context(), "first line\n", artifactMetadata()));
  assert.equal(ref.byteLength, 11);
  assert.notEqual(ref.artifactContentDigest.value, ref.contentDigest.value);
  const bytes = resultValue(
    await store.readVerified(context(), ref, attemptScope, "EVIDENCE_CAPTURE"),
  );
  assert.equal(Buffer.from(bytes).toString("utf8"), "first line\n");

  const replay = resultValue(await store.commit(context(), "first line\n", artifactMetadata()));
  assert.deepEqual(replay, ref);
  const conflict = await store.commit(context(), "changed\n", artifactMetadata());
  assert.equal(conflict.status, "REJECTED");
  if (conflict.status === "REJECTED") assert.equal(conflict.rejectionCode, "CONFLICT");

  const index = await readFile(join(artifactRoot, ids.run, "index.jsonl"), "utf8");
  assert.equal(index.trim().split("\n").length, 1);
});

test("Artifact metadata, scope and byte tampering are rejected", async () => {
  const { runRoot, artifactRoot } = await roots();
  const store = new FileArtifactStore({
    artifactRoot,
    runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const ref = resultValue(await store.commit(context(), "sealed bytes", artifactMetadata()));

  const alteredRef = { ...ref, byteLength: ref.byteLength + 1 };
  const alteredRead = await store.readVerified(
    context(),
    alteredRef,
    attemptScope,
    "EVIDENCE_CAPTURE",
  );
  assert.notEqual(alteredRead.status, "SUCCEEDED");

  const wrongScope = validateScope({
    targetId: "target-other",
    targetSnapshotId: "snapshot-other",
    runId: ids.run,
    caseId: ids.case,
    attemptId: ids.attempt,
  });
  const scopedRead = await store.readVerified(context(), ref, wrongScope, "EVIDENCE_CAPTURE");
  assert.notEqual(scopedRead.status, "SUCCEEDED");

  const path = join(artifactRoot, ids.run, "objects", ref.artifactId);
  await chmod(path, 0o600);
  await writeFile(path, "tampered bytes", "utf8");
  const byteRead = await store.readVerified(context(), ref, attemptScope, "EVIDENCE_CAPTURE");
  assert.notEqual(byteRead.status, "SUCCEEDED");
  assert.equal(byteRead.failureDrafts[0]?.reasonCode, "EVIDENCE_INTEGRITY");
});

test("Restricted Artifact cannot become task or report input", async () => {
  const { runRoot, artifactRoot } = await roots();
  const store = new FileArtifactStore({
    artifactRoot,
    runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const restricted = resultValue(
    await store.commit(context(), "secret-shaped fixture bytes", {
      ...artifactMetadata("artifact-restricted"),
      sensitivity: "RESTRICTED",
      redactionState: "FAILED",
    }),
  );
  assert.equal(
    (await store.readVerified(context(), restricted, attemptScope, "JUDGE_INPUT")).status,
    "SUCCEEDED",
  );
  const reportRead = await store.readVerified(
    context(),
    restricted,
    attemptScope,
    "REPORT_INPUT",
  );
  assert.equal(reportRead.status, "REJECTED");
  if (reportRead.status === "REJECTED") {
    assert.equal(reportRead.rejectionCode, "AUTHORIZATION_DENIED");
  }
});

test("root symlinks and orphan staging facts block writes", async () => {
  const first = await roots();
  const realArtifacts = join(first.base, "real-artifacts");
  await mkdir(realArtifacts, { recursive: true });
  const linkedArtifacts = join(first.base, "linked-artifacts");
  await symlink(realArtifacts, linkedArtifacts);
  const symlinkStore = new FileArtifactStore({
    artifactRoot: linkedArtifacts,
    runRoot: first.runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const symlinkCommit = await symlinkStore.commit(context(), "bytes", artifactMetadata());
  assert.notEqual(symlinkCommit.status, "SUCCEEDED");

  const second = await roots();
  const objects = join(second.artifactRoot, ids.run, "objects");
  await mkdir(objects, { recursive: true });
  await writeFile(join(objects, "orphan-artifact"), "incomplete", "utf8");
  const recoveryStore = new FileArtifactStore({
    artifactRoot: second.artifactRoot,
    runRoot: second.runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const blocked = await recoveryStore.commit(
    context(),
    "new bytes",
    artifactMetadata("artifact-new"),
  );
  assert.equal(blocked.status, "REJECTED");
  if (blocked.status === "REJECTED") assert.equal(blocked.rejectionCode, "PRECONDITION_FAILED");
});

test("interrupted staging blocks restart without changing committed facts", async () => {
  const { runRoot, artifactRoot } = await roots();
  const originalStore = new FileArtifactStore({
    artifactRoot,
    runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const committed = resultValue(
    await originalStore.commit(
      context(),
      "committed-before-interruption\n",
      artifactMetadata("artifact-before-interruption"),
    ),
  );
  const objectDirectory = join(artifactRoot, ids.run, "objects");
  const objectPath = join(objectDirectory, committed.artifactId);
  const stagedPath = join(objectDirectory, ".tmp-interrupted-write");
  const originalBytes = await readFile(objectPath);
  await writeFile(stagedPath, "uncommitted replacement", "utf8");

  const recoveringStore = new FileArtifactStore({
    artifactRoot,
    runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const blocked = await recoveringStore.readVerified(
    context(),
    committed,
    attemptScope,
    "EVIDENCE_CAPTURE",
  );
  assert.notEqual(blocked.status, "SUCCEEDED");
  assert.deepEqual(await readFile(objectPath), originalBytes);

  await unlink(stagedPath);
  const resumedStore = new FileArtifactStore({
    artifactRoot,
    runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  const verified = resultValue(
    await resumedStore.readVerified(
      context(),
      committed,
      attemptScope,
      "EVIDENCE_CAPTURE",
    ),
  );
  assert.deepEqual(Buffer.from(verified), originalBytes);
});

test("status.html is atomically replaced under runRoot and never becomes an Artifact", async () => {
  const { runRoot, artifactRoot } = await roots();
  const store = new FileArtifactStore({
    artifactRoot,
    runRoot,
    runId: ids.run,
    scope: targetScope,
    maxArtifactBytes: 1024,
  });
  resultValue(await store.replaceStatusHtml(context(), "<!doctype html><title>one</title>"));
  resultValue(await store.replaceStatusHtml(context(), "<!doctype html><title>two</title>"));
  assert.equal(
    await readFile(join(runRoot, ids.run, "status.html"), "utf8"),
    "<!doctype html><title>two</title>",
  );
  await assert.rejects(readFile(join(artifactRoot, ids.run, "status.html"), "utf8"));
  await assert.rejects(readFile(join(artifactRoot, ids.run, "index.jsonl"), "utf8"));
});

test("same idempotency key with different input is a conflict", async () => {
  const { runRoot } = await roots();
  const store = repository(runRoot);
  const firstContext = context("one-key");
  assert.equal((await store.putImmutable(firstContext, targetDescriptor())).status, "SUCCEEDED");
  const reusedContext: OperationContext = {
    ...context(),
    idempotencyKey: "one-key",
  };
  const result = await store.putImmutable(reusedContext, targetDescriptor("different"));
  assert.equal(result.status, "REJECTED");
  if (result.status === "REJECTED") assert.equal(result.rejectionCode, "CONFLICT");
});

test("orphan lifecycle revisions block restart instead of being guessed", async () => {
  const { runRoot } = await roots();
  const first = repository(runRoot, attemptScope);
  resultValue(await first.createProjection(context(), attemptProjection("PENDING", 0)));
  const projectionDirectory = join(runRoot, ids.run, "records", "attempt");
  await writeFile(
    join(projectionDirectory, `${ids.attempt}.r1.json`),
    canonicalJson(attemptProjection("RUNNING", 1)),
    { encoding: "utf8", mode: 0o400 },
  );
  const restarted = repository(runRoot, attemptScope);
  const issues = await restarted.inspectRecoveryState();
  assert.ok(issues.some((issue) => issue.code === "ORPHAN_PROJECTION_REVISION"));
  const blocked = await restarted.putImmutable(context(), targetDescriptor());
  assert.equal(blocked.status, "REJECTED");
  if (blocked.status === "REJECTED") assert.equal(blocked.rejectionCode, "PRECONDITION_FAILED");
});
