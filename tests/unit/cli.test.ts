import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCliArgs, runCli } from "../../src/app/cli.js";
import { digestValue } from "../../src/core/models.js";

async function readPersistedText(root: string): Promise<string> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
  const chunks: string[] = [];
  for (const entry of entries) {
    const location = path.join(root, entry.name);
    if (entry.isDirectory()) chunks.push(await readPersistedText(location));
    else if (entry.isFile()) chunks.push(await readFile(location, "utf8"));
  }
  return chunks.join("\n");
}

test("MVP-UT-CLI-001 parses the three Target commands without implicit fixture mode", () => {
  assert.deepEqual(parseCliArgs(["inspect", "--target", "target.json"]), {
    command: "inspect",
    target: "target.json",
    fixture: false,
  });
  assert.deepEqual(parseCliArgs(["--", "inspect", "--target", "target.json"]), {
    command: "inspect",
    target: "target.json",
    fixture: false,
  });
  assert.deepEqual(
    parseCliArgs(["inspect", "--target", "fixture.json", "--fixture"]),
    {
      command: "inspect",
      target: "fixture.json",
      fixture: true,
    },
  );
  assert.deepEqual(
    parseCliArgs([
      "plan",
      "--target",
      "target.json",
      "--pack",
      "packs/filesystem",
      "--config",
      "config.json",
      "--run-id",
      "run-plan-1",
    ]),
    {
      command: "plan",
      target: "target.json",
      fixture: false,
      packRoot: "packs/filesystem",
      configFile: "config.json",
      runId: "run-plan-1",
    },
  );
  assert.deepEqual(
    parseCliArgs([
      "run",
      "--target",
      "fixture.json",
      "--fixture",
      "--fixture-behavior",
      "missing-probe-stop",
    ]),
    {
      command: "run",
      target: "fixture.json",
      fixture: true,
      fixtureBehavior: "missing-probe-stop",
    },
  );
});

test("MVP-UT-CLI-001 parses report reconstruction bounds", () => {
  assert.deepEqual(
    parseCliArgs([
      "report",
      "--run",
      "run-report-1",
      "--report-root",
      "var/reports",
      "--max-bytes",
      "2097152",
    ]),
    {
      command: "report",
      runId: "run-report-1",
      reportRoot: "var/reports",
      maxBytes: 2_097_152,
    },
  );
});

test("MVP-UT-CLI-001 rejects ambiguous, misplaced, and implicitly enabled fixture options", () => {
  assert.throws(() => parseCliArgs([]), /expected one command/u);
  assert.throws(() => parseCliArgs(["run"]), /required CLI option/u);
  assert.throws(
    () => parseCliArgs(["run", "--target", "a.json", "--target", "b.json"]),
    /only once/u,
  );
  assert.throws(
    () => parseCliArgs(["run", "--target", "a.json", "--fixture-behavior", "copy"]),
    /explicit --fixture/u,
  );
  assert.throws(
    () =>
      parseCliArgs([
        "inspect",
        "--target",
        "a.json",
        "--fixture",
        "--fixture-behavior",
        "copy",
      ]),
    /not valid/u,
  );
  assert.throws(
    () => parseCliArgs(["inspect", "--target", "a.json", "--pack", "packs"]),
    /not valid/u,
  );
  assert.throws(
    () => parseCliArgs(["report", "--run", "run-1", "--fixture"]),
    /not valid/u,
  );
  assert.throws(
    () => parseCliArgs(["report", "--run", "run-1", "--max-bytes", "0"]),
    /positive integer/u,
  );
});

test("MVP-UT-CLI-001 runCli sends caught errors to its diagnostic sink", async () => {
  const diagnostics: string[] = [];
  const result = await runCli(["unknown-command"], process.cwd(), (message) => {
    diagnostics.push(message);
  });
  assert.equal(result.exitCode, 4);
  assert.deepEqual(diagnostics, [
    "CliUsageError: expected one command: inspect, plan, run, or report",
  ]);
});

test("MVP-E2E-012 MVP-UT-CLI-001 non-FULL_AGENT targets are a stable pre-plan rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-cli-target-"));
  try {
    const descriptor = path.join(root, "plugin-target.json");
    await writeFile(
      descriptor,
      JSON.stringify({
        schema: "dsheval.mvp.target-descriptor/v1",
        targetId: "plugin-target",
        targetType: "PLUGIN",
        sourceRoot: ".",
        dshExecutable: "dsh",
        dshHome: ".dsh",
        profile: "default",
        targetIdentity: "dshagent",
        requestedScope: "FILESYSTEM_MVP",
        pluginId: "unsupported-on-purpose",
      }),
      "utf8",
    );
    for (const command of ["inspect", "plan", "run"] as const) {
      const diagnostics: string[] = [];
      const result = await runCli(
        [command, "--target", descriptor],
        root,
        (message) => diagnostics.push(message),
      );
      assert.deepEqual(result, {
        schema: "dsheval.mvp.cli-summary/v1",
        command,
        status: "PLAN_UNSATISFIABLE",
        failureGroups: ["plan_conflict"],
        reasonCodes: ["UNSUPPORTED_TARGET_KIND"],
        exitCode: 2,
      });
      assert.deepEqual(diagnostics, [
        "UnsupportedTargetKindError: DSHEval MVP supports only FULL_AGENT targets",
      ]);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-UT-PLAN-002 missing Scenario makes the plan UNSATISFIABLE before Run creation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-cli-missing-scenario-"));
  try {
    const packRoot = path.join(root, "packs");
    await cp(path.join(process.cwd(), "packs"), packRoot, { recursive: true });
    await rename(
      path.join(packRoot, "scenarios", "filesystem-copy-exact-v1.json"),
      path.join(packRoot, "scenarios", "filesystem-copy-exact-v1.missing"),
    );
    const diagnostics: string[] = [];
    const result = await runCli(
      [
        "plan",
        "--target",
        path.join(process.cwd(), "examples", "fixture-target.json"),
        "--pack",
        packRoot,
        "--fixture",
        "--run-id",
        "fixture-plan-missing-scenario",
      ],
      root,
      (message) => diagnostics.push(message),
    );
    assert.equal(result.status, "PLAN_UNSATISFIABLE");
    assert.equal(result.command, "plan");
    assert.equal(result.exitCode, 2);
    assert.equal("runState" in result, false);
    const reasonCodes = "reasonCodes" in result
      ? result.reasonCodes as readonly string[]
      : [];
    assert.ok(reasonCodes.includes("PACK_FILE_SET_INVALID"));
    assert.deepEqual(diagnostics, [
      "plan finished with exit code 2 (PACK_FILE_SET_INVALID)",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-E2E-012 maxAttempts=2 is rejected during Planning without Run creation or Agent start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-cli-retry-scope-"));
  try {
    const packRoot = path.join(root, "packs");
    await cp(path.join(process.cwd(), "packs"), packRoot, { recursive: true });
    const scenarioPath = path.join(
      packRoot,
      "scenarios",
      "filesystem-copy-exact-v1.json",
    );
    const scenario = JSON.parse(await readFile(scenarioPath, "utf8")) as {
      contentDigest: unknown;
      execution: Record<string, unknown>;
      [key: string]: unknown;
    };
    scenario.execution = { ...scenario.execution, maxAttempts: 2 };
    scenario.contentDigest = digestValue(scenario, ["contentDigest"]);
    await writeFile(scenarioPath, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");

    const diagnostics: string[] = [];
    const runId = "fixture-retry-scope-rejected";
    const result = await runCli(
      [
        "run",
        "--target",
        path.join(process.cwd(), "examples", "fixture-target.json"),
        "--pack",
        packRoot,
        "--fixture",
        "--fixture-behavior",
        "copy",
        "--run-id",
        runId,
      ],
      root,
      (message) => diagnostics.push(message),
    );

    assert.equal(result.command, "run");
    assert.equal(result.status, "PLAN_UNSATISFIABLE");
    assert.equal(result.exitCode, 2);
    assert.equal("runState" in result, false);
    assert.equal("gate" in result, false);
    assert.ok((result.reasonCodes as readonly string[]).includes("UNSUPPORTED_PACK"));
    assert.deepEqual(diagnostics, ["run finished with exit code 2 (UNSUPPORTED_PACK)"]);

    assert.equal("recordsPath" in result, true);
    const persisted = "recordsPath" in result
      ? await readPersistedText(result.recordsPath)
      : "";
    assert.equal(
      persisted.includes('"schema":"dsheval.mvp.run/v1"'),
      false,
      "Planning rejection must not persist an EvaluationRun",
    );
    assert.equal(
      persisted.includes('"operation":"TARGET_START"'),
      false,
      "Planning rejection must not start the Target",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-UT-CLI-001 process entrypoint emits one JSON value and diagnostics on stderr", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "dist/src/app/cli.js"), "unknown-command"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 4);
  const lines = result.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]!) as unknown, {
    schema: "dsheval.mvp.cli-summary/v1",
    command: "unknown",
    status: "FAILED",
    failureGroups: ["plan_conflict"],
    reasonCodes: ["CLI_USAGE"],
    exitCode: 4,
  });
  assert.match(
    result.stderr,
    /^\[dsheval\] CliUsageError: expected one command: inspect, plan, run, or report\n$/u,
  );
});
