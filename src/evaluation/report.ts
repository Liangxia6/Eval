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
  const gate = view.gate ?? "尚未产生";
  const gateReason = view.gate === undefined && view.gateAbsenceReason !== undefined
    ? `<br><small>Reason: ${e(view.gateAbsenceReason)}</small>`
    : "";
  const timeline = view.timeline
    .map(
      (step) => `<li class="step ${statusClass(step.status)}"><div><strong>${step.number}. ${e(step.label)}</strong> <span>${e(step.status)}</span></div><small>${e(step.startedAt ?? "尚未产生")} → ${e(step.endedAt ?? "尚未产生")}</small>${step.objectRefs.length === 0 ? "" : `<div>Refs: ${step.objectRefs.map(e).join(", ")}</div>`}${step.failureGroups.length === 0 ? "" : `<div>Failure: ${step.failureGroups.map(e).join(", ")}</div>`}${step.hintCode === undefined ? "" : `<div>Hint: ${e(troubleshootingHint(step.hintCode))}</div>`}</li>`,
    )
    .join("");
  const sources = view.sources
    .map(
      (source) => `<tr><td>${e(source.sourceId)}</td><td>${e(source.sourceType)}</td><td>${e(source.trust)}</td><td>${e(source.completeness)}</td><td>${e(source.health)}</td><td>${source.gaps.map(e).join(", ") || "—"}</td></tr>`,
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
      return `<section class="check" id="check-${safeAnchor(check.checkResultId)}"><h3>${e(check.checkId)}: <span class="${outcomeClass(check.outcome)}">${e(check.outcome)}</span></h3><dl><dt>CheckResult</dt><dd><code>${e(check.checkResultId)}</code></dd><dt>Closure</dt><dd id="closure-${safeAnchor(check.closureId)}"><code>${e(check.closureId)}</code> · ${e(check.closureState)}</dd><dt>Judgement</dt><dd id="judgement-${safeAnchor(check.judgementId)}"><code>${e(check.judgementId)}</code> · ${e(check.judgementStatus)}</dd><dt>Reasons</dt><dd>${check.reasonCodes.map(e).join(", ") || "—"}</dd></dl><h4>Findings</h4><ul>${findings || "<li>None</li>"}</ul><h4>Authorized evidence</h4><ul>${evidence || "<li>None</li>"}</ul></section>`;
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

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1100px;margin:auto;padding:24px;line-height:1.5}header,.panel,.check{border:1px solid #8886;border-radius:10px;padding:16px;margin:12px 0}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.summary div{background:#8881;padding:8px;border-radius:6px}.timeline{padding-left:24px}.step{margin:8px 0;padding:8px;border-left:5px solid #888}.step.ok{border-color:#16803c}.step.bad{border-color:#b42318}.step.busy{border-color:#1769aa}.pass{color:#16803c}.fail{color:#b42318}.unevaluable{color:#a15c00}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #8885;padding:7px}code,pre{overflow-wrap:anywhere}small{opacity:.75}a{color:inherit}dt{font-weight:700}dd{margin-bottom:5px}</style></head><body>
<header><h1>${e(title)}</h1><div class="summary"><div>Run<br><strong>${e(view.runId)}</strong></div><div>Target<br><strong>${e(view.targetSummary)}</strong></div><div>Execution class<br><strong>${view.fixture ? "FIXTURE" : "FORMAL"}</strong></div><div>Security isolation<br><strong>${e(view.securityIsolation)}</strong></div><div>Phase<br><strong>${e(view.currentPhase)}</strong></div><div>Run state<br><strong>${e(view.runState)}</strong></div><div>Gate<br><strong class="${outcomeClass(gate)}">${e(gate)}</strong>${gateReason}</div><div>Health<br><strong>${e(view.operationalHealth)}</strong></div></div>${view.fixture ? '<p class="unevaluable"><strong>Fixture result:</strong> this Gate does not establish formal VM identity or network isolation.</p>' : ""}<p>${e(view.startedAt)} → ${e(view.updatedAt)}</p></header>
<section class="panel"><h2>十步流程</h2><ol class="timeline">${timeline}</ol></section>
<section class="panel"><h2>规划</h2><p>Cases: 1 · Attempts: 1 · Checks: ${view.planSummary.checkIds.map(e).join(", ")}</p></section>
<section class="panel"><h2>执行与环境</h2><table><thead><tr><th>Source</th><th>Type</th><th>Trust</th><th>Completeness</th><th>Health</th><th>Gaps</th></tr></thead><tbody>${sources}</tbody></table><h3>Reset</h3><p>${e(view.reset.result)} / ${e(view.reset.environmentState)}</p>${resetDetails}</section>
<section class="panel"><h2>判定</h2>${checks || "<p>尚未产生 CheckResult</p>"}</section>
<section class="panel"><h2>证据下钻</h2><h3>EvidenceRecord</h3>${evidenceDetails || "<p>尚未产生 Evidence</p>"}<h3>RawObservation 定位</h3><ul>${rawDetails || "<li>尚未产生 RawObservation</li>"}</ul><h3>File Snapshot Entries</h3>${snapshotDetails || "<p>尚未产生 File Snapshot</p>"}<h3>File Diff</h3>${diffDetails || "<p>尚未产生 File Diff</p>"}</section>
<section class="panel"><h2>Failures</h2><table><thead><tr><th>Group</th><th>Category</th><th>Actor</th><th>Reason</th><th>Message</th></tr></thead><tbody>${failures || '<tr><td colspan="5">None</td></tr>'}</tbody></table></section>
<section class="panel"><h2>Artifacts</h2><ul>${artifacts || "<li>None</li>"}</ul></section>
<footer><small>${finalReport ? "Authoritative report view" : "Non-authoritative status view"} · Renderer ${e(rendererVersion)} · No scripts or network dependencies</small></footer>
</body></html>\n`;
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
