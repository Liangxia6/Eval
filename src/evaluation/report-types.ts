/**
 * 文件职责：定义报告视图与构建输入的数据结构，不执行投影、判定或渲染。
 * 交互：report.ts 负责填充这些结构，报告渲染器只读取 ReportViewModel。
 * 公开接口：ReportViewInput、ReportViewModel 及其组成视图类型。
 */
import type {
  ArtifactRef,
  CheckOutcome,
  CheckResult,
  CollectionStatus,
  EvaluationPlan,
  EvaluationRun,
  ExecutionAttempt,
  EvidenceClosure,
  EvidenceContract,
  EvidenceRecord,
  FileDiff,
  FileSnapshot,
  Finding,
  GateDecision,
  InspectionSnapshot,
  JsonValue,
  JudgementRecord,
  OperationalHealth,
  RawObservation,
  ResetVerification,
  SourceDescriptor,
  TargetSnapshot,
} from "../core/models.js";
import type { FailureRecord } from "../core/errors.js";

/** 状态页十步时间线允许的展示状态。 */
export type WorkflowStepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED";

/** 单个工作流步骤的展示投影，关联对象、故障分组和排障提示。 */
export interface WorkflowStepView {
  readonly number: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
  readonly label: string;
  readonly status: WorkflowStepStatus;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly objectRefs: readonly string[];
  readonly failureGroups: readonly string[];
  readonly hintCode?: string;
}

/** 观测来源及其采集完整性/健康状态的展示投影。 */
export interface SourceView {
  readonly sourceId: string;
  readonly sourceType: string;
  readonly trust: string;
  readonly completeness: string;
  readonly health: string;
  readonly gaps: readonly string[];
}

/** 面向报告的脱敏 Finding 投影及其证据 ID。 */
export interface FindingView {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

/** 串联 Closure、Judgement、CheckResult 和 Finding 的单检查展示投影。 */
export interface CheckView {
  readonly checkResultId: string;
  readonly checkId: string;
  readonly judgementId: string;
  readonly closureId: string;
  readonly closureState: string;
  readonly judgementStatus: string;
  readonly outcome: CheckOutcome;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly findings: readonly FindingView[];
}

/** 一个标签在本次计划中绑定的 Metric、Judge、证据输入和最终结果。 */
export interface LabelEvaluationView {
  readonly labelId: string;
  readonly metricId: string;
  readonly checkId: string;
  readonly judgeId: string;
  readonly evaluationMode: "TRACE" | "OUTPUT_STATE" | "MIXED" | "INPUT_OUTPUT";
  readonly requiredEvidenceTypes: readonly string[];
  readonly metricParameters: JsonValue;
  readonly required: boolean;
  readonly hardGate: boolean;
}

/** EvidenceRecord 的下钻信息，保留其来源层级和原始观测/Artifact 关联。 */
export interface EvidenceDrilldownView {
  readonly evidenceId: string;
  readonly factType: string;
  readonly layer: "NORMALIZED" | "DERIVED";
  readonly relationship: "DIRECT" | "DERIVED";
  readonly authority: string;
  readonly trust: string;
  readonly completeness: string;
  readonly validity: string;
  readonly observationIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly derivationRuleId?: string;
}

/** RawObservation 的定位投影，用于从报告追溯 JSONL 字节区间或文件快照。 */
export interface RawObservationDrilldownView {
  readonly observationId: string;
  readonly sourceId: string;
  readonly sourceType: string;
  readonly trust: string;
  readonly externalEventType: string;
  readonly rawDigest: string;
  readonly artifactId?: string;
  readonly lineNumber?: number;
  readonly byteStart?: number;
  readonly byteEnd?: number;
  readonly association?: string;
  readonly snapshotId?: string;
  readonly phase?: string;
}

/** 文件快照及条目级状态的报告投影。 */
export interface FileSnapshotDrilldownView {
  readonly snapshotId: string;
  readonly phase: string;
  readonly completeness: string;
  readonly digest: string;
  readonly entries: readonly {
    readonly portablePath: string;
    readonly entryType: string;
    readonly mode: number;
    readonly byteLength?: number;
    readonly contentDigest?: string;
    readonly linkTarget?: string;
    readonly resolvedWithinRoot: boolean;
    readonly readError?: string;
  }[];
}

/** 本次 Target 进程真正收到的任务、退出事实和可公开 stdout/stderr。 */
export interface ExecutionDataView {
  readonly task: string;
  readonly terminationKind?: string;
  readonly exitCode?: number;
  readonly signal?: string;
  readonly pid?: number;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly durationMs?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutCapturedBytes?: number;
  readonly stderrCapturedBytes?: number;
  readonly stdoutCaptureTruncated?: boolean;
  readonly stderrCaptureTruncated?: boolean;
  readonly stdoutReportTruncated?: boolean;
  readonly stderrReportTruncated?: boolean;
  readonly stdoutArtifactId?: string;
  readonly stderrArtifactId?: string;
  readonly dshSessionIds?: readonly string[];
}

/** 从已提交 PROTOCOL_LIFECYCLE 事实提取的真实事件统计和工具调用。 */
export interface TraceDataView {
  readonly sessionIds: readonly string[];
  readonly eventCount: number;
  readonly eventTypeCounts: readonly { readonly eventType: string; readonly count: number }[];
  readonly toolCalls: readonly {
    readonly callId: string;
    readonly toolName: string;
    readonly at: string;
    readonly argumentsCaptured: string;
    readonly completed: boolean;
  }[];
  readonly model?: string;
  readonly provider?: string;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
    readonly cacheReadTokens: number;
  };
}

/** 真正进入 Judge 闭包的少量证据事实；不把全部诊断事件伪装成评分依据。 */
export interface DecisionEvidenceView extends EvidenceDrilldownView {
  readonly factValue: JsonValue;
}

/** 文件 Diff 的精简报告投影，列出变化路径及未变化计数。 */
export interface FileDiffDrilldownView {
  readonly diffId: string;
  readonly digest: string;
  readonly changes: readonly {
    readonly portablePath: string;
    readonly kind: string;
  }[];
  readonly unchangedCount: number;
}

/** report.json 内持久化的规范化展示模型，也是所有 HTML 渲染器的唯一事实输入。 */
export interface ReportViewModel {
  readonly runId: string;
  readonly targetSummary: string;
  readonly fixture: boolean;
  readonly securityIsolation: "AGENT_SEPARATED" | "SESSION_SEPARATED" | "PROCESS_FIXTURE" | "NOT_VERIFIED";
  readonly currentPhase: string;
  readonly runState: string;
  readonly gate?: CheckOutcome;
  readonly gateAbsenceReason?: string;
  readonly operationalHealth: OperationalHealth;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly timeline: readonly WorkflowStepView[];
  readonly execution?: ExecutionDataView;
  readonly trace: TraceDataView;
  readonly decisionEvidence: readonly DecisionEvidenceView[];
  readonly staticProfile?: {
    readonly dshVersion: string;
    readonly probeStatus: string;
    readonly driverStatus: string;
    readonly permissionPreset: string;
    readonly sandboxMode: string;
    readonly toolNames: readonly string[];
    readonly limitationCount: number;
  };
  readonly plannerMatch?: {
    /** 由统一 Planner 所选 Dataset 的既有标签确定性求并集。 */
    readonly evaluationLabelIds?: readonly string[];
    readonly requestedLabelIds: readonly string[];
    readonly selectedLabelIds: readonly string[];
    readonly selectedDatasetIds: readonly string[];
    readonly scenarioId: string;
    readonly environmentId: string;
    readonly selectionRule: "ALL_SELECTED_LABELS_COVERED";
  };
  readonly labelEvaluations?: readonly LabelEvaluationView[];
  readonly planSummary: {
    readonly caseCount: 1;
    readonly attemptCount: 1;
    readonly checkIds: readonly string[];
    readonly scenarioId?: string;
    readonly datasetIds?: readonly string[];
    readonly labelIds?: readonly string[];
    readonly environmentId?: string;
    readonly environmentObserverSourceRequirementId?: string;
    readonly inputPaths?: readonly string[];
    readonly allowedPaths?: readonly string[];
    readonly forbiddenPaths?: readonly string[];
    readonly deadlineMs?: number;
  };
  readonly sources: readonly SourceView[];
  readonly checks: readonly CheckView[];
  readonly evidence: readonly EvidenceDrilldownView[];
  readonly rawObservations: readonly RawObservationDrilldownView[];
  readonly fileSnapshots: readonly FileSnapshotDrilldownView[];
  readonly fileDiffs: readonly FileDiffDrilldownView[];
  readonly reset: {
    readonly result: string;
    readonly environmentState: string;
    readonly differenceSummary?: JsonValue;
  };
  readonly failures: readonly {
    readonly category: string;
    readonly group: string;
    readonly actor: string;
    readonly reasonCode: string;
    readonly message: string;
  }[];
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly artifactType: string;
    readonly logicalName: string;
    readonly mediaType: string;
    readonly portablePath: string;
    readonly byteLength: number;
    readonly digest: string;
    readonly redactionState: string;
  }[];
}

/** buildReportViewModel 接收的完整领域对象图；函数会先验证所有摘要与引用链。 */
export interface ReportViewInput {
  readonly run: EvaluationRun;
  readonly target: TargetSnapshot;
  readonly inspection?: InspectionSnapshot;
  readonly evaluationLabelIds?: readonly string[];
  readonly attempt: ExecutionAttempt;
  readonly evaluationPlan?: EvaluationPlan;
  readonly fixture: boolean;
  readonly securityIsolation: "AGENT_SEPARATED" | "SESSION_SEPARATED" | "PROCESS_FIXTURE" | "NOT_VERIFIED";
  readonly sources: readonly SourceDescriptor[];
  readonly collectionStatuses: readonly CollectionStatus[];
  readonly evidenceContracts: readonly EvidenceContract[];
  readonly closures: readonly EvidenceClosure[];
  readonly judgements: readonly JudgementRecord[];
  readonly checkResults: readonly CheckResult[];
  readonly evidence: readonly EvidenceRecord[];
  readonly rawObservations: readonly RawObservation[];
  readonly fileSnapshots: readonly FileSnapshot[];
  readonly fileDiffs: readonly FileDiff[];
  readonly findings: readonly Finding[];
  readonly gate?: GateDecision;
  readonly gateAbsenceReason?: string;
  readonly resetVerification?: ResetVerification;
  readonly environmentState: string;
  readonly failures: readonly FailureRecord[];
  readonly artifacts: readonly ArtifactRef[];
  readonly timeline: readonly WorkflowStepView[];
  readonly currentPhase: string;
  readonly execution?: ExecutionDataView;
}
