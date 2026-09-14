import assert from "node:assert/strict";
import test from "node:test";
import { aggregateScores } from "../../src/evaluation/scoring.js";
import { parseLabelScore } from "../../src/evaluation/llm-label-judge.js";
import { judgeInput } from "../helpers/evaluation.js";
test("Numeric aggregation preserves zero, distinguishes unknown/error and refuses mixed standards",async()=>{
  const input=await judgeInput();
  const score=(value:number|null)=>parseLabelScore(JSON.stringify({status:value===null?"UNASSESSABLE":"SCORED",score:value,reason:"fixture",evidence_ids:[]}),input,"mock");
  const result=aggregateScores([score(0),score(4),score(null),{...score(null),status:"ERROR"}])[0]!;
  assert.equal(result.score,2);assert.equal(result.scoredCases,2);assert.equal(result.unassessableCases,1);assert.equal(result.errorCases,1);
  assert.equal(aggregateScores([score(null)])[0]!.score,null);
  assert.throws(()=>aggregateScores([score(0),{...score(4),labelDigest:{...input.label.contentDigest,value:"0".repeat(64)}}]),/mix/);
});
