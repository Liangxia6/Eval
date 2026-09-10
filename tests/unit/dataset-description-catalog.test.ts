import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadDatasetDescriptionCatalog } from "../../src/datasets/catalog.js";

test("外部 Dataset Catalog 动态加载描述和既有标签", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-dataset-catalog-"));
  const file = path.join(root, "catalog.json");
  try {
    await writeFile(file, JSON.stringify({
      schema: "dsheval.dataset-planner-catalog/v1",
      version: "1.0",
      datasets: [{
        datasetId: "dataset.locomo/v1",
        name: "LoCoMo",
        description: "long-term conversational memory",
        labelIds: ["label.memory/v1", "label.retrieval-grounding/v1"],
        availableCaseCount: 30,
      }],
    }));
    const candidates = await loadDatasetDescriptionCatalog(file);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]?.availableCaseCount, 30);
    assert.deepEqual(candidates[0]?.labelIds, ["label.memory/v1", "label.retrieval-grounding/v1"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
