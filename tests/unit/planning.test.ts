/**
 * 测试功能：验证标签池、Dataset Pack 校验和“标签选择评测指标”的最小规划入口。
 * Catalog 只处理通用引用；具体 Attention 题目完全来自 packs/attention-pytorch-v1.json。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateStableId,
  validateVersionedAssetId,
  type EvaluationRequest,
} from "../../src/core/models.js";
import { LABEL_REGISTRY, loadEvaluationPack } from "../../src/planning/catalog.js";

const PACK_PATH = path.resolve("packs/attention-pytorch-v1.json");

test("标签池固定为 15 个可复用的一对一 Label/Metric", () => {
  assert.equal(LABEL_REGISTRY.length, 15);
  assert.equal(new Set(LABEL_REGISTRY.map((item) => item.labelId)).size, 15);
  assert.equal(new Set(LABEL_REGISTRY.map((item) => item.metricId)).size, 15);
});

test("Attention Dataset Pack 自包含 Case、环境、观测与三项评测", async () => {
  const pack = await loadEvaluationPack(PACK_PATH);
  assert.equal(pack.packId, "pack.attention-pytorch.v1");
  assert.equal(pack.resolution.units.length, 1);
  assert.deepEqual(
    pack.resolution.selectedLabelIds,
    [
      "label.artifact-delivery/v1",
      "label.instruction-following/v1",
      "label.tool-code/v1",
    ],
  );
  assert.deepEqual(
    pack.checks.map((check) => check.checkId).sort(),
    ["artifact.attention-code", "response.attention-explanation", "tool.pytorch-execution"],
  );
  assert.deepEqual(
    pack.sourceRequirements.map((source) => source.sourceType).sort(),
    ["DSH_PROBE", "FILESYSTEM"],
  );
});

test("Planner 选择的标签同时选择对应 Check 和 Judge", async () => {
  const request: EvaluationRequest = Object.freeze({
    schema: "dsheval.mvp.evaluation-request/v1",
    requestId: validateStableId<"EvaluationRequestId">("request.tool-code-only"),
    requestedLabelIds: Object.freeze([
      validateVersionedAssetId<"LabelId">("label.tool-code/v1"),
    ]),
    preferredDatasetIds: Object.freeze([
      validateVersionedAssetId<"DatasetId">("dataset.attention-pytorch/v1"),
    ]),
    excludeCaseIds: Object.freeze([]),
  });
  const pack = await loadEvaluationPack(PACK_PATH, request);
  assert.deepEqual(pack.resolution.units[0]?.checkIds, ["tool.pytorch-execution"]);
  assert.deepEqual(pack.checks.map((check) => check.checkId), ["tool.pytorch-execution"]);
  assert.deepEqual(pack.judges.map((judge) => judge.judgeId), ["judge.tool.completed/v1"]);
});

test("Dataset Pack 被改写但未更新摘要时拒绝加载", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-pack-"));
  try {
    const target = path.join(root, "tampered.json");
    const asset = JSON.parse(await readFile(PACK_PATH, "utf8")) as {
      scenario: { agentTask: string };
    };
    asset.scenario.agentTask = "tampered task";
    await writeFile(target, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
    await assert.rejects(loadEvaluationPack(target), /digest/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
