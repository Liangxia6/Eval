/** 测试职责：验证真实 DSH Session 日志可转换为完整、可判定的 Agent Trace。 */
import assert from "node:assert/strict";
import test from "node:test";

import { dshSessionCwd, dshSessionsToProbeJsonl } from "../../src/runtime/dsh-session-trace.js";
import { parseProbeJsonl } from "../../src/observation/runtime.js";
import { createProbeSourceDescriptor } from "../../src/observation/coordinator.js";
import { refForImmutable, validateScope } from "../../src/core/models.js";

test("DSH Session Archive 转换后保留工具、回答和完整边界", () => {
  const sessionJsonl = [
    { type: "session", id: "session-real", cwd: "/tmp/case-real", createdAt: 1_788_000_000_000 },
    { type: "turn/start", seq: 0, time: 1_788_000_000_001, data: { turn: 1 } },
    { type: "tool/call", seq: 1, time: 1_788_000_000_002, data: { callId: "c1", name: "bash" } },
    { type: "tool/result", seq: 2, time: 1_788_000_000_003, data: { callId: "c1", status: "completed" } },
    { type: "assistant/message", seq: 3, time: 1_788_000_000_004, data: { usage: { outputTokens: 20 } } },
    { type: "turn/end", seq: 4, time: 1_788_000_000_005, data: { turn: 1 } },
  ].map((value) => JSON.stringify(value)).join("\n");
  assert.equal(dshSessionCwd(sessionJsonl), "/tmp/case-real");
  const bytes = dshSessionsToProbeJsonl({
    sessions: [{ sessionId: "session-real", jsonl: sessionJsonl }],
    sourceRunId: "source-real",
    pid: 123,
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:00:01.000Z",
  });
  const source = createProbeSourceDescriptor({
    sourceId: "source.probe.attempt-real",
    scope: validateScope({
      targetId: "agent.test",
      targetSnapshotId: "snapshot.test",
      runId: "run-real",
      caseId: "case-real",
      attemptId: "attempt-real",
    }),
    resourceBinding: "dsh-session-archive",
    contentMode: "STRUCTURED",
    watermarkDefinition: { kind: "PROBE_SEQUENCE", field: "probeSeq" },
    createdAt: "2026-09-08T00:00:00.000Z",
    producerVersion: "test",
  });
  const parsed = parseProbeJsonl(bytes, {
    expectedRunId: "source-real",
    expectedPid: 123,
    attemptId: "attempt-real",
    sourceRef: refForImmutable(source, source.sourceId),
    collectionStatusId: "collection-real",
    openedAt: "2026-09-08T00:00:00.000Z",
    closedAt: "2026-09-08T00:00:01.000Z",
    observedAt: "2026-09-08T00:00:01.000Z",
  });
  assert.equal(parsed.collectionStatus.completeness, "COMPLETE");
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(
    parsed.records.filter((record) => record.envelope.kind === "session/event")
      .map((record) => (record.envelope.data.event as { type: string }).type),
    ["turn/start", "tool/call", "tool/result", "assistant/message", "turn/end"],
  );
});
