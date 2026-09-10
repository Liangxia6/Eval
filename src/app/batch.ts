/**
 * 文件职责：把一次统一 Planner 结果展开为最多三个并发 Case，并复用单 Case Workflow。
 * Planner 只执行一次；每个 Case 启动新的 Headless 会话并发布到同一父 Run 目录。
 */
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  validateStableId,
  validateVersionedAssetId,
  type DatasetId,
} from "../core/models.js";
import type { DatasetSelectionPlan } from "../planning/planner.js";
import {
  runEvaluationWorkflow,
  type RunWorkflowInput,
  type WorkflowSummary,
} from "./workflow.js";

export interface BatchRunWorkflowInput extends RunWorkflowInput {
  readonly maxCases?: number;
  readonly selectedCaseId?: string;
  readonly stopAfterCase?: boolean;
  readonly onProgress?: (message: string) => void;
  /** 仅供受控测试或嵌入调用替换单 Case Workflow。 */
  readonly workflowRunner?: typeof runEvaluationWorkflow;
}

export interface BatchCaseSummary {
  readonly caseId: string;
  readonly datasetId: string;
  readonly caseIndex: number;
  readonly executionRunId: string;
  readonly status: WorkflowSummary["status"];
  readonly gate?: WorkflowSummary["gate"];
  readonly exitCode: WorkflowSummary["exitCode"];
  readonly operationalHealth?: WorkflowSummary["operationalHealth"];
  readonly failureGroups: WorkflowSummary["failureGroups"];
  readonly reasonCodes: WorkflowSummary["reasonCodes"];
  readonly caseBundlePath?: string;
  readonly reportHtml?: string;
  readonly dshSessionIds: readonly string[];
}

export interface BatchWorkflowSummary extends WorkflowSummary {
  readonly caseConcurrency: 3;
  readonly caseResults: readonly BatchCaseSummary[];
  readonly runSummaryPath?: string;
}

/** 单台 VMmac 的固定 MVP 并发上限。 */
const CASE_CONCURRENCY = 3 as const;

function selectionFromSummary(summary: WorkflowSummary): DatasetSelectionPlan {
  if (
    summary.datasetTestProfile === undefined ||
    summary.selectedDatasets === undefined ||
    summary.totalCaseCount === undefined ||
    summary.datasetMatchModel === undefined ||
    summary.datasetMatchDurationMs === undefined
  ) {
    throw new Error("Planner summary is missing the frozen Dataset selection");
  }
  const selectedDatasets = summary.selectedDatasets.map((selected) => Object.freeze({
    datasetId: validateVersionedAssetId<"DatasetId">(selected.datasetId),
    evaluationLabelIds: Object.freeze(selected.evaluationLabelIds.map(
      (labelId) => validateVersionedAssetId<"LabelId">(labelId),
    )),
    caseCount: selected.caseCount,
    reason: selected.reason,
    ...(selected.matchType === undefined ? {} : { matchType: selected.matchType }),
    ...(selected.targetCapabilities === undefined ? {} : { targetCapabilities: selected.targetCapabilities }),
    ...(selected.evidence === undefined ? {} : { evidence: selected.evidence }),
    ...(selected.marginalValue === undefined ? {} : { marginalValue: selected.marginalValue }),
  }));
  const evaluationLabelIds = Object.freeze([
    ...new Map(selectedDatasets.flatMap((dataset) => dataset.evaluationLabelIds)
      .map((labelId) => [String(labelId), labelId] as const)).values(),
  ].sort((left, right) => String(left).localeCompare(String(right), "en")));
  return Object.freeze({
    schema: "dsheval.mvp.unified-planner-result/v1" as const,
    profile: summary.datasetTestProfile,
    selectedDatasets: Object.freeze(selectedDatasets),
    evaluationLabelIds,
    totalCaseCount: summary.totalCaseCount,
    model: summary.datasetMatchModel,
    durationMs: summary.datasetMatchDurationMs,
  });
}

function datasetSlug(datasetId: DatasetId): string {
  return String(datasetId).replace(/^dataset\./u, "").replace(/\/v1$/u, "");
}

function caseQueue(selection: DatasetSelectionPlan): Array<{
  readonly datasetId: DatasetId;
  readonly caseIndex: number;
  readonly caseId: string;
}> {
  const queue: Array<{ datasetId: DatasetId; caseIndex: number; caseId: string }> = [];
  for (const dataset of selection.selectedDatasets) {
    for (let caseIndex = 0; caseIndex < dataset.caseCount; caseIndex += 1) {
      queue.push(Object.freeze({
        datasetId: dataset.datasetId,
        caseIndex,
        caseId: validateStableId(`${datasetSlug(dataset.datasetId)}.case-${caseIndex + 1}`, "caseId"),
      }));
    }
  }
  return queue;
}

function aggregateGate(results: readonly BatchCaseSummary[]): WorkflowSummary["gate"] | undefined {
  const gates = results.map((result) => result.gate).filter(
    (gate): gate is NonNullable<WorkflowSummary["gate"]> => gate !== undefined,
  );
  if (gates.includes("FAIL")) return "FAIL";
  if (gates.includes("UNEVALUABLE")) return "UNEVALUABLE";
  return gates.length === results.length && gates.length > 0 ? "PASS" : undefined;
}

async function commitRunSummary(summary: BatchWorkflowSummary): Promise<string | undefined> {
  const bundle = summary.caseResults.find((result) => result.caseBundlePath !== undefined)?.caseBundlePath;
  if (bundle === undefined) return undefined;
  const runDirectory = path.dirname(path.dirname(bundle));
  const destination = path.join(runDirectory, "run.json");
  const temporary = `${destination}.tmp`;
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, destination);
  return destination;
}

/** 真实 run 的批量入口；Fixture、inspect 和 plan 仍直接调用单 Workflow。 */
export async function runEvaluationBatch(input: BatchRunWorkflowInput): Promise<BatchWorkflowSummary> {
  const {
    maxCases,
    selectedCaseId,
    stopAfterCase,
    onProgress,
    workflowRunner = runEvaluationWorkflow,
    ...workflowInput
  } = input;
  const parentRunId = validateStableId(workflowInput.runId ?? `batch-${Date.now()}`, "runId");
  const transientRoot = path.join(workflowInput.cwd, "var", "batch-runtime", parentRunId);
  const planningRoot = path.join(transientRoot, "planning");
  const planning = await workflowRunner({
    ...workflowInput,
    configOverrides: {
      ...workflowInput.configOverrides,
      runRoot: path.join(planningRoot, "records"),
      artifactRoot: path.join(planningRoot, "artifacts"),
      reportRoot: path.join(planningRoot, "reports"),
      workspaceRoot: path.join(planningRoot, "workspaces"),
      runtimeDshHomeRoot: path.join(planningRoot, "runtime-homes"),
    },
    runId: parentRunId,
    stopAfter: "PLAN",
  });
  if (planning.status !== "COMPLETED") {
    return Object.freeze({
      ...planning,
      caseConcurrency: CASE_CONCURRENCY,
      caseResults: Object.freeze([]),
    });
  }

  const selection = selectionFromSummary(planning);
  let queue = caseQueue(selection);
  if (selectedCaseId !== undefined) {
    const requested = validateStableId(selectedCaseId, "selectedCaseId");
    queue = queue.filter((item) => item.caseId === requested);
    if (queue.length === 0) throw new Error("--case does not match the frozen Planner result");
  }
  const limit = stopAfterCase === true ? 1 : maxCases;
  if (limit !== undefined) queue = queue.slice(0, limit);

  const caseResults: BatchCaseSummary[] = [];
  for (let groupStart = 0; groupStart < queue.length; groupStart += CASE_CONCURRENCY) {
    if (workflowInput.signal?.aborted === true) break;
    const group = queue.slice(groupStart, groupStart + CASE_CONCURRENCY);
    const completed = await Promise.all(group.map(async (item, groupIndex) => {
      const ordinal = groupStart + groupIndex;
      const executionRunId = validateStableId(`${parentRunId}.c${ordinal + 1}`, "executionRunId");
      const isolatedRoot = path.join(transientRoot, executionRunId);
      onProgress?.(`starting ${ordinal + 1}/${queue.length}: ${item.caseId}`);
      const result = await workflowRunner({
        ...workflowInput,
        configOverrides: {
          ...workflowInput.configOverrides,
          runRoot: path.join(isolatedRoot, "records"),
          artifactRoot: path.join(isolatedRoot, "artifacts"),
          reportRoot: path.join(isolatedRoot, "reports"),
          workspaceRoot: path.join(isolatedRoot, "workspaces"),
          runtimeDshHomeRoot: path.join(isolatedRoot, "runtime-homes"),
        },
        runId: executionRunId,
        precomputedDatasetSelection: selection,
        executionCase: {
          datasetId: String(item.datasetId),
          caseIndex: item.caseIndex,
          resultRunId: parentRunId,
          resultCaseId: item.caseId,
        },
      });
      // Case Bundle 已原子落盘后，删除其隔离运行区；最终 var 只保留精简结果，不重复保存内部 records/artifacts。
      if (result.caseBundlePath !== undefined) {
        await rm(isolatedRoot, { recursive: true, force: true });
      }
      onProgress?.(`finished ${ordinal + 1}/${queue.length}: ${item.caseId} (${result.status})`);
      return Object.freeze({
        caseId: item.caseId,
        datasetId: String(item.datasetId),
        caseIndex: item.caseIndex,
        executionRunId,
        status: result.status,
        ...(result.gate === undefined ? {} : { gate: result.gate }),
        exitCode: result.exitCode,
        ...(result.operationalHealth === undefined ? {} : { operationalHealth: result.operationalHealth }),
        failureGroups: result.failureGroups,
        reasonCodes: result.reasonCodes,
        ...(result.caseBundlePath === undefined ? {} : { caseBundlePath: result.caseBundlePath }),
        ...(result.reportHtml === undefined ? {} : { reportHtml: result.reportHtml }),
        dshSessionIds: Object.freeze(result.dshSessionIds ?? []),
      }) satisfies BatchCaseSummary;
    }));
    caseResults.push(...completed);
    if (completed.some((result) => result.status !== "COMPLETED" || result.operationalHealth === "FAILED")) break;
  }

  const gate = aggregateGate(caseResults);
  const cancelled = workflowInput.signal?.aborted === true || caseResults.some((item) => item.status === "CANCELLED");
  const planUnsatisfiable = caseResults.some((item) => item.status === "PLAN_UNSATISFIABLE");
  const failed = caseResults.some((item) => item.status === "FAILED" || item.operationalHealth === "FAILED");
  const exitCode: WorkflowSummary["exitCode"] = cancelled ? 130 : planUnsatisfiable ? 2 : failed ? 4 : gate === "FAIL" ? 1 : gate === "UNEVALUABLE" ? 3 : 0;
  const status: WorkflowSummary["status"] = cancelled ? "CANCELLED" : planUnsatisfiable ? "PLAN_UNSATISFIABLE" : failed ? "FAILED" : "COMPLETED";
  const firstBundle = caseResults.find((item) => item.caseBundlePath !== undefined)?.caseBundlePath;
  const summary: BatchWorkflowSummary = Object.freeze({
    ...planning,
    command: "run" as const,
    status,
    runId: parentRunId,
    ...(gate === undefined ? {} : { gate }),
    operationalHealth: failed ? "FAILED" : "HEALTHY",
    securityIsolation: "SESSION_SEPARATED" as const,
    caseConcurrency: CASE_CONCURRENCY,
    failureGroups: Object.freeze([...new Set(caseResults.flatMap((item) => item.failureGroups))]),
    reasonCodes: Object.freeze([...new Set(caseResults.flatMap((item) => item.reasonCodes))]),
    recordsPath: firstBundle === undefined ? planning.recordsPath : path.dirname(path.dirname(firstBundle)),
    exitCode,
    caseResults: Object.freeze(caseResults),
  });
  const runSummaryPath = await commitRunSummary(summary);
  await rm(transientRoot, { recursive: true, force: true });
  return runSummaryPath === undefined ? summary : Object.freeze({ ...summary, runSummaryPath });
}
