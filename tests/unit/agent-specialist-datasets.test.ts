import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve("datasets");
const families: Readonly<Record<string, string>> = {
  "swe-bench-pro": "ca10a60a5fcae51e6948ffe1485d4153d421e6c5",
  dsbench: "ba786096137a5108af11c016ad3f09cdb97beefd",
  memoryarena: "6cd9de14b71915e39ac742a20dc33785e14b6aab",
  "deepresearch-bench-ii": "087c1b8d4a0ed46fd3dd8615a0b5e93ce3acf6f8",
};
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function bundles(family: string) {
  const dir = path.join(root, family);
  return (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory())
    .map((e) => path.join(dir, e.name)).sort();
}

// Preserve quoted commas, escaped quotes and embedded newlines in the NLP data.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      row.push(field); field = "";
    } else if (ch === "\n" && !quoted) {
      row.push(field.replace(/\r$/u, "")); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  assert.equal(quoted, false, "unterminated quoted CSV cell");
  if (field.length || row.length) { row.push(field); rows.push(row); }
  assert.ok(rows.length > 1);
  for (const item of rows) assert.equal(item.length, rows[0]!.length);
  return rows;
}

test("四组各 5 题，保持最小题包及五字段 Catalog，来源/输入/标签一致", async () => {
  const text = await readFile(path.join(root, "catalog.md"), "utf8");
  const catalog = JSON.parse(text.match(/```json dsheval-dataset-catalog\s*\n([\s\S]*?)\n```/u)![1]!);
  const labels = new Set<string>();
  for (const file of await readdir(path.resolve("labels"))) {
    if (file.endsWith(".json")) labels.add((await json(path.resolve("labels", file))).labelId);
  }
  const ids = new Set<string>();
  for (const [family, commit] of Object.entries(families)) {
    const dirs = await bundles(family);
    assert.equal(dirs.length, 5);
    const entries = catalog.datasets.filter((d: { datasetId: string }) => d.datasetId === `dataset.${family}/v1`);
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.equal(entry.availableCaseCount, dirs.length);
    assert.deepEqual(Object.keys(entry).sort(), ["datasetId", "name", "description", "labelIds", "availableCaseCount"].sort());
    assert.ok(!/[()（）]/u.test(entry.name));
    assert.match(entry.description, /UNEVALUABLE/u);
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
    for (const dir of dirs) {
      const q = await json(path.join(dir, "question.json"));
      const final = await json(path.join(dir, "private/final.json"));
      assert.deepEqual(Object.keys(q).sort(), ["schema", "id", "version", "title", "matching", "source", "capabilityLabels", "task", "environment", "evidence"].sort());
      assert.deepEqual(Object.keys(final).sort(), ["answer", "rubric"]);
      assert.ok(final.answer && typeof final.answer === "object");
      assert.equal(q.schema, "dsheval.question/v1");
      assert.equal(q.title, path.basename(dir));
      assert.equal(q.matching.datasetId, `dataset.${q.id}/v1`);
      assert.equal(q.source.commit, commit);
      assert.equal(q.environment.upstreamConstraints.missingPrerequisiteResult, "UNEVALUABLE");
      assert.ok(!ids.has(q.id)); ids.add(q.id);
      assert.ok(q.capabilityLabels.length > 0);
      for (const label of q.capabilityLabels) {
        const id = `label.${label}/v1`;
        assert.ok(labels.has(id), id); union.add(id);
      }
      for (const file of q.source.files) assert.match(file.sha256, /^[0-9a-f]{64}$/u);
      for (const input of q.inputs) {
        assert.ok(input.source.startsWith("input/"));
        assert.ok(input.destination.startsWith("input/"));
        assert.equal(hash(await readFile(path.join(dir, input.source))), input.sha256);
      }
      assert.ok((await readFile(path.join(dir, "prompt.md"), "utf8")).length > 0);
      // rubric 已全部迁移到 LLM Judge 判分链路：题目相关成功标准，不含旧样板冲突句。
      assert.match(final.rubric, /成功标准/u);
      assert.doesNotMatch(final.rubric, /UNEVALUABLE|上游判分器|不代替|kind=llm|原生评分器/u);
      assert.deepEqual((await readdir(dir)).sort(), ["private", "prompt.md", "question.json", ...(q.inputs.length ? ["input"] : [])].sort());
    }
    assert.deepEqual([...union].sort(), [...entry.labelIds].sort());
  }
  assert.equal(ids.size, 20);
});

test("SWE-bench Pro 保留真实补丁与 F2P/P2P，初始化和测试不泄露给 Agent", async () => {
  const repos = new Set<string>();
  for (const dir of await bundles("swe-bench-pro")) {
    const q = await json(path.join(dir, "question.json"));
    const final = await json(path.join(dir, "private/final.json"));
    const env = await json(path.join(dir, "private/environment.json"));
    repos.add(env.repository);
    assert.equal(env.instanceId, final.answer.instanceId);
    assert.equal(env.baseCommit, q.environment.upstreamConstraints.baseCommit);
    assert.ok(q.task.instructions.includes(env.baseCommit));
    assert.ok(!q.task.instructions.includes(env.beforeRepoSetCmd));
    assert.equal(q.inputs.length, 0);
    assert.equal(q.environment.upstreamConstraints.baseRepositoryBundled, false);
    assert.equal(q.environment.upstreamConstraints.executionScope, "local-linux-vm");
    assert.equal(q.environment.upstreamConstraints.workspace, "VM-provisioned repository checkout");
    assert.doesNotMatch(JSON.stringify(q.environment.upstreamConstraints), /docker|container|imageDigest/i);
    assert.ok(final.answer.failToPass.length > 0);
    assert.ok(Array.isArray(final.answer.passToPass));
    for (const field of ["goldPatch", "testPatch"]) {
      const patch = await readFile(path.join(dir, final.answer[field]), "utf8");
      assert.match(patch, /^diff --git /u);
      assert.ok(!q.task.instructions.includes(patch));
    }
    for (const file of ["run_script.sh", "parser.py"]) {
      assert.ok((await readFile(path.join(dir, "private", file))).length > 0);
    }
    assert.ok((await readFile(path.join(dir, "prompt.md"), "utf8")).includes("output/solution.patch"));
    assert.doesNotMatch(JSON.stringify(q.source.files), /dockerfile/i);
  }
  assert.equal(repos.size, 5);
});

test("DSBench 五套完整 resplit 与隐藏答案按 ID 对齐，旧示例提交不混入", async () => {
  const metrics = new Set<string>();
  for (const dir of await bundles("dsbench")) {
    const final = await json(path.join(dir, "private/final.json"));
    const train = parseCsv(await readFile(path.join(dir, "input/train.csv"), "utf8"));
    const input = parseCsv(await readFile(path.join(dir, "input/test.csv"), "utf8"));
    const answer = parseCsv(await readFile(path.join(dir, "private/test_answer.csv"), "utf8"));
    const { idColumn, targetColumn } = final.answer;
    const trainKey = train[0]!.indexOf(idColumn);
    const inputKey = input[0]!.indexOf(idColumn);
    assert.ok(trainKey >= 0 && inputKey >= 0);
    assert.ok(train[0]!.includes(targetColumn));
    assert.ok(!input[0]!.includes(targetColumn));
    assert.deepEqual(answer[0], [idColumn, targetColumn]);
    assert.equal(input.length - 1, final.answer.testRowCount);
    assert.equal(input.length, answer.length);
    const ids = input.slice(1).map((r) => r[inputKey]);
    assert.deepEqual(ids, answer.slice(1).map((r) => r[0]));
    assert.equal(new Set(ids).size, ids.length);
    const trainIds = new Set(train.slice(1).map((r) => r[trainKey]));
    assert.ok(ids.every((id) => !trainIds.has(id)));
    assert.deepEqual((await readdir(path.join(dir, "input"))).sort(), ["test.csv", "train.csv"]);
    assert.equal(final.answer.officialPassThreshold, null);
    assert.match(await readFile(path.join(dir, "private/evaluate.py"), "utf8"), /args\.answer_file/u);
    metrics.add(final.answer.metric);
  }
  assert.equal(metrics.size, 5);
});

test("MemoryArena 按五条完整六阶段链计数，不能提前暴露后续问题或私有商品", async () => {
  let stages = 0;
  for (const dir of await bundles("memoryarena")) {
    const q = await json(path.join(dir, "question.json"));
    const scenario = await json(path.join(dir, "private/scenario.json"));
    const final = await json(path.join(dir, "private/final.json"));
    assert.equal(scenario.questions.length, 6);
    assert.equal(final.answer.answers.length, 6);
    assert.equal(final.answer.taskId, scenario.taskId);
    assert.equal(q.environment.upstreamConstraints.stagesPerCase, 6);
    assert.equal(q.environment.upstreamConstraints.splitSteps, true);
    assert.ok(q.task.instructions.startsWith(scenario.questions[0]));
    for (const question of scenario.questions.slice(1)) assert.ok(!q.task.instructions.includes(question));
    for (const answer of final.answer.answers) {
      assert.match(answer.target_asin, /^[A-Z0-9]{10}$/u);
      assert.ok(answer.attributes.length > 0);
      assert.ok(!q.task.instructions.includes(answer.target_asin));
    }
    assert.equal(q.inputs.length, 0);
    assert.equal(q.environment.upstreamConstraints.productDatabase.bundled, false);
    assert.match(q.environment.upstreamConstraints.memoryEvidence, /MEMORY_PROBE/u);
    assert.match(final.answer.scoringLimitations, /budget/u);
    stages += scenario.questions.length;
  }
  assert.equal(stages, 30);
});

test("DeepResearch 保留全部 443 条三维评分项、禁用来源和逐题许可", async () => {
  const languages: Record<string, number> = {};
  let total = 0;
  for (const dir of await bundles("deepresearch-bench-ii")) {
    const q = await json(path.join(dir, "question.json"));
    const final = await json(path.join(dir, "private/final.json"));
    // 逐题许可改为从 adaptationChanges 断言；language 取自 bundle 目录名后缀。
    assert.ok(q.source.adaptationChanges.some((line: string) => /CC BY 4\.0/u.test(line)));
    const language = path.basename(dir).endsWith("-zh") ? "zh" : "en";
    assert.ok((await readFile(path.join(dir, "prompt.md"), "utf8")).includes("output/report.md"));
    assert.deepEqual(Object.keys(final.answer.rubric).sort(), ["analysis", "info_recall", "presentation"]);
    for (const dimension of ["analysis", "info_recall", "presentation"]) {
      const items = final.answer.rubric[dimension];
      assert.ok(items.every((item: unknown) => typeof item === "string" && item.length > 0));
      total += items.length;
    }
    assert.ok(final.answer.blocked.urls.length > 0);
    for (const url of final.answer.blocked.urls) assert.ok(q.task.instructions.includes(url));
    assert.deepEqual(final.answer.blocked, q.environment.upstreamConstraints.blockedReferences);
    assert.equal(final.answer.nativeEvaluator.defaultModel, "gpt-5.5");
    assert.equal(final.answer.officialPassThreshold, null);
    assert.equal(q.inputs.length, 0);
    languages[language] = (languages[language] ?? 0) + 1;
  }
  assert.equal(total, 443);
  assert.deepEqual(languages, { zh: 2, en: 3 });
});
