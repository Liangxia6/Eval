import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  nativeProbeRunDirectory,
  readNativeProbeTrace,
} from "../../src/agent-trace/native-probe-adapter.js";

test("Native Probe events and logs become one contiguous compatible trace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-native-probe-"));
  const outputPath = path.join(root, "events.jsonl");
  const runId = "case-1.source";
  const runDirectory = nativeProbeRunDirectory(outputPath, runId);
  await mkdir(runDirectory, { recursive: true });
  const record = (seq: number, kind: string, payload: Record<string, unknown>) => JSON.stringify({
    schema: "dsheval.trace/v1",
    runId,
    seq,
    ts: `2026-09-08T00:00:0${seq}.000Z`,
    monotonicNs: String(seq * 1000),
    kind,
    source: { channel: "cordis-event", stability: "public" },
    correlation: { sessionId: "session-1" },
    data: { payload, capture: {} },
    integrity: { algorithm: "sha256-chain-v1", previous: "a", hash: "b" },
  });
  await writeFile(path.join(runDirectory, "events.jsonl"), [
    record(1, "probe.start", { captureDispatch: true }),
    record(3, "session.event", { sessionId: "session-1", event: { seq: 1, type: "turn/start", data: { turn: 1 } } }),
    record(4, "probe.stop", { reason: "plugin-dispose" }),
  ].join("\n") + "\n");
  await writeFile(path.join(runDirectory, "logs.jsonl"), `${record(2, "runtime.log", { level: "info" })}\n`);

  const result = await readNativeProbeTrace({
    probeOutputPath: outputPath,
    sourceRunId: runId,
    pid: 42,
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:00:09.000Z",
    maxBytes: 1024 * 1024,
  });
  assert.ok(result);
  const decoded = result.bytes.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(decoded.map((item) => item.probeSeq), [0, 1, 2, 3]);
  assert.deepEqual(decoded.map((item) => item.kind), ["probe/start", "runtime/log", "session/event", "probe/stop"]);
  assert.equal(decoded[2].data.event.type, "turn/start");
  assert.equal(decoded[2].data.native.kind, "session.event");
});

test("Native Probe absence leaves Session archive fallback available", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-native-probe-missing-"));
  const result = await readNativeProbeTrace({
    probeOutputPath: path.join(root, "events.jsonl"),
    sourceRunId: "missing.source",
    pid: 42,
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:00:01.000Z",
    maxBytes: 1024,
  });
  assert.equal(result, undefined);
});

test("target process exit supplies a transparent stop boundary when Cordis skips dispose", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-native-probe-stop-"));
  const outputPath = path.join(root, "events.jsonl");
  const runId = "case-2.source";
  const runDirectory = nativeProbeRunDirectory(outputPath, runId);
  await mkdir(runDirectory, { recursive: true });
  await writeFile(path.join(runDirectory, "events.jsonl"), `${JSON.stringify({
    schema: "dsheval.trace/v1",
    runId,
    seq: 1,
    ts: "2026-09-08T00:00:00.000Z",
    monotonicNs: "1000",
    kind: "probe.start",
    source: { channel: "cordis-reflection", stability: "internal-version-pinned" },
    correlation: {},
    data: { payload: {}, capture: {} },
  })}\n`);
  const result = await readNativeProbeTrace({
    probeOutputPath: outputPath,
    sourceRunId: runId,
    pid: 42,
    startedAt: "2026-09-08T00:00:00.000Z",
    endedAt: "2026-09-08T00:00:01.000Z",
    maxBytes: 1024 * 1024,
  });
  assert.ok(result);
  const decoded = result.bytes.toString("utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(decoded.at(-1).kind, "probe/stop");
  assert.equal(decoded.at(-1).data.source, "DSHEVAL_NATIVE_ADAPTER");
  assert.equal(decoded.at(-1).data.nativeStopObserved, false);
});
