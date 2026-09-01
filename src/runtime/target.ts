import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { lstat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import type { Readable } from "node:stream";

import {
  LINUX_SETPRIV_PATH,
  linuxSetprivArguments,
} from "../core/contracts.js";

export type TargetTerminationKind =
  | "EXITED"
  | "TARGET_FAILED"
  | "TIMED_OUT"
  | "CANCELLED"
  | "HARNESS_ERROR";

export interface TargetExecutionRequest {
  executablePath: string;
  profile: string;
  task: string;
  cwd: string;
  runtimeDshHomePath: string;
  probeOutputPath: string;
  sourceRunId: string;
  deadlineMs: number;
  maxOutputBytes: number;
  targetUid?: number;
  targetGid?: number;
  modelEnvironment?: Readonly<Record<string, string>>;
  fixtureBehavior?: string;
  signal?: AbortSignal;
  onStarted?: (pid: number) => Promise<void> | void;
}

export interface TargetExecutionResult {
  terminationKind: TargetTerminationKind;
  startedAt: string;
  endedAt: string;
  exitCode?: number;
  signal?: NodeJS.Signals;
  pid?: number;
  stdout: Buffer;
  stderr: Buffer;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  errorMessage?: string;
}

const FORBIDDEN_ENVIRONMENT_NAMES = new Set([
  "HOME",
  "USERPROFILE",
  "NODE_OPTIONS",
  "BASH_ENV",
  "ENV",
  "CDPATH",
  "PATH",
  "LANG",
  "TMPDIR",
  "DSH_HOME",
]);

function assertArgument(value: string, name: string): void {
  if (value.length === 0 || value.includes("\0")) {
    throw new Error(`${name} must be a non-empty NUL-free string`);
  }
}

function appendBounded(
  chunks: Buffer[],
  chunk: Buffer,
  currentLength: number,
  limit: number,
): { length: number; truncated: boolean } {
  if (currentLength >= limit) return { length: currentLength, truncated: true };
  const remaining = limit - currentLength;
  const accepted = chunk.subarray(0, remaining);
  chunks.push(accepted);
  return {
    length: currentLength + accepted.byteLength,
    truncated: accepted.byteLength !== chunk.byteLength,
  };
}

function buildEnvironment(request: TargetExecutionRequest): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "C.UTF-8",
    TMPDIR: path.join(request.runtimeDshHomePath, "tmp"),
    DSH_HOME: request.runtimeDshHomePath,
    DSH_EVAL_PROBE_OUTPUT: request.probeOutputPath,
    DSH_EVAL_SOURCE_RUN_ID: request.sourceRunId,
    DSH_EVAL_WORKSPACE: request.cwd,
    DSH_EVAL_CONTENT_MODE: "DIGEST",
    DO_NOT_TRACK: "1",
    DSH_TELEMETRY_DISABLED: "1",
  };
  for (const [name, value] of Object.entries(request.modelEnvironment ?? {})) {
    if (
      FORBIDDEN_ENVIRONMENT_NAMES.has(name) ||
      name.startsWith("DSH_EVAL_") ||
      name.startsWith("DSHEVAL_") ||
      !/^[A-Z][A-Z0-9_]{1,63}$/.test(name) ||
      value.includes("\0")
    ) {
      throw new Error(`environment variable ${name} is not allowed`);
    }
    environment[name] = value;
  }
  if (request.fixtureBehavior !== undefined) {
    environment.DSHEVAL_FIXTURE_BEHAVIOR = request.fixtureBehavior;
  }
  return environment;
}

function terminateProcess(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    if (process.platform === "win32") process.kill(pid, signal);
    else process.kill(-pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ESRCH") throw error;
  }
}

/**
 * Executes the frozen DSH headless grammar. It deliberately accepts no shell
 * command and inherits only a small environment allow-list.
 */
export async function executeTarget(
  request: TargetExecutionRequest,
): Promise<TargetExecutionResult> {
  assertArgument(request.executablePath, "executablePath");
  assertArgument(request.profile, "profile");
  assertArgument(request.task, "task");
  assertArgument(request.cwd, "cwd");
  assertArgument(request.runtimeDshHomePath, "runtimeDshHomePath");
  assertArgument(request.probeOutputPath, "probeOutputPath");
  assertArgument(request.sourceRunId, "sourceRunId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.profile)) {
    throw new Error("profile must be a StableId-like argv value");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(request.sourceRunId)) {
    throw new Error("sourceRunId must be a StableId");
  }
  for (const [name, value] of [
    ["executablePath", request.executablePath],
    ["cwd", request.cwd],
    ["runtimeDshHomePath", request.runtimeDshHomePath],
    ["probeOutputPath", request.probeOutputPath],
  ] as const) {
    if (!path.isAbsolute(value)) throw new Error(`${name} must be absolute`);
  }
  if (!Number.isSafeInteger(request.deadlineMs) || request.deadlineMs <= 0) {
    throw new Error("deadlineMs must be a positive safe integer");
  }
  if (!Number.isSafeInteger(request.maxOutputBytes) || request.maxOutputBytes <= 0) {
    throw new Error("maxOutputBytes must be a positive safe integer");
  }
  if ((request.targetUid === undefined) !== (request.targetGid === undefined)) {
    throw new Error("targetUid and targetGid must be supplied together");
  }
  for (const [name, value] of [
    ["targetUid", request.targetUid],
    ["targetGid", request.targetGid],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
      throw new Error(`${name} must be a non-negative safe integer`);
    }
  }
  const fixtureExecution = request.fixtureBehavior !== undefined;
  if (!fixtureExecution) {
    if (request.targetUid === undefined || request.targetGid === undefined) {
      throw new Error("formal target execution requires the frozen dshagent uid and gid");
    }
    if (process.getuid?.() === request.targetUid) {
      throw new Error("formal target execution requires a uid distinct from dsheval");
    }
    const stagedRelative = path.relative(request.runtimeDshHomePath, request.executablePath);
    if (
      path.isAbsolute(stagedRelative) ||
      stagedRelative === "" ||
      stagedRelative.startsWith(`..${path.sep}`) ||
      stagedRelative.split(path.sep)[0] !== "target-runtime"
    ) {
      throw new Error("formal target executable must be staged inside its Runtime Home");
    }
  }

  const startedAt = new Date().toISOString();
  if (request.signal?.aborted === true) {
    return {
      terminationKind: "CANCELLED",
      startedAt,
      endedAt: new Date().toISOString(),
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      stdoutTruncated: false,
      stderrTruncated: false,
    };
  }
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let stdoutLength = 0;
  let stderrLength = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let stopReason: "TIMED_OUT" | "CANCELLED" | undefined;
  let spawnError: Error | undefined;
  let terminationError: Error | undefined;
  let startedCallbackError: Error | undefined;
  let childClosed = false;
  let escalation: NodeJS.Timeout | undefined;

  const environment = buildEnvironment(request);
  const targetArguments = ["--profile", request.profile, request.task];
  const launchExecutable = request.targetUid === undefined
    ? request.executablePath
    : LINUX_SETPRIV_PATH;
  const launchArguments = request.targetUid === undefined
    ? targetArguments
    : linuxSetprivArguments(
        request.targetUid,
        request.targetGid!,
        request.executablePath,
        targetArguments,
      );
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn(launchExecutable, launchArguments, {
      cwd: request.cwd,
      env: environment,
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const spawnFailure = error instanceof Error ? error : new Error(String(error));
    return {
      terminationKind: "HARNESS_ERROR",
      startedAt,
      endedAt: new Date().toISOString(),
      stdout: Buffer.alloc(0),
      stderr: Buffer.alloc(0),
      stdoutTruncated: false,
      stderrTruncated: false,
      errorMessage: spawnFailure.message,
    };
  }

  const signalProcessGroup = (signal: NodeJS.Signals): void => {
    if (childClosed) return;
    try {
      terminateProcess(child.pid, signal);
    } catch (error) {
      terminationError = error instanceof Error ? error : new Error(String(error));
    }
  };
  const beginTermination = (): void => {
    signalProcessGroup("SIGTERM");
    if (escalation === undefined) {
      escalation = setTimeout(() => signalProcessGroup("SIGKILL"), 1_000);
      escalation.unref();
    }
  };

  child.stdout.on("data", (data: Buffer) => {
    const appended = appendBounded(
      stdoutChunks,
      data,
      stdoutLength,
      request.maxOutputBytes,
    );
    stdoutLength = appended.length;
    stdoutTruncated ||= appended.truncated;
  });
  child.stderr.on("data", (data: Buffer) => {
    const appended = appendBounded(
      stderrChunks,
      data,
      stderrLength,
      request.maxOutputBytes,
    );
    stderrLength = appended.length;
    stderrTruncated ||= appended.truncated;
  });
  let settleStartReceipt!: () => void;
  let startReceiptSettled = false;
  const startReceiptPromise = new Promise<void>((resolve) => {
    settleStartReceipt = () => {
      if (startReceiptSettled) return;
      startReceiptSettled = true;
      resolve();
    };
  });
  child.once("error", (error) => {
    spawnError = error;
    settleStartReceipt();
  });
  const closePromise = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once("close", (code, signal) => {
      childClosed = true;
      if (escalation !== undefined) clearTimeout(escalation);
      resolve({ code, signal });
    });
  });

  const onAbort = (): void => {
    stopReason ??= "CANCELLED";
    beginTermination();
  };
  request.signal?.addEventListener("abort", onAbort, { once: true });

  const timeout = setTimeout(() => {
    stopReason ??= "TIMED_OUT";
    if (!startReceiptSettled) {
      startedCallbackError = new Error("target start receipt did not complete before the deadline");
      settleStartReceipt();
    }
    beginTermination();
  }, request.deadlineMs);
  timeout.unref();

  child.once("spawn", () => {
    if (child.pid === undefined) {
      startedCallbackError = new Error("spawned target did not expose a pid");
      settleStartReceipt();
      beginTermination();
      return;
    }
    Promise.resolve(request.onStarted?.(child.pid))
      .catch((error: unknown) => {
        startedCallbackError = error instanceof Error ? error : new Error(String(error));
        beginTermination();
      })
      .finally(settleStartReceipt);
  });

  const [closed] = await Promise.all([closePromise, startReceiptPromise]);
  clearTimeout(timeout);
  if (escalation !== undefined) clearTimeout(escalation);
  request.signal?.removeEventListener("abort", onAbort);

  let terminationKind: TargetTerminationKind;
  const identityLaunchUnconfirmed =
    request.targetUid !== undefined &&
    (closed.code === 126 || closed.code === 127) &&
    !(await lstat(request.probeOutputPath)
      .then((metadata) => metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0)
      .catch(() => false));
  if (
    startedCallbackError !== undefined ||
    spawnError !== undefined ||
    terminationError !== undefined ||
    identityLaunchUnconfirmed
  ) {
    terminationKind = "HARNESS_ERROR";
  } else if (stopReason === "CANCELLED") {
    terminationKind = "CANCELLED";
  } else if (stopReason === "TIMED_OUT") {
    terminationKind = "TIMED_OUT";
  } else if (closed.code === 0) {
    terminationKind = "EXITED";
  } else {
    terminationKind = "TARGET_FAILED";
  }

  const executionError =
    startedCallbackError ??
    spawnError ??
    terminationError ??
    (identityLaunchUnconfirmed
      ? new Error("identity launch or target exec could not be confirmed")
      : undefined);
  return {
    terminationKind,
    startedAt,
    endedAt: new Date().toISOString(),
    ...(closed.code === null ? {} : { exitCode: closed.code }),
    ...(closed.signal === null ? {} : { signal: closed.signal }),
    ...(child.pid === undefined ? {} : { pid: child.pid }),
    stdout: Buffer.concat(stdoutChunks),
    stderr: Buffer.concat(stderrChunks),
    stdoutTruncated,
    stderrTruncated,
    ...(executionError === undefined ? {} : { errorMessage: executionError.message }),
  };
}
