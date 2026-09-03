/**
 * 文件职责：汇总评测对象图，生成权威 EvaluationReport、可序列化报告文档及静态 HTML 视图。
 * 核心流程：稳定化报告引用，验证完整对象图，投影为 ReportViewModel，将视图与渲染器版本纳入摘要后输出最终报告或运行状态页。
 * 真实交互：上游消费 planning、observation、closure、judging、scoring 和 reset 阶段的已提交记录；下游由 ArtifactStore 保存 report.json/report.html 并更新 status.html。
 * 公开接口：报告构建/视图/文档相关类型，以及 buildEvaluationReport、buildReportViewModel、buildReportDocument、序列化/解析和两类 HTML 渲染函数。
 */
import {
  ContractViolation,
  canonicalJson,
  digestEquals,
  digestValue,
  validateContentDigest,
  validateScope,
  validateStableId,
  withContentDigest,
  type ArtifactRef,
  type CheckOutcome,
  type CheckResult,
  type CollectionStatus,
  type ContentDigest,
  type EvaluationCase,
  type EvaluationPlan,
  type EvaluationReport,
  type EvaluationRun,
  type ExecutionAttempt,
  type EvidenceClosure,
  type EvidenceRecord,
  type FileDiff,
  type FileSnapshot,
  type Finding,
  type GateDecision,
  type JudgementRecord,
  type JsonValue,
  type OperationalHealth,
  type Ref,
  type RawObservation,
  type ResetVerification,
  type ScopeRef,
  type SourceDescriptor,
  type TargetSnapshot,
} from "../core/models.js";
import { failureDisplayGroup, type FailureRecord } from "../core/errors.js";

/** 构建权威 EvaluationReport 索引记录所需的 Scope、对象 Ref 和运行元数据。 */
export interface BuildEvaluationReportInput {
  readonly reportId: string;
  readonly scope: ScopeRef;
  readonly runRef: Ref<EvaluationRun>;
  readonly targetSnapshotRef: Ref<TargetSnapshot>;
  readonly planRefs: readonly Ref[];
  readonly caseRef: Ref<EvaluationCase>;
  readonly attemptRef: Ref<ExecutionAttempt>;
  readonly sourceRefs: readonly Ref<SourceDescriptor>[];
  readonly collectionStatusRefs: readonly Ref<CollectionStatus>[];
  readonly closureRefs: readonly Ref<EvidenceClosure>[];
  readonly judgementRefs: readonly Ref<JudgementRecord>[];
  readonly checkResultRefs: readonly Ref<CheckResult>[];
  readonly gateDecisionRef?: Ref<GateDecision>;
  readonly resetVerificationRef?: Ref<ResetVerification>;
  readonly failureRefs: readonly Ref<FailureRecord>[];
  readonly operationalHealth: OperationalHealth;
  readonly artifactRefs: readonly Ref<ArtifactRef>[];
  readonly createdAt: string;
  readonly producerVersion: string;
}

/** 应用编排层调用，稳定化所有已提交 Ref 并创建带内容摘要的 EvaluationReport。 */
export function buildEvaluationReport(input: BuildEvaluationReportInput): EvaluationReport {
  const scope = validateScope(input.scope);
  if (scope.runId === undefined || input.runRef.id !== scope.runId) {
    throw new ContractViolation("SCOPE_MISMATCH", "EvaluationReport Run Ref differs from Scope");
  }
  return withContentDigest({
    schema: "dsheval.mvp.report/v1" as const,
    reportId: validateStableId<"ReportId">(input.reportId, "reportId"),
    scope,
    runRef: input.runRef,
    targetSnapshotRef: input.targetSnapshotRef,
    planRefs: stableRefs(input.planRefs),
    caseRef: input.caseRef,
    attemptRef: input.attemptRef,
    sourceRefs: stableRefs(input.sourceRefs),
    collectionStatusRefs: stableRefs(input.collectionStatusRefs),
    closureRefs: stableRefs(input.closureRefs),
    judgementRefs: stableRefs(input.judgementRefs),
    checkResultRefs: stableRefs(input.checkResultRefs),
    ...(input.gateDecisionRef === undefined ? {} : { gateDecisionRef: input.gateDecisionRef }),
    ...(input.resetVerificationRef === undefined
      ? {}
      : { resetVerificationRef: input.resetVerificationRef }),
    failureRefs: stableRefs(input.failureRefs),
    operationalHealth: input.operationalHealth,
    artifactRefs: stableRefs(input.artifactRefs),
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
}

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
    readonly contentDigest?: string;
    readonly linkTarget?: string;
    readonly resolvedWithinRoot: boolean;
    readonly readError?: string;
  }[];
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
  readonly securityIsolation: "AGENT_SEPARATED" | "PROCESS_FIXTURE" | "NOT_VERIFIED";
  readonly currentPhase: string;
  readonly runState: string;
  readonly gate?: CheckOutcome;
  readonly gateAbsenceReason?: string;
  readonly operationalHealth: OperationalHealth;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly timeline: readonly WorkflowStepView[];
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
    readonly logicalName: string;
    readonly portablePath: string;
    readonly digest: string;
  }[];
}

/** buildReportViewModel 接收的完整领域对象图；函数会先验证所有摘要与引用链。 */
export interface ReportViewInput {
  readonly run: EvaluationRun;
  readonly target: TargetSnapshot;
  readonly attempt: ExecutionAttempt;
  readonly evaluationPlan?: EvaluationPlan;
  readonly fixture: boolean;
  readonly securityIsolation: "AGENT_SEPARATED" | "PROCESS_FIXTURE" | "NOT_VERIFIED";
  readonly sources: readonly SourceDescriptor[];
  readonly collectionStatuses: readonly CollectionStatus[];
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
}

/** 将已验证的领域对象图投影成稳定、脱敏且便于静态渲染的 ReportViewModel。 */
export function buildReportViewModel(input: ReportViewInput): ReportViewModel {
  validateReportViewGraph(input);
  validateTimeline(input.timeline);
  const statusBySource = new Map(
    input.collectionStatuses.map((status) => [String(status.sourceRef.id), status] as const),
  );
  const closureByCheck = new Map(
    input.closures.map((closure) => [String(closure.checkId), closure] as const),
  );
  const judgementByCheck = new Map(
    input.judgements.map((judgement) => [String(judgement.checkId), judgement] as const),
  );
  const findingsByRef = new Map(input.findings.map((finding) => [String(finding.findingId), finding] as const));
  const checks = [...input.checkResults]
    .sort((left, right) => String(left.checkId).localeCompare(String(right.checkId), "en"))
    .map((result): CheckView => {
      const closure = closureByCheck.get(String(result.checkId));
      const judgement = judgementByCheck.get(String(result.checkId));
      return {
        checkResultId: String(result.checkResultId),
        checkId: String(result.checkId),
        judgementId: judgement === undefined ? "MISSING" : String(judgement.judgementId),
        closureId: closure === undefined ? "MISSING" : String(closure.closureId),
        closureState: closure?.state ?? "MISSING",
        judgementStatus: judgement?.status ?? "MISSING",
        outcome: result.outcome,
        reasonCodes: [...result.reasonCodes].sort(),
        evidenceIds: (closure?.authorizedEvidenceRefs ?? [])
          .map((ref) => String(ref.id))
          .sort(),
        findings: (judgement?.findingRefs ?? [])
          .map((ref) => findingsByRef.get(String(ref.id)))
          .filter((finding): finding is Finding => finding !== undefined)
          .map((finding) => ({
            code: finding.code,
            severity: finding.severity,
            message: finding.messageRedacted,
            evidenceIds: finding.evidenceRefs.map((ref) => String(ref.id)).sort(),
          }))
          .sort((left, right) => left.code.localeCompare(right.code, "en")),
      };
    });

  return {
    runId: String(input.run.runId),
    targetSummary: `FULL_AGENT / ${input.target.dshPackageVersion ?? "UNKNOWN"}`,
    fixture: input.fixture,
    securityIsolation: input.securityIsolation,
    currentPhase: input.currentPhase,
    runState: input.run.state,
    ...(input.gate === undefined ? {} : { gate: input.gate.verdict }),
    ...(input.gate === undefined && input.gateAbsenceReason !== undefined
      ? { gateAbsenceReason: input.gateAbsenceReason }
      : {}),
    operationalHealth: input.run.operationalHealth,
    startedAt: input.run.createdAt,
    updatedAt: input.run.updatedAt,
    timeline: [...input.timeline].sort((left, right) => left.number - right.number),
    planSummary: {
      caseCount: 1,
      attemptCount: 1,
      checkIds: input.evaluationPlan === undefined
        ? checks.map((check) => check.checkId)
        : input.evaluationPlan.casePlan.checkIds.map(String),
      ...(input.evaluationPlan === undefined
        ? {}
        : {
            scenarioId: String(input.evaluationPlan.casePlan.scenarioId),
            datasetIds: [String(input.evaluationPlan.casePlan.datasetId)],
            labelIds: input.evaluationPlan.casePlan.labelBindings
              .map((binding) => String(binding.labelId))
              .sort(),
            environmentId: String(input.evaluationPlan.casePlan.environmentId),
            environmentObserverSourceRequirementId: String(
              input.evaluationPlan.casePlan.environmentObserverSourceRequirementId,
            ),
            inputPaths: planInputPaths(input.evaluationPlan),
            allowedPaths: input.evaluationPlan.casePlan.allowedPaths.map(String).sort(),
            forbiddenPaths: input.evaluationPlan.casePlan.forbiddenPaths.map(String).sort(),
            deadlineMs: input.evaluationPlan.casePlan.deadlineMs,
          }),
    },
    sources: [...input.sources]
      .sort((left, right) => String(left.sourceId).localeCompare(String(right.sourceId), "en"))
      .map((source) => {
        const status = statusBySource.get(String(source.sourceId));
        return {
          sourceId: String(source.sourceId),
          sourceType: source.sourceType,
          trust: source.trust,
          completeness: status?.completeness ?? "尚未产生",
          health: status?.health ?? "尚未产生",
          gaps: (status?.gaps ?? []).map((gap) => gap.reasonCode).sort(),
        };
      }),
    checks,
    evidence: [...input.evidence]
      .sort((left, right) => String(left.evidenceId).localeCompare(String(right.evidenceId), "en"))
      .map((evidence) => ({
        evidenceId: String(evidence.evidenceId),
        factType: evidence.factType,
        layer: evidence.derivationRuleId === undefined ? "NORMALIZED" as const : "DERIVED" as const,
        relationship: evidence.derivationRuleId === undefined ? "DIRECT" as const : "DERIVED" as const,
        authority: evidence.authority,
        trust: evidence.trust,
        completeness: evidence.completeness,
        validity: evidence.validity,
        observationIds: evidence.observationRefs.map((ref) => String(ref.id)).sort(),
        artifactIds: evidence.artifactRefs.map((ref) => String(ref.id)).sort(),
        ...(evidence.derivationRuleId === undefined
          ? {}
          : { derivationRuleId: String(evidence.derivationRuleId) }),
      })),
    rawObservations: [...input.rawObservations]
      .sort((left, right) => String(left.observationId).localeCompare(String(right.observationId), "en"))
      .map((observation) => rawObservationView(observation, input.sources)),
    fileSnapshots: [...input.fileSnapshots]
      .sort((left, right) => String(left.snapshotId).localeCompare(String(right.snapshotId), "en"))
      .map((snapshot) => ({
        snapshotId: String(snapshot.snapshotId),
        phase: snapshot.phase,
        completeness: snapshot.completeness,
        digest: snapshot.snapshotDigest.value,
        entries: snapshot.entries.map((entry) => ({
          portablePath: String(entry.portablePath),
          entryType: entry.entryType,
          ...(entry.contentDigest === undefined ? {} : { contentDigest: entry.contentDigest.value }),
          ...(entry.linkTarget === undefined ? {} : { linkTarget: entry.linkTarget }),
          resolvedWithinRoot: entry.resolvedWithinRoot,
          ...(entry.readError === undefined ? {} : { readError: entry.readError }),
        })),
      })),
    fileDiffs: [...input.fileDiffs]
      .sort((left, right) => String(left.diffId).localeCompare(String(right.diffId), "en"))
      .map((diff) => ({
        diffId: String(diff.diffId),
        digest: diff.diffDigest.value,
        changes: [...diff.added, ...diff.removed, ...diff.modified, ...diff.typeChanged]
          .map((change) => ({ portablePath: String(change.portablePath), kind: change.kind }))
          .sort((left, right) =>
            `${left.portablePath}\u0000${left.kind}`.localeCompare(
              `${right.portablePath}\u0000${right.kind}`,
              "en",
            ),
          ),
        unchangedCount: diff.unchangedCount,
      })),
    reset: {
      result: input.resetVerification?.result ?? "尚未产生",
      environmentState: input.environmentState,
      ...(input.resetVerification === undefined
        ? {}
        : { differenceSummary: input.resetVerification.differenceSummary }),
    },
    failures: [...input.failures]
      .sort((left, right) => String(left.failureId).localeCompare(String(right.failureId), "en"))
      .map((failure) => ({
        category: failure.category,
        group: failureDisplayGroup(failure),
        actor: failure.actor,
        reasonCode: failure.reasonCode,
        message: failure.messageRedacted,
      })),
    artifacts: [...input.artifacts]
      .filter((artifact) => artifact.sensitivity === "EXPORTABLE")
      .sort((left, right) => left.logicalName.localeCompare(right.logicalName, "en"))
      .map((artifact) => ({
        logicalName: artifact.logicalName,
        portablePath: artifact.portablePath,
        digest: artifact.artifactContentDigest.value,
      })),
  };
}

/** 从 EvaluationPlan.seedSpec 提取输入文件路径，供计划摘要和直观版页面展示。 */
function planInputPaths(plan: EvaluationPlan): readonly string[] {
  const entries = plan.casePlan.seedSpec.entries;
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry): entry is Record<string, JsonValue> =>
      entry !== null && typeof entry === "object" && !Array.isArray(entry)
    )
    .filter((entry) => entry.entryType === "FILE" && typeof entry.portablePath === "string")
    .map((entry) => String(entry.portablePath))
    .sort();
}

/** 将单条 RawObservation 与对应 Source 合并为可下钻视图；由 buildReportViewModel 调用。 */
function rawObservationView(
  observation: RawObservation,
  sources: readonly SourceDescriptor[],
): RawObservationDrilldownView {
  const source = sources.find((item) => item.sourceId === observation.sourceRef.id);
  if (source === undefined) {
    throw new ContractViolation("REPORT_GRAPH_INVALID", "RawObservation Source Ref is missing");
  }
  const metadata = observation.captureMetadata;
  const artifactId = observation.payloadArtifactRef === undefined
    ? jsonRefId(metadata.rawArtifactRef)
    : String(observation.payloadArtifactRef.id);
  const snapshotId = jsonRefId(metadata.snapshotRef);
  return {
    observationId: String(observation.observationId),
    sourceId: String(source.sourceId),
    sourceType: source.sourceType,
    trust: source.trust,
    externalEventType: observation.externalEventType,
    rawDigest: observation.rawDigest.value,
    ...(artifactId === undefined ? {} : { artifactId }),
    ...(typeof metadata.lineNumber === "number" ? { lineNumber: metadata.lineNumber } : {}),
    ...(typeof metadata.byteStart === "number" ? { byteStart: metadata.byteStart } : {}),
    ...(typeof metadata.byteEnd === "number" ? { byteEnd: metadata.byteEnd } : {}),
    ...(typeof metadata.association === "string" ? { association: metadata.association } : {}),
    ...(snapshotId === undefined ? {} : { snapshotId }),
    ...(typeof metadata.phase === "string" ? { phase: metadata.phase } : {}),
  };
}

/** 从捕获元数据中的 JSON Ref 安全读取 ID，供 RawObservation 定位使用。 */
function jsonRefId(value: JsonValue | undefined): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

/** 将权威报告索引、展示模型和渲染器版本绑定在同一顶层摘要中的持久化文档。 */
export interface EvaluationReportDocument
  extends Omit<EvaluationReport, "contentDigest"> {
  readonly view: ReportViewModel;
  readonly rendererVersion: string;
  /** 唯一顶层摘要同时约束报告引用、展示事实和渲染器版本。 */
  readonly contentDigest: ContentDigest;
}

/** report.json 必须精确包含的顶层字段白名单。 */
const REPORT_DOCUMENT_REQUIRED_FIELDS = [
  "schema",
  "reportId",
  "scope",
  "runRef",
  "targetSnapshotRef",
  "planRefs",
  "caseRef",
  "attemptRef",
  "sourceRefs",
  "collectionStatusRefs",
  "closureRefs",
  "judgementRefs",
  "checkResultRefs",
  "failureRefs",
  "operationalHealth",
  "artifactRefs",
  "createdAt",
  "producerVersion",
  "view",
  "rendererVersion",
  "contentDigest",
] as const;
/** report.json 允许按运行阶段缺席的可选顶层字段。 */
const REPORT_DOCUMENT_OPTIONAL_FIELDS = new Set(["gateDecisionRef", "resetVerificationRef"]);

/** 把 EvaluationReport 与视图、渲染器版本封装成新的完整性边界，并重算顶层摘要。 */
export function buildReportDocument(
  report: EvaluationReport,
  view: ReportViewModel,
  rendererVersion: string,
): EvaluationReportDocument {
  if (!digestEquals(report.contentDigest, digestValue(report, ["contentDigest"]))) {
    throw new ContractViolation("REPORT_INTEGRITY", "EvaluationReport digest is invalid");
  }
  if (view.runId !== String(report.scope.runId) || view.runId !== String(report.runRef.id)) {
    throw new ContractViolation("REPORT_SCOPE_MISMATCH", "Report view belongs to another Run");
  }
  if (typeof rendererVersion !== "string" || rendererVersion.length === 0) {
    throw new ContractViolation("REPORT_RENDERER_INVALID", "Renderer version is required");
  }
  const { contentDigest: _baseDigest, ...base } = report;
  return withContentDigest({ ...base, view, rendererVersion });
}

/** 验证报告文档后输出带结尾换行的规范 JSON，供 ArtifactStore 持久化。 */
export function serializeReportDocument(document: EvaluationReportDocument): string {
  verifyReportDocument(document);
  return `${canonicalJson(document)}\n`;
}

/** 解析已有 report.json 并验证结构与摘要，供离线重渲染等读取路径使用。 */
export function parseVerifiedReportDocument(json: string): EvaluationReportDocument {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new ContractViolation("REPORT_INVALID_JSON", "report.json is not valid JSON");
  }
  if (!isRecord(value) || !isRecord(value.view)) {
    throw new ContractViolation("REPORT_INVALID_JSON", "report.json has an invalid document shape");
  }
  const document = value as unknown as EvaluationReportDocument;
  verifyReportDocument(document);
  return document;
}

/** 验证权威文档后生成确定、自包含且无脚本的最终 HTML 报告。 */
export function renderReportHtml(document: EvaluationReportDocument): string {
  verifyReportDocument(document);
  return renderHtml("DSHEval Evaluation Report", document.view, true, document.rendererVersion);
}

/** 根据已提交事实生成非权威 status.html；应用层可在运行过程中反复原子替换。 */
export function renderStatusHtml(view: ReportViewModel, rendererVersion: string): string {
  validateTimeline(view.timeline);
  return renderHtml("DSHEval Run Status", view, false, rendererVersion);
}

/** 两个公开渲染入口共用的版本分派器；v3 走直观页面，其余版本保留兼容布局。 */
function renderHtml(
  title: string,
  view: ReportViewModel,
  finalReport: boolean,
  rendererVersion: string,
): string {
  if (rendererVersion === "dsheval-static/v3") {
    return renderIntuitiveHtml(title, view, finalReport, rendererVersion);
  }
  const e = escapeHtml;
  const enhanced = rendererVersion === "dsheval-static/v2";
  const settledSteps = view.timeline.filter((step) =>
    step.status === "SUCCEEDED" || step.status === "FAILED" || step.status === "BLOCKED"
  ).length;
  /** 兼容旧版布局：仅增强模板为各内容区生成导航锚点。 */
  const sectionId = (id: string): string => enhanced ? ` id="${id}"` : "";
  /** 兼容旧版布局：增强模板使用语义状态胶囊，v1 只输出转义文本。 */
  const semanticPill = (value: string): string => enhanced
    ? `<span class="status-pill ${statusTone(value)}">${e(value)}</span>`
    : e(value);
  const gate = view.gate ?? "尚未产生";
  const gateReason = view.gate === undefined && view.gateAbsenceReason !== undefined
    ? `<br><small>Reason: ${e(view.gateAbsenceReason)}</small>`
    : "";
  const compactStepLabels = [
    "Target 冻结",
    "DSH 检查",
    "生成计划",
    "环境预检",
    "Before / Probe",
    "Agent 执行",
    "Evidence 闭合",
    "评测判定",
    "Reset 验证",
    "Gate / 报告",
  ] as const;
  const timeline = view.timeline
    .map((step) => {
      if (!enhanced) {
        return `<li class="step ${statusClass(step.status)}"><div><strong>${step.number}. ${e(step.label)}</strong> <span>${e(step.status)}</span></div><small>${e(step.startedAt ?? "尚未产生")} → ${e(step.endedAt ?? "尚未产生")}</small>${step.objectRefs.length === 0 ? "" : `<div>Refs: ${step.objectRefs.map(e).join(", ")}</div>`}${step.failureGroups.length === 0 ? "" : `<div>Failure: ${step.failureGroups.map(e).join(", ")}</div>`}${step.hintCode === undefined ? "" : `<div>Hint: ${e(troubleshootingHint(step.hintCode))}</div>`}</li>`;
      }
      const expanded = step.status === "RUNNING" || step.status === "FAILED" || step.status === "BLOCKED";
      return `<li class="step ${statusClass(step.status)}" aria-label="${e(`${step.number}. ${step.label}: ${step.status}`)}"><div class="step-head"><span class="step-number">${String(step.number).padStart(2, "0")}</span><span>${e(step.status)}</span></div><strong class="step-label">${e(compactStepLabels[step.number - 1] ?? step.label)}</strong><details${expanded ? " open" : ""}><summary>详情</summary><div class="step-full-label">${e(step.label)}</div><small>${e(step.startedAt ?? "尚未产生")} → ${e(step.endedAt ?? "尚未产生")}</small>${step.objectRefs.length === 0 ? "" : `<div>Refs: ${step.objectRefs.map(e).join(", ")}</div>`}${step.failureGroups.length === 0 ? "" : `<div>Failure: ${step.failureGroups.map(e).join(", ")}</div>`}${step.hintCode === undefined ? "" : `<div>Hint: ${e(troubleshootingHint(step.hintCode))}</div>`}</details></li>`;
    })
    .join("");
  const sources = view.sources
    .map(
      (source) => `<tr><td>${e(source.sourceId)}</td><td>${e(source.sourceType)}</td><td>${semanticPill(source.trust)}</td><td>${semanticPill(source.completeness)}</td><td>${semanticPill(source.health)}</td><td>${source.gaps.map(e).join(", ") || "—"}</td></tr>`,
    )
    .join("");
  const checks = view.checks
    .map((check) => {
      const findings = check.findings
        .map(
          (finding) => `<li><strong>${e(finding.code)}</strong> (${e(finding.severity)}): ${e(finding.message)}<div>Evidence: ${finding.evidenceIds.map((id) => `<a href="#evidence-${safeAnchor(id)}">${e(id)}</a>`).join(", ") || "—"}</div></li>`,
        )
        .join("");
      const evidence = check.evidenceIds
        .map(
          (id) => `<li><a href="#evidence-${safeAnchor(id)}"><code>${e(id)}</code></a></li>`,
        )
        .join("");
      const checkClass = enhanced ? ` check-${outcomeClass(check.outcome) || "pending"}` : "";
      return `<section class="check${checkClass}" id="check-${safeAnchor(check.checkResultId)}"><h3>${e(check.checkId)}: <span class="${outcomeClass(check.outcome)}">${e(check.outcome)}</span></h3><dl><dt>CheckResult</dt><dd><code>${e(check.checkResultId)}</code></dd><dt>Closure</dt><dd id="closure-${safeAnchor(check.closureId)}"><code>${e(check.closureId)}</code> · ${e(check.closureState)}</dd><dt>Judgement</dt><dd id="judgement-${safeAnchor(check.judgementId)}"><code>${e(check.judgementId)}</code> · ${e(check.judgementStatus)}</dd><dt>Reasons</dt><dd>${check.reasonCodes.map(e).join(", ") || "—"}</dd></dl><h4>Findings</h4><ul>${findings || "<li>None</li>"}</ul><h4>Authorized evidence</h4><ul>${evidence || "<li>None</li>"}</ul></section>`;
    })
    .join("");
  const evidenceDetails = view.evidence
    .map((item) => `<article class="drill" id="evidence-${safeAnchor(item.evidenceId)}"><h3>${e(item.evidenceId)}</h3><p><strong>${e(item.layer)}</strong> · ${e(item.factType)} · relation=${e(item.relationship)} · authority=${e(item.authority)} · trust=${e(item.trust)} · ${e(item.completeness)}/${e(item.validity)}</p>${item.derivationRuleId === undefined ? "" : `<p>Derivation: <code>${e(item.derivationRuleId)}</code></p>`}<p>Raw observations: ${item.observationIds.map((id) => `<a href="#raw-${safeAnchor(id)}">${e(id)}</a>`).join(", ") || "—"}</p><p>Artifacts: ${item.artifactIds.map((id) => `<code>${e(id)}</code>`).join(", ") || "—"}</p></article>`)
    .join("");
  const rawDetails = view.rawObservations
    .map((item) => {
      const probeLocation = item.lineNumber === undefined
        ? ""
        : ` · JSONL line ${e(item.lineNumber)} bytes ${e(item.byteStart ?? "?")}..${e(item.byteEnd ?? "?")}`;
      const snapshot = item.snapshotId === undefined
        ? ""
        : ` · Snapshot <a href="#snapshot-${safeAnchor(item.snapshotId)}">${e(item.snapshotId)}</a>${item.phase === undefined ? "" : ` (${e(item.phase)})`}`;
      return `<li id="raw-${safeAnchor(item.observationId)}"><code>${e(item.observationId)}</code> · ${e(item.sourceType)}/${e(item.trust)} · ${e(item.externalEventType)}${probeLocation}${snapshot}${item.artifactId === undefined ? "" : ` · Artifact <code>${e(item.artifactId)}</code>`}<br><small>raw sha256 ${e(item.rawDigest)}${item.association === undefined ? "" : ` · ${e(item.association)}`}</small></li>`;
    })
    .join("");
  const snapshotDetails = view.fileSnapshots
    .map((snapshot) => {
      const entries = snapshot.entries
        .map((entry) => `<tr><td>${e(entry.portablePath)}</td><td>${e(entry.entryType)}</td><td>${e(entry.contentDigest ?? "—")}</td><td>${e(entry.linkTarget ?? "—")}</td><td>${e(entry.resolvedWithinRoot)}</td><td>${e(entry.readError ?? "—")}</td></tr>`)
        .join("");
      return `<article class="drill" id="snapshot-${safeAnchor(snapshot.snapshotId)}"><h3>${e(snapshot.snapshotId)} · ${e(snapshot.phase)} · ${e(snapshot.completeness)}</h3><p>snapshot sha256 <code>${e(snapshot.digest)}</code></p><table><thead><tr><th>Portable path</th><th>Type</th><th>Content digest</th><th>Link target</th><th>Within root</th><th>Read error</th></tr></thead><tbody>${entries || '<tr><td colspan="6">Empty snapshot</td></tr>'}</tbody></table></article>`;
    })
    .join("");
  const diffDetails = view.fileDiffs
    .map((diff) => `<article class="drill"><h3>${e(diff.diffId)}</h3><p>diff sha256 <code>${e(diff.digest)}</code> · unchanged ${e(diff.unchangedCount)}</p><ul>${diff.changes.map((change) => `<li>${e(change.kind)} · ${e(change.portablePath)}</li>`).join("") || "<li>No changes</li>"}</ul></article>`)
    .join("");
  const failures = view.failures
    .map(
      (failure) => `<tr><td>${e(failure.group)}</td><td>${e(failure.category)}</td><td>${e(failure.actor)}</td><td>${e(failure.reasonCode)}</td><td>${e(failure.message)}</td></tr>`,
    )
    .join("");
  const artifacts = view.artifacts
    .map(
      (artifact) => `<li><strong>${e(artifact.logicalName)}</strong>: ${e(artifact.portablePath)} <code>${e(artifact.digest)}</code></li>`,
    )
    .join("");
  const resetDetails =
    view.reset.differenceSummary === undefined
      ? ""
      : `<pre>${e(canonicalJson(view.reset.differenceSummary))}</pre>`;

  const enhancedChrome = enhanced
    ? `<div class="topbar"><div class="brand"><span class="brand-mark">D</span><span>DSHEval <small>Observatory</small></span></div><nav aria-label="页面导航"><a href="#workflow">流程</a><a href="#execution">观测</a><a href="#judging">判定</a><a href="#evidence">证据</a><a href="#failures">故障</a></nav><span class="view-kind">${finalReport ? "SEALED REPORT" : "STATUS SNAPSHOT"}</span></div>`
    : "";
  const progress = enhanced
    ? `<div class="progress-block"><div><span>已结算流程步骤</span><strong>${settledSteps} / 10</strong></div><div class="progress-track" role="progressbar" aria-label="Workflow progress" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${settledSteps}"><span style="width:${settledSteps * 10}%"></span></div></div>`
    : "";
  const operationalStrip = enhanced
    ? `<section class="operational-strip" aria-label="Operational summary"><div><small>Reset verification</small>${semanticPill(view.reset.result)}</div><div><small>Environment</small>${semanticPill(view.reset.environmentState)}</div><div><small>Sources observed</small><strong>${view.sources.length}</strong></div><div><small>Recorded failures</small><strong class="${view.failures.length === 0 ? "pass" : "fail"}">${view.failures.length}</strong></div></section>`
    : "";
  const failureAlert = enhanced && view.failures.length > 0
    ? `<aside class="failure-alert"><div><strong>${view.failures.length} recorded failure${view.failures.length === 1 ? "" : "s"}</strong><span>Agent、Collector、Judge 与 Infrastructure 归因保持独立。</span></div><a href="#failures">查看故障事实 ↓</a></aside>`
    : "";
  const summary = enhanced
    ? `<div>Phase<br><strong>${e(view.currentPhase)}</strong></div><div>Run state<br><strong>${e(view.runState)}</strong></div><div>Gate<br><strong class="${outcomeClass(gate)}">${e(gate)}</strong>${gateReason}</div><div>Health<br><strong>${e(view.operationalHealth)}</strong></div><div>Run<br><strong>${e(view.runId)}</strong></div><div>Target<br><strong>${e(view.targetSummary)}</strong></div><div>Execution class<br><strong>${view.fixture ? "FIXTURE" : "FORMAL"}</strong></div><div>Security isolation<br><strong>${e(view.securityIsolation)}</strong></div>`
    : `<div>Run<br><strong>${e(view.runId)}</strong></div><div>Target<br><strong>${e(view.targetSummary)}</strong></div><div>Execution class<br><strong>${view.fixture ? "FIXTURE" : "FORMAL"}</strong></div><div>Security isolation<br><strong>${e(view.securityIsolation)}</strong></div><div>Phase<br><strong>${e(view.currentPhase)}</strong></div><div>Run state<br><strong>${e(view.runState)}</strong></div><div>Gate<br><strong class="${outcomeClass(gate)}">${e(gate)}</strong>${gateReason}</div><div>Health<br><strong>${e(view.operationalHealth)}</strong></div>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
${rendererStyles(rendererVersion)}</style></head><body${enhanced ? ' class="dsheval-v2"' : ""}>${enhancedChrome === "" ? "" : `\n${enhancedChrome}`}
<header><h1>${e(title)}</h1><div class="summary">${summary}</div>${view.fixture ? `<p class="${enhanced ? "fixture-notice" : "unevaluable"}"><strong>Fixture result:</strong> this Gate does not establish formal VM identity or network isolation.</p>` : ""}<p>${e(view.startedAt)} → ${e(view.updatedAt)}</p></header>
${progress}${operationalStrip}${failureAlert}<section${sectionId("workflow")} class="panel"><h2>十步流程</h2><ol class="timeline">${timeline}</ol></section>
<section${sectionId("planning")} class="panel"><h2>规划</h2><p>Cases: 1 · Attempts: 1 · Checks: ${view.planSummary.checkIds.map(e).join(", ")}</p></section>
<section${sectionId("execution")} class="panel"><h2>执行与环境</h2><table><thead><tr><th>Source</th><th>Type</th><th>Trust</th><th>Completeness</th><th>Health</th><th>Gaps</th></tr></thead><tbody>${sources}</tbody></table><h3>Reset</h3><p>${semanticPill(view.reset.result)} / ${semanticPill(view.reset.environmentState)}</p>${resetDetails}</section>
<section${sectionId("judging")} class="panel"><h2>判定</h2>${checks || "<p>尚未产生 CheckResult</p>"}</section>
<section${sectionId("evidence")} class="panel"><h2>证据下钻</h2><h3>EvidenceRecord</h3>${evidenceDetails || "<p>尚未产生 Evidence</p>"}<h3>RawObservation 定位</h3><ul>${rawDetails || "<li>尚未产生 RawObservation</li>"}</ul><h3>File Snapshot Entries</h3>${snapshotDetails || "<p>尚未产生 File Snapshot</p>"}<h3>File Diff</h3>${diffDetails || "<p>尚未产生 File Diff</p>"}</section>
<section${sectionId("failures")} class="panel"><h2>Failures</h2><table><thead><tr><th>Group</th><th>Category</th><th>Actor</th><th>Reason</th><th>Message</th></tr></thead><tbody>${failures || '<tr><td colspan="5">None</td></tr>'}</tbody></table></section>
<section class="panel"><h2>Artifacts</h2><ul>${artifacts || "<li>None</li>"}</ul></section>
<footer><small>${finalReport ? "Authoritative report view" : "Non-authoritative status view"} · Renderer ${e(rendererVersion)} · No scripts or network dependencies</small></footer>
</body></html>\n`;
}

/** v3 页面为当前内置检查提供的面向用户文案。 */
interface FriendlyCheckCopy {
  readonly title: string;
  readonly question: string;
  readonly success: string;
  readonly pending: string;
}

/** 将已知 CheckId 映射为直观标题/问题/结果文案，未知检查回退为通用表述。 */
function friendlyCheckCopy(checkId: string): FriendlyCheckCopy {
  if (checkId.startsWith("artifact.")) {
    return {
      title: "产物交付",
      question: "是否交付了 Dataset 要求的产物？",
      success: "独立环境观测确认必需产物已经生成。",
      pending: "正在观察工作区中的必需产物。",
    };
  }
  if (checkId.startsWith("tool.")) {
    return {
      title: "工具执行",
      question: "Agent 是否实际完成了要求的工具调用？",
      success: "Trace 中存在符合 Dataset 规则的完整工具调用。",
      pending: "正在等待工具调用与完成记录。",
    };
  }
  if (checkId.startsWith("response.")) {
    return {
      title: "最终回答",
      question: "最终回答是否满足 Dataset 的基本要求？",
      success: "Agent 已提交符合规则的最终回答。",
      pending: "正在等待 Agent 的最终回答。",
    };
  }
  return {
    title: checkId,
    question: "该评分项满足要求吗？",
    success: "评分标准已满足。",
    pending: "尚未产生判定结果。",
  };
}

/** 将单检查三值结果转换为中文展示文本。 */
function friendlyOutcome(outcome: CheckOutcome | undefined): string {
  if (outcome === "PASS") return "通过";
  if (outcome === "FAIL") return "不通过";
  if (outcome === "UNEVALUABLE") return "证据不足";
  return "等待判定";
}

/** 将 Gate 三值结论转换为报告主标题。 */
function friendlyGate(gate: CheckOutcome | undefined): string {
  if (gate === "PASS") return "评测通过";
  if (gate === "FAIL") return "评测未通过";
  if (gate === "UNEVALUABLE") return "暂时无法判定";
  return "评测进行中";
}

/** 将工作流步骤状态转换为中文展示文本。 */
function friendlyStepStatus(status: WorkflowStepStatus): string {
  if (status === "SUCCEEDED") return "完成";
  if (status === "RUNNING") return "进行中";
  if (status === "FAILED") return "失败";
  if (status === "BLOCKED") return "已阻断";
  return "等待";
}

/** 将文件变化枚举转换为中文展示文本。 */
function friendlyChange(kind: string): string {
  if (kind === "ADDED") return "新增";
  if (kind === "REMOVED") return "删除";
  if (kind === "MODIFIED") return "修改";
  if (kind === "TYPE_CHANGED") return "类型变化";
  return kind;
}

/** 为已知 SourceType 提供用户可理解的标题和来源说明。 */
function friendlySource(type: string): { title: string; detail: string } {
  if (type === "FILESYSTEM") {
    return { title: "文件结果", detail: "由 DSHEval 独立读取执行前后的真实文件状态。" };
  }
  if (type === "DSH_PROBE") {
    return { title: "执行过程", detail: "由 DSH Runtime Probe 记录会话、工具调用和结束边界。" };
  }
  return { title: type, detail: "评测过程中采集的证据来源。" };
}

/** 将常见证据、来源及重置状态转换为中文展示文本。 */
function friendlyEvidenceState(value: string): string {
  if (value === "COMPLETE") return "完整";
  if (value === "PARTIAL") return "部分";
  if (value === "INVALID") return "无效";
  if (value === "HEALTHY") return "正常";
  if (value === "DEGRADED") return "降级";
  if (value === "MATCH") return "与干净状态一致";
  if (value === "CLEANED") return "环境已清理";
  return value;
}

/** renderHtml 为 v3 调用的直观报告模板，突出结论、能力标签、进度和技术依据。 */
function renderIntuitiveHtml(
  title: string,
  view: ReportViewModel,
  finalReport: boolean,
  rendererVersion: string,
): string {
  const e = escapeHtml;
  const gateTone = outcomeClass(view.gate ?? "") || "pending";
  const settledSteps = view.timeline.filter((step) =>
    step.status === "SUCCEEDED" || step.status === "FAILED" || step.status === "BLOCKED"
  ).length;
  const scenarioTitle = view.planSummary.scenarioId ?? "尚未生成题目";
  const labelTitles = new Map([
    ["label.artifact-delivery/v1", "产物交付"],
    ["label.instruction-following/v1", "指令遵循"],
    ["label.tool-code/v1", "工具（代码与终端）"],
  ]);
  const labelTitle = view.planSummary.labelIds
    ?.map((labelId) => labelTitles.get(labelId) ?? labelId)
    .join("、") ?? "尚未选择评测指标";
  const datasetTitle = view.planSummary.datasetIds?.join("、") ?? "尚未选择数据集";
  const inputPath = view.planSummary.inputPaths?.[0] ?? "无预置输入文件";
  const outputPath = view.planSummary.allowedPaths?.[0] ?? "output";
  const gateLead = view.gate === "PASS"
    ? "本次计划中的全部必需评测标准均已满足。"
    : view.gate === "FAIL"
      ? "至少一项硬性标准未满足，请查看下方红色评分项。"
      : view.gate === "UNEVALUABLE"
        ? "现有证据不足以形成可靠结论，没有用默认值判为通过。"
        : `当前运行到「${view.currentPhase}」，页面展示最后一次已提交状态。`;
  const gateAbsence = view.gate === undefined && view.gateAbsenceReason !== undefined
    ? `<p class="gate-reason">Reason: ${e(view.gateAbsenceReason)}</p>`
    : "";
  const fixtureNotice = view.fixture
    ? `<aside class="fixture-banner"><strong>这是 Fixture 演示结果</strong><span>它验证评测流水线，不代表真实 VM 身份隔离或真实 DSH 能力。</span><small>this Gate does not establish formal VM identity or network isolation</small></aside>`
    : "";

  const planChecks = view.planSummary.checkIds.length > 0
    ? view.planSummary.checkIds
    : view.checks.map((check) => check.checkId);
  const checksById = new Map(view.checks.map((check) => [check.checkId, check] as const));
  const scoreCards = planChecks.map((checkId) => {
    const check = checksById.get(checkId);
    const copy = friendlyCheckCopy(checkId);
    const outcome = check?.outcome;
    const tone = outcomeClass(outcome ?? "") || "pending";
    const explanation = outcome === "PASS"
      ? copy.success
      : outcome === undefined
        ? copy.pending
        : check?.findings[0]?.message ?? check?.reasonCodes.join("、") ?? "没有足够信息说明原因。";
    const findings = check?.findings.map((finding) =>
      `<li><strong>${e(finding.code)}</strong>：${e(finding.message)}</li>`
    ).join("") ?? "";
    const evidence = check?.evidenceIds.map((id) =>
      `<li><a href="#evidence-${safeAnchor(id)}"><code>${e(id)}</code></a></li>`
    ).join("") ?? "";
    return `<article class="score-card tone-${tone}" id="check-${safeAnchor(check?.checkResultId ?? checkId)}">
      <div class="score-icon" aria-hidden="true">${outcome === "PASS" ? "✓" : outcome === "FAIL" ? "!" : outcome === "UNEVALUABLE" ? "?" : "·"}</div>
      <div class="score-copy"><small>${e(copy.question)}</small><h3>${e(copy.title)}</h3><p>${e(explanation)}</p></div>
      <span class="result-badge ${tone}">${e(friendlyOutcome(outcome))}</span>
      <details class="technical-inline"><summary>技术依据</summary>
        <dl><dt>CheckResult</dt><dd><code>${e(check?.checkResultId ?? "尚未产生")}</code></dd><dt>Closure</dt><dd><code>${e(check?.closureId ?? "尚未产生")}</code> · ${e(check?.closureState ?? "尚未产生")}</dd><dt>Judgement</dt><dd><code>${e(check?.judgementId ?? "尚未产生")}</code> · ${e(check?.judgementStatus ?? "尚未产生")}</dd><dt>Reasons</dt><dd>${e(check?.reasonCodes.join(", ") || "—")}</dd></dl>
        <h4>Findings</h4><ul>${findings || "<li>None</li>"}</ul><h4>Authorized evidence</h4><ul>${evidence || "<li>None</li>"}</ul>
      </details>
    </article>`;
  }).join("");

  const timeline = view.timeline.map((step) => {
    const status = statusClass(step.status);
    const expanded = step.status === "RUNNING" || step.status === "FAILED" || step.status === "BLOCKED";
    const labels = ["冻结评测目标", "检查 DSH 能力", "生成唯一计划", "安全预检", "准备测试环境", "执行 DSH Agent", "整理并闭合证据", "生成评测判定", "重置并独立验证", "形成最终结论"] as const;
    return `<li class="journey-step ${status}" aria-label="${e(`${step.number}. ${step.label}: ${step.status}`)}"><span class="journey-number">${step.number}</span><div><strong>${e(labels[step.number - 1] ?? step.label)}</strong><small>${e(friendlyStepStatus(step.status))}</small></div><details${expanded ? " open" : ""}><summary>详情</summary><p>${e(step.label)}</p><p>${e(step.startedAt ?? "尚未开始")} → ${e(step.endedAt ?? "尚未结束")}</p>${step.failureGroups.length === 0 ? "" : `<p>Failure: ${step.failureGroups.map(e).join(", ")}</p>`}${step.hintCode === undefined ? "" : `<p>${e(troubleshootingHint(step.hintCode))}</p>`}</details></li>`;
  }).join("");

  const changes = view.fileDiffs.flatMap((diff) => diff.changes);
  const changeRows = changes.map((change) =>
    `<li><span class="change-kind">${e(friendlyChange(change.kind))}</span><code>${e(change.portablePath)}</code></li>`
  ).join("");
  const sourceCards = view.sources.map((source) => {
    const copy = friendlySource(source.sourceType);
    const healthy = source.completeness === "COMPLETE" && source.health === "HEALTHY";
    return `<article class="source-card"><span class="source-mark ${healthy ? "good" : "warn"}" aria-hidden="true">${healthy ? "✓" : "!"}</span><div><h3>${e(copy.title)}</h3><p>${e(copy.detail)}</p><div class="chips"><span>${e(source.trust === "INDEPENDENT" ? "独立证据" : source.trust === "COOPERATIVE" ? "协作证据" : source.trust)}</span><span>${e(friendlyEvidenceState(source.completeness))}</span><span>${e(friendlyEvidenceState(source.health))}</span></div>${source.gaps.length === 0 ? "" : `<p class="warning-copy">缺口：${source.gaps.map(e).join("、")}</p>`}<details><summary>来源 ID</summary><code>${e(source.sourceId)}</code></details></div></article>`;
  }).join("");

  const failures = view.failures.map((failure) =>
    `<li><strong>${e(failure.group)}</strong><span>${e(failure.message)}</span><code>${e(failure.reasonCode)}</code></li>`
  ).join("");
  const evidenceDetails = view.evidence.map((item) =>
    `<article class="drill" id="evidence-${safeAnchor(item.evidenceId)}"><h3>${e(item.evidenceId)}</h3><p><strong>${e(item.layer)}</strong> · ${e(item.factType)} · relation=${e(item.relationship)} · authority=${e(item.authority)} · trust=${e(item.trust)} · ${e(item.completeness)}/${e(item.validity)}</p><p>Raw observations: ${item.observationIds.map((id) => `<a href="#raw-${safeAnchor(id)}">${e(id)}</a>`).join(", ") || "—"}</p><p>Artifacts: ${item.artifactIds.map((id) => `<code>${e(id)}</code>`).join(", ") || "—"}</p></article>`
  ).join("");
  const rawDetails = view.rawObservations.map((item) => {
    const probeLocation = item.lineNumber === undefined ? "" : ` · JSONL line ${e(item.lineNumber)} bytes ${e(item.byteStart ?? "?")}..${e(item.byteEnd ?? "?")}`;
    return `<li id="raw-${safeAnchor(item.observationId)}"><code>${e(item.observationId)}</code> · ${e(item.sourceType)}/${e(item.trust)} · ${e(item.externalEventType)}${probeLocation}<br><small>raw sha256 ${e(item.rawDigest)}</small></li>`;
  }).join("");
  const snapshots = view.fileSnapshots.map((snapshot) => {
    const rows = snapshot.entries.map((entry) => `<tr><td>${e(entry.portablePath)}</td><td>${e(entry.entryType)}</td><td>${e(entry.contentDigest ?? "—")}</td><td>${e(entry.resolvedWithinRoot)}</td><td>${e(entry.readError ?? "—")}</td></tr>`).join("");
    return `<article class="drill" id="snapshot-${safeAnchor(snapshot.snapshotId)}"><h3>${e(snapshot.snapshotId)} · ${e(snapshot.phase)} · ${e(snapshot.completeness)}</h3><p>snapshot sha256 <code>${e(snapshot.digest)}</code></p><table><thead><tr><th>Portable path</th><th>Type</th><th>Content digest</th><th>Within root</th><th>Read error</th></tr></thead><tbody>${rows || '<tr><td colspan="5">Empty snapshot</td></tr>'}</tbody></table></article>`;
  }).join("");
  const diffDetails = view.fileDiffs.map((diff) => `<article class="drill"><h3>${e(diff.diffId)}</h3><p>diff sha256 <code>${e(diff.digest)}</code> · unchanged ${e(diff.unchangedCount)}</p><ul>${diff.changes.map((change) => `<li>${e(change.kind)} · ${e(change.portablePath)}</li>`).join("") || "<li>No changes</li>"}</ul></article>`).join("");
  const artifacts = view.artifacts.map((artifact) => `<li><strong>${e(artifact.logicalName)}</strong> · ${e(artifact.portablePath)}<br><code>${e(artifact.digest)}</code></li>`).join("");
  const resetTone = view.reset.result === "MATCH" && view.reset.environmentState === "CLEANED" ? "pass" : view.reset.result === "尚未产生" ? "pending" : "unevaluable";
  const resetTitle = resetTone === "pass" ? "环境已恢复" : resetTone === "pending" ? "等待环境恢复" : "环境需要检查";
  const resetDetails = view.reset.differenceSummary === undefined ? "" : `<pre>${e(canonicalJson(view.reset.differenceSummary))}</pre>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>${INTUITIVE_RENDERER_CSS}</style></head><body class="dsheval-v3">
<div class="topbar"><a class="brand" href="#top"><span>D</span><strong>DSHEval</strong></a><nav aria-label="页面导航"><a href="#coverage">测什么</a><a href="#journey">过程</a><a href="#results">结果</a><a href="#technical">技术证据</a></nav><span class="live-state">${finalReport ? "已密封报告" : "实时状态"}</span></div>
<main id="top">
  <header class="hero tone-${gateTone}"><div class="hero-main"><p class="eyebrow">${view.fixture ? "FIXTURE 流水线演示" : "正式 DSH 评测"}</p><h1>${e(friendlyGate(view.gate))}</h1><p class="hero-lead">${e(gateLead)}</p>${gateAbsence}<div class="hero-chips"><span>${e(view.operationalHealth === "HEALTHY" ? "系统正常" : `系统 ${view.operationalHealth}`)}</span><span>${e(view.reset.environmentState === "CLEANED" ? "环境已清理" : `环境 ${view.reset.environmentState}`)}</span><span>${e(view.securityIsolation === "AGENT_SEPARATED" ? "Agent 已隔离" : view.securityIsolation)}</span></div></div><div class="gate-orb"><small>最终结论</small><strong>${e(friendlyOutcome(view.gate))}</strong><span>${view.checks.filter((check) => check.outcome === "PASS").length} / ${planChecks.length} 项通过</span></div><details class="run-meta"><summary>运行信息</summary><div>Run<br><strong>${e(view.runId)}</strong></div><div>Target<br><strong>${e(view.targetSummary)}</strong></div><div>Execution class<br><strong>${view.fixture ? "FIXTURE" : "FORMAL"}</strong></div><div>Security isolation<br><strong>${e(view.securityIsolation)}</strong></div><div>Phase<br><strong>${e(view.currentPhase)}</strong></div><div>Run state<br><strong>${e(view.runState)}</strong></div><div>Gate<br><strong class="${gateTone}">${e(view.gate ?? "尚未产生")}</strong></div></details></header>
  ${fixtureNotice}
  <section class="section coverage" id="coverage"><div class="section-heading"><div><p class="eyebrow">当前资产覆盖</p><h2>这次到底测什么</h2></div><p>请求选择可复用能力标签；Dataset Pack 提供题目、指标参数、环境和观测要求。</p></div><div class="coverage-grid"><article><strong>${view.planSummary.labelIds?.length ?? 0}</strong><span>个能力标签</span><small>${e(labelTitle)}</small></article><article><strong>1</strong><span>个数据集</span><small>${e(datasetTitle)}</small></article><article><strong>1</strong><span>道测试题</span><small>${e(scenarioTitle)}</small></article><article><strong>${planChecks.length}</strong><span>项硬标准</span><small>任一失败都不能通过</small></article></div><div class="task-card"><div><p class="eyebrow">测试任务</p><h3>${e(scenarioTitle)}</h3><p>任务内容和判定参数来自已冻结的 Dataset Pack，DSHEval 只负责执行、观测与验证。</p>${view.planSummary.deadlineMs === undefined ? "" : `<small>最长执行时间 ${e(Math.round(view.planSummary.deadlineMs / 1000))} 秒 · 单次 Attempt</small>`}</div><div class="task-flow"><code>${e(inputPath)}</code><span>DSH Agent</span><code>${e(outputPath)}</code></div></div></section>
  <section class="section journey" id="journey"><div class="section-heading"><div><p class="eyebrow">实时运行过程</p><h2>现在走到哪里</h2></div><div class="progress-copy"><strong>${settledSteps} / 10</strong><span>已结算流程步骤</span></div></div><div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${settledSteps}"><span style="width:${settledSteps * 10}%"></span></div><ol class="journey-list">${timeline}</ol></section>
  <section class="section results" id="results"><div class="section-heading"><div><p class="eyebrow">评分结果</p><h2>评测结果，一眼看懂</h2></div><p>先看结论；内部对象和证据链放在“技术依据”里。</p></div><div class="score-grid">${scoreCards || "<p>尚未生成评分计划。</p>"}</div></section>
  <section class="section reality"><div class="section-heading"><div><p class="eyebrow">真实环境结果</p><h2>文件发生了什么</h2></div></div><div class="reality-grid"><article class="change-card"><h3>执行前后变化</h3><ul>${changeRows || "<li><span class=\"change-kind\">无变化</span><span>尚未观察到文件变化</span></li>"}</ul></article><article class="reset-card tone-${resetTone}"><span class="reset-icon" aria-hidden="true">${resetTone === "pass" ? "✓" : resetTone === "pending" ? "·" : "!"}</span><div><h3>${resetTitle}</h3><p>${e(friendlyEvidenceState(view.reset.result))} · ${e(friendlyEvidenceState(view.reset.environmentState))}</p><details><summary>独立验证详情</summary><p>Reset：${e(view.reset.result)} · Environment：${e(view.reset.environmentState)}</p>${resetDetails || "<p>没有额外差异。</p>"}</details></div></article></div><div class="source-grid">${sourceCards || "<p>尚未建立观测来源。</p>"}</div></section>
  <section class="section failures ${view.failures.length === 0 ? "all-clear" : "has-failures"}" id="failures"><div class="section-heading"><div><p class="eyebrow">故障归因</p><h2>${view.failures.length === 0 ? "没有记录到系统故障" : `发现 ${view.failures.length} 条故障`}</h2></div><p>${view.failures.length === 0 ? "Agent、采集器、Judge 和基础设施均没有故障记录。" : "故障归因不会被混成 Agent 失败。"}</p></div>${failures === "" ? "" : `<ul>${failures}</ul>`}</section>
  <details class="section technical" id="technical"><summary><span><small>可审计详情</small><strong>技术证据与内部对象</strong></span><span>展开查看</span></summary><div class="technical-body"><h2>EvidenceRecord</h2>${evidenceDetails || "<p>尚未产生 Evidence</p>"}<h2>RawObservation 定位</h2><ul>${rawDetails || "<li>尚未产生 RawObservation</li>"}</ul><h2>File Snapshot Entries</h2>${snapshots || "<p>尚未产生 File Snapshot</p>"}<h2>File Diff</h2>${diffDetails || "<p>尚未产生 File Diff</p>"}<h2>Artifacts</h2><ul>${artifacts || "<li>None</li>"}</ul></div></details>
</main><footer><span>${finalReport ? "权威终态报告" : "非权威实时状态"}</span><code>${e(view.runId)}</code><small>Renderer ${e(rendererVersion)} · No scripts or network dependencies</small></footer></body></html>\n`;
}

/** v3 直观报告模板的内联样式，不引入网络资源或脚本。 */
const INTUITIVE_RENDERER_CSS = `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  --bg: #f5f6f8;
  --surface: #ffffff;
  --surface-soft: #f8fafc;
  --ink: #172033;
  --muted: #667085;
  --line: #e5e9f0;
  --brand: #5b55e7;
  --brand-soft: #eeedff;
  --good: #087443;
  --good-soft: #eaf8f0;
  --bad: #b4233b;
  --bad-soft: #fff0f2;
  --warn: #9a5700;
  --warn-soft: #fff7df;
  --blue: #2563eb;
  --blue-soft: #edf4ff;
  --shadow: 0 14px 42px rgba(28, 39, 60, .07);
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body.dsheval-v3 { margin: 0; background: var(--bg); color: var(--ink); line-height: 1.55; }
.topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 28px; min-height: 58px; padding: 8px max(24px, calc((100vw - 1240px) / 2)); background: rgba(255,255,255,.94); border-bottom: 1px solid var(--line); backdrop-filter: blur(14px); }
.brand { display: flex; align-items: center; gap: 9px; color: var(--ink); text-decoration: none; }
.brand > span { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 10px; background: var(--ink); color: #fff; font-weight: 900; }
.brand strong { letter-spacing: -.03em; }
.topbar nav { display: flex; align-items: center; gap: 4px; flex: 1; }
.topbar nav a { padding: 8px 11px; border-radius: 8px; color: var(--muted); text-decoration: none; font-size: 13px; }
.topbar nav a:hover { background: var(--surface-soft); color: var(--ink); }
.live-state { padding: 5px 9px; border-radius: 999px; background: var(--brand-soft); color: #4841c9; font-size: 11px; font-weight: 800; letter-spacing: .05em; }
main { width: min(1240px, calc(100% - 40px)); margin: 24px auto 52px; }
.hero, .section, .fixture-banner { border: 1px solid var(--line); border-radius: 22px; background: var(--surface); box-shadow: var(--shadow); }
.hero { position: relative; display: grid; grid-template-columns: 1fr 220px; gap: 30px; overflow: hidden; min-height: 310px; padding: 42px; color: #fff; background: linear-gradient(125deg, #151b2b 0%, #252953 58%, #4f46b8 100%); border: 0; }
.hero:after { content: ""; position: absolute; right: -100px; top: -170px; width: 430px; height: 430px; border: 75px solid #ffffff0a; border-radius: 50%; }
.hero.tone-pass { background: linear-gradient(125deg, #10251d 0%, #143c2c 55%, #16734c 100%); }
.hero.tone-fail { background: linear-gradient(125deg, #2b171c 0%, #5d1d2d 58%, #a82744 100%); }
.hero.tone-unevaluable { background: linear-gradient(125deg, #2a2114 0%, #5b421b 58%, #986515 100%); }
.hero-main, .gate-orb, .run-meta { position: relative; z-index: 1; }
.eyebrow { margin: 0 0 8px; color: inherit; opacity: .7; font-size: 11px; font-weight: 850; letter-spacing: .13em; text-transform: uppercase; }
.hero h1 { margin: 0; font-size: clamp(40px, 7vw, 72px); line-height: 1; letter-spacing: -.065em; }
.hero-lead { max-width: 650px; margin: 18px 0 0; color: #e2e8f0; font-size: 17px; }
.gate-reason { width: fit-content; margin: 12px 0 0; padding: 6px 9px; border-radius: 7px; background: #ffffff10; color: #fde68a; font: 700 11px/1.4 ui-monospace, SFMono-Regular, monospace; }
.hero-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 26px; }
.hero-chips span { padding: 6px 10px; border: 1px solid #ffffff25; border-radius: 999px; background: #ffffff0c; color: #e2e8f0; font-size: 12px; }
.gate-orb { align-self: center; display: grid; place-items: center; width: 196px; height: 196px; padding: 25px; border: 1px solid #ffffff32; border-radius: 50%; background: #ffffff10; text-align: center; box-shadow: inset 0 0 0 12px #ffffff08; }
.gate-orb small { color: #cbd5e1; }
.gate-orb strong { font-size: 27px; letter-spacing: -.04em; }
.gate-orb span { color: #cbd5e1; font-size: 12px; }
.run-meta { grid-column: 1 / -1; align-self: end; color: #cbd5e1; font-size: 12px; }
.run-meta summary { cursor: pointer; width: fit-content; }
.run-meta[open] { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.run-meta[open] summary { grid-column: 1 / -1; }
.run-meta > div { min-width: 0; padding: 10px; border-radius: 9px; background: #ffffff0c; overflow-wrap: anywhere; }
.run-meta strong { color: #fff; }
.fixture-banner { display: flex; align-items: center; gap: 15px; margin-top: 14px; padding: 14px 18px; border-color: #f1ce77; background: #fffae9; color: #714b08; box-shadow: none; }
.fixture-banner span { flex: 1; color: #8b651c; font-size: 13px; }
.fixture-banner small { color: #a87b22; font-family: ui-monospace, SFMono-Regular, monospace; }
.section { margin-top: 18px; padding: 30px; scroll-margin-top: 76px; }
.section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 22px; }
.section-heading h2 { margin: 0; font-size: 26px; line-height: 1.15; letter-spacing: -.04em; }
.section-heading > p { max-width: 430px; margin: 0; color: var(--muted); font-size: 13px; text-align: right; }
.section .eyebrow { color: var(--brand); opacity: 1; }
.coverage-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.coverage-grid article { display: grid; grid-template-columns: auto 1fr; align-items: end; gap: 0 10px; min-width: 0; padding: 20px; border-radius: 16px; background: var(--surface-soft); border: 1px solid var(--line); }
.coverage-grid strong { grid-row: 1 / 3; font-size: 44px; line-height: .9; letter-spacing: -.06em; }
.coverage-grid span { color: var(--muted); font-size: 13px; }
.coverage-grid small { overflow: hidden; color: var(--ink); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.task-card { display: grid; grid-template-columns: minmax(280px, 1fr) minmax(380px, 1.25fr); align-items: center; gap: 28px; margin-top: 14px; padding: 26px; border-radius: 18px; background: linear-gradient(135deg, #f8f9ff, #f1f5ff); border: 1px solid #dde2ff; }
.task-card h3 { margin: 0 0 7px; font-size: 24px; }
.task-card p { margin: 0 0 8px; color: var(--muted); }
.task-flow { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
.task-flow code { min-width: 0; padding: 14px; border: 1px solid #d8dcf8; border-radius: 12px; background: #fff; color: #332f98; text-align: center; overflow-wrap: anywhere; }
.task-flow span { position: relative; padding: 7px 11px; border-radius: 999px; background: var(--brand); color: #fff; font-size: 11px; font-weight: 800; white-space: nowrap; }
.progress-copy { display: flex; align-items: baseline; gap: 8px; }
.progress-copy strong { font-size: 23px; }
.progress-copy span { color: var(--muted); font-size: 12px; }
.progress-track { height: 8px; overflow: hidden; margin: -8px 0 24px; border-radius: 999px; background: #e8ebf1; }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--brand), #8b5cf6); }
.journey-list { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; padding: 0; margin: 0; list-style: none; }
.journey-step { display: grid; grid-template-columns: 30px 1fr; align-items: start; gap: 10px; min-width: 0; padding: 13px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-soft); }
.journey-number { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; background: #e8ebf1; color: var(--muted); font-size: 12px; font-weight: 850; }
.journey-step strong { display: block; min-height: 36px; font-size: 12px; line-height: 1.35; }
.journey-step small { color: var(--muted); }
.journey-step details { grid-column: 1 / -1; color: var(--muted); font-size: 11px; }
.journey-step details p { margin: 6px 0 0; overflow-wrap: anywhere; }
.journey-step.ok { border-color: #bde8cf; background: var(--good-soft); }
.journey-step.ok .journey-number { background: var(--good); color: #fff; }
.journey-step.busy { border-color: #bcd0ff; background: var(--blue-soft); box-shadow: 0 0 0 2px #2563eb10; }
.journey-step.busy .journey-number { background: var(--blue); color: #fff; }
.journey-step.bad { border-color: #f2bdc6; background: var(--bad-soft); }
.journey-step.bad .journey-number { background: var(--bad); color: #fff; }
.score-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.score-card { position: relative; display: grid; grid-template-columns: 42px 1fr auto; gap: 12px; min-width: 0; padding: 20px; border: 1px solid var(--line); border-top: 5px solid #a6afbd; border-radius: 17px; background: var(--surface-soft); }
.score-card.tone-pass { border-top-color: var(--good); background: var(--good-soft); }
.score-card.tone-fail { border-top-color: var(--bad); background: var(--bad-soft); }
.score-card.tone-unevaluable { border-top-color: var(--warn); background: var(--warn-soft); }
.score-icon { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: #e8ebf1; color: var(--muted); font-size: 22px; font-weight: 900; }
.tone-pass .score-icon { background: var(--good); color: #fff; }
.tone-fail .score-icon { background: var(--bad); color: #fff; }
.tone-unevaluable .score-icon { background: var(--warn); color: #fff; }
.score-copy { min-width: 0; }
.score-copy small { color: var(--muted); }
.score-copy h3 { margin: 2px 0 6px; font-size: 20px; letter-spacing: -.03em; }
.score-copy p { margin: 0; color: var(--muted); font-size: 13px; }
.result-badge { align-self: start; padding: 5px 8px; border-radius: 999px; background: #e8ebf1; color: var(--muted); font-size: 11px; font-weight: 850; white-space: nowrap; }
.result-badge.pass { background: #caefd9; color: var(--good); }
.result-badge.fail { background: #ffd7dd; color: var(--bad); }
.result-badge.unevaluable { background: #f7e5af; color: var(--warn); }
.technical-inline { grid-column: 1 / -1; margin-top: 6px; color: var(--muted); font-size: 12px; }
.technical-inline summary, .source-card summary, .reset-card summary { cursor: pointer; width: fit-content; color: var(--muted); }
.technical-inline dl { display: grid; grid-template-columns: 100px 1fr; gap: 4px 8px; padding: 12px; border-radius: 10px; background: #ffffff99; }
.technical-inline dt { font-weight: 750; }
.technical-inline dd { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.reality-grid { display: grid; grid-template-columns: 1.2fr .8fr; gap: 12px; }
.change-card, .reset-card, .source-card { border: 1px solid var(--line); border-radius: 16px; background: var(--surface-soft); }
.change-card { padding: 21px; }
.change-card h3, .reset-card h3, .source-card h3 { margin: 0 0 8px; }
.change-card ul { display: grid; gap: 8px; padding: 0; margin: 14px 0 0; list-style: none; }
.change-card li { display: flex; align-items: center; gap: 10px; padding: 9px; border-radius: 9px; background: #fff; }
.change-kind { flex: none; min-width: 48px; padding: 3px 7px; border-radius: 6px; background: var(--blue-soft); color: var(--blue); font-size: 11px; font-weight: 800; text-align: center; }
.reset-card { display: flex; align-items: flex-start; gap: 13px; padding: 21px; }
.reset-card.tone-pass { background: var(--good-soft); border-color: #bde8cf; }
.reset-card.tone-unevaluable { background: var(--warn-soft); border-color: #ead596; }
.reset-icon, .source-mark { display: grid; place-items: center; flex: none; width: 34px; height: 34px; border-radius: 10px; background: #e8ebf1; color: var(--muted); font-weight: 900; }
.tone-pass .reset-icon, .source-mark.good { background: var(--good); color: #fff; }
.source-mark.warn { background: var(--warn); color: #fff; }
.reset-card p { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
.source-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
.source-card { display: flex; align-items: flex-start; gap: 13px; padding: 20px; }
.source-card > div { min-width: 0; }
.source-card p { margin: 0 0 9px; color: var(--muted); font-size: 13px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chips span { padding: 3px 7px; border-radius: 6px; background: #e8ebf1; color: #475467; font-size: 10px; font-weight: 800; }
.warning-copy { color: var(--warn) !important; }
.failures.all-clear { border-color: #bde8cf; background: var(--good-soft); box-shadow: none; }
.failures.has-failures { border-color: #f2bdc6; background: var(--bad-soft); }
.failures ul { display: grid; gap: 8px; padding: 0; list-style: none; }
.failures li { display: grid; grid-template-columns: 160px 1fr auto; gap: 10px; padding: 10px; border-radius: 10px; background: #fff; }
.technical { padding: 0; overflow: hidden; }
.technical > summary { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 24px 30px; cursor: pointer; list-style: none; }
.technical > summary::-webkit-details-marker { display: none; }
.technical > summary span:first-child { display: flex; flex-direction: column; }
.technical > summary small { color: var(--brand); font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }
.technical > summary strong { font-size: 20px; }
.technical > summary span:last-child { color: var(--muted); font-size: 12px; }
.technical-body { padding: 0 30px 30px; border-top: 1px solid var(--line); }
.technical-body h2 { margin-top: 28px; font-size: 18px; }
.drill { padding: 14px; margin: 9px 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-soft); scroll-margin-top: 74px; }
.drill:target, [id^="raw-"]:target { outline: 3px solid #7c73ef55; background: var(--brand-soft); }
.drill h3 { margin: 0 0 5px; font-size: 13px; overflow-wrap: anywhere; }
.drill p { margin: 5px 0; color: var(--muted); font-size: 12px; }
table { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; border: 1px solid var(--line); border-radius: 10px; background: #fff; }
th, td { min-width: 120px; padding: 9px 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; font-size: 11px; }
th { color: var(--muted); background: var(--surface-soft); text-transform: uppercase; letter-spacing: .05em; }
tr:last-child td { border-bottom: 0; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; word-break: break-word; }
code { color: #4841c9; font-size: .88em; }
pre { padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: #fff; white-space: pre-wrap; }
a { color: #4f46d4; text-underline-offset: 3px; }
footer { display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap; padding: 24px; color: var(--muted); font-size: 11px; }
footer code { max-width: 50vw; }
.pass { color: var(--good); }
.fail { color: var(--bad); }
.unevaluable { color: var(--warn); }
.pending { color: var(--muted); }
@media (max-width: 980px) {
  .hero { grid-template-columns: 1fr 170px; padding: 32px; }
  .gate-orb { width: 160px; height: 160px; }
  .coverage-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .task-card { grid-template-columns: 1fr; }
  .journey-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .score-grid { grid-template-columns: 1fr; }
}
@media (max-width: 680px) {
  .topbar { padding: 8px 14px; }
  .topbar nav { order: 3; width: 100%; overflow-x: auto; }
  .live-state { margin-left: auto; }
  main { width: min(100% - 24px, 1240px); margin-top: 12px; }
  .hero { grid-template-columns: 1fr; min-height: 0; padding: 25px; }
  .hero h1 { font-size: 45px; }
  .gate-orb { width: 145px; height: 145px; }
  .run-meta[open] { grid-template-columns: 1fr; }
  .fixture-banner { align-items: flex-start; flex-direction: column; }
  .section { padding: 20px; border-radius: 17px; }
  .section-heading { align-items: flex-start; flex-direction: column; gap: 7px; }
  .section-heading > p { text-align: left; }
  .coverage-grid { grid-template-columns: 1fr; }
  .task-flow { grid-template-columns: 1fr; }
  .journey-list, .reality-grid, .source-grid { grid-template-columns: 1fr; }
  .score-card { grid-template-columns: 42px 1fr; }
  .result-badge { grid-column: 2; width: fit-content; }
  .failures li { grid-template-columns: 1fr; }
  .technical > summary, .technical-body { padding-left: 20px; padding-right: 20px; }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
@media print {
  .topbar { position: relative; }
  body.dsheval-v3 { background: #fff; }
  main { width: 100%; margin: 0; }
  .hero, .section { box-shadow: none; break-inside: avoid; }
  .journey-list { grid-template-columns: repeat(5, 1fr); }
}
`;

/** v1 兼容渲染器的最小内联样式。 */
const LEGACY_RENDERER_CSS = ":root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1100px;margin:auto;padding:24px;line-height:1.5}header,.panel,.check{border:1px solid #8886;border-radius:10px;padding:16px;margin:12px 0}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.summary div{background:#8881;padding:8px;border-radius:6px}.timeline{padding-left:24px}.step{margin:8px 0;padding:8px;border-left:5px solid #888}.step.ok{border-color:#16803c}.step.bad{border-color:#b42318}.step.busy{border-color:#1769aa}.pass{color:#16803c}.fail{color:#b42318}.unevaluable{color:#a15c00}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #8885;padding:7px}code,pre{overflow-wrap:anywhere}small{opacity:.75}a{color:inherit}dt{font-weight:700}dd{margin-bottom:5px}";

/** v2 增强兼容渲染器的内联样式。 */
const ENHANCED_RENDERER_CSS = `
:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  --bg: #f2f5fb;
  --surface: #fff;
  --surface-2: #f7f9fd;
  --ink: #111827;
  --muted: #64748b;
  --line: #dce3ee;
  --accent: #5b5ce2;
  --accent-2: #7c3aed;
  --good: #087343;
  --good-bg: #e9f9f0;
  --good-chip: #c9f0da;
  --bad: #b4233b;
  --bad-bg: #fff0f2;
  --bad-chip: #ffd7dc;
  --warn: #9a5700;
  --warn-bg: #fff7df;
  --busy: #1d4ed8;
  --busy-bg: #eef4ff;
  --busy-chip: #dbeafe;
  --neutral-chip: #e2e8f0;
  --shadow: 0 18px 45px rgba(30, 41, 59, .08);
  --glow-a: #c7d2fe;
  --glow-b: #ddd6fe;
  --target: #eef2ff;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body.dsheval-v2 {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 32px 56px;
  background: radial-gradient(circle at 9% -8%, var(--glow-a) 0, transparent 27rem), radial-gradient(circle at 92% 4%, var(--glow-b) 0, transparent 23rem), var(--bg);
  color: var(--ink);
  line-height: 1.55;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: 56px;
  margin: 0 -32px 22px;
  padding: 8px 32px;
  background: rgba(15, 23, 42, .92);
  color: #fff;
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 28px rgba(15, 23, 42, .18);
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: -.02em; white-space: nowrap; }
.brand small { font-weight: 500; opacity: .65; }
.brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: linear-gradient(135deg, #818cf8, #a78bfa); font-size: 14px; }
.topbar nav { display: flex; gap: 4px; flex: 1; }
.topbar a { display: inline-flex; align-items: center; min-height: 40px; padding: 6px 11px; border-radius: 8px; color: #dbeafe; text-decoration: none; font-size: 13px; white-space: nowrap; }
.topbar a:hover { background: #ffffff18; color: #fff; }
.view-kind { padding: 5px 9px; border: 1px solid #ffffff2c; border-radius: 999px; color: #c4b5fd; font: 700 11px/1.2 ui-monospace, SFMono-Regular, monospace; letter-spacing: .08em; white-space: nowrap; }
header, .panel, .check, .progress-block { border: 1px solid var(--line); border-radius: 18px; background: var(--surface); background: color-mix(in srgb, var(--surface) 96%, transparent); box-shadow: var(--shadow); }
header { position: relative; overflow: hidden; padding: 28px; margin: 0 0 18px; background: linear-gradient(125deg, #111827 0%, #24234f 52%, #3730a3 100%); border: 0; color: #fff; }
header:after { content: ""; position: absolute; right: -70px; top: -100px; width: 280px; height: 280px; border: 55px solid #ffffff0b; border-radius: 50%; }
h1 { position: relative; z-index: 1; margin: 0 0 22px; font-size: clamp(26px, 4vw, 43px); letter-spacing: -.045em; line-height: 1.08; }
.summary { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.summary > div { min-width: 0; padding: 12px 13px; border: 1px solid #ffffff18; border-radius: 12px; background: #ffffff0d; color: #cbd5e1; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; }
.summary strong { display: inline-block; max-width: 100%; margin-top: 4px; color: #fff; font-size: 14px; text-transform: none; letter-spacing: 0; overflow-wrap: anywhere; }
.summary strong.pass { color: #a7f3d0; background: #064e3b; }
.summary strong.fail { color: #fecdd3; background: #881337; }
.summary strong.unevaluable { color: #fde68a; background: #78350f; }
header > p { position: relative; z-index: 1; margin: 14px 0 0; color: #cbd5e1; }
.fixture-notice { padding: 9px 12px; border-left: 4px solid #fbbf24; border-radius: 7px; background: #fbbf2418; }
.progress-block { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; align-items: center; gap: 22px; padding: 16px 20px; margin: 0 0 12px; }
.progress-block > div:first-child { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 13px; }
.progress-block strong { color: var(--ink); }
.progress-track { height: 9px; overflow: hidden; border-radius: 999px; background: var(--neutral-chip); }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.operational-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; }
.operational-strip > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.operational-strip small { color: var(--muted); }
.failure-alert { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 16px; margin: 0 0 12px; border: 1px solid #fb718566; border-left: 5px solid var(--bad); border-radius: 12px; background: var(--bad-bg); }
.failure-alert div { display: flex; flex-direction: column; }
.failure-alert span { color: var(--muted); font-size: 12px; }
.failure-alert a { white-space: nowrap; }
.panel { padding: 22px; margin: 16px 0; scroll-margin-top: 74px; }
.panel > h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; font-size: 20px; letter-spacing: -.025em; }
.panel > h2:before { content: ""; width: 4px; height: 20px; border-radius: 9px; background: linear-gradient(var(--accent), var(--accent-2)); }
.timeline { display: grid; grid-template-columns: repeat(10, minmax(98px, 1fr)); gap: 8px; padding: 0 0 6px; margin: 0; overflow-x: auto; list-style: none; }
.step { position: relative; min-width: 0; min-height: 126px; margin: 0; padding: 11px; border: 1px solid var(--line); border-top: 4px solid #94a3b8; border-radius: 12px; background: var(--surface-2); font-size: 12px; }
.step-head { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-bottom: 11px; }
.step-head > span:last-child { flex: none; padding: 3px 5px; border-radius: 999px; background: var(--neutral-chip); color: #475569; font: 700 10px/1.2 ui-monospace, SFMono-Regular, monospace; letter-spacing: .02em; }
.step-number { color: var(--muted); font: 800 13px/1 ui-monospace, SFMono-Regular, monospace; }
.step-label { display: block; min-height: 40px; font-size: 13px; line-height: 1.28; overflow-wrap: anywhere; }
.step details { margin-top: 11px; color: var(--muted); overflow-wrap: anywhere; }
.step details[open] { max-height: 220px; overflow: auto; }
.step summary { cursor: pointer; color: var(--muted); font-size: 11px; }
.step-full-label { margin: 8px 0 5px; color: var(--ink); font-weight: 700; }
.step small { display: block; color: var(--muted); font-size: 11px; }
.step details > div:not(.step-full-label) { margin-top: 7px; }
.step.ok { border-top-color: var(--good); background: var(--good-bg); }
.step.ok .step-head > span:last-child { background: var(--good-chip); color: var(--good); }
.step.bad { border-top-color: var(--bad); background: var(--bad-bg); }
.step.bad .step-head > span:last-child { background: var(--bad-chip); color: var(--bad); }
.step.busy { border-top-color: var(--busy); background: var(--busy-bg); box-shadow: 0 0 0 2px #2563eb18; }
.step.busy .step-head > span:last-child { background: var(--busy-chip); color: var(--busy); }
#judging { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
#judging > h2, #judging > p { grid-column: 1 / -1; }
.check { min-width: 0; padding: 18px; margin: 0; box-shadow: none; }
.check.check-pass { border-left: 5px solid var(--good); }
.check.check-fail { border-left: 5px solid var(--bad); }
.check.check-unevaluable { border-left: 5px solid var(--warn); }
.check h3 { margin-top: 0; overflow-wrap: anywhere; }
.pass, .fail, .unevaluable, .status-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 800; }
.pass, .tone-good { color: var(--good); background: var(--good-bg); }
.fail, .tone-bad { color: var(--bad); background: var(--bad-bg); }
.unevaluable, .tone-warn { color: var(--warn); background: var(--warn-bg); }
.tone-neutral { color: var(--muted); background: var(--surface-2); }
.status-pill { font-size: 11px; white-space: nowrap; }
table { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
thead { background: var(--surface-2); }
th, td { min-width: 110px; padding: 10px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); font-size: 12px; }
th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
tr:last-child td { border-bottom: 0; }
.drill { padding: 14px 16px; margin: 10px 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); scroll-margin-top: 74px; }
.drill:target, [id^="raw-"]:target, [id^="snapshot-"]:target { outline: 3px solid #818cf866; background: var(--target); }
.drill h3 { margin-top: 0; font-size: 14px; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; word-break: break-word; }
code { font-size: .9em; color: #4338ca; }
pre { padding: 13px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); white-space: pre-wrap; }
a { color: #4f46e5; text-underline-offset: 3px; }
dt { font-weight: 750; }
dd { margin: 0 0 6px; color: var(--muted); }
small { opacity: .82; }
footer { padding: 18px 4px; color: var(--muted); }
@media (max-width: 1050px) {
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .timeline { grid-template-columns: repeat(10, minmax(112px, 1fr)); }
  #judging { grid-template-columns: 1fr; }
  .operational-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  body.dsheval-v2 { padding: 0 14px 36px; }
  .topbar { position: relative; align-items: flex-start; flex-wrap: wrap; margin: 0 -14px 16px; padding: 8px 14px; }
  .topbar nav { order: 3; width: 100%; overflow-x: auto; }
  .view-kind { margin-left: auto; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .summary > div:first-child { grid-column: 1 / -1; }
  .timeline { grid-template-columns: repeat(10, minmax(132px, 1fr)); }
  .progress-block { grid-template-columns: 1fr; gap: 10px; }
  .failure-alert { align-items: flex-start; flex-direction: column; }
  header, .panel { padding: 17px; border-radius: 14px; }
}
@media (max-width: 440px) {
  .operational-strip { grid-template-columns: 1fr; }
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #090d18; --surface: #111827; --surface-2: #172033; --ink: #e5e7eb; --muted: #94a3b8; --line: #293548; --good: #4ade80; --good-bg: #102b21; --good-chip: #17472f; --bad: #fb7185; --bad-bg: #33151b; --bad-chip: #52202a; --warn: #fbbf24; --warn-bg: #33260d; --busy: #60a5fa; --busy-bg: #13243f; --busy-chip: #18365f; --neutral-chip: #263246; --shadow: 0 18px 45px rgba(0, 0, 0, .22); --glow-a: #111934; --glow-b: #1b1437; --target: #1e2450; }
  code { color: #a5b4fc; }
  thead { background: #172033; }
  .topbar { background: rgba(5, 9, 18, .94); }
  .step-head > span:last-child { color: #cbd5e1; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
}
@media print {
  :root { --bg: #fff; --surface: #fff; --surface-2: #f8fafc; --ink: #111; --muted: #475569; --line: #cbd5e1; --good: #087343; --good-bg: #e9f9f0; --good-chip: #c9f0da; --bad: #b4233b; --bad-bg: #fff0f2; --bad-chip: #ffd7dc; --warn: #9a5700; --warn-bg: #fff7df; --busy: #1d4ed8; --busy-bg: #eef4ff; --busy-chip: #dbeafe; --neutral-chip: #e2e8f0; --target: #eef2ff; }
  body.dsheval-v2 { padding: 0; background: #fff; color: #111; }
  .topbar { position: relative; background: #111; }
  .panel, header, .check, .progress-block { box-shadow: none; break-inside: avoid; }
  .timeline { grid-template-columns: repeat(5, 1fr); }
}`;

/** 按文档绑定的 rendererVersion 选择对应内联样式。 */
function rendererStyles(rendererVersion: string): string {
  if (rendererVersion === "dsheval-static/v3") return INTUITIVE_RENDERER_CSS;
  if (rendererVersion === "dsheval-static/v2") return ENHANCED_RENDERER_CSS;
  return LEGACY_RENDERER_CSS;
}

/** 序列化、解析和最终渲染前共同调用，严格验证字段白名单、身份关系与顶层摘要。 */
function verifyReportDocument(document: EvaluationReportDocument): void {
  try {
    if (!isRecord(document) || !isRecord(document.view)) {
      throw new ContractViolation("REPORT_INTEGRITY", "Report document shape is invalid");
    }
    const keys = Object.keys(document);
    if (
      REPORT_DOCUMENT_REQUIRED_FIELDS.some((field) => !keys.includes(field)) ||
      keys.some(
        (field) =>
          !(REPORT_DOCUMENT_REQUIRED_FIELDS as readonly string[]).includes(field) &&
          !REPORT_DOCUMENT_OPTIONAL_FIELDS.has(field),
      )
    ) {
      throw new ContractViolation(
        "REPORT_INTEGRITY",
        "Report document contains unknown or missing fields",
      );
    }
    if (
      document.schema !== "dsheval.mvp.report/v1" ||
      typeof document.rendererVersion !== "string" ||
      document.rendererVersion.length === 0 ||
      !Array.isArray(document.view.timeline) ||
      !Array.isArray(document.view.sources) ||
      !Array.isArray(document.view.checks) ||
      !Array.isArray(document.view.evidence) ||
      !Array.isArray(document.view.rawObservations) ||
      !Array.isArray(document.view.fileSnapshots) ||
      !Array.isArray(document.view.fileDiffs) ||
      !Array.isArray(document.view.failures) ||
      !Array.isArray(document.view.artifacts) ||
      typeof document.view.fixture !== "boolean" ||
      (document.view.gateAbsenceReason !== undefined &&
        typeof document.view.gateAbsenceReason !== "string") ||
      !["AGENT_SEPARATED", "PROCESS_FIXTURE", "NOT_VERIFIED"].includes(
        document.view.securityIsolation,
      ) ||
      typeof document.view.runId !== "string" ||
      document.view.runId !== String(document.scope.runId) ||
      document.view.runId !== String(document.runRef.id)
    ) {
      throw new ContractViolation("REPORT_INTEGRITY", "Report document fields are invalid");
    }
    validateContentDigest(document.contentDigest, "report.contentDigest");
    if (!digestEquals(document.contentDigest, digestValue(document, ["contentDigest"]))) {
      throw new ContractViolation("REPORT_INTEGRITY", "report.json digest is invalid");
    }
    validateTimeline(document.view.timeline);
  } catch (error) {
    if (error instanceof ContractViolation && error.code === "REPORT_INTEGRITY") throw error;
    throw new ContractViolation("REPORT_INTEGRITY", "Report document failed validation", {
      cause: error,
    });
  }
}

/** buildReportViewModel 的入口守卫：复验所有记录摘要及 Source→Evidence→Closure→Judgement→Gate 引用链。 */
function validateReportViewGraph(input: ReportViewInput): void {
  assertProjectionDigest(input.run, "Run");
  assertProjectionDigest(input.attempt, "Attempt");
  assertImmutableDigest(input.target, "TargetSnapshot");
  for (const record of [
    ...input.sources,
    ...input.collectionStatuses,
    ...input.closures,
    ...input.judgements,
    ...input.checkResults,
    ...input.evidence,
    ...input.rawObservations,
    ...input.fileSnapshots,
    ...input.fileDiffs,
    ...input.findings,
    ...input.failures,
    ...input.artifacts,
    ...(input.gate === undefined ? [] : [input.gate]),
    ...(input.resetVerification === undefined ? [] : [input.resetVerification]),
  ]) {
    assertImmutableDigest(record, record.schema);
  }
  if (
    input.attempt.scope.runId !== input.run.runId ||
    input.target.targetSnapshotId !== input.run.targetSnapshotRef.id
  ) {
    throw new ContractViolation("REPORT_GRAPH_INVALID", "Report graph contains foreign Run data");
  }
  const sources = new Map(input.sources.map((source) => [String(source.sourceId), source] as const));
  for (const status of input.collectionStatuses) {
    const source = sources.get(String(status.sourceRef.id));
    if (source === undefined || !refMatches(status.sourceRef, source.sourceId, source.contentDigest)) {
      throw new ContractViolation("REPORT_GRAPH_INVALID", "CollectionStatus Source Ref is invalid");
    }
  }
  const rawObservations = new Map(
    input.rawObservations.map((observation) => [String(observation.observationId), observation] as const),
  );
  for (const observation of input.rawObservations) {
    const source = sources.get(String(observation.sourceRef.id));
    if (source === undefined || !refMatches(observation.sourceRef, source.sourceId, source.contentDigest)) {
      throw new ContractViolation("REPORT_GRAPH_INVALID", "RawObservation Source Ref is invalid");
    }
  }
  for (const evidence of input.evidence) {
    for (const sourceRef of evidence.sourceRefs) {
      const source = sources.get(String(sourceRef.id));
      if (source === undefined || !refMatches(sourceRef, source.sourceId, source.contentDigest)) {
        throw new ContractViolation("REPORT_GRAPH_INVALID", "Evidence Source Ref is invalid");
      }
    }
    for (const observationRef of evidence.observationRefs) {
      const observation = rawObservations.get(String(observationRef.id));
      if (
        observation === undefined ||
        !refMatches(observationRef, observation.observationId, observation.contentDigest)
      ) {
        throw new ContractViolation("REPORT_GRAPH_INVALID", "Evidence RawObservation Ref is invalid");
      }
    }
  }
  const evidenceById = new Map(
    input.evidence.map((evidence) => [String(evidence.evidenceId), evidence] as const),
  );
  for (const closure of input.closures) {
    for (const evidenceRef of closure.authorizedEvidenceRefs) {
      const evidence = evidenceById.get(String(evidenceRef.id));
      if (evidence === undefined || !refMatches(evidenceRef, evidence.evidenceId, evidence.contentDigest)) {
        throw new ContractViolation("REPORT_GRAPH_INVALID", "Closure Evidence Ref is invalid");
      }
    }
  }
  const snapshots = new Map(
    input.fileSnapshots.map((snapshot) => [String(snapshot.snapshotId), snapshot] as const),
  );
  for (const diff of input.fileDiffs) {
    const before = snapshots.get(String(diff.beforeSnapshotRef.id));
    const after = snapshots.get(String(diff.afterSnapshotRef.id));
    if (
      before === undefined ||
      after === undefined ||
      !refMatches(diff.beforeSnapshotRef, before.snapshotId, before.contentDigest) ||
      !refMatches(diff.afterSnapshotRef, after.snapshotId, after.contentDigest)
    ) {
      throw new ContractViolation("REPORT_GRAPH_INVALID", "FileDiff Snapshot Ref is invalid");
    }
  }
  const closures = new Map(input.closures.map((closure) => [String(closure.checkId), closure] as const));
  const judgements = new Map(input.judgements.map((item) => [String(item.checkId), item] as const));
  const findings = new Map(input.findings.map((item) => [String(item.findingId), item] as const));
  for (const result of input.checkResults) {
    const judgement = judgements.get(String(result.checkId));
    const closure = closures.get(String(result.checkId));
    if (
      judgement === undefined ||
      closure === undefined ||
      !refMatches(result.judgementRef, judgement.judgementId, judgement.contentDigest) ||
      !refMatches(judgement.closureRef, closure.closureId, closure.contentDigest)
    ) {
      throw new ContractViolation("REPORT_GRAPH_INVALID", "Check result chain is not closed");
    }
    for (const findingRef of judgement.findingRefs) {
      const finding = findings.get(String(findingRef.id));
      if (
        finding === undefined ||
        finding.checkId !== result.checkId ||
        !refMatches(findingRef, finding.findingId, finding.contentDigest)
      ) {
        throw new ContractViolation("REPORT_GRAPH_INVALID", "Judgement Finding Ref is invalid");
      }
    }
  }
  if (input.gate !== undefined) {
    const expected = input.checkResults
      .map((record) => `${record.schema}\u0000${record.checkResultId}\u0000${record.contentDigest.value}`)
      .sort();
    const actual = input.gate.inputCheckResultRefs
      .map((ref) => `${ref.schema}\u0000${ref.id}\u0000${ref.digest.value}`)
      .sort();
    if (
      input.gate.runId !== input.run.runId ||
      expected.length !== actual.length ||
      !expected.every((key, index) => key === actual[index])
    ) {
      throw new ContractViolation("REPORT_GRAPH_INVALID", "Gate does not cite the displayed CheckResults");
    }
  }
}

/** validateReportViewGraph 用于复验不可变记录 contentDigest 的通用断言。 */
function assertImmutableDigest(
  record: { readonly schema: string; readonly contentDigest: ContentDigest },
  label: string,
): void {
  if (!digestEquals(record.contentDigest, digestValue(record, ["contentDigest"]))) {
    throw new ContractViolation("REPORT_GRAPH_INVALID", `${label} digest is invalid`);
  }
}

/** validateReportViewGraph 用于复验生命周期投影 projectionDigest 的通用断言。 */
function assertProjectionDigest(
  record: { readonly projectionDigest: ContentDigest },
  label: string,
): void {
  if (!digestEquals(record.projectionDigest, digestValue(record, ["projectionDigest"]))) {
    throw new ContractViolation("REPORT_GRAPH_INVALID", `${label} projection digest is invalid`);
  }
}

/** 比较 Ref 的 ID 与摘要是否同时指向指定记录。 */
function refMatches(ref: Ref, id: string, digest: ContentDigest): boolean {
  return String(ref.id) === String(id) && digestEquals(ref.digest, digest);
}

/** 状态与报告渲染前确认时间线恰好包含顺序固定的十个步骤。 */
function validateTimeline(timeline: readonly WorkflowStepView[]): void {
  if (timeline.length !== 10 || timeline.some((step, index) => step.number !== index + 1)) {
    throw new ContractViolation("INVALID_TIMELINE", "Status timeline must contain ordered steps 1..10");
  }
}

/** 将常见 reasonCode 映射为报告中的中文排障建议。 */
function troubleshootingHint(reasonCode: string): string {
  const hints: Readonly<Record<string, string>> = {
    PLAN_UNSATISFIABLE: "检查缺失资产、Sensor 或 Judge 后重新规划。",
    BASELINE_FAILED: "检查 Workspace 路径、权限和 File Sensor；Agent 尚未启动。",
    PROBE_SEQUENCE_INCOMPLETE: "检查 Probe gap、最终 watermark 与 probe/stop。",
    PROBE_STOP_MISSING: "Probe 缺少 stop；Protocol Check 将不可评测。",
    TARGET_EXECUTION: "查看退出事实、stderr、Trace 与独立文件结果。",
    EVIDENCE_INCOMPLETE: "检查缺失的来源、watermark 或所需内容。",
    JUDGE_IMPLEMENTATION_ERROR: "这是 Judge 故障，不是 Agent FAIL。",
    RESET_MISMATCH: "环境有残留并已隔离；既有 Gate 不会改变。",
    REPORT_FAILURE: "Gate 已保存，可从权威 JSON 重新渲染。",
  };
  return hints[reasonCode] ?? reasonCode;
}

/** 所有模板插值共用的 HTML 转义函数，也公开供渲染相关测试复用。 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 把任意对象 ID 编码成安全且可复现的 HTML anchor。 */
function safeAnchor(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/** 将时间线状态映射为兼容模板的 CSS class。 */
function statusClass(status: WorkflowStepStatus): string {
  if (status === "SUCCEEDED") return "ok";
  if (status === "FAILED" || status === "BLOCKED") return "bad";
  if (status === "RUNNING") return "busy";
  return "";
}

/** 将多种领域状态归并为 v2/v3 页面使用的四类语义色调。 */
function statusTone(value: string): "tone-good" | "tone-bad" | "tone-warn" | "tone-neutral" {
  const normalized = value.toUpperCase();
  if (
    [
      "INDEPENDENT",
      "COMPLETE",
      "HEALTHY",
      "VALID",
      "CLOSED",
      "COMPLETED",
      "MATCH",
      "CLEANED",
      "PASS",
    ].includes(normalized)
  ) {
    return "tone-good";
  }
  if (
    [
      "FAILED",
      "INVALID",
      "UNAVAILABLE",
      "ERROR",
      "MISMATCH",
      "QUARANTINED",
      "NOT_VERIFIED",
      "FAIL",
    ].includes(normalized)
  ) {
    return "tone-bad";
  }
  if (
    ["PARTIAL", "COOPERATIVE", "UNKNOWN", "UNEVALUABLE", "DEGRADED", "PENDING"].includes(
      normalized,
    )
  ) {
    return "tone-warn";
  }
  return "tone-neutral";
}

/** 将 CheckOutcome 映射为旧模板使用的结果 CSS class。 */
function outcomeClass(outcome: string): string {
  return outcome === "PASS" ? "pass" : outcome === "FAIL" ? "fail" : outcome === "UNEVALUABLE" ? "unevaluable" : "";
}

/** buildEvaluationReport 用于按身份去重并稳定排序对象 Ref。 */
function stableRefs<T extends Ref>(refs: readonly T[]): readonly T[] {
  const unique = new Map<string, T>();
  for (const ref of refs) unique.set(`${ref.schema}\u0000${ref.id}\u0000${ref.revision ?? ""}`, ref);
  return [...unique.values()].sort((left, right) =>
    `${left.schema}\u0000${left.id}`.localeCompare(`${right.schema}\u0000${right.id}`, "en"),
  );
}

/** 报告 JSON 解析与元数据读取共用的普通对象类型守卫。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
