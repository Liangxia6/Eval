import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCompatibleLabelJudge, parseLabelScore, judgePrompt } from "../../src/evaluation/llm-label-judge.js";
import { judgeInput } from "../helpers/evaluation.js";
import { loadLabels } from "../../src/labels/catalog.js";
test("Every label receives identical all trace and both grading references, without evidence gates",async()=>{
  const input=await judgeInput();
  const prompts:Record<string,unknown>[]=[];
  const judge=new OpenAiCompatibleLabelJudge({endpoint:"https://judge.example/api",apiKey:"test-key",model:"mock",
    fetchImpl:async(_url,options)=>{
      const body=JSON.parse(String(options?.body));const prompt=JSON.parse(body.messages[1].content);prompts.push(prompt);
      assert.match(body.messages[0].content,/untrusted evidence/);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({status:"SCORED",score:2.5,
        reason:"Fixture evaluates the label and Case reference.",evidence_ids:[input.allTrace.entries[0]!.id]})}}]}));
    }});
  const labels=(await loadLabels("labels")).slice(0,2);
  for(const label of labels) {
    const score=await judge.evaluate({...input,label});
    assert.equal(score.score,2.5);assert.equal(score.status,"SCORED");assert.equal("outcome" in score,false);
    assert.deepEqual(score.allTraceDigest,input.allTrace.contentDigest);
  }
  assert.equal(prompts.length,2);
  assert.deepEqual(prompts[0]!.all_trace,prompts[1]!.all_trace);
  assert.deepEqual((prompts[0]!.case as {grading:unknown}).grading,input.case.grading);
  assert.ok((prompts[0]!.label as {scoringStandard:unknown}).scoringStandard);
  assert.equal("authorized_evidence" in prompts[0]!,false);
});
test("Unknown citations, invalid score and malformed response are rejected; null is distinct from zero",async()=>{
  const input=await judgeInput();
  const valid={status:"SCORED",score:0,reason:"Actual low performance",evidence_ids:[]};
  assert.equal(parseLabelScore(JSON.stringify(valid),input,"mock").score,0);
  for(const patch of [{score:5},{score:null},{status:"UNASSESSABLE"},{evidence_ids:["invented"]}])
    assert.throws(()=>parseLabelScore(JSON.stringify({...valid,...patch}),input,"mock"));
  const unknown=parseLabelScore(JSON.stringify({...valid,status:"UNASSESSABLE",score:null}),input,"mock");
  assert.equal(unknown.score,null);assert.equal(unknown.status,"UNASSESSABLE");
  assert.match(JSON.stringify(judgePrompt(input)),/scoringStandard/);
});
test("Transport failure remains Judge ERROR, not Agent zero",async()=>{
  const judge=new OpenAiCompatibleLabelJudge({endpoint:"https://judge.example/api",apiKey:"secret",model:"mock",
    fetchImpl:async()=>new Response("secret private body",{status:503})});
  const result=await judge.evaluate(await judgeInput());
  assert.equal(result.status,"ERROR");assert.equal(result.score,null);assert.equal(result.reason,"JUDGE_HTTP_503");
});
