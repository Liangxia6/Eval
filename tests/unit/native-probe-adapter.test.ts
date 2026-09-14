import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { nativeProbeRunDirectory, readNativeProbeTrace } from "../../src/agent-trace/native-probe-adapter.js";
import { parseProbeJsonl } from "../../src/agent-trace/reader.js";
import { createProbeSourceDescriptor } from "../../src/observation/coordinator.js";
import { refForImmutable, validateScope } from "../../src/core/models.js";

const runId = "case-1.source";
const startedAt = "2026-09-08T00:00:00.000Z";
const endedAt = "2026-09-08T00:00:09.000Z";
const source = createProbeSourceDescriptor({
  sourceId: "source.audit",
  scope: validateScope({ targetId: "agent.test", targetSnapshotId: "snapshot.test", runId: "run.test", caseId: "case.test", attemptId: "attempt.test" }),
  resourceBinding: "native-probe", contentMode: "FULL",
  watermarkDefinition: { kind: "PROBE_SEQUENCE", field: "probeSeq" },
  createdAt: startedAt, producerVersion: "test",
});

function parse(bytes: Buffer) {
  return parseProbeJsonl(bytes, {
    expectedRunId: runId, expectedPid: 42, attemptId: "attempt.test",
    sourceRef: refForImmutable(source, source.sourceId), collectionStatusId: "collection.test",
    openedAt: startedAt, closedAt: endedAt, observedAt: endedAt,
  });
}

/** 按 RunWriter 公开线协议生成跨两个流的真实哈希链。 */
function nativeLines() {
  const events: Array<[string, Record<string, unknown>]> = [
    ["probe.start", {}],
    ["session.event", { sessionId: "s", event: { seq: 0, type: "turn/start", data: { turn: 1 } } }],
    ["runtime.log", { level: "info", message: "running" }],
    ["session.event", { sessionId: "s", event: { seq: 1, type: "tool/call", data: { turn: 1, callId: "c", name: "bash", arguments: { command: "printf result" } } } }],
    ["session.event", { sessionId: "s", event: { seq: 2, type: "tool/result", data: { turn: 1, message: { source: { callId: "c" }, content: "result" } } } }],
    ["session.event", { sessionId: "s", event: { seq: 3, type: "turn/end", data: { turn: 1 } } }],
    ["probe.stop", { reason: "plugin-dispose", writerFailure: null }],
  ];
  let previous = "0".repeat(64);
  return events.map(([kind, payload], index) => {
    const body = {
      schema: "dsheval.trace/v1", runId, seq: index + 1, ts: startedAt,
      monotonicNs: String(index * 1000), kind,
      source: { channel: "cordis-event", stability: "public" }, correlation: { sessionId: "s" },
      data: { payload, capture: {} },
    };
    const hash = createHash("sha256").update(previous).update("\n").update(JSON.stringify(body)).digest("hex");
    const line = JSON.stringify({ ...body, integrity: { algorithm: "sha256-chain-v1", previous, hash } });
    previous = hash;
    return line;
  });
}

async function adapt(lines: readonly string[], maxBytes = 1024 * 1024) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-native-integrity-"));
  try {
    const probeOutputPath = path.join(root, "probe.jsonl");
    const directory = nativeProbeRunDirectory(probeOutputPath, runId);
    await mkdir(directory, { recursive: true });
    const logs = lines.filter((line) => line.includes('"kind":"runtime.log"'));
    const events = lines.filter((line) => !line.includes('"kind":"runtime.log"'));
    await writeFile(path.join(directory, "events.jsonl"), events.length ? events.join("\n") + "\n" : "");
    await writeFile(path.join(directory, "logs.jsonl"), logs.length ? logs.join("\n") + "\n" : "");
    const result = await readNativeProbeTrace({ probeOutputPath, sourceRunId: runId, pid: 42, startedAt, endedAt, maxBytes });
    assert.ok(result, "present Native files must not silently fall back");
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("valid Native events/logs verify one chain and retain original sequence, tool arguments and results", async () => {
  const result = await adapt(nativeLines());
  const parsed = parse(result.bytes);
  assert.equal(parsed.collectionStatus.completeness, "COMPLETE");
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.records.map((item) => (item.envelope.data.native as { seq: number }).seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.match(result.bytes.toString(), /printf result/u);
  assert.match(result.bytes.toString(), /"content":"result"/u);
});

test("Native Probe absence leaves Session archive fallback available", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-native-absent-"));
  try {
    assert.equal(await readNativeProbeTrace({
      probeOutputPath: path.join(root, "probe.jsonl"), sourceRunId: runId, pid: 42,
      startedAt, endedAt, maxBytes: 1024,
    }), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const scenario of [
  { name: "missing middle record", mutate: (lines: string[]) => lines.filter((_, index) => index !== 2), reason: "NATIVE_SEQUENCE_GAP" },
  { name: "duplicate original sequence", mutate: (lines: string[]) => [...lines, lines[3]!], reason: "NATIVE_SEQUENCE_DUPLICATE" },
  { name: "changed payload with old digest", mutate: (lines: string[]) => lines.map((line) => line.replace("printf result", "printf tampered")), reason: "NATIVE_HASH_INVALID" },
  { name: "malformed raw line", mutate: (lines: string[]) => [...lines, "{damaged"], reason: "NATIVE_RECORD_INVALID" },
  { name: "empty existing Native files", mutate: (_lines: string[]) => [], reason: "NATIVE_RECORDS_MISSING" },
]) {
  test(`Native ${scenario.name} cannot become complete after normalization`, async () => {
    const result = await adapt(scenario.mutate(nativeLines()));
    const parsed = parse(result.bytes);
    assert.equal(parsed.collectionStatus.completeness, "PARTIAL");
    assert.ok(parsed.issues.some((issue) => issue.code === "ADAPTER_CAPTURE_INCOMPLETE" && issue.detail.includes(scenario.reason)));
    if (scenario.reason === "NATIVE_SEQUENCE_DUPLICATE") {
      assert.equal(parsed.records.filter((item) => (item.envelope.data.native as { seq?: number } | undefined)?.seq === 4).length, 2);
    }
    if (scenario.reason === "NATIVE_RECORD_INVALID") assert.match(result.bytes.toString(), /damaged/u);
  });
}

test("target exit remains a transparent boundary and does not prove Native flush/stop", async () => {
  const result = await adapt(nativeLines().slice(0, -1));
  const parsed = parse(result.bytes);
  assert.equal(parsed.records.at(-1)!.envelope.data.nativeStopObserved, false);
  assert.ok(parsed.issues.some((issue) => issue.code === "NATIVE_STOP_UNCONFIRMED"));
  assert.equal(parsed.collectionStatus.completeness, "PARTIAL");
});

test("Native truncation survives serialized adapter bytes even without caller flags", async () => {
  const lines = nativeLines();
  const result = await adapt(lines, Buffer.byteLength(lines[0]! + "\n" + lines[1]!) + 20);
  assert.equal(result.truncated, true);
  const parsed = parse(result.bytes);
  assert.equal(parsed.collectionStatus.truncated, true);
  assert.equal(parsed.collectionStatus.completeness, "PARTIAL");
  assert.ok(parsed.issues.some((issue) => issue.code === "PROBE_TRUNCATED"));
});

test("missing turn/end and tool/result remain incomplete despite a valid Native stop", async () => {
  // 重建哈希不是本例目标；直接解析完整转换结果中删去相应事件，重新生成兼容序号。
  const result = await adapt(nativeLines());
  const records = result.bytes.toString().trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
  const filtered = records.filter((record) => {
    const data = record.data as { event?: { type?: string } };
    return !["turn/end", "tool/result"].includes(data.event?.type ?? "");
  }).map((record, index) => ({ ...record, probeSeq: index }));
  const parsed = parse(Buffer.from(filtered.map((record) => JSON.stringify(record)).join("\n") + "\n"));
  assert.ok(parsed.issues.some((issue) => issue.code === "TURN_INCOMPLETE"));
  assert.ok(parsed.issues.some((issue) => issue.code === "TOOL_CALL_INCOMPLETE"));
  assert.equal(parsed.collectionStatus.completeness, "PARTIAL");
});
