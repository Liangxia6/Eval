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
  validateVersionedAssetId,
  withContentDigest,
  type TargetDescriptor,
} from "../../src/core/models.js";
import { cleanupRuntimeDshHome } from "../../src/runtime/environment.js";

const REPOSITORY_ROOT = path.resolve(process.cwd());
const TARGET_ROOT = path.join(REPOSITORY_ROOT, "tests", "fixtures", "agents", "fake-dsh");
const PACK_PATH = path.join(REPOSITORY_ROOT, "tests", "fixtures", "packs", "attention-pytorch-v1.json");

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
        resultRoot: path.join(root, "evaluation-results"),
        workspaceRoot: path.join(root, "workspaces"),
        runtimeDshHomeRoot: path.join(root, "runtime-homes"),
        runDeadlineMs: 300_000,
        caseDeadlineMs: 240_000,
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

test("inspect 只做静态观测，不调用 LLM Planner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-label-inspect-"));
  try {
    const summary = await runEvaluationWorkflow({
      cwd: REPOSITORY_ROOT,
      runId: "inspect-label-selection",
      descriptor: fixtureDescriptor(),
      fixtureMode: true,
      stopAfter: "INSPECT",
      configOverrides: {
        runRoot: path.join(root, "records"),
        artifactRoot: path.join(root, "artifacts"),
        reportRoot: path.join(root, "reports"),
        resultRoot: path.join(root, "evaluation-results"),
        workspaceRoot: path.join(root, "workspaces"),
        runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      },
    });
    assert.equal(summary.status, "COMPLETED");
    assert.equal(summary.command, "inspect");
    assert.equal(summary.evaluationPlanId, undefined);
    assert.equal(summary.selectedLabelIds, undefined);
    assert.equal(summary.datasetMatchModel, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan 把静态观测和 Dataset 目录交给一次统一 Planner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-dataset-plan-"));
  const toolCode = validateVersionedAssetId<"LabelId">("label.tool-code/v1");
  const artifact = validateVersionedAssetId<"LabelId">("label.artifact-delivery/v1");
  const attentionDataset = validateVersionedAssetId<"DatasetId">("dataset.attention-pytorch/v1");
  let datasetCalls = 0;
  try {
    const summary = await runEvaluationWorkflow({
      cwd: REPOSITORY_ROOT,
      runId: "dataset-selection-plan",
      descriptor: fixtureDescriptor(),
      fixtureMode: true,
      stopAfter: "PLAN",
      packRoot: PACK_PATH,
      datasetMatcher: {
        select: async (input) => {
          datasetCalls += 1;
          assert.equal(input.agentStaticInfo.target_type, "FULL_AGENT");
          assert.ok(input.agentStaticInfo.tools.length > 0);
          assert.equal(input.agentStaticInfo.plugins.length, 1);
          assert.match(JSON.stringify(input.agentStaticInfo.plugins), /deterministic Python fixture/u);
          assert.match(JSON.stringify(input.agentStaticInfo.tool_delta), /fixture\.python\/v1/u);
          assert.equal(input.profile, "STANDARD");
          assert.equal(input.availableDatasets.length, 1);
          assert.equal(input.availableDatasets[0]?.datasetId, attentionDataset);
          return {
            schema: "dsheval.mvp.unified-planner-result/v1",
            profile: "STANDARD",
            selectedDatasets: [{
              datasetId: attentionDataset,
              evaluationLabelIds: [toolCode, artifact],
              caseCount: 1,
              reason: "fixture compatible",
            }],
            evaluationLabelIds: [toolCode, artifact],
            totalCaseCount: 1,
            model: "fixture-dataset-model",
            durationMs: 6,
          };
        },
      },
      configOverrides: {
        runRoot: path.join(root, "records"),
        artifactRoot: path.join(root, "artifacts"),
        reportRoot: path.join(root, "reports"),
        resultRoot: path.join(root, "evaluation-results"),
        workspaceRoot: path.join(root, "workspaces"),
        runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      },
    });
    assert.equal(datasetCalls, 1);
    assert.equal(summary.command, "plan");
    assert.notEqual(summary.evaluationPlanId, undefined);
    assert.notEqual(summary.agentTracePlanId, undefined);
    assert.notEqual(summary.observationPlanId, undefined);
    const tracePlan = JSON.parse(await readFile(path.join(
      root,
      "records",
      summary.runId,
      "records",
      "agent-trace-plan",
      `${summary.agentTracePlanId}.json`,
    ), "utf8")) as { sourceRequirements: Array<{ sourceType: string }> };
    const observationPlan = JSON.parse(await readFile(path.join(
      root,
      "records",
      summary.runId,
      "records",
      "observation-plan",
      `${summary.observationPlanId}.json`,
    ), "utf8")) as { sourceRequirements: Array<{ sourceType: string }> };
    assert.deepEqual(tracePlan.sourceRequirements.map((item) => item.sourceType), ["DSH_PROBE"]);
    assert.deepEqual(observationPlan.sourceRequirements.map((item) => item.sourceType), ["FILESYSTEM"]);
    assert.equal(summary.datasetTestProfile, "STANDARD");
    assert.equal(summary.selectedDatasets?.length, 1);
    assert.equal(summary.totalCaseCount, 1);
    assert.equal(summary.datasetMatchModel, "fixture-dataset-model");
    assert.equal(summary.datasetMatchDurationMs, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Attention Fixture: Planner 到 HTML 报告的完整链路 PASS", { timeout: 20_000 }, async () => {
  const run = await runFixture("attention-pass", "attention-success");
  try {
    assert.equal(run.summary.status, "COMPLETED");
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FINISHED");
    assert.equal(run.summary.securityIsolation, "PROCESS_FIXTURE");
    assert.match(run.summary.caseBundlePath ?? "", /evaluation-results\/agents\/fixture-agent\/runs\/attention-pass\/cases\/attention-pass\.case$/u);
    const bundleManifest = JSON.parse(
      await readFile(path.join(run.summary.caseBundlePath!, "manifest.json"), "utf8"),
    ) as { files: Array<{ path: string }> };
    assert.ok(bundleManifest.files.some((entry) => entry.path === "trace/raw.jsonl.gz"));
    assert.ok(bundleManifest.files.some((entry) => entry.path === "observers/filesystem.json"));
    assert.ok(bundleManifest.files.some((entry) => entry.path === "judge/tool-code.json"));
    assert.ok(bundleManifest.files.some((entry) => entry.path === "artifacts/deliverables/output/attention.py"));
    assert.ok(bundleManifest.files.some((entry) => entry.path === "report.json"));
    const document = await report(run);
    assert.deepEqual(document.contentDigest, digestValue(document, ["contentDigest"]));
    const view = document.view as {
      checks: Array<{ checkId: string; outcome: string }>;
      reset: { result: string; environmentState: string };
      plannerMatch: { evaluationLabelIds: string[]; selectedDatasetIds: string[]; selectedLabelIds: string[] };
      labelEvaluations: Array<{ labelId: string; checkId: string; evaluationMode: string }>;
      execution: { task: string; terminationKind: string; exitCode: number };
      trace: { eventCount: number; toolCalls: Array<{ toolName: string; completed: boolean }> };
      decisionEvidence: Array<{ factType: string }>;
    };
    assert.deepEqual(
      view.checks.map((check) => [check.checkId, check.outcome]).sort(),
      [
        ["artifact.attention-code", "PASS"],
        ["tool.pytorch-execution", "PASS"],
      ],
    );
    assert.equal(view.reset.result, "MATCH");
    assert.equal(view.reset.environmentState, "CLEANED");
    assert.deepEqual(view.plannerMatch.selectedDatasetIds, ["dataset.attention-pytorch/v1"]);
    assert.deepEqual(view.plannerMatch.evaluationLabelIds, [
      "label.artifact-delivery/v1",
      "label.tool-code/v1",
    ]);
    assert.deepEqual(
      view.labelEvaluations.map((item) => [item.labelId, item.evaluationMode]),
      [
        ["label.artifact-delivery/v1", "OUTPUT_STATE"],
        ["label.tool-code/v1", "TRACE"],
      ],
    );
    assert.match(view.execution.task, /Attention Is All You Need/u);
    assert.equal(view.execution.terminationKind, "EXITED");
    assert.equal(view.execution.exitCode, 0);
    assert.ok(view.trace.eventCount > 0);
    assert.deepEqual(view.trace.toolCalls.map((item) => [item.toolName, item.completed]), [
      ["python", true],
    ]);
    assert.deepEqual(
      view.decisionEvidence.map((item) => item.factType).sort(),
      ["AGENT_TRACE", "FILE_AFTER", "FILE_DIFF", "PROTOCOL_LIFECYCLE"],
    );
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
