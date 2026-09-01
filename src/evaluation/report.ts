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

export type WorkflowStepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED";

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

export interface SourceView {
  readonly sourceId: string;
  readonly sourceType: string;
  readonly trust: string;
  readonly completeness: string;
  readonly health: string;
  readonly gaps: readonly string[];
}

export interface FindingView {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
  readonly evidenceIds: readonly string[];
}

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

export interface FileDiffDrilldownView {
  readonly diffId: string;
  readonly digest: string;
  readonly changes: readonly {
    readonly portablePath: string;
    readonly kind: string;
  }[];
  readonly unchangedCount: number;
}

/** This normalized view is persisted inside report.json before HTML rendering. */
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

export interface ReportViewInput {
  readonly run: EvaluationRun;
  readonly target: TargetSnapshot;
  readonly attempt: ExecutionAttempt;
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
      checkIds: checks.map((check) => check.checkId),
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

function jsonRefId(value: JsonValue | undefined): string | undefined {
  if (!isRecord(value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

export interface EvaluationReportDocument
  extends Omit<EvaluationReport, "contentDigest"> {
  readonly view: ReportViewModel;
  readonly rendererVersion: string;
  /** The sole top-level digest binds report refs, presentation facts and renderer. */
  readonly contentDigest: ContentDigest;
}

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
const REPORT_DOCUMENT_OPTIONAL_FIELDS = new Set(["gateDecisionRef", "resetVerificationRef"]);

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

export function serializeReportDocument(document: EvaluationReportDocument): string {
  verifyReportDocument(document);
  return `${canonicalJson(document)}\n`;
}

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

/** Deterministic, self-contained and script-free final renderer. */
export function renderReportHtml(document: EvaluationReportDocument): string {
  verifyReportDocument(document);
  return renderHtml("DSHEval Evaluation Report", document.view, true, document.rendererVersion);
}

/** status.html is non-authoritative and contains only already committed facts. */
export function renderStatusHtml(view: ReportViewModel, rendererVersion: string): string {
  validateTimeline(view.timeline);
  return renderHtml("DSHEval Run Status", view, false, rendererVersion);
}

function renderHtml(
  title: string,
  view: ReportViewModel,
  finalReport: boolean,
  rendererVersion: string,
): string {
  const e = escapeHtml;
  const enhanced = rendererVersion === "dsheval-static/v2";
  const settledSteps = view.timeline.filter((step) =>
    step.status === "SUCCEEDED" || step.status === "FAILED" || step.status === "BLOCKED"
  ).length;
  const sectionId = (id: string): string => enhanced ? ` id="${id}"` : "";
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
    "三项判定",
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

const LEGACY_RENDERER_CSS = ":root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1100px;margin:auto;padding:24px;line-height:1.5}header,.panel,.check{border:1px solid #8886;border-radius:10px;padding:16px;margin:12px 0}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.summary div{background:#8881;padding:8px;border-radius:6px}.timeline{padding-left:24px}.step{margin:8px 0;padding:8px;border-left:5px solid #888}.step.ok{border-color:#16803c}.step.bad{border-color:#b42318}.step.busy{border-color:#1769aa}.pass{color:#16803c}.fail{color:#b42318}.unevaluable{color:#a15c00}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #8885;padding:7px}code,pre{overflow-wrap:anywhere}small{opacity:.75}a{color:inherit}dt{font-weight:700}dd{margin-bottom:5px}";

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

function rendererStyles(rendererVersion: string): string {
  return rendererVersion === "dsheval-static/v2"
    ? ENHANCED_RENDERER_CSS
    : LEGACY_RENDERER_CSS;
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

function assertImmutableDigest(
  record: { readonly schema: string; readonly contentDigest: ContentDigest },
  label: string,
): void {
  if (!digestEquals(record.contentDigest, digestValue(record, ["contentDigest"]))) {
    throw new ContractViolation("REPORT_GRAPH_INVALID", `${label} digest is invalid`);
  }
}

function assertProjectionDigest(
  record: { readonly projectionDigest: ContentDigest },
  label: string,
): void {
  if (!digestEquals(record.projectionDigest, digestValue(record, ["projectionDigest"]))) {
    throw new ContractViolation("REPORT_GRAPH_INVALID", `${label} projection digest is invalid`);
  }
}

function refMatches(ref: Ref, id: string, digest: ContentDigest): boolean {
  return String(ref.id) === String(id) && digestEquals(ref.digest, digest);
}

function validateTimeline(timeline: readonly WorkflowStepView[]): void {
  if (timeline.length !== 10 || timeline.some((step, index) => step.number !== index + 1)) {
    throw new ContractViolation("INVALID_TIMELINE", "Status timeline must contain ordered steps 1..10");
  }
}

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

export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeAnchor(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

function statusClass(status: WorkflowStepStatus): string {
  if (status === "SUCCEEDED") return "ok";
  if (status === "FAILED" || status === "BLOCKED") return "bad";
  if (status === "RUNNING") return "busy";
  return "";
}

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

function outcomeClass(outcome: string): string {
  return outcome === "PASS" ? "pass" : outcome === "FAIL" ? "fail" : outcome === "UNEVALUABLE" ? "unevaluable" : "";
}

function stableRefs<T extends Ref>(refs: readonly T[]): readonly T[] {
  const unique = new Map<string, T>();
  for (const ref of refs) unique.set(`${ref.schema}\u0000${ref.id}\u0000${ref.revision ?? ""}`, ref);
  return [...unique.values()].sort((left, right) =>
    `${left.schema}\u0000${left.id}`.localeCompare(`${right.schema}\u0000${right.id}`, "en"),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
