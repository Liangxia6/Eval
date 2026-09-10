/**
 * 文件职责：汇总评测对象图，验证引用与摘要，并生成权威报告及静态 HTML 结构。
 * 核心流程：投影 ReportViewModel，将视图与渲染器版本纳入摘要，再输出最终报告或运行状态页。
 * 真实交互：上游消费 planning、observation、closure、judging、scoring 和 reset 阶段的已提交记录；下游由 ArtifactStore 保存 report.json/report.html 并更新 status.html。
 * 公开接口：报告构建、投影、序列化/解析和 HTML 渲染函数；视图类型从 report-types.ts 原样导出。
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
import { renderReportViewHtml } from "./report-html.js";
import type {
  CheckView,
  LabelEvaluationView,
  RawObservationDrilldownView,
  ReportViewInput,
  ReportViewModel,
  TraceDataView,
  WorkflowStepView,
} from "./report-types.js";
export * from "./report-types.js";
export { escapeHtml } from "./report-html.js";

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
  const contractsByCheck = new Map(
    input.evidenceContracts.map((contract) => [String(contract.checkId), contract] as const),
  );
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
  const labelEvaluations = input.evaluationPlan?.casePlan.labelBindings.map((binding) => {
    const checkPlan = input.evaluationPlan!.checkPlans.find(
      (candidate) => candidate.checkId === binding.checkId,
    );
    const contract = contractsByCheck.get(String(binding.checkId));
    const requiredEvidenceTypes = contract?.requiredFactTypes ?? binding.requiredEvidenceTypes;
    return {
      labelId: String(binding.labelId),
      metricId: String(binding.metricId),
      checkId: String(binding.checkId),
      judgeId: String(checkPlan?.judgeId ?? "MISSING"),
      evaluationMode: evidenceEvaluationMode(requiredEvidenceTypes),
      requiredEvidenceTypes: [...requiredEvidenceTypes].sort(),
      metricParameters: binding.metricParameters,
      required: binding.required,
      hardGate: binding.hardGate,
    } satisfies LabelEvaluationView;
  }).sort((left, right) => left.labelId.localeCompare(right.labelId, "en"));
  const authorizedEvidenceIds = new Set(checks.flatMap((check) => check.evidenceIds));
  const trace = traceDataView(input.evidence);

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
    ...(input.execution === undefined ? {} : { execution: input.execution }),
    trace,
    decisionEvidence: input.evidence
      .filter((item) => authorizedEvidenceIds.has(String(item.evidenceId)))
      .sort((left, right) => String(left.evidenceId).localeCompare(String(right.evidenceId), "en"))
      .map((item) => ({
        evidenceId: String(item.evidenceId),
        factType: item.factType,
        layer: item.derivationRuleId === undefined ? "NORMALIZED" as const : "DERIVED" as const,
        relationship: item.derivationRuleId === undefined ? "DIRECT" as const : "DERIVED" as const,
        authority: item.authority,
        trust: item.trust,
        completeness: item.completeness,
        validity: item.validity,
        observationIds: item.observationRefs.map((ref) => String(ref.id)).sort(),
        artifactIds: item.artifactRefs.map((ref) => String(ref.id)).sort(),
        ...(item.derivationRuleId === undefined ? {} : { derivationRuleId: String(item.derivationRuleId) }),
        factValue: item.factType === "PROTOCOL_LIFECYCLE"
          ? {
              eventCount: trace.eventCount,
              eventTypeCounts: trace.eventTypeCounts,
              toolCalls: trace.toolCalls,
              usage: trace.usage,
            }
          : item.factValue,
      })),
    ...(input.inspection === undefined
      ? {}
      : {
          staticProfile: {
            dshVersion: inspectionVersion(input.inspection.dshVersionStatus),
            probeStatus: input.inspection.probeConfigured === true
              ? `${input.inspection.probeSchema} · ${input.inspection.probeOrderStatus}`
              : String(input.inspection.probeConfigured),
            driverStatus: input.inspection.headlessDriverStatus,
            permissionPreset: input.inspection.permissionPreset,
            sandboxMode: input.inspection.sandboxMode,
            toolNames: inspectionToolNames(input.inspection.toolSchemas),
            limitationCount: input.inspection.limitations.length,
          },
        }),
    ...(input.evaluationPlan === undefined
      ? {}
      : {
          plannerMatch: {
            ...(input.evaluationLabelIds === undefined
              ? {}
              : { evaluationLabelIds: [...input.evaluationLabelIds].sort() }),
            requestedLabelIds: input.evaluationPlan.request.requestedLabelIds.map(String).sort(),
            selectedLabelIds: input.evaluationPlan.catalogResolution.selectedLabelIds.map(String).sort(),
            selectedDatasetIds: input.evaluationPlan.catalogResolution.selectedDatasetIds.map(String).sort(),
            scenarioId: String(input.evaluationPlan.casePlan.scenarioId),
            environmentId: String(input.evaluationPlan.casePlan.environmentId),
            selectionRule: "ALL_SELECTED_LABELS_COVERED" as const,
          },
          labelEvaluations: labelEvaluations ?? [],
        }),
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
          mode: entry.mode,
          ...(entry.byteLength === undefined ? {} : { byteLength: entry.byteLength }),
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
        artifactId: String(artifact.artifactId),
        artifactType: artifact.artifactType,
        logicalName: artifact.logicalName,
        mediaType: artifact.mediaType,
        portablePath: artifact.portablePath,
        byteLength: artifact.byteLength,
        digest: artifact.artifactContentDigest.value,
        redactionState: artifact.redactionState,
      })),
  };
}

/** 从 EvaluationPlan.seedSpec 提取输入文件路径，供计划审计表展示。 */
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
  return renderReportViewHtml("DSHEval Evaluation Report", document.view, true, document.rendererVersion);
}

/** 根据已提交事实生成非权威 status.html；应用层可在运行过程中反复原子替换。 */
export function renderStatusHtml(view: ReportViewModel, rendererVersion: string): string {
  validateTimeline(view.timeline);
  return renderReportViewHtml("DSHEval Run Status", view, false, rendererVersion);
}

/** 两个公开渲染入口共用的版本分派器；v3 走事实审计页，其余版本保留兼容布局。 */
function evidenceEvaluationMode(
  factTypes: readonly string[],
): LabelEvaluationView["evaluationMode"] {
  const usesTrace = factTypes.some((type) =>
    type.startsWith("PROTOCOL_") || type.startsWith("PROBE_") || type.startsWith("RUNTIME_"),
  );
  const usesOutputState = factTypes.some((type) =>
    type.startsWith("FILE_") || type === "ARTIFACT",
  );
  if (usesTrace && usesOutputState) return "MIXED";
  if (usesTrace) return "TRACE";
  if (usesOutputState) return "OUTPUT_STATE";
  return "INPUT_OUTPUT";
}

/** 只从已提交的协议生命周期事实提取可核对数据，不根据文案推测 Agent 行为。 */
function traceDataView(evidence: readonly EvidenceRecord[]): TraceDataView {
  const lifecycle = evidence.find((item) => item.factType === "PROTOCOL_LIFECYCLE");
  if (lifecycle === undefined || !Array.isArray(lifecycle.factValue)) {
    return {
      sessionIds: [],
      eventCount: 0,
      eventTypeCounts: [],
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 },
    };
  }
  const sessionIds = new Set<string>();
  const counts = new Map<string, number>();
  const calls = new Map<string, {
    callId: string;
    toolName: string;
    at: string;
    argumentsCaptured: string;
    completed: boolean;
  }>();
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 };
  let model: string | undefined;
  let provider: string | undefined;
  for (const item of lifecycle.factValue) {
    if (!isRecord(item) || !isRecord(item.data) || !isRecord(item.data.event)) continue;
    const event = item.data.event;
    const eventType = typeof event.type === "string" ? event.type : "UNKNOWN";
    const eventData = isRecord(event.data) ? event.data : {};
    counts.set(eventType, (counts.get(eventType) ?? 0) + 1);
    if (typeof item.data.sessionId === "string") sessionIds.add(item.data.sessionId);
    if (eventType === "request/context") {
      if (typeof eventData.model === "string") model = eventData.model;
      if (typeof eventData.provider === "string") provider = eventData.provider;
    }
    if (eventType === "assistant/message" && isRecord(eventData.usage)) {
      usage.inputTokens += jsonNumber(eventData.usage.inputTokens);
      usage.outputTokens += jsonNumber(eventData.usage.outputTokens);
      usage.reasoningTokens += jsonNumber(eventData.usage.reasoningTokens);
      usage.cacheReadTokens += jsonNumber(eventData.usage.cacheReadTokens);
    }
    if (eventType === "tool/call" && typeof eventData.callId === "string") {
      calls.set(eventData.callId, {
        callId: eventData.callId,
        toolName: typeof eventData.name === "string" ? eventData.name : "UNKNOWN",
        at: typeof item.at === "string" ? item.at : "UNKNOWN",
        argumentsCaptured: typeof eventData.arguments === "string"
          ? eventData.arguments
          : canonicalJson((eventData.arguments ?? null) as JsonValue),
        completed: false,
      });
    }
    if (eventType === "tool/result") {
      const message = isRecord(eventData.message) ? eventData.message : undefined;
      const source = message !== undefined && isRecord(message.source) ? message.source : undefined;
      const callId = typeof eventData.callId === "string"
        ? eventData.callId
        : typeof source?.callId === "string" ? source.callId : undefined;
      if (callId !== undefined) {
        const existing = calls.get(callId);
        if (existing !== undefined) calls.set(callId, { ...existing, completed: true });
      }
    }
  }
  return {
    sessionIds: [...sessionIds].sort(),
    eventCount: lifecycle.factValue.length,
    eventTypeCounts: [...counts.entries()]
      .map(([eventType, count]) => ({ eventType, count }))
      .sort((left, right) => right.count - left.count || left.eventType.localeCompare(right.eventType, "en")),
    toolCalls: [...calls.values()].sort((left, right) => left.at.localeCompare(right.at, "en")),
    ...(model === undefined ? {} : { model }),
    ...(provider === undefined ? {} : { provider }),
    usage,
  };
}

/** Trace 中缺失或非数值的 token 统计按 0 处理，避免展示层产生 NaN。 */
function jsonNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** 从 Inspector 的版本事实中提取面向人的 DSH 版本。 */
function inspectionVersion(value: JsonValue): string {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("version" in value)
  ) return "UNKNOWN";
  return typeof value.version === "string" ? value.version : "UNKNOWN";
}

/** 从 Inspector 已冻结的 Tool Schema 中提取工具名。 */
function inspectionToolNames(values: readonly JsonValue[]): string[] {
  return values.flatMap((value) => {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !("name" in value)
    ) return [];
    return typeof value.name === "string" ? [value.name] : [];
  }).sort();
}

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
      !["AGENT_SEPARATED", "SESSION_SEPARATED", "PROCESS_FIXTURE", "NOT_VERIFIED"].includes(
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
  if (input.inspection !== undefined) assertImmutableDigest(input.inspection, "InspectionSnapshot");
  if (input.evaluationPlan !== undefined) assertImmutableDigest(input.evaluationPlan, "EvaluationPlan");
  for (const record of [
    ...input.sources,
    ...input.collectionStatuses,
    ...input.evidenceContracts,
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
  if (
    input.inspection !== undefined &&
    !refMatches(
      input.inspection.targetSnapshotRef,
      input.target.targetSnapshotId,
      input.target.contentDigest,
    )
  ) {
    throw new ContractViolation("REPORT_GRAPH_INVALID", "InspectionSnapshot Target Ref is invalid");
  }
  if (input.evaluationPlan !== undefined) {
    const contracts = new Map(
      input.evidenceContracts.map((contract) => [String(contract.evidenceContractId), contract] as const),
    );
    for (const check of input.evaluationPlan.checkPlans) {
      const contract = contracts.get(String(check.evidenceContractRef.id));
      if (
        contract === undefined ||
        contract.checkId !== check.checkId ||
        !refMatches(check.evidenceContractRef, contract.evidenceContractId, contract.contentDigest)
      ) {
        throw new ContractViolation("REPORT_GRAPH_INVALID", "CheckPlan EvidenceContract Ref is invalid");
      }
    }
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
