/**
 * 测试功能：验证标签池、Agent Trace/Environment 配置边界、兼容 Pack 校验和规划入口。
 * 旧 Pack 仅作为执行内核兼容 Fixture，不再是生产配置入口。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateStableId,
  validateVersionedAssetId,
  type EvaluationRequest,
} from "../../src/core/models.js";
import { loadEvaluationPack } from "../../src/evaluation/evaluation-asset.js";

const PACK_PATH = path.resolve("tests/fixtures/packs/attention-pytorch-v1.json");

test("标签目录包含 14 个外部配置且不再包含 instruction-following", async () => {
  const files = (await readdir(path.resolve("labels"))).filter((file) => file.endsWith(".json"));
  assert.equal(files.length, 14);
  const assets = await Promise.all(files.map(async (file) =>
    JSON.parse(await readFile(path.resolve("labels", file), "utf8")) as { labelId: string; metricId: string },
  ));
  assert.equal(new Set(assets.map((asset) => asset.labelId)).size, 14);
  assert.equal(new Set(assets.map((asset) => asset.metricId)).size, 14);
  assert.equal(assets.some((asset) => asset.labelId === "label.instruction-following/v1"), false);
});

test("Runtime Probe 只属于 Agent Trace，不进入 Environment Observer 配置", async () => {
  const trace = JSON.parse(await readFile(path.resolve("trace/dsh-runtime.json"), "utf8")) as {
    schema: string;
    sourceRequirement: { sourceType: string };
  };
  const environment = JSON.parse(await readFile(path.resolve("environments/macos.json"), "utf8")) as {
    schema: string;
    components: Record<string, unknown>;
  };
  assert.equal(trace.schema, "dsheval.agent-trace-source/v1");
  assert.equal(trace.sourceRequirement.sourceType, "DSH_PROBE");
  assert.equal(environment.schema, "dsheval.environment/v1");
  assert.equal(Object.hasOwn(environment.components, "runtime"), false);
  assert.equal(JSON.stringify(environment).includes("DSH_PROBE"), false);
});

test("Attention Dataset Pack 自包含 Case、环境、观测与两项评测", async () => {
  const pack = await loadEvaluationPack(PACK_PATH);
  assert.equal(pack.packId, "pack.attention-pytorch.v1");
  assert.equal(pack.resolution.units.length, 1);
  assert.deepEqual(
    pack.resolution.selectedLabelIds,
    [
      "label.artifact-delivery/v1",
      "label.tool-code/v1",
    ],
  );
  assert.deepEqual(
    pack.checks.map((check) => check.checkId).sort(),
    ["artifact.attention-code", "tool.pytorch-execution"],
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
