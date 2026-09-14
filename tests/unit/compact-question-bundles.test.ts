import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve("datasets");
const counts: Readonly<Record<string, number>> = {
  "agentbench-db": 16, algotune: 5, arcagi2: 5, bix: 5, featurebench: 4,
  gaia2: 5, gpqadiamond: 1, hle: 8, labbench: 4,
  omnimath: 2, replicationbench: 1, skillsbench: 2, spreadsheetbench: 12,
  usaco: 1, widesearch: 1,
};
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const digest = (data: Buffer) => createHash("sha256").update(data).digest("hex");

test("全部使用最小题包，只有必要评分资源例外", async () => {
  let total = 0;
  for (const [family, count] of Object.entries(counts)) {
    const entries = await readdir(path.join(root, family), { withFileTypes: true });
    const rootFiles = entries.filter((item) => !item.isDirectory()).map((item) => item.name).sort();
    assert.deepEqual(rootFiles, ["README.md"], family);
    const bundles = entries.filter((item) => item.isDirectory());
    assert.equal(bundles.length, count, family);
    for (const bundle of bundles) {
      total += 1;
      const directory = path.join(root, family, bundle.name);
      const question = await json(path.join(directory, "question.json"));
      const final = await json(path.join(directory, "private/final.json"));
      assert.deepEqual((await readdir(directory)).sort(),
        ["private", "prompt.md", "question.json", ...(question.inputs.length ? ["input"] : [])].sort());
      assert.deepEqual(Object.keys(question).sort(), ["schema", "id", "version", "title", "matching", "source", "capabilityLabels", "task", "environment", "evidence", "inputs", "grading"].sort());
      assert.deepEqual(Object.keys(final).sort(), ["answer", "rubric"]);
      assert.equal(question.schema, "dsheval.question/v1");
      assert.ok(question.capabilityLabels.length >= 1);
      const extra = family === "algotune" ? ["evaluator.py", "oracle_solver.py", "test_outputs.py"]
        : family === "featurebench" ? ["setup_patch.diff", "test.sh", "test_patch.diff"]
          : family === "gaia2" ? ["scenario.json"]
            : family === "spreadsheetbench" ? ["reference.xlsx"]
              : family === "usaco" ? ["reference-tests"]
                : family === "widesearch" ? ["eval_config.json"]
                  : bundle.name === "skillsbench-model-investment-shock-gdp" ? ["test_outputs.py"] : [];
      assert.deepEqual((await readdir(path.join(directory, "private"))).sort(), ["final.json", ...extra].sort(), bundle.name);
      for (const input of question.inputs) {
        assert.equal(digest(await readFile(path.join(directory, input.source))), input.sha256);
      }
      assert.ok(!JSON.stringify([question, final]).match(/private\/(expected\.json|source-record\.json|source-metadata\.json|stat_oracle\.xlsx|gold_answer\.csv|reference\/)/u), bundle.name);
      if (family === "agentbench-db") {
        assert.equal(question.source.taskPath, `data/dbbench/standard.jsonl#line=${Number(bundle.name.split("-").at(-1))}`);
        assert.ok(Array.isArray(JSON.parse(final.answer)));
      }
      if (family === "spreadsheetbench") {
        assert.ok(Array.isArray(final.answer.regions));
        assert.ok(final.answer.regions.length > 0);
        assert.equal(digest(await readFile(path.join(directory, final.answer.referenceWorkbook))), final.answer.referenceSha256);
        assert.ok(question.source.adaptationChanges.some((line: string) => line.includes("CC BY-SA 4.0")));
      }
      if (family === "gaia2") {
        assert.equal(final.answer.scenario, "private/scenario.json");
        assert.ok(final.answer.oracleEvents.length > 0);
        assert.ok(!Object.hasOwn(final.answer, "oracleActions"));
        assert.ok(final.answer.oracleEvents.every((event: { event_time: number; parent_event_ids: unknown[] }) =>
          typeof event.event_time === "number" && Array.isArray(event.parent_event_ids)));
      }
    }
  }
  assert.equal(total, 72);
});

test("精简后仍保留全部表格目标值、OCR 行、搜索答案和隐藏编程用例", async () => {
  let cells = 0;
  for (const item of await readdir(path.join(root, "spreadsheetbench"), { withFileTypes: true })) {
    if (!item.isDirectory()) continue;
    const final = await json(path.join(root, "spreadsheetbench", item.name, "private/final.json"));
    for (const region of final.answer.regions) cells += Object.keys(region.cells).length;
  }
  assert.equal(cells, 276);
  const ocr = await json(path.join(root, "skillsbench/skillsbench-ocr-receipts-to-excel/private/final.json"));
  assert.equal(ocr.answer.rows.length, 22);
  const search = await json(path.join(root, "widesearch/widesearch-list-bri-projects-2025/private/final.json"));
  assert.equal(search.answer.length, 75);
  const hidden = path.join(root, "usaco/usaco-assign-cows-to-barns/private/reference-tests");
  const constraints = await json(path.join(hidden, "data/constraint.json"));
  assert.equal(constraints.num_tests, 20);
  assert.equal(constraints.runtime_limit_sec, 600);
  assert.equal(constraints.memory_limit_mb, 1280);
  assert.ok(!(await readdir(hidden)).includes("Dockerfile"));
  for (let index = 1; index <= constraints.num_tests; index += 1) {
    for (const suffix of ["in", "out"]) {
      assert.ok((await readFile(path.join(hidden, "data", `${index}.${suffix}`))).length > 0);
    }
  }
});
