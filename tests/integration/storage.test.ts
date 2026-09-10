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
  digestValue,
  type AttemptState,
  type EnvironmentInstance,
  type EnvironmentState,
  type EvaluationRun,
  type ExecutionAttempt,
  type Ref,
  type RunState,
  type ScopeRef,
  type StableId,
  type StateTransition,
  validateScope,
  validateStableId,
  validateVersionedAssetId,
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
const snapshotScope = validateScope({ targetId: ids.target, targetSnapshotId: ids.snapshot });
const runScope = validateScope({
  targetId: ids.target,
  targetSnapshotId: ids.snapshot,
  runId: ids.run,
});
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

async function saveRunProjection(store: FileRepository, state: RunState): Promise<Ref<EvaluationRun>> {
  const targetSnapshot = withContentDigest({
    schema: "dsheval.mvp.target-snapshot/v1" as const,
    targetSnapshotId: ids.snapshot,
    targetId: ids.target,
    scope: snapshotScope,
    createdAt: now,
    producerVersion: "0.1.0",
  });
  const targetSnapshotRef = resultValue(await store.putImmutable(context(), targetSnapshot));
  const evaluationPlan = withContentDigest({
    schema: "dsheval.mvp.evaluation-plan/v1" as const,
    evaluationPlanId: validateStableId<"EvaluationPlanId">("evaluation-plan-storage"),
    scope: runScope,
    createdAt: now,
    producerVersion: "0.1.0",
  });
  const evaluationPlanRef = resultValue(await store.putImmutable(context(), evaluationPlan));
  const observationPlan = withContentDigest({
    schema: "dsheval.mvp.observation-plan/v1" as const,
    observationPlanId: validateStableId<"ObservationPlanId">("observation-plan-storage"),
    scope: runScope,
    createdAt: now,
    producerVersion: "0.1.0",
  });
  const observationPlanRef = resultValue(await store.putImmutable(context(), observationPlan));
  const run: EvaluationRun = withProjectionDigest({
    schema: "dsheval.mvp.run/v1" as const,
    aggregateId: ids.run,
    scope: runScope,
    state,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    failureRefs: [],
    runId: ids.run,
    targetSnapshotRef: targetSnapshotRef as EvaluationRun["targetSnapshotRef"],
    evaluationPlanRef: evaluationPlanRef as EvaluationRun["evaluationPlanRef"],
    observationPlanRef: observationPlanRef as EvaluationRun["observationPlanRef"],
    caseId: ids.case,
    operationalHealth: "HEALTHY" as const,
  });
  return resultValue(await store.createProjection(context(), run));
}

async function saveEnvironmentProjection(
  store: FileRepository,
  state: EnvironmentState,
  resetGeneration = 1,
  environmentId = "environment-storage",
  failureRefs: EnvironmentInstance["failureRefs"] = [],
): Promise<Ref<EnvironmentInstance> & { readonly revision: number }> {
  const aggregateId = validateStableId<"EnvironmentInstanceId">(environmentId);
  const environment: EnvironmentInstance = withProjectionDigest({
    schema: "dsheval.mvp.environment/v1" as const,
    aggregateId,
    scope: attemptScope,
    state,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    failureRefs,
    environmentInstanceId: aggregateId,
    attemptId: ids.attempt,
    environmentId: validateVersionedAssetId<"EnvironmentDefinitionId">("filesystem-env/v1"),
    workspaceBinding: `workspace://${environmentId}`,
    resetGeneration,
  });
  return resultValue(await store.createProjection(context(), environment));
}

async function saveResetFailure(store: FileRepository, suffix: string): Promise<Ref> {
  const failure = withContentDigest({
    schema: "dsheval.mvp.failure/v1" as const,
    failureId: validateStableId(`failure-reset-${suffix}`),
    scope: attemptScope,
    category: "ENVIRONMENT_FAILURE" as const,
    origin: "ENVIRONMENT" as const,
    actor: "ENVIRONMENT_CONTROLLER" as const,
    phase: "RESET",
    severity: "ERROR" as const,
    retryable: false,
    messageRedacted: "Reset failed",
    reasonCode: "ENVIRONMENT_RESET_FAILED",
    evidenceRefs: [],
    artifactRefs: [],
    occurredAt: now,
    createdAt: now,
    producerVersion: "0.1.0",
  });
  return resultValue(await store.putImmutable(context(), failure));
}

async function saveResetVerification(
  store: FileRepository,
  environmentInstanceRef: Ref<EnvironmentInstance> & { readonly revision: number },
  suffix = "storage",
  resetGeneration = 1,
): Promise<Ref> {
  const snapshot = withContentDigest({
    schema: "dsheval.mvp.file-snapshot/v1" as const,
    snapshotId: validateStableId(`snapshot-post-reset-${suffix}`),
    scope: attemptScope,
    createdAt: now,
    producerVersion: "0.1.0",
  });
  const snapshotRef = resultValue(await store.putImmutable(context(), snapshot));
  const collection = withContentDigest({
    schema: "dsheval.mvp.collection-status/v1" as const,
    collectionStatusId: validateStableId(`collection-post-reset-${suffix}`),
    scope: attemptScope,
    createdAt: now,
    producerVersion: "0.1.0",
  });
  const collectionRef = resultValue(await store.putImmutable(context(), collection));
  const verification = withContentDigest({
    schema: "dsheval.mvp.reset-verification/v1" as const,
    verificationId: validateStableId(`reset-verification-${suffix}`),
    scope: attemptScope,
    createdAt: now,
    producerVersion: "0.1.0",
    environmentInstanceRef,
    resetGeneration,
    expectedCleanDigest: digestValue({ clean: true }),
    postResetSnapshotRef: snapshotRef,
    collectionStatusRef: collectionRef,
    result: "MATCH" as const,
    differenceSummary: {},
  });
  return resultValue(await store.putImmutable(context(), verification));
}

async function saveCheckResults(store: FileRepository): Promise<readonly Ref[]> {
  const refs: Ref[] = [];
  for (const index of [1, 2, 3]) {
    const check = withContentDigest({
      schema: "dsheval.mvp.check-result/v1" as const,
      checkResultId: validateStableId(`check-result-${index}`),
      scope: attemptScope,
      createdAt: now,
      producerVersion: "0.1.0",
    });
    refs.push(resultValue(await store.putImmutable(context(), check)));
  }
  return refs;
}

function gateDecision(gateDecisionId: string, inputCheckResultRefs: readonly Ref[]) {
  return withContentDigest({
    schema: "dsheval.mvp.gate/v1" as const,
    gateDecisionId: validateStableId(gateDecisionId),
    scope: attemptScope,
    createdAt: now,
    producerVersion: "0.1.0",
    runId: ids.run,
    inputCheckResultRefs,
    verdict: "PASS" as const,
    triggeredHardFailureRefs: [],
    unevaluableRequiredRefs: [],
    ruleVersion: "gate.required-hard/v1",
  });
}

async function saveGateOrderPrerequisites(
  store: FileRepository,
  options: {
    readonly runState?: RunState;
    readonly environmentState?: EnvironmentState;
    readonly resetGeneration?: number;
  } = {},
): Promise<Ref<EnvironmentInstance> & { readonly revision: number }> {
  await saveRunProjection(store, options.runState ?? "FINALIZING");
  const resetGeneration = options.resetGeneration ?? 1;
  const environmentRef = await saveEnvironmentProjection(
    store,
    options.environmentState ?? "CLEANED",
    resetGeneration,
  );
  await saveResetVerification(store, environmentRef, "storage", resetGeneration);
  return environmentRef;
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

test("MVP-STORE-AC-002 immutable records are idempotent and reject replacement", async () => {
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

test("MVP-STORE-AC-004 ancestor scopes are accepted, cross-run and cross-target scopes are rejected", async () => {
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

test("MVP-CORE-AC-004 lifecycle CAS saves each revision and rejects illegal/stale transitions", async () => {
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

test("MVP-CONTRACT-AC-007 repository detects committed JSON tampering", async () => {
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

test("MVP-CT-STORE-001 Artifact commit and verified read preserve two digests", async () => {
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

test("MVP-STORE-AC-003 Artifact metadata, scope and byte tampering are rejected", async () => {
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

test("MVP-STORE-AC-007 Restricted Artifact cannot become task or report input", async () => {
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

test("MVP-SEC-STORE-001 root symlinks and orphan staging facts block writes", async () => {
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

test("MVP-FI-STORE-001 interrupted staging blocks restart without changing committed facts", async () => {
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

test("GateDecision accepts the committed CheckResult set and is unique per run", async () => {
  const { runRoot } = await roots();
  const store = repository(runRoot, attemptScope);
  const refs = (await saveCheckResults(store)).slice(0, 2);
  await saveGateOrderPrerequisites(store);
  assert.equal(
    (await store.putImmutable(context(), gateDecision("gate-first", refs))).status,
    "SUCCEEDED",
  );
  const second = await store.putImmutable(context(), gateDecision("gate-second", refs));
  assert.equal(second.status, "REJECTED");
  if (second.status === "REJECTED") assert.equal(second.rejectionCode, "CONFLICT");

  const other = await roots();
  const otherStore = repository(other.runRoot, attemptScope);
  await saveGateOrderPrerequisites(otherStore);
  const unsaved = await otherStore.putImmutable(context(), gateDecision("gate-unsaved", refs));
  assert.equal(unsaved.status, "REJECTED");
});

test("GateDecision rejects an empty CheckResult set", async () => {
  const { runRoot } = await roots();
  const store = repository(runRoot, attemptScope);
  await saveGateOrderPrerequisites(store);
  const result = await store.putImmutable(context(), gateDecision("gate-empty", []));
  assert.equal(result.status, "REJECTED");
  if (result.status === "REJECTED") assert.equal(result.rejectionCode, "INVALID_INPUT");
});

test("GateDecision requires FINALIZING Run, one ResetVerification and one terminal Environment", async () => {
  for (const terminalState of ["CLEANED", "QUARANTINED", "CLEANUP_FAILED"] as const) {
    const { runRoot } = await roots();
    const store = repository(runRoot, attemptScope);
    const refs = await saveCheckResults(store);
    await saveGateOrderPrerequisites(store, { environmentState: terminalState });
    assert.equal(
      (await store.putImmutable(context(), gateDecision(`gate-${terminalState.toLowerCase()}`, refs)))
        .status,
      "SUCCEEDED",
    );
  }

  const missingRunRoots = await roots();
  const missingRunStore = repository(missingRunRoots.runRoot, attemptScope);
  const missingRunRefs = await saveCheckResults(missingRunStore);
  const missingRun = await missingRunStore.putImmutable(
    context(),
    gateDecision("gate-missing-run", missingRunRefs),
  );
  assert.equal(missingRun.status, "REJECTED");
  if (missingRun.status === "REJECTED") {
    assert.equal(missingRun.rejectionCode, "PRECONDITION_FAILED");
    assert.equal(missingRun.failureDrafts[0]?.reasonCode, "GATE_COMMIT_ORDER");
  }

  const wrongRunRoots = await roots();
  const wrongRunStore = repository(wrongRunRoots.runRoot, attemptScope);
  const wrongRunRefs = await saveCheckResults(wrongRunStore);
  await saveGateOrderPrerequisites(wrongRunStore, { runState: "RUNNING" });
  const wrongRun = await wrongRunStore.putImmutable(
    context(),
    gateDecision("gate-running-run", wrongRunRefs),
  );
  assert.equal(wrongRun.status, "REJECTED");
  if (wrongRun.status === "REJECTED") assert.equal(wrongRun.rejectionCode, "PRECONDITION_FAILED");

  const missingResetRoots = await roots();
  const missingResetStore = repository(missingResetRoots.runRoot, attemptScope);
  const missingResetRefs = await saveCheckResults(missingResetStore);
  await saveRunProjection(missingResetStore, "FINALIZING");
  await saveEnvironmentProjection(missingResetStore, "CLEANED");
  const missingReset = await missingResetStore.putImmutable(
    context(),
    gateDecision("gate-missing-reset", missingResetRefs),
  );
  assert.equal(missingReset.status, "REJECTED");
  if (missingReset.status === "REJECTED") {
    assert.equal(missingReset.rejectionCode, "PRECONDITION_FAILED");
  }

  const multipleResetRoots = await roots();
  const multipleResetStore = repository(multipleResetRoots.runRoot, attemptScope);
  const multipleResetRefs = await saveCheckResults(multipleResetStore);
  const multipleResetEnvironmentRef = await saveGateOrderPrerequisites(multipleResetStore);
  await saveResetVerification(multipleResetStore, multipleResetEnvironmentRef, "second");
  const multipleReset = await multipleResetStore.putImmutable(
    context(),
    gateDecision("gate-multiple-reset", multipleResetRefs),
  );
  assert.equal(multipleReset.status, "REJECTED");
  if (multipleReset.status === "REJECTED") {
    assert.equal(multipleReset.rejectionCode, "PRECONDITION_FAILED");
  }

  const multipleEnvironmentRoots = await roots();
  const multipleEnvironmentStore = repository(multipleEnvironmentRoots.runRoot, attemptScope);
  const multipleEnvironmentRefs = await saveCheckResults(multipleEnvironmentStore);
  await saveGateOrderPrerequisites(multipleEnvironmentStore);
  await saveEnvironmentProjection(
    multipleEnvironmentStore,
    "CLEANED",
    1,
    "environment-storage-second",
  );
  const multipleEnvironment = await multipleEnvironmentStore.putImmutable(
    context(),
    gateDecision("gate-multiple-environment", multipleEnvironmentRefs),
  );
  assert.equal(multipleEnvironment.status, "REJECTED");
  if (multipleEnvironment.status === "REJECTED") {
    assert.equal(multipleEnvironment.rejectionCode, "PRECONDITION_FAILED");
  }
});

test("GateDecision permits no ResetVerification only for an explicit terminal Reset failure", async () => {
  const acceptedRoots = await roots();
  const acceptedStore = repository(acceptedRoots.runRoot, attemptScope);
  const acceptedChecks = await saveCheckResults(acceptedStore);
  await saveRunProjection(acceptedStore, "FINALIZING");
  const resetFailureRef = await saveResetFailure(acceptedStore, "explicit");
  await saveEnvironmentProjection(
    acceptedStore,
    "QUARANTINED",
    0,
    "environment-storage",
    [resetFailureRef as EnvironmentInstance["failureRefs"][number]],
  );
  assert.equal(
    (await acceptedStore.putImmutable(
      context(),
      gateDecision("gate-explicit-reset-failure", acceptedChecks),
    )).status,
    "SUCCEEDED",
  );

  const rejectedRoots = await roots();
  const rejectedStore = repository(rejectedRoots.runRoot, attemptScope);
  const rejectedChecks = await saveCheckResults(rejectedStore);
  await saveRunProjection(rejectedStore, "FINALIZING");
  await saveEnvironmentProjection(rejectedStore, "QUARANTINED", 0);
  const rejected = await rejectedStore.putImmutable(
    context(),
    gateDecision("gate-unexplained-missing-reset", rejectedChecks),
  );
  assert.equal(rejected.status, "REJECTED");
  if (rejected.status === "REJECTED") {
    assert.equal(rejected.rejectionCode, "PRECONDITION_FAILED");
  }
});

test("GateDecision rejects missing, damaged or non-final Environment facts", async () => {
  const missingEnvironmentRoots = await roots();
  const missingEnvironmentStore = repository(missingEnvironmentRoots.runRoot, attemptScope);
  const missingEnvironmentRefs = await saveCheckResults(missingEnvironmentStore);
  await saveGateOrderPrerequisites(missingEnvironmentStore);
  await unlink(
    join(
      missingEnvironmentRoots.runRoot,
      ids.run,
      "records",
      "environment",
      "environment-storage.json",
    ),
  );
  const missingEnvironment = await missingEnvironmentStore.putImmutable(
    context(),
    gateDecision("gate-missing-environment", missingEnvironmentRefs),
  );
  assert.equal(missingEnvironment.status, "REJECTED");
  if (missingEnvironment.status === "REJECTED") {
    assert.equal(missingEnvironment.rejectionCode, "PRECONDITION_FAILED");
  }

  const nonFinalRoots = await roots();
  const nonFinalStore = repository(nonFinalRoots.runRoot, attemptScope);
  const nonFinalRefs = await saveCheckResults(nonFinalStore);
  await saveGateOrderPrerequisites(nonFinalStore, { environmentState: "RESETTING" });
  const nonFinal = await nonFinalStore.putImmutable(
    context(),
    gateDecision("gate-non-final-environment", nonFinalRefs),
  );
  assert.equal(nonFinal.status, "REJECTED");
  if (nonFinal.status === "REJECTED") assert.equal(nonFinal.rejectionCode, "PRECONDITION_FAILED");

  const zeroGenerationRoots = await roots();
  const zeroGenerationStore = repository(zeroGenerationRoots.runRoot, attemptScope);
  const zeroGenerationRefs = await saveCheckResults(zeroGenerationStore);
  await saveGateOrderPrerequisites(zeroGenerationStore, { resetGeneration: 0 });
  const zeroGeneration = await zeroGenerationStore.putImmutable(
    context(),
    gateDecision("gate-zero-reset-generation", zeroGenerationRefs),
  );
  assert.equal(zeroGeneration.status, "REJECTED");
  if (zeroGeneration.status === "REJECTED") {
    assert.equal(zeroGeneration.rejectionCode, "PRECONDITION_FAILED");
  }

  const damagedRoots = await roots();
  const damagedStore = repository(damagedRoots.runRoot, attemptScope);
  const damagedRefs = await saveCheckResults(damagedStore);
  await saveGateOrderPrerequisites(damagedStore);
  const resetPath = join(
    damagedRoots.runRoot,
    ids.run,
    "records",
    "reset-verification",
    "reset-verification-storage.json",
  );
  const resetRecord = JSON.parse(await readFile(resetPath, "utf8")) as Record<string, unknown>;
  resetRecord.result = "MISMATCH";
  await chmod(resetPath, 0o600);
  await writeFile(resetPath, canonicalJson(resetRecord), "utf8");
  await chmod(resetPath, 0o400);
  const damaged = await damagedStore.putImmutable(
    context(),
    gateDecision("gate-damaged-reset", damagedRefs),
  );
  assert.equal(damaged.status, "REJECTED");
  if (damaged.status === "REJECTED") {
    assert.equal(damaged.failureDrafts[0]?.reasonCode, "EVIDENCE_INTEGRITY");
  }
});

test("MVP-STORE-AC-008 orphan lifecycle revisions block restart instead of being guessed", async () => {
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
