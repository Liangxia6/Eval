/** 测试职责：验证 MVP Case Bundle 按 Agent/Run/Case 输出少量聚合文件并保持不可覆盖。 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { exportCaseBundle } from "../../src/platform/case-bundle.js";

test("Case Bundle 汇总静态观测、Trace、Observer、评分和报告", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-case-bundle-"));
  const runId = "run.bundle-1";
  const caseId = "case.bundle-1";
  try {
    const recordRoot = path.join(root, "records", runId, "records");
    const artifactPartition = path.join(root, "artifacts", runId);
    const artifactRoot = path.join(artifactPartition, "objects");
    const reportRoot = path.join(root, "reports", runId);
    await Promise.all([
      mkdir(path.join(recordRoot, "process-snapshot"), { recursive: true }),
      mkdir(path.join(recordRoot, "process-diff"), { recursive: true }),
      mkdir(artifactRoot, { recursive: true }),
      mkdir(reportRoot, { recursive: true }),
    ]);
    await Promise.all([
      writeFile(path.join(recordRoot, "process-snapshot", "after.json"), "{}"),
      writeFile(path.join(recordRoot, "process-diff", "diff.json"), "{}"),
      writeFile(path.join(artifactRoot, "raw-probe"), "{\"event\":1}\n"),
      writeFile(path.join(artifactRoot, "stdout"), "ok\n"),
      writeFile(path.join(artifactPartition, "index.jsonl"), [
        JSON.stringify({ artifactId: "raw-probe", artifactType: "DSH_PROBE_JSONL", logicalName: "probe.jsonl", portablePath: "objects/raw-probe", sensitivity: "RESTRICTED" }),
        JSON.stringify({ artifactId: "stdout", artifactType: "TARGET_OUTPUT", logicalName: "stdout.txt", portablePath: "objects/stdout", sensitivity: "EXPORTABLE" }),
      ].join("\n") + "\n"),
      writeFile(path.join(reportRoot, "report.json"), JSON.stringify({ view: {
        targetSummary: "FULL_AGENT / test",
        runState: "FINISHED",
        gate: "PASS",
        operationalHealth: "HEALTHY",
        execution: { task: "do work", exitCode: 0 },
        trace: { eventCount: 1 },
        rawObservations: [{ observationId: "raw-1" }],
        sources: [{ sourceType: "DSH_PROBE" }, { sourceType: "FILESYSTEM" }],
        fileSnapshots: [],
        fileDiffs: [],
        planSummary: { datasetIds: ["dataset.test/v1"] },
        labelEvaluations: [{ labelId: "label.tool-code/v1", checkId: "check.code", metricId: "metric.code/v1", judgeId: "judge.code/v1", requiredEvidenceTypes: ["AGENT_TRACE"] }],
        checks: [{ checkId: "check.code", evidenceIds: ["evidence.trace"], outcome: "PASS" }],
        decisionEvidence: [{ evidenceId: "evidence.trace", factValue: { eventCount: 1 } }],
      } })),
      writeFile(path.join(reportRoot, "report.html"), "<html></html>"),
    ]);

    const bundle = await exportCaseBundle({
      resultRoot: path.join(root, "evaluation-results"),
      runRoot: path.join(root, "records"),
      artifactRoot: path.join(root, "artifacts"),
      reportRoot: path.join(root, "reports"),
      agentId: "agent.bundle",
      runId,
      caseId,
      maxFileBytes: 1024,
    });

    assert.equal(
      bundle.directory,
      path.join(await realpath(root), "evaluation-results", "agents", "agent.bundle", "runs", runId, "cases", caseId),
    );
    const manifest = JSON.parse(await readFile(bundle.manifestPath, "utf8")) as {
      files: Array<{ path: string }>;
    };
    const files = manifest.files.map((entry) => entry.path);
    assert.ok(files.includes("task.json"));
    assert.ok(files.includes("plan.json"));
    assert.ok(files.includes("execution.json"));
    assert.ok(files.includes("trace/raw.jsonl.gz"));
    assert.ok(files.includes("trace/index.json"));
    assert.ok(files.includes("observers/filesystem.json"));
    assert.ok(files.includes("observers/process.json"));
    assert.ok(files.includes("evidence/tool-code.json"));
    assert.ok(files.includes("judge/tool-code.json"));
    assert.ok(files.includes("artifacts/stdout.txt"));
    assert.ok(files.includes("report.json"));
    await assert.rejects(exportCaseBundle({
      resultRoot: path.join(root, "evaluation-results"),
      runRoot: path.join(root, "records"),
      artifactRoot: path.join(root, "artifacts"),
      reportRoot: path.join(root, "reports"),
      agentId: "agent.bundle",
      runId,
      caseId,
      maxFileBytes: 1024,
    }), /immutable/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
