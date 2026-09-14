import { renderRunReport } from "../reporting/batch-html.js";
import { aggregateScores } from "../evaluation/scoring.js";
/**
 * 文件职责：把一次统一 Planner 结果展开为互不重复的 Case，并复用单 Case Workflow。
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
import { resolveExplicitCase } from "../datasets/case-selection.js";
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
  readonly scores: NonNullable<WorkflowSummary["scores"]>;
  readonly exitCode: WorkflowSummary["exitCode"];
  readonly operationalHealth?: WorkflowSummary["operationalHealth"];
  readonly failureGroups: WorkflowSummary["failureGroups"];
  readonly reasonCodes: WorkflowSummary["reasonCodes"];
  readonly caseBundlePath?: string;
  readonly reportHtml?: string;
  readonly dshSessionIds: readonly string[];
}

export interface BatchWorkflowSummary extends WorkflowSummary {
  readonly caseConcurrency: 1;
  readonly caseResults: readonly BatchCaseSummary[];
  readonly runSummaryPath?: string;
}

/** 当前 MVP 串行执行，确保每个 Case 的 Session 和资源占用容易观测。 */
const CASE_CONCURRENCY = 1 as const;

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
  return String(datasetId).replace(/^dataset\./u, "").replace(/\/v[1-9][0-9]*$/u, "");
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

async function commitRunSummary(summary: BatchWorkflowSummary): Promise<{
  readonly summaryPath: string;
  readonly reportHtmlPath: string;
} | undefined> {
  const bundle = summary.caseResults.find((result) => result.caseBundlePath !== undefined)?.caseBundlePath;
  if (bundle === undefined) return undefined;
  const runDirectory = path.dirname(path.dirname(bundle));
  const destination = path.join(runDirectory, "run.json");
  const temporary = `${destination}.tmp`;
  const reportHtmlPath = path.join(runDirectory, "report.html");
  const reportTemporary = `${reportHtmlPath}.tmp`;
  await mkdir(runDirectory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await writeFile(reportTemporary, renderRunReport(summary), { flag: "wx", mode: 0o600 });
  await rename(temporary, destination);
  await rename(reportTemporary, reportHtmlPath);
  return { summaryPath: destination, reportHtmlPath };
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
  const explicit = selectedCaseId === undefined ? undefined : await resolveExplicitCase({
    ...workflowInput, selector: selectedCaseId,
  });
  if (explicit !== undefined) {
    onProgress?.(`explicit case: ${explicit.item.caseId} -> ${explicit.questionPath} (model selection skipped)`);
  }
  const planning = await workflowRunner({
    ...workflowInput,
    ...(explicit === undefined ? {} : {
      precomputedDatasetSelection: explicit.selection,
      executionCase: { ...explicit.item, resultRunId: parentRunId, resultCaseId: explicit.item.caseId },
    }),
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

  const selection = explicit?.selection ?? selectionFromSummary(planning);
  let queue = explicit === undefined ? caseQueue(selection) : [explicit.item];
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
        scores: result.scores ?? [],
        exitCode: result.exitCode,
        ...(result.operationalHealth === undefined ? {} : { operationalHealth: result.operationalHealth }),
        failureGroups: result.failureGroups,
        reasonCodes: result.reasonCodes,
        ...(result.caseBundlePath === undefined ? {} : { caseBundlePath: result.caseBundlePath }),
        ...(result.caseBundlePath === undefined && result.reportHtml === undefined
          ? {}
          : { reportHtml: result.caseBundlePath === undefined ? result.reportHtml! : path.join(result.caseBundlePath, "report.html") }),
        dshSessionIds: Object.freeze(result.dshSessionIds ?? []),
      }) satisfies BatchCaseSummary;
    }));
    caseResults.push(...completed);
    if (completed.some((result) => result.status !== "COMPLETED" || result.operationalHealth === "FAILED")) break;
  }

  const scores=caseResults.flatMap(result=>result.scores);
  const dimensions=aggregateScores(scores);
  const cancelled = workflowInput.signal?.aborted === true || caseResults.some((item) => item.status === "CANCELLED");
  const planUnsatisfiable = caseResults.some((item) => item.status === "PLAN_UNSATISFIABLE");
  const failed = caseResults.some((item) => item.status === "FAILED" || item.operationalHealth === "FAILED" || item.exitCode === 4);
  const exitCode: WorkflowSummary["exitCode"] = cancelled ? 130 : planUnsatisfiable ? 2 : failed ? 4 : 0;
  const status: WorkflowSummary["status"] = cancelled ? "CANCELLED" : planUnsatisfiable ? "PLAN_UNSATISFIABLE" : failed ? "FAILED" : "COMPLETED";
  const firstBundle = caseResults.find((item) => item.caseBundlePath !== undefined)?.caseBundlePath;
  const summary: BatchWorkflowSummary = Object.freeze({
    ...planning,
    command: "run" as const,
    status,
    runId: parentRunId,
    scores, dimensions,
    operationalHealth: failed ? "FAILED" : "HEALTHY",
    securityIsolation: "SESSION_SEPARATED" as const,
    caseConcurrency: CASE_CONCURRENCY,
    failureGroups: Object.freeze([...new Set(caseResults.flatMap((item) => item.failureGroups))]),
    reasonCodes: Object.freeze([...new Set(caseResults.flatMap((item) => item.reasonCodes))]),
    recordsPath: firstBundle === undefined ? planning.recordsPath : path.dirname(path.dirname(firstBundle)),
    exitCode,
    caseResults: Object.freeze(caseResults),
  });
  const committedRun = await commitRunSummary(summary);
  // Preserve the transient tree so Probe, stdout/stderr, and execution records
  // remain available even when Judge or report delivery fails.
  return committedRun === undefined
    ? summary
    : Object.freeze({
        ...summary,
        reportHtml: committedRun.reportHtmlPath,
        runSummaryPath: committedRun.summaryPath,
      });
}
