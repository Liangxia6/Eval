import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve("datasets");
const families: Readonly<Record<string, { catalogId: string; commit: string }>> = {
  "agentbench-os": { catalogId: "dataset.agentbench-os/v1", commit: "ed013ff9887b0c3d7864c56ae54d41eba54a99d8" },
  "tau-bench": { catalogId: "dataset.taubench/v1", commit: "59a200c6d575d595120f1cb70fea53cef0632f6b" },
  "tau2-bench": { catalogId: "dataset.tau2-bench/v1", commit: "672227c6b6676edc20d57ea53b7000262aae77b9" },
  appworld: { catalogId: "dataset.appworld/v1", commit: "42b5bcf3cd334fee33f0c37c02070a9f5807add5" },
  "bfcl-multiturn": { catalogId: "dataset.bfcl-multiturn/v1", commit: "6ea57973c7a6097fd7c5915698c54c17c5b1b6c8" },
  webarena: { catalogId: "dataset.webarena/v1", commit: "dce04686a56253aefba7b18a4fa0937cf1dc987b" },
  visualwebarena: { catalogId: "dataset.visualwebarena/v1", commit: "89f5af29305c3d1e9f97ce4421462060a70c9a03" },
  osworld: { catalogId: "dataset.osworld/v1", commit: "fc31a9049664292fcb35d6e501ee1dc839f2cf6d" },
  workarena: { catalogId: "dataset.workarena/v1", commit: "a772230a94cf1caf4166b8ead3983f3b3786455b" },
};
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");

async function bundles(family: string) {
  const directory = path.join(root, family);
  return (await readdir(directory, { withFileTypes: true })).filter((item) => item.isDirectory())
    .map((item) => path.join(directory, item.name)).sort();
}

test("前十项新增 9×5 题，沿用最小题包及 Catalog 既有字段和分节格式", async () => {
  const text = await readFile(path.join(root, "catalog.md"), "utf8");
  const catalog = JSON.parse(text.match(/```json dsheval-dataset-catalog\s*\n([\s\S]*?)\n```/u)![1]!);
  // Catalog 不再保留历史 GAIA 占位条目；后续批次还会追加新条目，因此这里只要求
  // 九个家庭的条目存在（逐家庭 find 断言），不再要求它们位于 catalog 末尾。
  const targetIds = Object.values(families).map((item) => item.catalogId);
  for (const targetId of targetIds) assert.ok(catalog.datasets.some((item: { datasetId: string }) => item.datasetId === targetId), targetId);
  assert.equal(text.split(/\n```/u).at(-1)!.trim(), "", "Catalog must not append an import report after its JSON block");
  assert.doesNotMatch(text, /前十项导入与待授权项/u);
  const labels = new Set<string>();
  for (const file of await readdir(path.resolve("labels"))) {
    if (file.endsWith(".json")) labels.add((await json(path.resolve("labels", file))).labelId);
  }
  const ids = new Set();
  for (const [family, expected] of Object.entries(families)) {
    const directories = await bundles(family);
    assert.equal(directories.length, 5, family);
    const entry = catalog.datasets.find((item: { datasetId: string }) => item.datasetId === expected.catalogId);
    assert.ok(entry, family);
    assert.deepEqual(Object.keys(entry), ["datasetId", "name", "description", "labelIds", "availableCaseCount"]);
    assert.equal(entry.availableCaseCount, directories.length);
    assert.ok(!/[()（）]/u.test(entry.name));
    assert.doesNotMatch(entry.description, /kind=llm|本地仅完成题包导入和静态完整性核验/u);
    const [overview, ...sections] = entry.description.split("\n\n") as string[];
    assert.deepEqual(overview!.split("\n").map((line) => line.split(": ")[0]), [
      "数据集", "最突出的测试对象", "当前输入形态", "输出与评分", "最适合的 Agent", "数据可用状态",
    ]);
    assert.ok(overview!.startsWith(`数据集: ${entry.name}\n`));
    assert.match(overview!, /本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge/u);
    assert.deepEqual(sections.map((section) => section.split("\n")[0]), [
      "1. 基本定位", "2. 评测层级设计", "3. 输入和环境", "4. 输出与评分",
      "5. 适配能力", "6. 不适配情况", "7. 匹配关键词", "8. 当前局限",
    ]);
    assert.ok(sections.every((section) => section.split("\n")[1]!.trim().length > 0));
    const union = new Set<string>();
    for (const directory of directories) {
      const q = await json(path.join(directory, "question.json"));
      const final = await json(path.join(directory, "private/final.json"));
      assert.deepEqual(Object.keys(q).sort(), ["schema", "id", "version", "title", "matching", "source", "capabilityLabels", "task", "environment", "evidence"].sort());
      assert.ok((await readFile(path.join(directory, "prompt.md"), "utf8")).length > 0);
      assert.deepEqual(Object.keys(final).sort(), ["answer", "rubric"]);
      assert.ok(final.answer && typeof final.answer === "object");
      assert.equal(q.schema, "dsheval.question/v1");
      assert.equal(q.title, path.basename(directory));
      assert.equal(q.matching.datasetId, `dataset.${q.id}/v1`);
      assert.ok(!ids.has(q.id));
      ids.add(q.id);
      assert.equal(q.source.commit, expected.commit);
      assert.ok(q.source.files.length >= 2);
      for (const file of q.source.files) assert.match(file.sha256, /^[0-9a-f]{64}$/u);
      assert.equal(q.environment.upstreamConstraints.missingPrerequisiteResult, "UNEVALUABLE");
      if (family === "agentbench-os") {
        assert.equal(q.environment.upstreamConstraints.guestOS, "Linux");
        assert.equal(q.environment.upstreamConstraints.executionScope, "local-linux-vm");
        assert.equal(q.environment.upstreamConstraints.workspace, "VM-provisioned isolated workspace");
        assert.doesNotMatch(JSON.stringify(q), /dockerfile|dockerImage|imageDigest/i);
      }
      assert.match(q.task.instructions, /output\/response\.txt/u);
      // instructions 不再教 Agent 写判分词汇 UNEVALUABLE；缺环境时要求如实说明缺失前提。
      assert.match(q.task.instructions, /missing prerequisite/u);
      // rubric 已全部迁移到 LLM Judge 判分链路：题目相关成功标准，不含旧样板冲突句。
      assert.match(final.rubric, /成功标准/u);
      assert.doesNotMatch(final.rubric, /UNEVALUABLE|上游判分器|不代替|kind=llm|原生评分器/u);
      assert.ok(q.capabilityLabels.length > 0);
      for (const label of q.capabilityLabels) {
        const id = `label.${label}/v1`;
        assert.ok(labels.has(id), id);
        union.add(id);
      }
      for (const input of q.inputs) {
        assert.ok(input.source.startsWith("input/"));
        assert.ok(input.destination.startsWith("input/"));
        assert.equal(hash(await readFile(path.join(directory, input.source))), input.sha256);
      }
      assert.deepEqual((await readdir(directory)).sort(), ["private", "prompt.md", "question.json", ...(q.inputs.length ? ["input"] : [])].sort());
    }
    assert.deepEqual([...union].sort(), [...entry.labelIds].sort(), family);
  }
  assert.equal(ids.size, 45);
});

test("τ 的用户背景及 BFCL 后续轮次保留私有，不能扁平化为单轮问答", async () => {
  for (const family of ["tau-bench", "tau2-bench"]) {
    for (const directory of await bundles(family)) {
      const q = await json(path.join(directory, "question.json"));
      const scenario = await json(path.join(directory, "private/scenario.json"));
      const final = await json(path.join(directory, "private/final.json"));
      const userInstruction = family === "tau-bench" ? scenario.instruction : scenario.user_scenario.instructions.reason_for_call;
      assert.ok(userInstruction.length > 20);
      assert.ok(!q.task.instructions.includes(userInstruction));
      assert.ok(final.answer.actions.length > 0);
      assert.ok(q.environment.upstreamConstraints.databaseSeed.length > 0);
      assert.ok(!q.inputs.some((item: { source: string }) => /scenario|db\.json|user_db/u.test(item.source)));
    }
  }
  const categories = new Set();
  for (const directory of await bundles("bfcl-multiturn")) {
    const q = await json(path.join(directory, "question.json"));
    const scenario = await json(path.join(directory, "private/scenario.json"));
    const final = await json(path.join(directory, "private/final.json"));
    // split 信息取自 bundle 目录名（bfcl-multi-turn-<split>-<n>），不再依赖 source.upstreamMetadata。
    const split = path.basename(directory).replace(/^bfcl-multi-turn-/u, "").replace(/-[0-9]+$/u, "").replace(/-/gu, "_");
    categories.add(split);
    assert.ok(scenario.question.length >= 2);
    assert.equal(scenario.question.length, final.answer.groundTruth.length);
    assert.equal(scenario.question.length, q.environment.upstreamConstraints.turnCount);
    assert.ok(scenario.initial_config);
    assert.ok(scenario.involved_classes.length > 0);
    for (const messages of scenario.question.slice(1)) {
      for (const message of messages) assert.ok(!q.task.instructions.includes(message.content));
    }
    if (split === "miss_func") assert.ok(scenario.missed_function);
  }
  assert.deepEqual([...categories].sort(), ["base", "long_context", "miss_func", "miss_param"]);
});

test("应用/网页任务保留原生状态评分，AppWorld 保留空数据库差异与副作用约束", async () => {
  for (const directory of await bundles("appworld")) {
    const q = await json(path.join(directory, "question.json"));
    const final = await json(path.join(directory, "private/final.json"));
    const diffs = await json(path.join(directory, "private/database-diffs.json"));
    assert.equal(Object.keys(diffs).length, 12);
    assert.ok(Object.values(diffs).some((value) => value === ""));
    for (const [file, value] of Object.entries(diffs)) {
      assert.equal(typeof value, "string");
      const source = q.source.files.find((item: { path: string }) => item.path.endsWith(`/dbs/${file}`));
      assert.ok(source);
      assert.equal(hash(Buffer.from(value as string)), source.sha256);
    }
    assert.ok(final.answer.testRequirements.length > 1);
    const evaluation = await readFile(path.join(directory, "private/evaluation.py"), "utf8");
    assert.match(evaluation, /models\.changed_model_names/u);
    const source = q.source.files.find((item: { path: string }) => item.path.endsWith("/ground_truth/evaluation.py"));
    assert.equal(hash(Buffer.from(evaluation)), source.sha256);
    assert.match(q.task.instructions, /appworld:d17ac3f/u);
  }
  for (const family of ["webarena", "visualwebarena"]) {
    for (const directory of await bundles(family)) {
      const q = await json(path.join(directory, "question.json"));
      const final = await json(path.join(directory, "private/final.json"));
      const browser = await json(path.join(directory, "input/browser.json"));
      assert.ok(final.answer.eval_types.includes("program_html"));
      assert.ok(final.answer.program_html.length > 0);
      assert.equal(browser.require_reset, true);
      assert.ok(!Object.hasOwn(browser, "eval") && !Object.hasOwn(browser, "comments"));
      if (family === "visualwebarena") assert.ok(q.capabilityLabels.includes("multimodal"));
    }
  }
  for (const directory of await bundles("osworld")) {
    const init = await json(path.join(directory, "private/environment.json"));
    const final = await json(path.join(directory, "private/final.json"));
    assert.ok(init.snapshot);
    assert.ok(!init.config.some((item: { type: string }) => ["download", "googledrive"].includes(item.type)));
    assert.ok(final.answer.func && final.answer.result && final.answer.expected);
  }
  for (const directory of await bundles("workarena")) {
    const q = await json(path.join(directory, "question.json"));
    const final = await json(path.join(directory, "private/final.json"));
    assert.equal(q.environment.upstreamConstraints.level, "L1");
    assert.equal(final.answer.seed, 42);
    assert.equal(final.answer.requiredReward, 1);
    assert.match(final.answer.validator, /\.validate$/u);
    if (final.answer.fixedConfig.sort_fields) assert.ok(final.answer.fixedConfig.sort_fields.length >= 2);
  }
});
