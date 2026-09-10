/**
 * 文件职责：把 DSHEval 自有 Native Probe 的高覆盖 Trace 转换为现有
 * dsh-eval.probe/v1 线协议，让既有 RawObservation、Evidence 和 Judge 链路复用。
 * Native 原始字段保留在 data.native 中；本文件不属于 Environment Observer。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

interface NativeTraceEnvelope {
  readonly schema: "dsheval.trace/v1";
  readonly runId: string;
  readonly seq: number;
  readonly ts: string;
  readonly monotonicNs: string;
  readonly kind: string;
  readonly source: Readonly<Record<string, unknown>>;
  readonly correlation: Readonly<Record<string, unknown>>;
  readonly data: Readonly<Record<string, unknown>>;
  readonly integrity?: Readonly<Record<string, unknown>>;
}

export interface NativeProbeTraceInput {
  readonly probeOutputPath: string;
  readonly sourceRunId: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly maxBytes: number;
}

export interface NativeProbeTraceResult {
  readonly bytes: Buffer;
  readonly sourcePaths: readonly string[];
  readonly eventCount: number;
  readonly truncated: boolean;
}

/** Native Probe 根据 outputDir/runId 固定生成的 Run 目录。 */
export function nativeProbeRunDirectory(
  probeOutputPath: string,
  sourceRunId: string,
): string {
  return path.join(path.dirname(probeOutputPath), sourceRunId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nativePayload(record: NativeTraceEnvelope): Record<string, unknown> {
  return isRecord(record.data.payload) ? record.data.payload : {};
}

function parseNativeLines(bytes: Buffer, expectedRunId: string): NativeTraceEnvelope[] {
  const records: NativeTraceEnvelope[] = [];
  for (const line of bytes.toString("utf8").split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const value = JSON.parse(line) as unknown;
    if (
      !isRecord(value) ||
      value.schema !== "dsheval.trace/v1" ||
      value.runId !== expectedRunId ||
      !Number.isSafeInteger(value.seq) ||
      typeof value.ts !== "string" ||
      !Number.isFinite(Date.parse(value.ts)) ||
      typeof value.monotonicNs !== "string" ||
      typeof value.kind !== "string" ||
      !isRecord(value.source) ||
      !isRecord(value.correlation) ||
      !isRecord(value.data)
    ) {
      throw new Error("Native Probe emitted an invalid or foreign dsheval.trace/v1 record");
    }
    records.push(value as unknown as NativeTraceEnvelope);
  }
  return records;
}

function compatibleKind(record: NativeTraceEnvelope): {
  readonly kind: string;
  readonly data: Record<string, unknown>;
} {
  const payload = nativePayload(record);
  const native = {
    kind: record.kind,
    source: record.source,
    correlation: record.correlation,
    capture: record.data.capture ?? {},
    integrity: record.integrity ?? {},
  };
  if (record.kind === "probe.start") {
    return {
      kind: "probe/start",
      data: {
        ...payload,
        source: "DSHEVAL_NATIVE_PROBE",
        native,
      },
    };
  }
  if (record.kind === "probe.stop") {
    return { kind: "probe/stop", data: { ...payload, source: "DSHEVAL_NATIVE_PROBE", native } };
  }
  if (record.kind === "session.event") {
    return { kind: "session/event", data: { ...payload, native } };
  }
  if (record.kind === "runtime.log") {
    return { kind: "runtime/log", data: { ...payload, native } };
  }
  return {
    kind: "runtime/event",
    data: {
      eventName: record.kind,
      payload,
      native,
    },
  };
}

/**
 * 读取 Native Probe 的 events/logs 两条 hash-chain 流，按原始全局 seq 合并，
 * 再生成从 0 连续递增的兼容 Envelope。不存在 Native 输出时返回 undefined，
 * 由 Workflow 回退到 DSH Session archive。
 */
export async function readNativeProbeTrace(
  input: NativeProbeTraceInput,
): Promise<NativeProbeTraceResult | undefined> {
  const runDirectory = nativeProbeRunDirectory(input.probeOutputPath, input.sourceRunId);
  const candidates = [path.join(runDirectory, "events.jsonl"), path.join(runDirectory, "logs.jsonl")];
  const loaded: Array<{ readonly path: string; readonly bytes: Buffer }> = [];
  let totalBytes = 0;
  let truncated = false;
  for (const candidate of candidates) {
    const bytes = await readFile(candidate).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (bytes === undefined) continue;
    const remaining = Math.max(0, input.maxBytes - totalBytes);
    if (remaining === 0) {
      truncated = true;
      continue;
    }
    const accepted = bytes.subarray(0, remaining);
    const complete = accepted.byteLength === bytes.byteLength
      ? accepted
      : accepted.subarray(0, Math.max(0, accepted.lastIndexOf(0x0a) + 1));
    loaded.push({ path: candidate, bytes: complete });
    totalBytes += complete.byteLength;
    if (complete.byteLength !== bytes.byteLength) truncated = true;
  }
  if (loaded.length === 0) return undefined;
  const records = loaded
    .flatMap((item) => parseNativeLines(item.bytes, input.sourceRunId))
    .sort((left, right) => left.seq - right.seq);
  if (records.length === 0) return undefined;
  const unique = records.filter((record, index) => index === 0 || record.seq !== records[index - 1]!.seq);
  const envelopes = unique.map((record, probeSeq) => {
    const compatible = compatibleKind(record);
    return {
      schema: "dsh-eval.probe/v1",
      runId: input.sourceRunId,
      probeSeq,
      at: record.ts,
      monotonicNs: record.monotonicNs,
      pid: input.pid,
      kind: compatible.kind,
      data: compatible.data,
    };
  });
  // DSH Headless 正常退出时不保证 Cordis 执行插件 disposer。目标进程已经由
  // DSHEval wait() 确认终止，因此适配层补充一个明确标注、不可伪装成 Native
  // 事件的采集边界；原生 stop 若存在则原样使用。
  if (!unique.some((record) => record.kind === "probe.stop")) {
    const last = envelopes[envelopes.length - 1]!;
    envelopes.push({
      schema: "dsh-eval.probe/v1",
      runId: input.sourceRunId,
      probeSeq: envelopes.length,
      at: input.endedAt,
      monotonicNs: last.monotonicNs,
      pid: input.pid,
      kind: "probe/stop",
      data: {
        reason: "target-process-exit",
        source: "DSHEVAL_NATIVE_ADAPTER",
        nativeStopObserved: false,
      },
    });
  }
  return {
    bytes: Buffer.from(`${envelopes.map((item) => JSON.stringify(item)).join("\n")}\n`, "utf8"),
    sourcePaths: Object.freeze(loaded.map((item) => item.path)),
    eventCount: envelopes.length,
    truncated,
  };
}
