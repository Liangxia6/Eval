import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

import {
  prepareEnvironment,
  resetEnvironment,
  seedEnvironment,
} from "../../src/runtime/environment.js";
import {
  executeTarget,
  type TargetExecutionRequest,
} from "../../src/runtime/target.js";

const FIXTURE_EXECUTABLE = path.join(
  process.cwd(),
  "tests/fixtures/agents/fake-dsh/fake-dsh.mjs",
);

async function temporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "dsheval-target-security-"));
}

async function preparedTarget(root: string, id: string) {
  const prepared = await prepareEnvironment({
    workspaceRoot: path.join(root, "workspaces"),
    runtimeDshHomeRoot: path.join(root, "runtime-homes"),
    runId: `run-${id}`,
    caseId: `case-${id}`,
    attemptId: `attempt-${id}`,
  });
  await seedEnvironment(prepared.workspacePath, [
    {
      portablePath: "input",
      entryType: "DIRECTORY",
      mode: "0555",
      readOnlyForTarget: true,
    },
    {
      portablePath: "input/source.txt",
      entryType: "FILE",
      mode: "0444",
      readOnlyForTarget: true,
      content: "DSHEval launch contract\n",
      encoding: "utf8",
    },
    {
      portablePath: "output",
      entryType: "DIRECTORY",
      mode: "0755",
      readOnlyForTarget: false,
    },
  ]);
  return prepared;
}

type PreparedTarget = Awaited<ReturnType<typeof preparedTarget>>;

async function removeTestRoot(
  root: string,
  prepared: PreparedTarget | undefined,
): Promise<void> {
  if (prepared !== undefined) {
    await resetEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      workspacePath: prepared.workspacePath,
      resetGeneration: 0,
    });
  }
  await rm(root, { recursive: true, force: true });
}

function baseRequest(
  prepared: Awaited<ReturnType<typeof preparedTarget>>,
  id: string,
): TargetExecutionRequest {
  return {
    executablePath: FIXTURE_EXECUTABLE,
    profile: "fixture-filesystem",
    task: "copy the public input",
    cwd: prepared.workspacePath,
    runtimeDshHomePath: prepared.runtimeDshHomePath,
    probeOutputPath: prepared.probeOutputPath,
    sourceRunId: `source-${id}`,
    deadlineMs: 5_000,
    maxOutputBytes: 64 * 1024,
    fixtureBehavior: "copy",
  };
}

test("MVP-SEC-RUN-001: Headless launch uses literal argv, the frozen cwd, and does not inherit the parent environment", async () => {
  const root = await temporaryDirectory();
  let prepared: PreparedTarget | undefined;
  const previousSentinel = process.env.DSHEVAL_PARENT_SENTINEL;
  process.env.DSHEVAL_PARENT_SENTINEL = "must-not-be-inherited";
  try {
    prepared = await preparedTarget(root, "launch-contract");
    const shellMarker = path.join(root, "shell-injection-marker.txt");
    const task = `literal task; touch ${shellMarker}; echo \"$HOME\"`;
    const result = await executeTarget({
      ...baseRequest(prepared, "launch-contract"),
      task,
      fixtureBehavior: "audit-launch-contract",
      modelEnvironment: {
        MODEL_TEST_API_KEY: "test-only-secret-value",
      },
    });

    assert.equal(result.terminationKind, "EXITED");
    assert.equal(result.exitCode, 0);
    await assert.rejects(access(shellMarker), /ENOENT/);

    const audit = JSON.parse(
      await readFile(path.join(prepared.workspacePath, "output/result.txt"), "utf8"),
    ) as {
      readonly argv: readonly string[];
      readonly cwd: string;
      readonly environmentNames: readonly string[];
    };
    assert.deepEqual(audit.argv, ["--profile", "fixture-filesystem", task]);
    assert.equal(audit.cwd, prepared.workspacePath);
    const constructedNames = [
      "DO_NOT_TRACK",
      "DSHEVAL_FIXTURE_BEHAVIOR",
      "DSH_EVAL_CONTENT_MODE",
      "DSH_EVAL_PROBE_OUTPUT",
      "DSH_EVAL_SOURCE_RUN_ID",
      "DSH_EVAL_WORKSPACE",
      "DSH_HOME",
      "DSH_TELEMETRY_DISABLED",
      "LANG",
      "MODEL_TEST_API_KEY",
      "PATH",
      "TMPDIR",
    ];
    for (const name of constructedNames) {
      assert.equal(audit.environmentNames.includes(name), true, `missing ${name}`);
    }
    const platformInjectedNames = process.platform === "darwin"
      ? ["__CF_USER_TEXT_ENCODING"]
      : [];
    assert.deepEqual(
      audit.environmentNames.filter((name) => !platformInjectedNames.includes(name)),
      constructedNames,
    );
    assert.equal(audit.environmentNames.includes("HOME"), false);
    assert.equal(audit.environmentNames.includes("DSHEVAL_PARENT_SENTINEL"), false);

    const probe = await readFile(prepared.probeOutputPath, "utf8");
    assert.match(probe, /"kind":"probe\/start"/);
    assert.match(probe, /"kind":"probe\/stop"/);
  } finally {
    if (previousSentinel === undefined) delete process.env.DSHEVAL_PARENT_SENTINEL;
    else process.env.DSHEVAL_PARENT_SENTINEL = previousSentinel;
    await removeTestRoot(root, prepared);
  }
});

test("MVP-SEC-RUN-002: argv, cwd, and non-allowlisted environment injection are rejected before spawn", async () => {
  const root = await temporaryDirectory();
  let prepared: PreparedTarget | undefined;
  try {
    prepared = await preparedTarget(root, "rejected-launch");
    let startedCount = 0;
    const request = {
      ...baseRequest(prepared, "rejected-launch"),
      onStarted: () => {
        startedCount += 1;
      },
    };

    await assert.rejects(
      executeTarget({ ...request, profile: "fixture-filesystem;touch-marker" }),
      /profile must be a StableId-like argv value/,
    );
    await assert.rejects(
      executeTarget({ ...request, task: "copy\0--profile=attacker" }),
      /task must be a non-empty NUL-free string/,
    );
    await assert.rejects(
      executeTarget({ ...request, cwd: "relative/injected-workspace" }),
      /cwd must be absolute/,
    );
    await assert.rejects(
      executeTarget({ ...request, modelEnvironment: { HOME: "/attacker" } }),
      /environment variable HOME is not allowed/,
    );
    await assert.rejects(
      executeTarget({
        ...request,
        modelEnvironment: { DSH_EVAL_WORKSPACE: "/attacker" },
      }),
      /environment variable DSH_EVAL_WORKSPACE is not allowed/,
    );
    await assert.rejects(
      executeTarget({
        ...request,
        modelEnvironment: { MODEL_SAFE_NAME: "value\0injection" },
      }),
      /environment variable MODEL_SAFE_NAME is not allowed/,
    );

    assert.equal(startedCount, 0);
    await assert.rejects(access(prepared.probeOutputPath), /ENOENT/);
  } finally {
    await removeTestRoot(root, prepared);
  }
});

test("MVP-FI-TARGET-001: a started target's non-zero exit maps to TARGET_FAILED and preserves its Probe", async () => {
  const root = await temporaryDirectory();
  let prepared: PreparedTarget | undefined;
  try {
    prepared = await preparedTarget(root, "nonzero");
    let startedCount = 0;
    const result = await executeTarget({
      ...baseRequest(prepared, "nonzero"),
      fixtureBehavior: "nonzero-exit",
      onStarted: () => {
        startedCount += 1;
      },
    });

    assert.equal(startedCount, 1);
    assert.equal(result.terminationKind, "TARGET_FAILED");
    assert.equal(result.exitCode, 23);
    assert.equal(result.signal, undefined);
    assert.equal(result.stderr.toString("utf8"), "fixture requested exit code 23\n");
    const probe = await readFile(prepared.probeOutputPath, "utf8");
    assert.match(probe, /"probeSeq":0/);
    assert.match(probe, /"kind":"probe\/start"/);
    assert.match(probe, /"kind":"tool\/call"|"type":"tool\/call"/);
    assert.match(probe, /"kind":"probe\/stop"/);
  } finally {
    await removeTestRoot(root, prepared);
  }
});

test("MVP-SEC-IDENTITY-001: an unconfirmed formal setpriv or target exec failure is a Harness error", async (context) => {
  const currentUid = process.getuid?.();
  const currentGid = process.getgid?.();
  if (currentUid === undefined || currentGid === undefined) {
    context.skip("POSIX identity APIs are required");
    return;
  }
  const root = await temporaryDirectory();
  let prepared: PreparedTarget | undefined;
  try {
    prepared = await preparedTarget(root, "formal-launch-failure");
    const fixtureRequest = baseRequest(prepared, "formal-launch-failure");
    const { fixtureBehavior, executablePath, ...formalRequest } = fixtureRequest;
    assert.equal(fixtureBehavior, "copy");
    assert.equal(executablePath, FIXTURE_EXECUTABLE);
    const result = await executeTarget({
      ...formalRequest,
      executablePath: path.join(
        prepared.runtimeDshHomePath,
        "target-runtime",
        "missing-dsh-entrypoint",
      ),
      targetUid: currentUid === 0 ? 65_534 : currentUid + 1,
      targetGid: currentGid === 0 ? 65_534 : currentGid + 1,
    });

    assert.equal(result.terminationKind, "HARNESS_ERROR");
    assert.ok(result.errorMessage);
    await assert.rejects(access(prepared.probeOutputPath), /ENOENT/);
  } finally {
    await removeTestRoot(root, prepared);
  }
});
