import assert from "node:assert/strict";
import { mkdir,mkdtemp,readFile,readdir,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportCaseBundle } from "../../src/platform/case-bundle.js";
import { resultFixture } from "../helpers/evaluation.js";
test("Bundle has one structured result and HTML; no per-label copies or legacy projections",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"dsheval-bundle-"));
  try {
    const data=await resultFixture();const reportRoot=path.join(root,"reports");
    await mkdir(path.join(reportRoot,data.runId),{recursive:true});
    const bytes=JSON.stringify(data);
    await writeFile(path.join(reportRoot,data.runId,"report.json"),bytes);
    await writeFile(path.join(reportRoot,data.runId,"report.html"),"<html></html>");
    const input={resultRoot:path.join(root,"results"),runRoot:path.join(root,"runs"),
      artifactRoot:path.join(root,"artifacts"),reportRoot,agentId:"agent.test",runId:data.runId,caseId:"case.test",maxFileBytes:2000000};
    const result=await exportCaseBundle(input);
    assert.deepEqual((await readdir(result.directory)).sort(),["output","report.html","report.json"]);
    assert.equal(await readFile(result.reportJsonPath,"utf8"),bytes);
    await assert.rejects(exportCaseBundle(input),/immutable/);
  } finally {await rm(root,{recursive:true,force:true});}
});
