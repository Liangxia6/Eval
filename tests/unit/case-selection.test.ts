import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveExplicitCase } from "../../src/datasets/case-selection.js";
import { runEvaluationBatch } from "../../src/app/batch.js";
import type { RunWorkflowInput, WorkflowSummary } from "../../src/app/workflow.js";

async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "dsheval-case-selection-"));
  const datasets = ["harbor-hle", "agentbench-os"].map(slug => ({
    datasetId: `dataset.${slug}/v1`, name: slug, description: "test dataset",
    labelIds: ["label.reasoning-planning/v1"], availableCaseCount: 99,
  }));
  for (const group of ["hle", "agentbench-os"]) {
    // Reverse creation order must not change the loader's stable case numbering.
    for (const name of ["z-last", "shared", "a-first"]) {
      const directory = path.join(cwd, "datasets", group, name);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "question.json"), "{}");
    }
  }
  await writeFile(path.join(cwd, "datasets", "catalog.json"), JSON.stringify({
    schema: "dsheval.dataset-planner-catalog/v1", version: "1.0", datasets,
  }));
  return { cwd, datasetCatalogPath: "datasets/catalog.json" };
}

test("Explicit aliases resolve the same real question and allocate exactly one case", async () => {
  const input = await fixture();
  try {
    const question = path.join(input.cwd, "datasets", "agentbench-os", "shared", "question.json");
    for (const selector of ["agentbench-os.case-2", "agentbench-os/shared",
      "datasets/agentbench-os/shared/question.json", question, path.dirname(question)]) {
      const result = await resolveExplicitCase({ ...input, selector });
      assert.equal(result.item.caseIndex, 1);
      assert.equal(result.item.datasetId, "dataset.agentbench-os/v1");
      assert.equal(result.questionPath, question);
      assert.equal(result.selection.totalCaseCount, 1);
      assert.equal(result.selection.selectedDatasets[0]?.caseCount, 1);
      assert.equal(result.selection.model, "user-selected-case/v1");
      assert.deepEqual(result.selection.evaluationLabelIds, ["label.reasoning-planning/v1"]);
    }
    assert.equal((await resolveExplicitCase({ ...input, selector: "harbor-hle.case-1" })).item.caseIndex, 0);
  } finally { await rm(input.cwd, { recursive: true, force: true }); }
});

test("Explicit selection rejects missing, out-of-range and ambiguous cases", async () => {
  const input = await fixture();
  try {
    for (const selector of ["missing", "agentbench-os.case-0", "agentbench-os.case-4", "agentbench-os.case-99"]) {
      await assert.rejects(resolveExplicitCase({ ...input, selector }), /was not found/);
    }
    await assert.rejects(resolveExplicitCase({ ...input, selector: "shared" }), /ambiguous/);
  } finally { await rm(input.cwd, { recursive: true, force: true }); }
});

test("Batch freezes the explicit second case before planning and never substitutes the first case", async () => {
  const input = await fixture();
  const calls: RunWorkflowInput[] = [];
  try {
    const result = await runEvaluationBatch({
      ...input, runId: "explicit-run", selectedCaseId: "agentbench-os.case-2",
      descriptor: {} as RunWorkflowInput["descriptor"],
      workflowRunner: async call => {
        calls.push(call);
        assert.equal(call.precomputedDatasetSelection?.model, "user-selected-case/v1");
        assert.equal(call.executionCase?.caseIndex, 1);
        assert.equal(call.executionCase?.resultCaseId, "agentbench-os.case-2");
        const selection = call.precomputedDatasetSelection!;
        return {
          schema: "dsheval.mvp.cli-summary/v1", command: call.stopAfter === "PLAN" ? "plan" : "run",
          status: "COMPLETED", runId: call.runId!, fixture: false,
          failureGroups: [], reasonCodes: [], exitCode: 0, recordsPath: input.cwd,
          datasetTestProfile: selection.profile, selectedDatasets: selection.selectedDatasets,
          totalCaseCount: selection.totalCaseCount, datasetMatchModel: selection.model,
          datasetMatchDurationMs: selection.durationMs, scores: [],
        } as WorkflowSummary;
      },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.stopAfter, "PLAN");
    assert.equal(result.caseResults.length, 1);
    assert.equal(result.caseResults[0]?.caseIndex, 1);
    assert.equal(result.totalCaseCount, 1);
    assert.equal(result.datasetMatchModel, "user-selected-case/v1");
    await assert.rejects(runEvaluationBatch({
      ...input, selectedCaseId: "agentbench-os.case-99",
      descriptor: {} as RunWorkflowInput["descriptor"],
      workflowRunner: async () => { assert.fail("invalid selection must fail before planning"); },
    }), /was not found/);
  } finally { await rm(input.cwd, { recursive: true, force: true }); }
});
