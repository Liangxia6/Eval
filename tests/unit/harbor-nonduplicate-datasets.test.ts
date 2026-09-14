import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadDatasetDescriptionCatalog } from "../../src/datasets/catalog.js";

const EXPECTED = [
  { directory: "algotune", title: "algotune-optimize-matrix-sqrt", output: "output/solver.py" },
  { directory: "algotune", title: "algotune-optimize-lti-sim", output: "output/solver.py" },
  { directory: "algotune", title: "algotune-optimize-ode-seirs", output: "output/solver.py" },
  { directory: "algotune", title: "algotune-optimize-outer-product", output: "output/solver.py" },
  { directory: "algotune", title: "algotune-simplex-projection-speedup", output: "output/solver.py" },
  { directory: "bix", title: "bix-diff-expr-mirna", output: "output/answer.txt" },
  { directory: "bix", title: "bix-cpg-density-jackdaw", output: "output/answer.txt" },
  { directory: "bix", title: "bix-filter-chip-variants", output: "output/answer.txt" },
  { directory: "bix", title: "bix-immune-pathway-enrichment", output: "output/answer.txt" },
  { directory: "bix", title: "bix-ordinal-logit-covid", output: "output/answer.txt" },
  { directory: "featurebench", title: "featurebench-add-feature-xarray-backend-chunks", output: "output/agent.patch" },
  { directory: "featurebench", title: "featurebench-add-feature-lightning-hooks", output: "output/agent.patch" },
  { directory: "featurebench", title: "featurebench-add-feature-mlflow-bedrock-autolog", output: "output/agent.patch" },
  { directory: "featurebench", title: "featurebench-add-feature-mlflow-unity-catalog", output: "output/agent.patch" },
  { directory: "gaia2", title: "gaia2-adapt-hard-1", output: "output/response.txt" },
  { directory: "gaia2", title: "gaia2-ambiguous", output: "output/response.txt" },
  { directory: "gaia2", title: "gaia2-adapt-hard-2", output: "output/response.txt" },
  { directory: "gaia2", title: "gaia2-timed-1", output: "output/response.txt" },
  { directory: "gaia2", title: "gaia2-timed-2", output: "output/response.txt" },
  { directory: "replicationbench", title: "replicationbench-find-galactic-vz-peaks", output: "output/result.json" },
  { directory: "skillsbench", title: "skillsbench-ocr-receipts-to-excel", output: "output/stat_ocr.xlsx" },
  { directory: "skillsbench", title: "skillsbench-model-investment-shock-gdp", output: "output/test-supply.xlsx" },
  { directory: "usaco", title: "usaco-assign-cows-to-barns", output: "output/solution.py" },
  { directory: "widesearch", title: "widesearch-list-bri-projects-2025", output: "output/output.md" },
] as const;

const SOURCE_COMMIT = "5399ea1026fb2c7fc384cf8acd91a7d10fc943f3";
const ORIGINAL_TITLES = new Set([
  "algotune-optimize-matrix-sqrt", "bix-diff-expr-mirna", "featurebench-add-feature-xarray-backend-chunks",
  "gaia2-adapt-hard-1", "gaia2-ambiguous", "replicationbench-find-galactic-vz-peaks",
  "skillsbench-ocr-receipts-to-excel", "usaco-assign-cows-to-barns", "widesearch-list-bri-projects-2025",
]);
const ESSENTIAL_PRIVATE_FILES: Readonly<Record<string, readonly string[]>> = {
  algotune: ["evaluator.py", "oracle_solver.py", "test_outputs.py"],
  bix: [],
  featurebench: ["setup_patch.diff", "test_patch.diff", "test.sh"],
  gaia2: ["scenario.json"],
  skillsbench: ["test_outputs.py"],
};

test("严格去重的 Harbor 题目使用逐题 Question Bundle 并与 Catalog 一致", async () => {
  const datasetsRoot = path.resolve("datasets");
  const catalog = await loadDatasetDescriptionCatalog(path.join(datasetsRoot, "catalog.md"));
  const byDirectory = new Map<string, number>();
  const labelsByDirectory = new Map<string, Set<string>>();
  const seenSources = new Set<string>();
  const knownLabels = new Set(await Promise.all((await readdir("labels"))
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => (JSON.parse(await readFile(path.join("labels", file), "utf8")) as { labelId: string }).labelId)));

  for (const expected of EXPECTED) {
    const bundleRoot = path.join(datasetsRoot, expected.directory, expected.title);
    const question = JSON.parse(await readFile(path.join(bundleRoot, "question.json"), "utf8")) as {
      schema: string;
      id: string;
      version: string;
      title: string;
      matching: { datasetId: string };
      source: { repository: string; commit: string; taskPath: string; files: readonly { path: string; sha256: string }[]; adaptationChanges: readonly string[] };
      capabilityLabels: readonly string[];
      task: { instructions: string };
      environment: { timeoutSeconds: number }; inputs: readonly { source:string; destination:string; sha256:string }[];
      evidence: { process: { checkpoints: readonly unknown[] }; local: object };
    };
    const final = JSON.parse(await readFile(path.join(bundleRoot, "private/final.json"), "utf8")) as { answer: unknown; rubric: string };

    assert.equal(question.schema, "dsheval.question/v1");
    assert.equal(question.version, "1.0.0");
    assert.equal(question.id, `harbor.${expected.title}`);
    assert.equal(question.title, expected.title);
    assert.equal(question.matching.datasetId, `dataset.harbor.${expected.title}/v1`);
    assert.equal(question.source.repository, "https://github.com/harbor-framework/harbor-index");
    assert.equal(question.source.commit, SOURCE_COMMIT);
    assert.equal(question.source.taskPath, `tasks/${expected.title}`);
    assert.ok(!seenSources.has(question.source.taskPath));
    seenSources.add(question.source.taskPath);
    assert.ok(question.source.files.length >= 3);
    assert.ok(question.source.files.every((file) => /^[0-9a-f]{64}$/u.test(file.sha256)));
    assert.ok(question.source.adaptationChanges.length >= 3);
    assert.ok(question.capabilityLabels.length >= 1);
    assert.ok(await readFile(path.join(bundleRoot, "prompt.md"), "utf8"));
    assert.ok(question.task.instructions.includes(expected.output));
    assert.ok(question.evidence.process.checkpoints.length >= 3);
    assert.notEqual(final.answer, undefined);
    assert.ok(final.rubric.length > 0);

    for (const input of question.inputs) {
      assert.ok(input.source.startsWith("input/"));
      assert.ok(!input.source.includes(".."));
      const bytes = await readFile(path.join(bundleRoot, input.source));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), input.sha256);
    }
    if (!ORIGINAL_TITLES.has(expected.title)) {
      const retained = ESSENTIAL_PRIVATE_FILES[expected.directory]!;
      assert.deepEqual((await readdir(path.join(bundleRoot, "private"))).sort(), ["final.json", ...retained].sort());
      assert.deepEqual((await readdir(bundleRoot)).sort(),
        ["question.json", "prompt.md", "private", ...(question.inputs.length ? ["input"] : [])].sort());
      assert.ok(question.source.files.length <= 5);
      assert.ok(question.source.files.every((file) => !/Dockerfile|README|requirements|solution\//u.test(file.path)));
      assert.ok(!JSON.stringify([question, final]).includes("private/upstream"));
      assert.equal(Object.hasOwn(question, "final"), false);
      if (expected.directory !== "algotune") assert.ok(!Object.hasOwn(question.environment, "upstreamConstraints"));
      for (const name of retained) {
        const source = question.source.files.find((file) => path.posix.basename(file.path) === name);
        assert.ok(source, `${expected.title}/${name}: missing source hash`);
        const bytes = await readFile(path.join(bundleRoot, "private", name));
        assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sha256, name);
      }
    }
    const labels = labelsByDirectory.get(expected.directory) ?? new Set<string>();
    for (const label of question.capabilityLabels) {
      const id = `label.${label}/v1`;
      assert.ok(knownLabels.has(id), id);
      labels.add(id);
    }
    labelsByDirectory.set(expected.directory, labels);
    byDirectory.set(expected.directory, (byDirectory.get(expected.directory) ?? 0) + 1);
  }

  for (const [directory, count] of byDirectory) {
    const entry = catalog.find((candidate) => candidate.datasetId === `dataset.harbor-${directory}/v1`);
    assert.equal(entry?.availableCaseCount, count);
    assert.deepEqual([...(entry?.labelIds ?? [])].sort(), [...(labelsByDirectory.get(directory) ?? [])].sort());
    assert.ok(entry);
    assert.equal(Object.hasOwn(entry, "estimatedSecondsPerCase"), false);
    const bundles = (await readdir(path.join(datasetsRoot, directory), { withFileTypes: true }))
      .filter((item) => item.isDirectory());
    assert.equal(bundles.length, count);
  }

  const skillsInputs = JSON.parse(await readFile(
    path.join(datasetsRoot, "skillsbench", "skillsbench-ocr-receipts-to-excel", "question.json"),
    "utf8",
  )) as { inputs: readonly unknown[] };
  assert.equal(skillsInputs.inputs.length, 22);
});

test("补充题保留不同场景、实际性能门槛和 GDP 专属判分契约", async () => {
  const load = async (directory: string, title: string, file = "question.json") =>
    JSON.parse(await readFile(path.resolve("datasets", directory, title, file), "utf8"));
  const scenarioIds = new Set<string>();
  for (const expected of EXPECTED.filter((item) => item.directory === "gaia2")) {
    const question = await load(expected.directory, expected.title);
    assert.equal(question.inputs.length, 0);
    if (["gaia2-adapt-hard-2", "gaia2-timed-1", "gaia2-timed-2"].includes(expected.title)) {
      const scenario = await load("gaia2", expected.title, "private/scenario.json");
      // scenario 唯一性改为直接取自 private/scenario.json，不再依赖 source.upstreamMetadata。
      const scenarioId = scenario.metadata.definition.scenario_id;
      assert.ok(!scenarioIds.has(scenarioId));
      scenarioIds.add(scenarioId);
      assert.equal(scenario.metadata.definition.start_time, 1728975600);
      const final = await load("gaia2", expected.title, "private/final.json");
      assert.ok(!Object.hasOwn(final.answer, "oracleActions"));
      assert.ok(Array.isArray(final.answer.oracleEvents) && final.answer.oracleEvents.length > 0);
      assert.ok(final.answer.oracleEvents.every((event: { parent_event_ids: unknown; event_time: unknown }) =>
        Array.isArray(event.parent_event_ids) && typeof event.event_time === "number"));
    }
  }
  for (const expected of EXPECTED.filter((item) => item.directory === "algotune" && item.title !== "algotune-optimize-matrix-sqrt")) {
    const question = await load("algotune", expected.title);
    const final = await load("algotune", expected.title, "private/final.json");
    assert.ok(!question.task.instructions.includes("x faster**"));
    assert.ok(question.task.instructions.includes("1.05"));
    assert.equal(final.answer.minimumOracleRatio, 1 / 1.05);
    assert.equal(question.environment.upstreamConstraints.verifier.timeout_sec,
      expected.title === "algotune-optimize-outer-product" ? 10800 : 7200);
  }
  const gdpTitle = "skillsbench-model-investment-shock-gdp";
  const gdp = await load("skillsbench", gdpTitle);
  const final = await load("skillsbench", gdpTitle, "private/final.json");
  assert.equal(gdp.inputs.length, 1);
  assert.ok(gdp.task.instructions.includes("input/test-supply.xlsx"));
  assert.ok(!gdp.task.instructions.includes("/root/"));
  assert.ok(!gdp.capabilityLabels.includes("multimodal"));
  assert.equal(final.answer.weoGdpRelativeTolerance, 0.05);
  assert.equal(final.answer.depreciationRelativeTolerance, 0.4);
  assert.equal(final.answer.requiredSheets.length, 5);
  assert.ok(!Object.hasOwn(final.answer, "oracleWorkbook"));
  assert.equal(final.answer.judge, "private/test_outputs.py");
});
