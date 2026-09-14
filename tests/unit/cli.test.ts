/**
 * 测试职责：验证 CLI 参数判别联合、退出码、stdout/stderr 协议、报告命令边界，
 * 以及 inspect/plan/run 对主 Workflow 的正确映射。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseCliArgs, runCli } from "../../src/app/cli.js";
import { declarePluginsInTarget, resolvePlugins } from "../../src/app/plugins.js";

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
      "--fixture",
      "--dataset-catalog",
      "datasets/catalog.json",
      "--datasets",
      "datasets",
      "--labels",
      "labels",
      "--trace",
      "trace/dsh-runtime.json",
      "--environment",
      "environments/macos.json",
      "--test-profile",
      "STANDARD",
      "--config",
      "config.json",
      "--run-id",
      "run-plan-1",
    ]),
    {
      command: "plan",
      target: "target.json",
      fixture: true,
      datasetCatalogPath: "datasets/catalog.json",
      datasetsRoot: "datasets",
      labelsRoot: "labels",
      traceFile: "trace/dsh-runtime.json",
      environmentFile: "environments/macos.json",
      testProfile: "STANDARD",
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
  assert.deepEqual(
    parseCliArgs([
      "run",
      "--target",
      "target.json",
      "--case",
      "attention-pytorch.case-1",
      "--max-cases",
      "2",
      "--stop-after-case",
    ]),
    {
      command: "run",
      target: "target.json",
      fixture: false,
      selectedCaseId: "attention-pytorch.case-1",
      maxCases: 2,
      stopAfterCase: true,
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

test("MVP-UT-CLI-PLUGIN resolves repeated names by highest rank and requires install metadata", async () => {
  const originalFetch = globalThis.fetch;
  const manifest = {
    datasets: { search: { url: "/search.json" } },
  };
  const search = {
    rankings: [
      {
        rank: 8,
        fullName: "lower/example",
        name: "same-name",
        install: {
          method: "pnpm-profile",
          packageName: "lower-package",
          commands: ["dsh plugin --profile web add lower-package"],
        },
      },
      {
        rank: 2,
        fullName: "higher/example",
        name: "same-name",
        install: {
          method: "pnpm-profile",
          packageName: "higher-package",
          commands: ["dsh plugin --profile web add higher-package"],
        },
      },
      {
        rank: 1,
        fullName: "no-source/example",
        name: "no-source",
      },
    ],
  };
  globalThis.fetch = (async (url: string | URL) => {
    const body = String(url).endsWith("manifest.json") ? manifest : search;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const selected = await resolvePlugins(["same-name"]);
    assert.equal(selected.plugins.length, 1);
    assert.equal(selected.plugins[0]?.fullName, "higher/example");
    assert.equal(selected.plugins[0]?.packageName, "higher-package");
    await assert.rejects(
      () => resolvePlugins(["no-source"]),
      /no recognized install source/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MVP-UT-CLI-PLUGIN adds selected plugins to the isolated static snapshot inputs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-plugin-declare-"));
  try {
    const targetRoot = path.join(root, "target");
    const dshHome = path.join(targetRoot, ".dsh");
    const profileRoot = path.join(dshHome, "profiles", "default");
    await mkdir(targetRoot, { recursive: true });
    await writeFile(
      path.join(targetRoot, "effective-config.json"),
      JSON.stringify({ profile: { plugins: [{ id: "existing-plugin" }] } }),
      "utf8",
    );
    await mkdir(profileRoot, { recursive: true });
    await writeFile(
      path.join(profileRoot, "profile.json"),
      JSON.stringify({ profile: "default", plugins: ["existing-plugin"] }),
      "utf8",
    );
    await declarePluginsInTarget(
      targetRoot,
      dshHome,
      "default",
      [{
        input: "new-plugin",
        rank: 1,
        fullName: "owner/new-plugin",
        name: "new-plugin",
        packageName: "@owner/new-plugin",
        installMethod: "pnpm-profile",
      }],
    );
    const effective = JSON.parse(await readFile(path.join(targetRoot, "effective-config.json"), "utf8")) as {
      profile: { plugins: unknown[] };
    };
    const profile = JSON.parse(await readFile(path.join(profileRoot, "profile.json"), "utf8")) as {
      plugins: unknown[];
    };
    assert.deepEqual(effective.profile.plugins, [{ id: "existing-plugin" }, "@owner/new-plugin"]);
    assert.deepEqual(profile.plugins, ["existing-plugin", "@owner/new-plugin"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-UT-CLI-001 rejects ambiguous, misplaced, and implicitly enabled fixture options", () => {
  assert.throws(() => parseCliArgs([]), /expected one command/u);
  assert.throws(() => parseCliArgs(["run"]), /required CLI option/u);
  assert.deepEqual(
    parseCliArgs(["inspect", "--target", "a.json", "--plugin", "one", "--plugin", "two,three"]),
    {
      command: "inspect",
      target: "a.json",
      fixture: false,
      plugins: ["one", "two", "three"],
    },
  );
  assert.throws(
    () => parseCliArgs(["run", "--target", "a.json", "--target", "b.json"]),
    /only once/u,
  );
  assert.throws(
    () => parseCliArgs(["run", "--target", "a.json", "--fixture-behavior", "attention-success"]),
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
        "attention-success",
      ]),
    /not valid/u,
  );
  assert.throws(
    () => parseCliArgs(["inspect", "--target", "a.json", "--fixture-pack", "packs"]),
    /unknown or misplaced/u,
  );
  assert.throws(
    () => parseCliArgs(["report", "--run", "run-1", "--fixture"]),
    /not valid/u,
  );
  assert.throws(
    () => parseCliArgs(["report", "--run", "run-1", "--max-bytes", "0"]),
    /positive integer/u,
  );
  assert.throws(
    () => parseCliArgs([
      "run",
      "--target",
      "fixture.json",
      "--fixture",
      "--fixture-behavior",
      "attention-success",
      "--max-cases",
      "1",
    ]),
    /only available for a real run/u,
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
