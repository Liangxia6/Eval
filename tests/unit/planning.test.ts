import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadLabels } from "../../src/labels/catalog.js";
test("Labels are the single frozen source; no legacy Metric, contract or passScore",async()=>{
  const labels=await loadLabels("labels");
  assert.ok(labels.length>0);
  assert.equal(new Set(labels.map(label=>label.labelId)).size,labels.length);
  for(const label of labels) {
    assert.ok(Object.isFrozen(label.scoringStandard));assert.ok(Object.isFrozen(label.judge.instructions));
    assert.ok(!("evidence" in label));assert.ok(!("metricId" in label));assert.ok(!("passScore" in label.judge));
  }
});
test("Probe is separate from the ten external Observers",async()=>{
  const trace=JSON.parse(await readFile("trace/dsh-runtime.json","utf8"));
  const environment=JSON.parse(await readFile("environments/macos.json","utf8"));
  assert.equal(trace.sourceRequirement.sourceType,"DSH_PROBE");
  assert.equal(Object.keys(environment.components).length,10);
  assert.ok(!JSON.stringify(environment).includes("DSH_PROBE"));
});
