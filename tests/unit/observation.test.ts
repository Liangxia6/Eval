/**
 * 测试职责：验证 Probe JSONL、File Snapshot/Diff、Sensor Binding、完成账本和
 * Reset 独立观测，覆盖序号缺口、截断、读取失败与 symlink 逃逸。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ContractViolation,
  digestBytes,
  digestValue,
  validateStableId,
  validateVersionedAssetId,
  withContentDigest,
  withProjectionDigest,
  type EnvironmentInstance,
  type FileEntry,
  type ObservationExecutionRequest,
  type ObservationPlan,
  type PreparedObserverBinding,
  type Ref,
  type SensorAdapterDescriptor,
  type SourceDescriptor,
  type SourceRequirement,
} from "../../src/core/models.js";
import {
  activateObservation,
  beginBaseline,
  beginDrain,
  completeBaseline,
  completionLedger,
  createObservationSession,
  ledgerItem,
  rejectPostSealObservation,
  sealObservation,
} from "../../src/observation/coordinator.js";
import {
  parseProbeJsonl,
  probeIssueFailureDrafts,
  readProbeFileBounded,
  type ProbeEnvelope,
} from "../../src/agent-trace/reader.js";
import {
  FILE_SENSOR_DESCRIPTOR,
  FILE_SENSOR_REGISTRY_DIGEST,
  validateCaptureContext,
  type EnvironmentCaptureContext,
} from "../../observer-lab/adapters/filesystem/binding.js";
import {
  buildFileDiff,
  captureFileSnapshot,
  emptyWorkspaceManifestDigest,
  materializeFileDiff,
  materializeFileSnapshot,
  verifyResetSnapshot,
  type FileSnapshotDraft,
} from "../../observer-lab/adapters/filesystem/sensor.js";

const ZERO_DIGEST = digestBytes("");

test("parses complete Probe, preserves unknown events and exact raw bytes", () => {
  const lines = completeProbe("source-run-1");
  lines.splice(4, 0, probe("source-run-1", 4, "future/kind", { future: true }));
  for (let index = 5; index < lines.length; index += 1) {
    lines[index] = { ...lines[index]!, probeSeq: index };
  }
  const raw = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  const result = parseProbeJsonl(raw, probeOptions("source-run-1"));

  assert.equal(result.collectionStatus.completeness, "COMPLETE");
  assert.equal(result.collectionStatus.firstSourceSeq, 0);
  assert.equal(result.collectionStatus.lastSourceSeq, lines.length - 1);
  assert.deepEqual(Buffer.from(result.rawArtifactBytes), Buffer.from(raw));
  assert.equal(result.records.find((record) => record.envelope.kind === "future/kind")?.envelope.data.future, true);
  assert.equal(result.issues.length, 0);
});

test("Probe 为每个高频事件保留紧凑索引并由原始字节承载完整负载", () => {
  const lines = completeProbe("source-run-1");
  lines.splice(
    1,
    0,
    probe("source-run-1", 1, "session/event", {
      sessionId: "s",
      event: { seq: 0, type: "assistant/chunk", data: { delta: "token" } },
    }),
    probe("source-run-1", 2, "runtime/event", { name: "session/event" }),
  );
  for (let index = 3; index < lines.length; index += 1) {
    lines[index] = { ...lines[index]!, probeSeq: index };
  }
  const raw = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
  const result = parseProbeJsonl(raw, probeOptions("source-run-1"));

  assert.equal(result.collectionStatus.completeness, "COMPLETE");
  assert.equal(result.records.length, lines.length);
  assert.equal(result.observations.length, lines.length);
  const compacted = result.observations.filter(
    (item) => item.payloadInline.data.compactedDuplicate === true,
  );
  assert.equal(compacted.length, 2);
  assert.equal(compacted.some((item) => item.payloadInline.data.eventName === "session/event"), true);
  assert.equal(compacted.some((item) => {
    const event = item.payloadInline.data.event;
    return typeof event === "object" && event !== null && "type" in event && event.type === "assistant/chunk";
  }), true);
  assert.deepEqual(Buffer.from(result.rawArtifactBytes), Buffer.from(raw));
});

test("distinguishes gap, duplicate, out-of-order and malformed tail", () => {
  const events = completeProbe("source-run-1");
  events[2] = { ...events[2]!, probeSeq: 3 };
  events[3] = { ...events[3]!, probeSeq: 3 };
  events[4] = { ...events[4]!, probeSeq: 2 };
  const validPrefix = `${events.map((line) => JSON.stringify(line)).join("\n")}\n`;
  const raw = `${validPrefix}{"schema":"dsh-eval.probe/v1"`;
  const result = parseProbeJsonl(raw, probeOptions("source-run-1"));
  const codes = new Set(result.issues.map((issue) => issue.code));

  assert.equal(result.collectionStatus.completeness, "PARTIAL");
  assert.equal(result.collectionStatus.truncated, true);
  assert.equal(result.validPrefixByteLength, Buffer.byteLength(validPrefix));
  assert.ok(codes.has("SEQUENCE_GAP"));
  assert.ok(codes.has("SEQUENCE_DUPLICATE"));
  assert.ok(codes.has("SEQUENCE_OUT_OF_ORDER"));
  assert.ok(codes.has("BAD_JSON"));
  assert.equal(result.records.length, events.length);
});

test("marks a collector-bounded prefix PARTIAL and preserves its exact bytes", () => {
  const raw = `${completeProbe("source-run-1").map((line) => JSON.stringify(line)).join("\n")}\n`;
  const result = parseProbeJsonl(raw, {
    ...probeOptions("source-run-1"),
    inputTruncated: true,
  });

  assert.deepEqual(Buffer.from(result.rawArtifactBytes), Buffer.from(raw));
  assert.equal(result.collectionStatus.completeness, "PARTIAL");
  assert.equal(result.collectionStatus.truncated, true);
  assert.ok(result.issues.some((issue) => issue.code === "PROBE_TRUNCATED"));
});

test("withholds canary-bearing Probe content from ordinary observations", () => {
  const raw = Buffer.from('{"message":"fixture-canary-secret-4e18d9"}\n', "utf8");
  const result = parseProbeJsonl(raw, {
    ...probeOptions("source-run-1"),
    contentRestricted: true,
  });

  assert.deepEqual(Buffer.from(result.rawArtifactBytes), raw);
  assert.equal(result.records.length, 0);
  assert.equal(result.observations.length, 0);
  assert.equal(result.collectionStatus.completeness, "PARTIAL");
  assert.ok(result.issues.some((issue) => issue.code === "PROBE_CONTENT_RESTRICTED"));
});

test("reads only the frozen byte bound and rejects symlink input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-probe-bound-"));
  try {
    const probePath = path.join(root, "probe.jsonl");
    const linkPath = path.join(root, "probe-link.jsonl");
    await writeFile(probePath, "0123456789abcdef", "utf8");
    const bounded = await readProbeFileBounded({ path: probePath, maxBytes: 8, timeoutMs: 1_000 });
    assert.equal(Buffer.from(bounded.bytes).toString("utf8"), "01234567");
    assert.equal(bounded.truncated, true);
    assert.equal(bounded.timedOut, false);
    await symlink(probePath, linkPath);
    await assert.rejects(
      readProbeFileBounded({ path: linkPath, maxBytes: 8, timeoutMs: 1_000 }),
      /regular non-symlink/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Observation rejects every Sensor binding triple drift before capture", () => {
  const valid = captureContextFixture();
  assert.doesNotThrow(() => validateCaptureContext("BEFORE", valid));
  const original = valid.request.preparedBindings[0]!;
  const driftedFields = [
    {
      sensorImplementationId: validateStableId<"SensorImplementationId">(
        "fixture.drifted-file-sensor",
      ),
    },
    { sensorImplementationVersion: "9.9.9" },
    { sensorCapabilityDigest: digestBytes("drifted file sensor capabilities") },
  ] as const;

  for (const drift of driftedFields) {
    const { grantDigest: _oldGrantDigest, ...originalGrantFields } = original;
    const changedGrantFields = Object.freeze({ ...originalGrantFields, ...drift });
    const changedBinding: PreparedObserverBinding = Object.freeze({
      ...changedGrantFields,
      grantDigest: digestValue(changedGrantFields, ["readCapabilityToken"]),
    });
    const drifted: EnvironmentCaptureContext = {
      ...valid,
      request: { ...valid.request, preparedBindings: Object.freeze([changedBinding]) },
    };
    assert.throws(
      () => validateCaptureContext("BEFORE", drifted),
      (error: unknown) =>
        error instanceof ContractViolation && error.code === "SENSOR_IMPLEMENTATION_DRIFT",
    );
  }
});

test("Observation accepts a compatible descriptor through the existing binding interface", () => {
  const replacementDescriptor: SensorAdapterDescriptor = Object.freeze({
    ...FILE_SENSOR_DESCRIPTOR,
    implementationId: validateStableId<"SensorImplementationId">(
      "fixture.compatible-file-sensor",
    ),
    implementationVersion: "2.0.0",
  });
  const replacement = captureContextFixture(replacementDescriptor);
  const validated = validateCaptureContext("BEFORE", replacement, replacementDescriptor);

  assert.equal(validated.requirement.sensorImplementationId, replacementDescriptor.implementationId);
  assert.equal(
    validated.requirement.sensorImplementationVersion,
    replacementDescriptor.implementationVersion,
  );
  assert.deepEqual(
    validated.requirement.sensorCapabilityDigest,
    replacementDescriptor.capabilityDigest,
  );
  assert.notEqual(
    replacement.request.sensorRegistryDigest.value,
    FILE_SENSOR_REGISTRY_DIGEST.value,
  );
});

test("File Diff identifies every required change class", () => {
  const file = (portablePath: string, content: string, mode = 0o644): FileEntry => ({
    portablePath,
    entryType: "FILE",
    mode,
    byteLength: content.length,
    contentDigest: digestBytes(content),
    resolvedWithinRoot: true,
  });
  const before = snapshotDraft("before", "BEFORE", [
    file("removed.txt", "gone"),
    file("content.txt", "old"),
    file("metadata.txt", "same", 0o644),
    { portablePath: "link", entryType: "SYMLINK", mode: 0o777, linkTarget: "inside", resolvedWithinRoot: true },
    file("type", "file"),
    file("unreadable", "before"),
    file("unchanged", "same"),
  ]);
  const after = snapshotDraft("after", "AFTER", [
    file("added.txt", "new"),
    file("content.txt", "new"),
    file("metadata.txt", "same", 0o600),
    { portablePath: "link", entryType: "SYMLINK", mode: 0o777, linkTarget: "outside", resolvedWithinRoot: false },
    { portablePath: "type", entryType: "DIRECTORY", mode: 0o755, resolvedWithinRoot: true },
    {
      portablePath: "unreadable",
      entryType: "FILE",
      mode: 0o644,
      byteLength: 6,
      resolvedWithinRoot: true,
      readError: "denied",
    },
    file("unchanged", "same"),
  ]);
  const diff = buildFileDiff({
    diffId: "diff-1",
    beforeSnapshot: before,
    afterSnapshot: after,
    beforeSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "before"),
    afterSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "after"),
  });

  assert.deepEqual(diff.added.map((item) => item.portablePath), ["added.txt"]);
  assert.deepEqual(diff.removed.map((item) => item.portablePath), ["removed.txt"]);
  assert.deepEqual(diff.typeChanged.map((item) => item.portablePath), ["type"]);
  assert.deepEqual(
    diff.modified.map((item) => [item.portablePath, item.kind]),
    [
      ["content.txt", "CONTENT_CHANGED"],
      ["link", "SYMLINK_CHANGED"],
      ["metadata.txt", "METADATA_CHANGED"],
      ["unreadable", "UNREADABLE"],
    ],
  );
  assert.equal(diff.unchangedCount, 1);
  const materialized = materializeFileDiff(diff, immutableMetadata());
  assert.deepEqual(materialized.added.map((item) => item.kind), ["ADDED"]);
  assert.deepEqual(materialized.removed.map((item) => item.kind), ["REMOVED"]);
  assert.deepEqual(materialized.typeChanged.map((item) => item.kind), ["TYPE_CHANGED"]);
  assert.deepEqual(
    materialized.modified.map((item) => item.kind),
    ["CONTENT_CHANGED", "SYMLINK_CHANGED", "METADATA_CHANGED", "UNREADABLE"],
  );
});

test("missing stop and foreign Run/PID remain explicit collection gaps", () => {
  const missingStop = completeProbe("source-run-1").slice(0, -1);
  const result = parseProbeJsonl(
    `${missingStop.map((line) => JSON.stringify(line)).join("\n")}\n`,
    { ...probeOptions("source-run-1"), expectedPid: 42 },
  );
  assert.equal(result.collectionStatus.completeness, "PARTIAL");
  assert.ok(
    result.collectionStatus.gaps.some((gap) => gap.reasonCode === "PROBE_STOP_MISSING"),
  );
  const failures = probeIssueFailureDrafts(result, {
    scope: immutableMetadata().scope,
    occurredAt: "2026-01-01T00:00:10.000Z",
  });
  assert.equal(failures[0]?.origin, "DSHEVAL");
  assert.equal(failures[0]?.actor, "COLLECTOR");
  assert.equal(failures[0]?.category, "OBSERVATION_FAILURE");

  const foreign = completeProbe("foreign-run");
  const foreignResult = parseProbeJsonl(
    `${foreign.map((line) => JSON.stringify({ ...line, pid: 99 })).join("\n")}\n`,
    { ...probeOptions("source-run-1"), expectedPid: 42 },
  );
  assert.equal(foreignResult.collectionStatus.completeness, "PARTIAL");
  assert.ok(foreignResult.records.every((record) => record.association === "UNRESOLVED"));
  assert.ok(
    foreignResult.collectionStatus.gaps.some((gap) => gap.reasonCode === "PROBE_RUN_ID_MISMATCH"),
  );
  assert.ok(
    foreignResult.collectionStatus.gaps.some((gap) => gap.reasonCode === "PROBE_PID_MISMATCH"),
  );
});

test("scanner hashes files with lstat and records root-escaping symlink without following it", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "dsheval-observation-"));
  const workspace = path.join(parent, "workspace");
  const neighbor = path.join(parent, "neighbor.txt");
  try {
    await mkdir(path.join(workspace, "input"), { recursive: true });
    await mkdir(path.join(workspace, "output"));
    await writeFile(path.join(workspace, "input", "context.txt"), "DSHEval MVP ready\n");
    await writeFile(neighbor, "must not be read through the link");
    await symlink(neighbor, path.join(workspace, "output", "escape"));

    const snapshot = await captureFileSnapshot({
      snapshotId: "snapshot-1",
      attemptId: "attempt-1",
      phase: "AFTER",
      rootPath: workspace,
      rootBinding: "attempt.workspace",
      maxFileBytes: 1024,
      now: sequenceClock("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z"),
    });
    const source = snapshot.entries.find((entry) => entry.portablePath === "input/context.txt");
    const escape = snapshot.entries.find((entry) => entry.portablePath === "output/escape");

    assert.equal(snapshot.completeness, "COMPLETE");
    assert.equal(source?.contentDigest?.value, digestBytes("DSHEval MVP ready\n").value);
    assert.equal(escape?.entryType, "SYMLINK");
    assert.equal(escape?.resolvedWithinRoot, false);
    assert.equal(escape?.contentDigest, undefined);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("POST_RESET uses a fresh capture and distinguishes MATCH/MISMATCH/UNAVAILABLE", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "dsheval-reset-"));
  try {
    const expected = emptyWorkspaceManifestDigest("attempt.workspace");
    const clean = await captureFileSnapshot({
      snapshotId: "post-reset-clean",
      attemptId: "attempt-1",
      phase: "POST_RESET",
      rootPath: workspace,
      rootBinding: "attempt.workspace",
      maxFileBytes: 1024,
      now: sequenceClock("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z"),
    });
    const common = {
      environmentInstanceRef: dummyRef("dsheval.mvp.environment/v1", "environment-1"),
      resetGeneration: 2,
      expectedCleanDigest: expected,
      collectionStatusRef: dummyRef("dsheval.mvp.collection-status/v1", "status-reset"),
    } as const;
    const match = verifyResetSnapshot({
      ...common,
      verificationId: "verification-clean",
      postResetSnapshot: clean,
      postResetSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "post-reset-clean"),
    });
    assert.equal(match.result, "MATCH");

    await writeFile(path.join(workspace, "residue.txt"), "residue");
    const residue = await captureFileSnapshot({
      snapshotId: "post-reset-residue",
      attemptId: "attempt-1",
      phase: "POST_RESET",
      rootPath: workspace,
      rootBinding: "attempt.workspace",
      maxFileBytes: 1024,
      now: sequenceClock("2026-01-01T00:00:02.000Z", "2026-01-01T00:00:03.000Z"),
    });
    const mismatch = verifyResetSnapshot({
      ...common,
      verificationId: "verification-residue",
      postResetSnapshot: residue,
      postResetSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "post-reset-residue"),
    });
    assert.equal(mismatch.result, "MISMATCH");

    const unavailable = verifyResetSnapshot({
      ...common,
      verificationId: "verification-unavailable",
      postResetSnapshot: { ...residue, completeness: "PARTIAL", readErrors: [{ portablePath: ".", reasonCode: "LIST_FAILED", messageRedacted: "denied" }] },
      postResetSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "post-reset-unavailable"),
    });
    assert.equal(unavailable.result, "UNAVAILABLE");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("unavailable root is PARTIAL and cannot become a conclusive no-change Diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-file-failure-"));
  const missing = path.join(root, "missing");
  try {
    const unavailable = await captureFileSnapshot({
      snapshotId: "snapshot-unavailable",
      attemptId: "attempt-1",
      phase: "AFTER",
      rootPath: missing,
      rootBinding: "attempt.workspace",
      maxFileBytes: 1024,
      now: sequenceClock("2026-01-01T00:00:00.000Z", "2026-01-01T00:00:01.000Z"),
    });
    assert.equal(unavailable.completeness, "PARTIAL");
    assert.equal(unavailable.readErrors[0]?.portablePath, ".");
    assert.doesNotThrow(() => materializeFileSnapshot(unavailable, immutableMetadata()));
    const before = snapshotDraft("before-complete", "BEFORE", []);
    assert.throws(
      () =>
        buildFileDiff({
          diffId: "diff-unavailable",
          beforeSnapshot: before,
          afterSnapshot: unavailable,
          beforeSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "before-complete"),
          afterSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "snapshot-unavailable"),
        }),
      /requires COMPLETE/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Session seals only after ordered baseline, ACTIVE and explicit ledger", () => {
  const scope = {
    targetId: validateStableId<"TargetId">("target-1"),
    targetSnapshotId: validateStableId<"TargetSnapshotId">("target-snapshot-1"),
    runId: validateStableId<"RunId">("run-1"),
    caseId: validateStableId<"CaseId">("case-1"),
    attemptId: validateStableId<"AttemptId">("attempt-1"),
  };
  let session = createObservationSession({
    observationSessionId: "session-1",
    attemptId: "attempt-1",
    scope,
    agentTracePlanRef: dummyRef("dsheval.mvp.agent-trace-plan/v1", "agent-trace-plan-1"),
    observationPlanRef: dummyRef("dsheval.mvp.observation-plan/v1", "observation-plan-1"),
    sourceRefs: [
      dummyRef("dsheval.mvp.source/v1", "source-probe"),
      dummyRef("dsheval.mvp.source/v1", "source-file"),
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
  });
  session = beginBaseline(session, transition("2026-01-01T00:00:01.000Z")).nextProjection;
  session = completeBaseline(session, {
    ...transition("2026-01-01T00:00:02.000Z"),
    beforeSnapshotRef: dummyRef("dsheval.mvp.file-snapshot/v1", "before"),
  }).nextProjection;
  session = activateObservation(session, transition("2026-01-01T00:00:03.000Z")).nextProjection;
  session = beginDrain(session, {
    ...transition("2026-01-01T00:00:05.000Z"),
    targetTerminatedAt: "2026-01-01T00:00:04.000Z",
  }).nextProjection;
  const digestBeforeSeal = session.projectionDigest.value;
  const ledger = completionLedger({
    TARGET_TERMINATION: ledgerItem("TARGET_TERMINATION", "COMPLETE"),
    TOOL_CALLS: ledgerItem("TOOL_CALLS", "COMPLETE"),
    SESSION_FLUSH: ledgerItem("SESSION_FLUSH", "COMPLETE"),
    PROBE_WATERMARK: ledgerItem("PROBE_WATERMARK", "COMPLETE"),
    STABLE_WINDOW: ledgerItem("STABLE_WINDOW", "COMPLETE"),
    FINAL_FILE_SNAPSHOT: ledgerItem("FINAL_FILE_SNAPSHOT", "COMPLETE"),
  });
  session = sealObservation(session, {
    ...transition("2026-01-01T00:00:06.000Z"),
    collectionStatusRefs: [
      dummyRef("dsheval.mvp.collection-status/v1", "status-probe"),
      dummyRef("dsheval.mvp.collection-status/v1", "status-file"),
    ],
    completionLedger: ledger,
    allRawArtifactsCommitted: true,
  }).nextProjection;

  assert.equal(session.state, "SEALED");
  assert.notEqual(session.projectionDigest.value, digestBeforeSeal);
  const sealedDigest = session.projectionDigest.value;
  const late = rejectPostSealObservation(session, { occurredAt: "2026-01-01T00:00:07.000Z" });
  assert.equal(late.reasonCode, "POST_SEAL_OBSERVATION");
  assert.equal(session.projectionDigest.value, sealedDigest);
  assert.throws(() => activateObservation(session, transition("2026-01-01T00:00:08.000Z")), /cannot transition/);
});

function completeProbe(runId: string): ProbeEnvelope[] {
  return [
    probe(runId, 0, "probe/start", { outputPath: "probe.jsonl", contentMode: "STRUCTURED", captureDispatch: true, captureLogs: true, node: "v22", cwd: "/workspace" }),
    probe(runId, 1, "session/event", { sessionId: "s", event: { seq: 0, type: "turn/start", data: { turn: 1 } } }),
    probe(runId, 2, "session/event", { sessionId: "s", event: { seq: 1, type: "tool/call", data: { callId: "c", name: "python" } } }),
    probe(runId, 3, "session/event", { sessionId: "s", event: { seq: 2, type: "tool/result", data: { message: { source: { callId: "c" } } } } }),
    probe(runId, 4, "session/event", { sessionId: "s", event: { seq: 3, type: "turn/end", data: { turn: 1 } } }),
    probe(runId, 5, "probe/stop", {}),
  ];
}

function probe(runId: string, probeSeq: number, kind: string, data: Record<string, unknown>): ProbeEnvelope {
  return {
    schema: "dsh-eval.probe/v1",
    runId,
    probeSeq,
    at: `2026-01-01T00:00:0${Math.min(probeSeq, 9)}.000Z`,
    monotonicNs: probeSeq,
    pid: 42,
    kind,
    data,
  };
}

function probeOptions(expectedRunId: string) {
  return {
    expectedRunId,
    attemptId: "attempt-1",
    sourceRef: dummyRef("dsheval.mvp.source/v1", "source-probe") as Ref<SourceDescriptor>,
    collectionStatusId: "status-probe",
    openedAt: "2026-01-01T00:00:00.000Z",
    closedAt: "2026-01-01T00:00:10.000Z",
    observedAt: "2026-01-01T00:00:10.000Z",
  };
}

function snapshotDraft(
  snapshotId: string,
  phase: "BEFORE" | "AFTER",
  entries: readonly FileEntry[],
): FileSnapshotDraft {
  const manifest = { rootBinding: "attempt.workspace", entries, readErrors: [], completeness: "COMPLETE" };
  return {
    snapshotId,
    attemptId: "attempt-1",
    phase,
    rootBinding: "attempt.workspace",
    scanStartedAt: "2026-01-01T00:00:00.000Z",
    scanCompletedAt: "2026-01-01T00:00:01.000Z",
    entries,
    readErrors: [],
    completeness: "COMPLETE",
    snapshotDigest: digestValue(manifest),
  };
}

function immutableMetadata() {
  return {
    scope: {
      targetId: validateStableId<"TargetId">("target-1"),
      targetSnapshotId: validateStableId<"TargetSnapshotId">("target-snapshot-1"),
      runId: validateStableId<"RunId">("run-1"),
      caseId: validateStableId<"CaseId">("case-1"),
      attemptId: validateStableId<"AttemptId">("attempt-1"),
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    producerVersion: "test",
  } as const;
}

function captureContextFixture(
  descriptor: SensorAdapterDescriptor = FILE_SENSOR_DESCRIPTOR,
): EnvironmentCaptureContext {
  const metadata = immutableMetadata();
  const sourceRequirement: SourceRequirement = Object.freeze({
    sourceRequirementId: validateVersionedAssetId<"SourceRequirementId">(
      "source.filesystem.workspace/v1",
    ),
    sourceType: "FILESYSTEM",
    sensorImplementationId: descriptor.implementationId,
    sensorImplementationVersion: descriptor.implementationVersion,
    sensorCapabilityDigest: descriptor.capabilityDigest,
    resourceBinding: "attempt.workspace",
    mandatory: true,
    minimumTrust: "INDEPENDENT",
    contentMode: "SHA256",
    maxBytes: 1024,
    timeoutMs: 1_000,
    watermarkDefinition: "before-after-stable-window/v1",
  });
  const observationPlan: ObservationPlan = withContentDigest({
    schema: "dsheval.mvp.observation-plan/v1" as const,
    observationPlanId: validateStableId<"ObservationPlanId">("observation-plan.binding-fixture"),
    scope: metadata.scope,
    createdAt: metadata.createdAt,
    producerVersion: metadata.producerVersion,
    evaluationPlanRef: dummyRef("dsheval.mvp.evaluation-plan/v1", "evaluation-plan.binding-fixture"),
    casePlanId: validateStableId<"CasePlanId">("case-plan.binding-fixture"),
    sourceRequirements: Object.freeze([sourceRequirement]),
    boundaryPolicy: Object.freeze({ baselineBeforeTargetStart: true }),
    stablePolicy: Object.freeze({ quietWindowMs: 250 }),
    contentPolicy: Object.freeze({ contentMode: "SHA256" }),
    semanticDigest: digestValue({ sourceRequirements: [sourceRequirement] }),
  });
  const environment: EnvironmentInstance & { readonly state: "SEEDED" } = withProjectionDigest({
    schema: "dsheval.mvp.environment/v1" as const,
    aggregateId: validateStableId("environment.binding-fixture"),
    scope: metadata.scope,
    state: "SEEDED" as const,
    revision: 2,
    createdAt: metadata.createdAt,
    updatedAt: "2026-01-01T00:00:02.000Z",
    failureRefs: Object.freeze([]),
    environmentInstanceId: validateStableId<"EnvironmentInstanceId">(
      "environment.binding-fixture",
    ),
    attemptId: metadata.scope.attemptId!,
    environmentId: validateVersionedAssetId<"EnvironmentDefinitionId">(
      "environment.filesystem.workspace/v1",
    ),
    workspaceBinding: sourceRequirement.resourceBinding,
    resetGeneration: 0,
  });
  const grantFields = Object.freeze({
    bindingId: validateStableId<"PreparedObserverBindingId">("binding.file-fixture"),
    environmentInstanceId: environment.environmentInstanceId,
    resetGeneration: environment.resetGeneration,
    sourceRequirementId: sourceRequirement.sourceRequirementId,
    resourceBinding: sourceRequirement.resourceBinding,
    sensorImplementationId: sourceRequirement.sensorImplementationId,
    sensorImplementationVersion: sourceRequirement.sensorImplementationVersion,
    sensorCapabilityDigest: sourceRequirement.sensorCapabilityDigest,
    allowedOperations: Object.freeze(["READ", "SNAPSHOT", "DRAIN"] as const),
    readCapabilityToken: "process-only-fixture-token",
    expiresAt: "2999-01-01T00:00:00.000Z",
  });
  const binding: PreparedObserverBinding = Object.freeze({
    ...grantFields,
    grantDigest: digestValue(grantFields, ["readCapabilityToken"]),
  });
  const sensorRegistryDigest = digestValue([descriptor]);
  const request: ObservationExecutionRequest = Object.freeze({
    kind: "CASE_RUN" as const,
    observationPlan,
    environment,
    preparedBindings: Object.freeze([binding]),
    sensorRegistryDigest,
  });
  return Object.freeze({
    request,
    sourceRequirementId: sourceRequirement.sourceRequirementId,
    expectedSensorRegistryDigest: sensorRegistryDigest,
    rootPath: "/fixture/not-read-by-contract-test",
    snapshotId: "snapshot.binding-fixture",
    attemptId: metadata.scope.attemptId!,
    maxFileBytes: 1024,
  });
}

function dummyRef<T>(schema: string, id: string): Ref<T> {
  return {
    schema,
    id: validateStableId(id),
    digest: ZERO_DIGEST,
    ...(schema.endsWith("observation-session/v1") || schema.endsWith("environment/v1") ? { revision: 0 } : {}),
  };
}

function transition(occurredAt: string) {
  return { occurredAt, reasonCode: "TEST_TRANSITION" };
}

function sequenceClock(...values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)]!;
}

test("parallel Sessions with identical turn and call IDs close independently", () => {
  const first = completeProbe("source-run-1");
  const second = first.filter((item) => item.kind === "session/event").map((item) => ({
    ...item, data: { ...item.data, sessionId: "second-session" },
  }));
  const records = [
    first[0]!, first[1]!, second[0]!, first[2]!, second[1]!,
    first[3]!, second[2]!, first[4]!, second[3]!, first[5]!,
  ].map((item, probeSeq) => ({ ...item, probeSeq }));
  const parsed = parseProbeJsonl(records.map((item) => JSON.stringify(item)).join("\n"), probeOptions("source-run-1"));
  assert.equal(parsed.collectionStatus.completeness, "COMPLETE");
});

test("a result from another Session cannot close an outstanding tool call", () => {
  const records = completeProbe("source-run-1").map((item) => ({
    ...item,
    data: item.kind === "session/event" && (item.data.event as { type?: string } | undefined)?.type === "tool/result"
      ? { ...item.data, sessionId: "different-session" } : item.data,
  }));
  const parsed = parseProbeJsonl(records.map((item) => JSON.stringify(item)).join("\n"), probeOptions("source-run-1"));
  assert.equal(parsed.collectionStatus.completeness, "PARTIAL");
  assert.ok(parsed.issues.some((issue) => issue.code === "TOOL_CALL_INCOMPLETE"));
});
