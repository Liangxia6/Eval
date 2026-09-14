import assert from "node:assert/strict";
import { mkdtemp,mkdir,readFile,rm,writeFile } from "node:fs/promises";
import os from "node:os";import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { digestBytes } from "../../src/core/models.js";
import { loadDatasetCase } from "../../src/datasets/loader.js";
import { validateVersionedAssetId } from "../../src/core/models.js";
import { prepareEnvironment } from "../../src/runtime/environment.js";
import { executeTarget } from "../../src/runtime/target.js";
import { prepareInputLaunch } from "../../src/runtime/input-delivery.js";
import { submitInput } from "../../src/runtime/dsh-input-runner.js";

test("PDF chat attachment fails explicitly before Agent creation; no text fallback",async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),"dsheval-pdf-input-"));
 try{
  let created=false;let receipt:any;
  const ctx={get:()=>({create:()=>{created=true;}})};
  await assert.rejects(submitInput(ctx,"read PDF",[{destination:"input/a.pdf",mediaType:"application/pdf",sha256:"unused"}],root,{},async value=>{receipt=value;}),/DSH_ATTACHMENT_MEDIA_UNSUPPORTED/);
  assert.equal(created,false);assert.equal(receipt.status,"FAILED");assert.match(receipt.reason,/application\/pdf/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("Loader -> launcher manifest -> native DSH image storage -> same user message",async(t)=>{
 const executable="/Users/dsheval/Targets/dsh-headless-current/package/lib/bin.js";
 try{await readFile(executable);}catch{t.skip("Requires the VM DSH installation");return;}
 const root=await mkdtemp(path.join(os.tmpdir(),"dsheval-image-input-"));
 try{
  const require=createRequire(executable);
  const load=(name:string)=>import(pathToFileURL(require.resolve(name)).href);
  const [{Context},{LocalAttachmentStore},llm]=await Promise.all([load("@deepseek-ai/cordis"),load("@deepseek-ai/dsh-attachment-local"),load("@deepseek-ai/dsh-llm")]);
  const sharp=(await import(pathToFileURL(createRequire(require.resolve("@deepseek-ai/dsh-attachment-local")).resolve("sharp")).href)).default;
  const bytes:Buffer=await sharp({create:{width:4,height:4,channels:3,background:"#2288aa"}}).png().toBuffer();
  const caseRoot=path.join(root,"datasets","example","case-1");
  await mkdir(path.join(caseRoot,"input"),{recursive:true});await mkdir(path.join(caseRoot,"private"));
  await writeFile(path.join(caseRoot,"input/chart.png"),bytes);
  await writeFile(path.join(caseRoot,"private/final.json"),JSON.stringify({answer:"blue",rubric:"Identify the image color"}));
  await writeFile(path.join(caseRoot,"question.json"),JSON.stringify({
   schema:"dsheval.question/v1",id:"example",version:"1.0.0",capabilityLabels:["multimodal"],
   task:{instructions:"Describe the attached image"},environment:{platform:"portable",timeoutSeconds:30},
   inputs:[{source:"input/chart.png",destination:"input/chart.png",delivery:"chat-attachment"}],
   grading:{reference:"private/final.json"}}));
  const data=await loadDatasetCase({datasetsRoot:path.join(root,"datasets"),datasetId:validateVersionedAssetId("dataset.example/v1"),labelIds:[validateVersionedAssetId("label.multimodal/v1")]});
  const cwd=path.join(root,"workspace"),home=path.join(root,"home");
  await mkdir(path.join(cwd,"input"),{recursive:true});await mkdir(home);
  const seed=data.seedEntries.find(entry=>entry.entryType==="FILE")!;
  await writeFile(path.join(cwd,"input/chart.png"),Buffer.from(String(seed.content),"base64"));
  const launch=await prepareInputLaunch(home,data.inputs);assert.ok(launch);
  const manifest=JSON.parse(await readFile(launch.manifestPath,"utf8"));
  assert.equal(manifest[0].sha256,digestBytes(bytes).value);
  assert.match(await readFile(launch.patchPath,"utf8"),/headless-runner/);
  const context=new Context();const storage=new LocalAttachmentStore(context,{dshHome:home});
  let message:any;let receipt:any;
  const agent={session:{seq:0,events:[] as any[]},whenIdle:async()=>{},
    followup:(value:any)=>{message=value;agent.session.events.push({seq:1,type:"assistant/message",data:{message:{content:[{type:"text",text:"blue"}]}}},{seq:2,type:"turn/end",data:{reason:{kind:"completed"}}});}};
  const ctx={get:(name:string)=>({
    attachments:storage,agentDefaultModel:{currentSelection:()=>({provider:"test",model:"test"})},
    agents:{create:async()=>({agent})},sessions:{flush:async()=>{}},
  } as Record<string,unknown>)[name]};
  const result=await submitInput(ctx,data.task,manifest,cwd,{...llm,SessionId:(id:string)=>id,installModelSelection:()=>{}},async value=>{receipt=value;});
  assert.equal(result.exitCode,0);assert.equal(receipt.status,"SUBMITTED");
  assert.equal(message.content[0].text,data.task);assert.equal(message.content[1].type,"image");
  assert.equal(message.content[1].attachment.attachmentId,receipt.attachments[0].attachmentId);
  const stored=await storage.readImage(message.content[1].attachment);
  assert.ok(stored.data.length>0);assert.equal(stored.ref.width,4);
  assert.deepEqual(await readFile(path.join(caseRoot,"input/chart.png")),bytes);
 }finally{await rm(root,{recursive:true,force:true});}
});


test("real DSH mounts the input adapter instead of silently running the text-only runner",async(t)=>{
 const source="/Users/dsheval/Targets/dsh-headless-current";
 try{await readFile(source+"/package/lib/bin.js");}catch{t.skip("Requires VM DSH");return;}
 const root=await mkdtemp(path.join(os.tmpdir(),"dsheval-native-input-"));
 try{
  const prepared=await prepareEnvironment({workspaceRoot:path.join(root,"workspaces"),runtimeDshHomeRoot:path.join(root,"homes"),
    runId:"native-input",caseId:"pdf",attemptId:"attempt-1",sourceDshHome:source+"/dsh-home",profile:"dsheval"});
  const result=await executeTarget({executablePath:source+"/package/lib/bin.js",profile:"dsheval",
    task:"Read the attached PDF",cwd:prepared.workspacePath,runtimeDshHomePath:prepared.runtimeDshHomePath,
    sessionDshHomePath:prepared.runtimeDshHomePath,probeOutputPath:prepared.probeOutputPath,sourceRunId:"native-input",
    contentMode:"FULL",deadlineMs:30000,maxOutputBytes:100000,
    // Only satisfies DSH's startup config. Unsupported media must fail before any model call.
    modelEnvironment:{DEEPSEEK_API_KEY:"fixture-not-a-real-key"},
    inputs:[{source:"input/a.pdf",destination:"input/a.pdf",delivery:"chat-attachment",mediaType:"application/pdf",sha256:"0".repeat(64)}]});
  assert.equal(result.terminationKind,"HARNESS_ERROR");
  assert.equal(result.inputDelivery?.reason,"DSH_ATTACHMENT_MEDIA_UNSUPPORTED: application/pdf");
  assert.deepEqual(result.inputDelivery?.attachments,[{portablePath:"input/a.pdf"}]);
  assert.doesNotMatch(result.stderr.toString(),/AUTH:|Authentication Fails/);
 }finally{await rm(root,{recursive:true,force:true});}
});
