/** 测试职责：验证统一 Planner 只运行一次，随后不重复地执行多个 Case。 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runEvaluationBatch } from "../../src/app/batch.js";
import type { RunWorkflowInput, WorkflowSummary } from "../../src/app/workflow.js";
import { digestValue, type TargetDescriptor } from "../../src/core/models.js";

const descriptor = {
  schema: "dsheval.mvp.target-descriptor/v1",
  targetId: "agent.batch-test",
  targetType: "FULL_AGENT",
  sourceRoot: "/tmp/target",
  dshExecutable: "dsh",
  dshHome: "dsh-home",
  profile: "headless",
  targetIdentity: "dsheval",
  contentDigest: digestValue({ targetId: "agent.batch-test" }),
} as unknown as TargetDescriptor;

function baseSummary(runId: string): WorkflowSummary {
  return {
    schema: "dsheval.mvp.cli-summary/v1",
    command: "plan",
    status: "COMPLETED",
    runId,
    fixture: false,
    failureGroups: [],
    reasonCodes: [],
    selectedLabelIds: ["label.tool-code/v1"],
    datasetTestProfile: "STANDARD",
    selectedDatasets: [{
      datasetId: "dataset.attention-pytorch/v1",
      evaluationLabelIds: ["label.tool-code/v1"],
      caseCount: 4,
      reason: "matches code tools",
    }],
    totalCaseCount: 4,
    datasetMatchModel: "planner-test",
    datasetMatchDurationMs: 1,
    recordsPath: `/tmp/records/${runId}`,
    exitCode: 0,
  };
}

test("Batch 只规划一次，并为每个 Case 复用冻结选择", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-batch-"));
  const calls: RunWorkflowInput[] = [];
  try {
    const summary = await runEvaluationBatch({
      cwd: root,
      runId: "batch-run",
      descriptor,
      workflowRunner: async (input) => {
        calls.push(input);
        if (input.stopAfter === "PLAN") return baseSummary("batch-run");
        const current = input.executionCase!;
        const bundle = path.join(root, "agents", "agent.batch-test", "runs", current.resultRunId, "cases", current.resultCaseId);
        await mkdir(bundle, { recursive: true });
        const result: WorkflowSummary = {
          ...baseSummary(input.runId!),
          command: "run",
          status: "COMPLETED",
          runId: input.runId!,
          scores: [],dimensions: [],
          operationalHealth: "HEALTHY",
          securityIsolation: "SESSION_SEPARATED",
          caseBundlePath: bundle,
          dshSessionIds: [`session-${current.caseIndex + 1}`],
          exitCode: 0,
        };
        return result;
      },
    });
    assert.equal(calls.length, 5);
    assert.equal(calls.filter((call) => call.stopAfter === "PLAN").length, 1);
    assert.deepEqual(calls.slice(1).map((call) => call.executionCase?.caseIndex), [0, 1, 2, 3]);
    assert.ok(calls.slice(1).every((call) => call.precomputedDatasetSelection?.model === "planner-test"));
    assert.deepEqual(summary.caseResults.map((item) => item.dshSessionIds), [["session-1"], ["session-2"], ["session-3"], ["session-4"]]);
    assert.deepEqual(summary.dimensions, []);
    assert.equal(summary.runSummaryPath, path.join(root, "agents", "agent.batch-test", "runs", "batch-run", "run.json"));
    assert.equal(summary.reportHtml, path.join(root, "agents", "agent.batch-test", "runs", "batch-run", "report.html"));
    const persisted = JSON.parse(await readFile(summary.runSummaryPath!, "utf8")) as { runId: string; caseResults: unknown[] };
    assert.equal(persisted.runId, "batch-run");
    assert.equal(persisted.caseResults.length, 4);
    const report = await readFile(summary.reportHtml!, "utf8");
    assert.match(report, /DSHEval 完整 Run 报告/u);
    assert.match(report, /attention-pytorch\.case-1/u);
    assert.match(report, /attention-pytorch\.case-4/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
