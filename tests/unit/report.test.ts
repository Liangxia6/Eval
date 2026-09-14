import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseVerifiedReportDocument, serializeReportDocument } from "../../src/reporting/record.js";
import { renderReportHtml } from "../../src/reporting/html.js";
import { commitReportJson,readCommittedReportJson } from "../../src/platform/export.js";
import { resultFixture } from "../helpers/evaluation.js";
test("One JSON record renders deterministic escaped HTML without rerunning Judge",async()=>{
  const data=await resultFixture();const bytes=serializeReportDocument(data);
  const first=renderReportHtml(parseVerifiedReportDocument(bytes));
  assert.equal(first,renderReportHtml(parseVerifiedReportDocument(bytes)));
  assert.match(first,/&lt;script&gt;/);assert.doesNotMatch(first,/<script>/);
  assert.ok(!("view" in data));assert.ok(!("gate" in data));
  const root=await mkdtemp(path.join(os.tmpdir(),"dsheval-result-"));
  try {
    const input={reportRoot:root,runId:data.runId,maxBytes:2000000};
    await commitReportJson({...input,bytes});
    assert.equal((await readCommittedReportJson(input)).toString(),bytes);
    await assert.rejects(commitReportJson({...input,bytes}),/immutable/);
  } finally {await rm(root,{recursive:true,force:true});}
});
test("Changed score content invalidates result digest",async()=>{
  const data=await resultFixture();
  assert.throws(()=>parseVerifiedReportDocument(JSON.stringify({...data,scores:[{score:4}]})),/Invalid/);
});
