/**
 * 文件职责：把 DSH 自身落盘的 Session 日志转换为 DSHEval 的 Agent Trace 线协议。
 * 该适配只读取 Agent Session，不属于 Environment Observer。
 */
import { spawn } from "node:child_process";

interface DshSessionRecord {
  readonly type?: unknown;
  readonly seq?: unknown;
  readonly time?: unknown;
  readonly data?: unknown;
  readonly id?: unknown;
  readonly [field: string]: unknown;
}

export interface DshSessionTraceInput {
  readonly sessions: readonly {
    readonly sessionId: string;
    readonly jsonl: string;
  }[];
  readonly sourceRunId: string;
  readonly pid: number;
  readonly startedAt: string;
  readonly endedAt: string;
}

/** 读取 Session 首记录中的工作目录，用于并发 Case 精确归属。 */
export function dshSessionCwd(jsonl: string): string | undefined {
  const firstLine = jsonl.split(/\r?\n/u).find((line) => line.length > 0);
  if (firstLine === undefined) return undefined;
  try {
    const record = JSON.parse(firstLine) as DshSessionRecord;
    return record.type === "session" && typeof record.cwd === "string" ? record.cwd : undefined;
  } catch {
    return undefined;
  }
}

function eventTime(value: unknown, fallback: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const converted = new Date(value).toISOString();
  return Number.isFinite(Date.parse(converted)) ? converted : fallback;
}

/** 纯转换函数；保留每条 DSH Session Event 的原始字段。 */
export function dshSessionsToProbeJsonl(input: DshSessionTraceInput): Buffer {
  const envelopes: Array<Record<string, unknown>> = [];
  const emit = (kind: string, data: Record<string, unknown>, at: string): void => {
    const probeSeq = envelopes.length;
    envelopes.push({
      schema: "dsh-eval.probe/v1",
      runId: input.sourceRunId,
      probeSeq,
      at,
      monotonicNs: String(probeSeq * 1_000_000),
      pid: input.pid,
      kind,
      data,
    });
  };
  emit("probe/start", {
    source: "DSH_SESSION_ARCHIVE",
    sessionIds: input.sessions.map((session) => session.sessionId),
  }, input.startedAt);
  for (const session of input.sessions) {
    for (const line of session.jsonl.split(/\r?\n/u)) {
      if (line.length === 0) continue;
      let record: DshSessionRecord;
      try {
        record = JSON.parse(line) as DshSessionRecord;
      } catch {
        continue;
      }
      if (typeof record.type !== "string" || record.type === "session") continue;
      const event = {
        ...record,
        data: record.data !== null && typeof record.data === "object" && !Array.isArray(record.data)
          ? record.data
          : {},
      };
      emit("session/event", { sessionId: session.sessionId, event }, eventTime(record.time, input.startedAt));
    }
  }
  emit("probe/stop", { source: "DSH_SESSION_ARCHIVE" }, input.endedAt);
  return Buffer.from(`${envelopes.map((envelope) => JSON.stringify(envelope)).join("\n")}\n`, "utf8");
}

/** 使用 macOS VM 已安装的 zstd 有界解压一份 DSH Session Archive。 */
export async function readDshSessionArchive(
  archivePath: string,
  maxBytes: number,
): Promise<{ readonly jsonl: string; readonly truncated: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn("zstd", ["-dc", archivePath], { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let accepted = 0;
    let truncated = false;
    child.stdout.on("data", (value: Buffer) => {
      const remaining = Math.max(0, maxBytes - accepted);
      if (remaining > 0) {
        const chunk = value.subarray(0, remaining);
        chunks.push(chunk);
        accepted += chunk.byteLength;
      }
      if (value.byteLength > remaining) truncated = true;
    });
    child.stderr.on("data", (value: Buffer) => errors.push(value.subarray(0, 4096)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`DSH Session archive decompression failed: ${Buffer.concat(errors).toString("utf8").slice(0, 256)}`));
        return;
      }
      const bytes = Buffer.concat(chunks);
      const completeBytes = truncated
        ? bytes.subarray(0, Math.max(0, bytes.lastIndexOf(0x0a) + 1))
        : bytes;
      resolve({ jsonl: completeBytes.toString("utf8"), truncated });
    });
  });
}
