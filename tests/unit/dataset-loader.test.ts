import { loadCaseExecutionInput } from "../../src/runtime/case-input.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { registryGapForSensors } from "../../src/runtime/evaluation-plan-compiler.js";
import { FILE_SENSOR_DESCRIPTOR } from "../../observer-lab/adapters/filesystem/binding.js";
import { PROCESS_SENSOR_DESCRIPTOR } from "../../observer-lab/adapters/process/binding.js";
import { LAB_SENSOR_DESCRIPTORS } from "../../src/observation/collection.js";
import { loadDatasetCase } from "../../src/datasets/loader.js";
import { digestBytes, validateVersionedAssetId } from "../../src/core/models.js";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-loader-compat-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const caseRoot = path.join(root, "example", "case-a");
  await mkdir(path.join(caseRoot, "input"), { recursive: true });
  await mkdir(path.join(caseRoot, "private"), { recursive: true });
  const inputPath = path.join(caseRoot, "input", "data.txt");
  const questionPath = path.join(caseRoot, "question.json");
  await writeFile(inputPath, "public data");
  await writeFile(path.join(caseRoot, "private", "final.json"), JSON.stringify({ answer: "answer", rubric: "correct" }));
  const question = {
    schema: "dsheval.question/v1", id: "example", version: "1.0.0",
    capabilityLabels: ["tool-code"],
    task: { instructions: "Read input/data.txt and write output/answer.txt; optional intermediates belong in work/." },
    inputs: [{ source: "input/data.txt", destination: "input/data.txt", delivery:"workspace" }],
    grading: { reference:"private/final.json",expectedOutputPath:"output/answer.txt" },
    environment: {
      platform: "portable", timeoutSeconds: 10,
      allowedEdits: ["output/**", "work/**"],
    },
  };
  const datasetId = validateVersionedAssetId<"DatasetId">("dataset.example/v1");
  const labelIds = [validateVersionedAssetId<"LabelId">("label.tool-code/v1")];
  const save = async (value: unknown = question) => writeFile(questionPath, JSON.stringify(value));
  const load = () => loadDatasetCase({
    datasetsRoot: root,datasetId,labelIds,
  });
  await save();
  return { question, save, load, questionPath, inputPath };
}

test("Loader accepts public inputs and allowed work directory without rewriting the Dataset", async (t) => {
  const f = await fixture(t);
  const original = await readFile(f.questionPath, "utf8");
  const pack = await f.load();
  assert.deepEqual(pack.allowedPaths,["output","work"]);
  assert.deepEqual(pack.grading.reference,{answer:"answer",rubric:"correct"});
  assert.equal(await readFile(f.questionPath, "utf8"), original);
  const firstDigest = pack.contentDigest.value;
  await writeFile(f.inputPath, "updated public data");
  assert.notEqual((await f.load()).contentDigest.value, firstDigest, "actual bytes without author digest still enter the frozen Case");
});

test("an author-provided input digest remains mandatory to verify", async (t) => {
  const f = await fixture(t);
  const input = f.question.inputs[0]!;
  await f.save({ ...f.question, inputs: [{ ...input, sha256: digestBytes("public data").value }] });
  await f.load();
  await writeFile(f.inputPath, "tampered");
  await assert.rejects(f.load(), /input digest mismatch/u);
});

test("Loader does not dispatch Setup or Case checks; private rubric stays with Judge", async(t)=>{
  const f=await fixture(t);
  await f.save({...f.question, environment:{...f.question.environment,setup:{kind:"manual-database"}},
    final:{checks:[{kind:"deterministic-program",runner:"checks/check.py"}]}});
  const loaded=await f.load();
  assert.deepEqual(loaded.grading.reference,{answer:"answer",rubric:"correct"});
  assert.equal(loaded.inputs[0]?.delivery,"workspace");
  await f.save({...f.question,environment:{...f.question.environment,allowedEdits:["input/**"]}});
  await assert.rejects(f.load(),/overlaps protected/);
});

test("Loader carries chat attachments without silently changing their delivery mode",async(t)=>{
  const f=await fixture(t);
  await f.save({...f.question,inputs:[{...f.question.inputs[0],delivery:"chat-attachment"}]});
  const loaded=await f.load();
  assert.equal(loaded.inputs[0]?.delivery,"chat-attachment");
  assert.equal(loaded.inputs[0]?.sha256,digestBytes("public data").value);
  await f.save({...f.question,inputs:[{...f.question.inputs[0],source:"private/final.json"}]});
  await assert.rejects(f.load(),/under input/);
});
test("all environment Observers are planned even when the only label is tool-code", async (t) => {
  const caseData = await (await fixture(t)).load();
  const pack=await loadCaseExecutionInput({case:caseData,datasetId:validateVersionedAssetId<"DatasetId">("dataset.example/v1"),traceFile:path.resolve("trace/dsh-runtime.json"),environmentFile:path.resolve("environments/macos.json")});
  assert.deepEqual(registryGapForSensors(
    pack.sourceRequirements.filter((source) => source.sourceType !== "DSH_PROBE"),
    [FILE_SENSOR_DESCRIPTOR, PROCESS_SENSOR_DESCRIPTOR, ...LAB_SENSOR_DESCRIPTORS],
  ), [], "real component capability subsets must match the installed registry");
  const text = JSON.stringify(pack);
  for (const type of ["FILESYSTEM", "PROCESS", "DATABASE", "BROWSER", "DESKTOP",
    "NETWORK", "EXTERNAL_API", "CLIPBOARD", "APPLICATION", "SYSTEM"]) {
    assert.ok(text.includes('"sourceType":"' + type + '"'), type);
  }
});
