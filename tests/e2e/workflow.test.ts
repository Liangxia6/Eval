/**
 * 测试功能：用 Attention + PyTorch Fixture 跑通唯一纵向链路。
 * 覆盖正常通过、产物不合格、Probe 证据不足，以及 Reset 故障不篡改 Agent 判定。
 * 调用入口：app/workflow.ts 的 runEvaluationWorkflow。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runEvaluationWorkflow, type FixtureHooks } from "../../src/app/workflow.js";
import {
  digestValue,
  validateStableId,
  withContentDigest,
  type TargetDescriptor,
} from "../../src/core/models.js";
import { cleanupRuntimeDshHome } from "../../src/runtime/environment.js";

const REPOSITORY_ROOT = path.resolve(process.cwd());
const TARGET_ROOT = path.join(REPOSITORY_ROOT, "tests", "fixtures", "agents", "fake-dsh");
const PACK_PATH = path.join(REPOSITORY_ROOT, "packs", "attention-pytorch-v1.json");

interface FixtureRun {
  readonly root: string;
  readonly reportRoot: string;
  readonly summary: Awaited<ReturnType<typeof runEvaluationWorkflow>>;
}

function fixtureDescriptor(): TargetDescriptor {
  return withContentDigest({
    schema: "dsheval.mvp.target-descriptor/v1" as const,
    targetId: validateStableId<"TargetId">("fixture-agent"),
    targetType: "FULL_AGENT" as const,
    sourceRoot: TARGET_ROOT,
    dshExecutable: "fake-dsh.mjs",
    dshHome: ".dsh",
    profile: "fixture-attention",
    targetIdentity: "dshagent",
  });
}

async function runFixture(
  runId: string,
  behavior: string,
  hooks: Omit<FixtureHooks, "behavior"> = {},
): Promise<FixtureRun> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-attention-"));
  const reportRoot = path.join(root, "reports");
  try {
    const summary = await runEvaluationWorkflow({
      cwd: REPOSITORY_ROOT,
      runId,
      descriptor: fixtureDescriptor(),
      packRoot: PACK_PATH,
      fixtureMode: true,
      fixtureHooks: { behavior, ...hooks },
      configOverrides: {
        runRoot: path.join(root, "records"),
        artifactRoot: path.join(root, "artifacts"),
        reportRoot,
        workspaceRoot: path.join(root, "workspaces"),
        runtimeDshHomeRoot: path.join(root, "runtime-homes"),
        runDeadlineMs: 60_000,
        caseDeadlineMs: 30_000,
      },
    });
    return { root, reportRoot, summary };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function report(run: FixtureRun): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(run.reportRoot, run.summary.runId, "report.json"), "utf8"),
  ) as Record<string, unknown>;
}

async function removeFixture(run: FixtureRun): Promise<void> {
  const runtimeRoot = path.join(run.root, "runtime-homes");
  const canonicalRoot = await realpath(runtimeRoot);
  await cleanupRuntimeDshHome({
    runtimeDshHomeRoot: runtimeRoot,
    runtimeDshHomePath: path.join(
      canonicalRoot,
      run.summary.runId,
      `${run.summary.runId}.case`,
      `${run.summary.runId}.attempt`,
    ),
    runId: run.summary.runId,
    caseId: `${run.summary.runId}.case`,
    attemptId: `${run.summary.runId}.attempt`,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rm(run.root, { recursive: true, force: true });
}

test("Attention Fixture: Planner 到 HTML 报告的完整链路 PASS", { timeout: 20_000 }, async () => {
  const run = await runFixture("attention-pass", "attention-success");
  try {
    assert.equal(run.summary.status, "COMPLETED");
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FINISHED");
    assert.equal(run.summary.securityIsolation, "PROCESS_FIXTURE");
    const document = await report(run);
    assert.deepEqual(document.contentDigest, digestValue(document, ["contentDigest"]));
    const view = document.view as {
      checks: Array<{ checkId: string; outcome: string }>;
      reset: { result: string; environmentState: string };
    };
    assert.deepEqual(
      view.checks.map((check) => [check.checkId, check.outcome]).sort(),
      [
        ["artifact.attention-code", "PASS"],
        ["response.attention-explanation", "PASS"],
        ["tool.pytorch-execution", "PASS"],
      ],
    );
    assert.equal(view.reset.result, "MATCH");
    assert.equal(view.reset.environmentState, "CLEANED");
    assert.match(
      await readFile(run.summary.reportHtml!, "utf8"),
      /scenario\.attention\.pytorch\/v1/,
    );
  } finally {
    await removeFixture(run);
  }
});

test("Attention Fixture: 缺少代码产物只让对应硬检查 FAIL", { timeout: 20_000 }, async () => {
  const run = await runFixture("attention-missing-artifact", "missing-artifact");
  try {
    assert.equal(run.summary.gate, "FAIL");
    const view = (await report(run)).view as {
      checks: Array<{ checkId: string; outcome: string }>;
    };
    assert.equal(
      view.checks.find((check) => check.checkId === "artifact.attention-code")?.outcome,
      "FAIL",
    );
    assert.equal(
      view.checks.find((check) => check.checkId === "tool.pytorch-execution")?.outcome,
      "PASS",
    );
  } finally {
    await removeFixture(run);
  }
});

test("Attention Fixture: Probe 缺结束边界时证据不足而不是 PASS", { timeout: 20_000 }, async () => {
  const run = await runFixture("attention-incomplete-probe", "missing-probe-stop");
  try {
    assert.equal(run.summary.gate, "UNEVALUABLE");
    assert.ok(run.summary.reasonCodes.includes("PROBE_STOP_MISSING"));
  } finally {
    await removeFixture(run);
  }
});

test("Attention Fixture: Reset 验证失败不改变已形成的 PASS Gate", { timeout: 20_000 }, async () => {
  const run = await runFixture("attention-reset-failure", "attention-success", {
    afterReset: async (workspacePath) => {
      await writeFile(path.join(workspacePath, "residue.txt"), "reset residue", "utf8");
    },
  });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.notEqual(run.summary.operationalHealth, "HEALTHY");
  } finally {
    await removeFixture(run);
  }
});
