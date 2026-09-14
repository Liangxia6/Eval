import { OpenAiCompatibleLabelJudge } from "../../src/evaluation/llm-label-judge.js";
import type { EvaluationResult } from "../../src/reporting/types.js";
/**
 * 测试功能：用 Attention + PyTorch Fixture 跑通唯一纵向链路。
 * 覆盖正常通过、产物不合格、Probe 证据不足，以及 Reset 故障不篡改 Agent 判定。
 * 调用入口：app/workflow.ts 的 runEvaluationWorkflow。
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runEvaluationWorkflow, type FixtureHooks } from "../../src/app/workflow.js";
import {
  digestValue,
  validateStableId,
  validateVersionedAssetId,
  withContentDigest,
  type TargetDescriptor,
} from "../../src/core/models.js";
import { cleanupRuntimeDshHome } from "../../src/runtime/environment.js";

const REPOSITORY_ROOT = path.resolve(process.cwd());
const TARGET_ROOT = path.join(REPOSITORY_ROOT, "tests", "fixtures", "agents", "fake-dsh");
const DATASETS_ROOT = path.join(REPOSITORY_ROOT,"tests","fixtures","datasets");
const CATALOG_PATH = path.join(DATASETS_ROOT,"catalog.json");
const mockJudge = new OpenAiCompatibleLabelJudge({
  endpoint:"https://judge.fixture/api",apiKey:"fixture-key",model:"explicit-test-stub",
  fetchImpl:async(_url,options)=>{
    const body=JSON.parse(String(options?.body));const prompt=JSON.parse(body.messages[1].content);
    const entries=prompt.all_trace.entries as Array<{id:string;layer:string;content:{portablePath?:string}}>;
    const deliverable=entries.find(entry=>entry.layer==="DELIVERY" && entry.content.portablePath==="output/attention.py");
    const value=prompt.label.labelId==="label.artifact-delivery/v1" && !deliverable?0:3;
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({
      status:"SCORED",score:value,reason:"Explicit fixture Judge response; not a real model quality evaluation.",
      evidence_ids:deliverable?[deliverable.id]:[],
    })}}]}));
  },
});

interface FixtureRun {
  readonly root: string;
  readonly reportRoot: string;
  readonly summary: Awaited<ReturnType<typeof runEvaluationWorkflow>>;
}

function fixtureDescriptor(): TargetDescriptor {
  return withContentDigest({
    schema: "dsheval.mvp.target-descriptor/v1" as const,
    targetId: validateStableId<"TargetId">("fixture-agent"),
    targetType: "FULL_AGENT" as const,
    sourceRoot: TARGET_ROOT,
    dshExecutable: "fake-dsh.mjs",
    dshHome: ".dsh",
    profile: "fixture-attention",
    targetIdentity: "dshagent",
  });
}

async function runFixture(
  runId: string,
  behavior: string,
  hooks: Omit<FixtureHooks, "behavior"> = {},
): Promise<FixtureRun> {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-attention-"));
  const reportRoot = path.join(root, "reports");
  try {
    const summary = await runEvaluationWorkflow({
      cwd: REPOSITORY_ROOT,
      runId,
      descriptor: fixtureDescriptor(),
      datasetsRoot:DATASETS_ROOT,datasetCatalogPath:CATALOG_PATH,labelJudge:mockJudge,
      fixtureMode: true,
      fixtureHooks: { behavior, ...hooks },
      configOverrides: {
        runRoot: path.join(root, "records"),
        artifactRoot: path.join(root, "artifacts"),
        reportRoot,
        resultRoot: path.join(root, "evaluation-results"),
        workspaceRoot: path.join(root, "workspaces"),
        runtimeDshHomeRoot: path.join(root, "runtime-homes"),
        runDeadlineMs: 300_000,
        caseDeadlineMs: 240_000,
      },
    });
    return { root, reportRoot, summary };
  } catch (error) {
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

async function report(run: FixtureRun): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(path.join(run.reportRoot, run.summary.runId, "report.json"), "utf8"),
  ) as Record<string, unknown>;
}

async function removeFixture(run: FixtureRun): Promise<void> {
  const runtimeRoot = path.join(run.root, "runtime-homes");
  const canonicalRoot = await realpath(runtimeRoot);
  await cleanupRuntimeDshHome({
    runtimeDshHomeRoot: runtimeRoot,
    runtimeDshHomePath: path.join(
      canonicalRoot,
      run.summary.runId,
      `${run.summary.runId}.case`,
      `${run.summary.runId}.attempt`,
    ),
    runId: run.summary.runId,
    caseId: `${run.summary.runId}.case`,
    attemptId: `${run.summary.runId}.attempt`,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rm(run.root, { recursive: true, force: true });
}

test("inspect 只做静态观测，不调用 LLM Planner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-label-inspect-"));
  try {
    const summary = await runEvaluationWorkflow({
      cwd: REPOSITORY_ROOT,
      runId: "inspect-label-selection",
      descriptor: fixtureDescriptor(),
      fixtureMode: true,
      stopAfter: "INSPECT",
      configOverrides: {
        runRoot: path.join(root, "records"),
        artifactRoot: path.join(root, "artifacts"),
        reportRoot: path.join(root, "reports"),
        resultRoot: path.join(root, "evaluation-results"),
        workspaceRoot: path.join(root, "workspaces"),
        runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      },
    });
    assert.equal(summary.status, "COMPLETED");
    assert.equal(summary.command, "inspect");
    assert.equal(summary.evaluationPlanId, undefined);
    assert.equal(summary.selectedLabelIds, undefined);
    assert.equal(summary.datasetMatchModel, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plan 把静态观测和 Dataset 目录交给一次统一 Planner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-dataset-plan-"));
  const toolCode = validateVersionedAssetId<"LabelId">("label.tool-code/v1");
  const artifact = validateVersionedAssetId<"LabelId">("label.artifact-delivery/v1");
  const attentionDataset = validateVersionedAssetId<"DatasetId">("dataset.attention-pytorch/v1");
  let datasetCalls = 0;
  try {
    const summary = await runEvaluationWorkflow({
      cwd: REPOSITORY_ROOT,
      runId: "dataset-selection-plan",
      descriptor: fixtureDescriptor(),
      fixtureMode: true,
      stopAfter: "PLAN",
      datasetsRoot:DATASETS_ROOT,datasetCatalogPath:CATALOG_PATH,labelJudge:mockJudge,
      datasetMatcher: {
        select: async (input) => {
          datasetCalls += 1;
          assert.equal(input.agentStaticInfo.target_type, "FULL_AGENT");
          assert.ok(input.agentStaticInfo.tools.length > 0);
          assert.equal(input.agentStaticInfo.plugins.length, 1);
          assert.match(JSON.stringify(input.agentStaticInfo.plugins), /deterministic Python fixture/u);
          assert.match(JSON.stringify(input.agentStaticInfo.tool_delta), /fixture\.python\/v1/u);
          assert.equal(input.profile, "STANDARD");
          assert.equal(input.availableDatasets.length, 1);
          assert.equal(input.availableDatasets[0]?.datasetId, attentionDataset);
          return {
            schema: "dsheval.mvp.unified-planner-result/v1",
            profile: "STANDARD",
            selectedDatasets: [{
              datasetId: attentionDataset,
              evaluationLabelIds: [toolCode, artifact],
              caseCount: 1,
              reason: "fixture compatible",
            }],
            evaluationLabelIds: [toolCode, artifact],
            totalCaseCount: 1,
            model: "fixture-dataset-model",
            durationMs: 6,
          };
        },
      },
      configOverrides: {
        runRoot: path.join(root, "records"),
        artifactRoot: path.join(root, "artifacts"),
        reportRoot: path.join(root, "reports"),
        resultRoot: path.join(root, "evaluation-results"),
        workspaceRoot: path.join(root, "workspaces"),
        runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      },
    });
    assert.equal(datasetCalls, 1);
    assert.equal(summary.command, "plan");
    assert.notEqual(summary.evaluationPlanId, undefined);
    assert.notEqual(summary.agentTracePlanId, undefined);
    assert.notEqual(summary.observationPlanId, undefined);
    const tracePlan = JSON.parse(await readFile(path.join(
      root,
      "records",
      summary.runId,
      "records",
      "agent-trace-plan",
      `${summary.agentTracePlanId}.json`,
    ), "utf8")) as { sourceRequirements: Array<{ sourceType: string }> };
    const observationPlan = JSON.parse(await readFile(path.join(
      root,
      "records",
      summary.runId,
      "records",
      "observation-plan",
      `${summary.observationPlanId}.json`,
    ), "utf8")) as { sourceRequirements: Array<{ sourceType: string }> };
    assert.deepEqual(tracePlan.sourceRequirements.map((item) => item.sourceType), ["DSH_PROBE"]);
    assert.equal(observationPlan.sourceRequirements.length,10);
    assert.equal(summary.datasetTestProfile, "STANDARD");
    assert.equal(summary.selectedDatasets?.length, 1);
    assert.equal(summary.totalCaseCount, 1);
    assert.equal(summary.datasetMatchModel, "fixture-dataset-model");
    assert.equal(summary.datasetMatchDurationMs, 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Dataset Loader -> all trace -> label Judge -> numeric result -> HTML", {timeout:30000},async()=>{
  const run=await runFixture("attention-score","attention-success");
  try {
    assert.equal(run.summary.status,"COMPLETED",JSON.stringify(run.summary));
    assert.equal(run.summary.exitCode,0,JSON.stringify(run.summary));
    assert.equal(run.summary.runState,"FINISHED");
    const document=await report(run) as unknown as EvaluationResult;
    assert.deepEqual(document.contentDigest,digestValue(document,["contentDigest"]));
    assert.equal(document.scores.length,2);assert.ok(document.scores.every(score=>score.score===3));
    assert.ok(document.scores.every(score=>score.allTraceDigest.value===document.allTrace!.contentDigest.value));
    assert.equal(document.allTrace!.coverage.length,11);
    assert.ok(document.allTrace!.entries.some(entry=>entry.layer==="AGENT"));
    const delivery=document.allTrace!.entries.filter(entry=>entry.layer==="DELIVERY");
    assert.match(JSON.stringify(delivery),/scaled_dot_product_attention/);
    assert.match(JSON.stringify(document.case!.grading),/softmax/);
    assert.equal(document.environmentState,"CLEANED");
    assert.equal(document.reset?.result,"MATCH");
    assert.equal("gate" in document,false);assert.equal("view" in document,false);
    const html=await readFile(run.summary.reportHtml!,"utf8");
    const output=await readFile(path.join(run.summary.caseBundlePath!,"output","attention.py"),"utf8");
    assert.match(output,/scaled_dot_product_attention/);
    assert.match(html,/href="output\/attention.py"/);
    assert.match(html,/标签维度评分/);assert.match(html,/3.00/);
    assert.deepEqual(JSON.parse(await readFile(path.join(run.summary.caseBundlePath!,"report.json"),"utf8")),document);
  } finally {await removeFixture(run);}
});
test("Missing delivery becomes a numeric result from Judge, not a hard gate",{timeout:30000},async()=>{
  const run=await runFixture("attention-missing","missing-artifact");
  try {
    assert.equal(run.summary.exitCode,0,JSON.stringify(run.summary));
    assert.equal(run.summary.scores?.find(score=>score.labelId==="label.artifact-delivery/v1")?.score,0);
    assert.equal(run.summary.scores?.find(score=>score.labelId==="label.tool-code/v1")?.score,3);
  } finally {await removeFixture(run);}
});
test("Incomplete Probe still reaches every Judge with coverage metadata",{timeout:30000},async()=>{
  const run=await runFixture("attention-incomplete","missing-probe-stop");
  try {
    assert.equal(run.summary.scores?.length,2,JSON.stringify(run.summary));
    assert.ok(run.summary.scores?.every(score=>score.status==="SCORED"));
    assert.ok(run.summary.reasonCodes.includes("PROBE_STOP_MISSING"));
  } finally {await removeFixture(run);}
});
test("Reset failure does not change previously produced numeric scores",{timeout:30000},async()=>{
  const run=await runFixture("attention-reset-failure","attention-success",{
    afterReset:async(workspace)=>{await writeFile(path.join(workspace,"residue.txt"),"residue");},
  });
  try {
    assert.ok(run.summary.scores?.every(score=>score.score===3),JSON.stringify(run.summary));
    assert.equal(run.summary.operationalHealth,"FAILED");
    assert.equal(run.summary.exitCode,4);
  } finally {await removeFixture(run);}
});

for (const scenario of [
  { name: "adapter-loss", reason: "PROBE_ADAPTER_CAPTURE_INCOMPLETE" },
  { name: "adapter-truncation", reason: "PROBE_TRUNCATED" },
  { name: "turn-open", reason: "PROBE_TURN_INCOMPLETE" },
  { name: "native-stop-unconfirmed", reason: "PROBE_NATIVE_STOP_UNCONFIRMED" },
]) {
  test(`Trace ${scenario.name} records coverage uncertainty without blocking Judge`, { timeout: 30000 }, async () => {
    const runId = `trace-${scenario.name}`;
    const run = await runFixture(runId, "attention-success", {
      afterTargetBeforeDrain: async (workspacePath) => {
        const fixtureRoot = path.resolve(workspacePath, "../../../..");
        const probeFile = path.join(fixtureRoot, "runtime-homes", runId, `${runId}.case`, `${runId}.attempt`, "probe", "events.jsonl");
        let records = (await readFile(probeFile, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as {
          probeSeq: number;
          kind: string;
          data: Record<string, unknown> & { event?: { type?: string } };
          captureDiagnostics?: unknown;
        });
        if (scenario.name === "turn-open") {
          records = records.filter((record) => record.data.event?.type !== "turn/end");
        } else if (scenario.name === "native-stop-unconfirmed") {
          const stop = records.find((record) => record.kind === "probe/stop")!;
          stop.data = { source: "DSHEVAL_NATIVE_ADAPTER", nativeStopObserved: false };
        } else {
          records[0]!.captureDiagnostics = {
            schema: "dsheval.trace-adapter-capture/v1", source: "DSHEVAL_NATIVE_PROBE",
            truncated: scenario.name === "adapter-truncation",
            issues: scenario.name === "adapter-loss" ? [{ code: "NATIVE_HASH_INVALID", detail: "test capture integrity failure" }] : [],
          };
        }
        records = records.map((record, probeSeq) => ({ ...record, probeSeq }));
        await writeFile(probeFile, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
      },
    });
    try {
      assert.equal(run.summary.scores?.length,2,JSON.stringify(run.summary));
      assert.ok(run.summary.scores?.every(score=>score.status==="SCORED"));
      assert.ok(run.summary.reasonCodes.includes(scenario.reason));
      const document=await report(run) as unknown as EvaluationResult;
      assert.equal(document.environmentState,"CLEANED");
      assert.ok(document.allTrace!.coverage.some(status=>status.completeness!=="COMPLETE"));
    } finally { await removeFixture(run); }
  });
}
