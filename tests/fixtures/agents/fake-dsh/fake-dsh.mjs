#!/usr/bin/env node

import { appendFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const argv = process.argv.slice(2);
if (argv.length !== 3 || argv[0] !== "--profile" || argv[1] !== "fixture-filesystem") {
  throw new Error("expected: --profile fixture-filesystem <task>");
}
const workspace = process.env.DSH_EVAL_WORKSPACE;
const probeOutput = process.env.DSH_EVAL_PROBE_OUTPUT;
const sourceRunId = process.env.DSH_EVAL_SOURCE_RUN_ID;
const behavior = process.env.DSHEVAL_FIXTURE_BEHAVIOR ?? "copy";

if (!workspace || !probeOutput || !sourceRunId) {
  throw new Error("workspace, probe-output and source-run-id are required");
}

await mkdir(path.dirname(probeOutput), { recursive: true });

const events = [];
async function event(kind, data = {}) {
  const entry = {
    schema: "dsh-eval.probe/v1",
    runId: behavior === "foreign-probe-run" ? `${sourceRunId}-foreign` : sourceRunId,
    probeSeq: events.length,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, events.length)).toISOString(),
    monotonicNs: String(events.length * 1_000_000),
    pid: process.pid,
    kind,
    data,
  };
  events.push(entry);
  await appendFile(probeOutput, `${JSON.stringify(entry)}\n`, "utf8");
}

await writeFile(probeOutput, "", "utf8");
await event("probe/start", {
  outputPath: "probe/events.jsonl",
  contentMode: "DIGEST",
  captureDispatch: true,
  captureLogs: true,
  node: process.version,
  cwd: workspace,
});
await event("session/event", {
  sessionId: "fixture-session",
  event: { seq: 0, type: "turn/start", data: { turn: 1 } },
});
await event("session/event", {
  sessionId: "fixture-session",
  event: { seq: 1, type: "step/start", data: { turn: 1, step: 1 } },
});
await event("session/event", {
  sessionId: "fixture-session",
  event: {
    seq: 2,
    type: "tool/call",
    data: { callId: "copy-1", name: "filesystem.write" },
  },
});

const source = path.join(workspace, "input", "source.txt");
const result = path.join(workspace, "output", "result.txt");

if (
  behavior === "copy" ||
  behavior === "missing-probe-stop" ||
  behavior === "foreign-probe-run" ||
  behavior === "nonzero-exit"
) {
  await writeFile(result, await readFile(source));
} else if (behavior === "audit-launch-contract") {
  await writeFile(
    result,
    `${JSON.stringify({
      argv,
      cwd: process.cwd(),
      environmentNames: Object.keys(process.env).sort(),
    })}\n`,
    "utf8",
  );
} else if (behavior === "require-secret") {
  if (process.env.MODEL_TEST_API_KEY !== "fixture-canary-secret-4e18d9") {
    throw new Error("expected the configured test Secret reference");
  }
  await writeFile(result, await readFile(source));
} else if (behavior === "leak-secret-probe") {
  if (process.env.MODEL_TEST_API_KEY !== "fixture-canary-secret-4e18d9") {
    throw new Error("expected the configured test Secret reference");
  }
  await writeFile(result, await readFile(source));
  await event("runtime/log", {
    level: "error",
    message: process.env.MODEL_TEST_API_KEY,
  });
} else if (behavior === "wrong") {
  await writeFile(result, "wrong bytes\n", "utf8");
} else if (behavior === "extra") {
  await writeFile(result, await readFile(source));
  await writeFile(path.join(workspace, "output", "extra.txt"), "side effect\n", "utf8");
} else if (behavior === "modify-input") {
  await writeFile(result, await readFile(source));
  await writeFile(source, "modified input\n", "utf8");
} else if (behavior === "symlink") {
  await symlink("../../../outside.txt", result);
} else if (behavior === "ignore-term-timeout") {
  process.on("SIGTERM", () => undefined);
  await new Promise((resolve) => setTimeout(resolve, 60_000));
} else if (behavior === "timeout") {
  await new Promise((resolve) => setTimeout(resolve, 60_000));
} else if (behavior !== "missing") {
  throw new Error(`unknown fixture behavior: ${behavior}`);
}

await event("session/event", {
  sessionId: "fixture-session",
  event: {
    seq: 3,
    type: "tool/result",
    data: { message: { source: { callId: "copy-1" } }, status: "completed" },
  },
});
await event("session/event", {
  sessionId: "fixture-session",
  event: { seq: 4, type: "step/end", data: { turn: 1, step: 1 } },
});
await event("session/event", {
  sessionId: "fixture-session",
  event: { seq: 5, type: "turn/end", data: { turn: 1 } },
});

if (behavior !== "missing-probe-stop") {
  await event("probe/stop");
}

if (behavior === "nonzero-exit") {
  process.stderr.write("fixture requested exit code 23\n");
  process.exitCode = 23;
}
