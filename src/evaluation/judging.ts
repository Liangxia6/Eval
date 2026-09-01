import {
  ContractViolation,
  assertSameAttemptScope,
  canonicalJson,
  digestEquals,
  digestValue,
  refForImmutable,
  validateScope,
  validateStableId,
  validateVersionedAssetId,
  withContentDigest,
  type CheckOutcome,
  type CheckPlan,
  type CheckResult,
  type EvidenceClosure,
  type EvidenceContract,
  type EvidenceRecord,
  type Finding,
  type JsonObject,
  type JsonValue,
  type JudgementRecord,
  type Ref,
  type ScopeRef,
} from "../core/models.js";
import type { FailureDraft, FailureRecord } from "../core/errors.js";

export const PROTOCOL_JUDGE_ID = validateVersionedAssetId<"JudgeId">(
  "judge.protocol.integrity/v1",
);
export const FILE_STATE_JUDGE_ID = validateVersionedAssetId<"JudgeId">(
  "judge.filesystem.state/v1",
);
export const PATH_SECURITY_JUDGE_ID = validateVersionedAssetId<"JudgeId">(
  "judge.filesystem.path-security/v1",
);
export const DETERMINISTIC_JUDGE_VERSION = "1.0.0";

export interface EvaluateCheckInput {
  readonly scope: ScopeRef;
  readonly checkPlan: CheckPlan;
  readonly closure: EvidenceClosure;
  readonly closureRef: Ref<EvidenceClosure>;
  readonly evidenceContract: EvidenceContract;
  readonly authorizedEvidence: readonly EvidenceRecord[];
  readonly judgementId: string;
  readonly checkResultId: string;
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly makeFindingId?: (code: string, ordinal: number) => string;
  /** If App has already committed the Judge failure, bind it here. */
  readonly judgeFailureRef?: Ref<FailureRecord>;
}

export interface JudgeEvaluationResult {
  readonly judgement: JudgementRecord;
  readonly findings: readonly Finding[];
  readonly checkResult: CheckResult;
  /** Present only when the Judge implementation itself threw. */
  readonly failureDraft?: FailureDraft;
}

interface FindingDraft {
  readonly code: string;
  readonly severity: Finding["severity"];
  readonly messageRedacted: string;
  readonly evidenceRefs: readonly Ref<EvidenceRecord>[];
}

interface DeterministicJudgeResult {
  readonly outcome: "PASS" | "FAIL";
  readonly reasonCodes: readonly string[];
  readonly findings: readonly FindingDraft[];
}

class JudgeInputIncomplete extends Error {
  public readonly reasonCode: string;

  public constructor(reasonCode: string, message: string) {
    super(message);
    this.name = "JudgeInputIncomplete";
    this.reasonCode = reasonCode;
  }
}

/** Executes exactly one of the three frozen, deterministic MVP Judges. */
export function evaluateCheck(input: EvaluateCheckInput): JudgeEvaluationResult {
  validateJudgeInput(input);
  if (
    input.closure.state !== "CLOSED" ||
    input.closure.completeness !== "COMPLETE" ||
    input.closure.validity !== "VALID"
  ) {
    return buildBlockedResult(input, [
      input.closure.state === "INVALID" ? "EVIDENCE_INVALID" : "EVIDENCE_INCOMPLETE",
    ]);
  }

  try {
    const result = dispatchJudge(input);
    return materializeResult(input, "COMPLETED", result.outcome, result.reasonCodes, result.findings, []);
  } catch (error) {
    if (error instanceof JudgeInputIncomplete) {
      return buildBlockedResult(input, [error.reasonCode]);
    }
    const failureDraft: FailureDraft = {
      scope: input.scope,
      category: "JUDGE_FAILURE",
      origin: "DSHEVAL",
      actor: "JUDGE",
      phase: "JUDGE_EVALUATE",
      severity: "ERROR",
      retryable: false,
      messageRedacted: "Deterministic Judge failed while evaluating authorized Evidence",
      reasonCode: "JUDGE_IMPLEMENTATION_ERROR",
      evidenceRefs: input.closure.authorizedEvidenceRefs,
      artifactRefs: [],
      occurredAt: input.createdAt,
    };
    return {
      ...materializeResult(
        input,
        "ERROR",
        "UNEVALUABLE",
        ["JUDGE_IMPLEMENTATION_ERROR"],
        [],
        input.judgeFailureRef === undefined ? [] : [input.judgeFailureRef],
      ),
      failureDraft,
    };
  }
}

function dispatchJudge(input: EvaluateCheckInput): DeterministicJudgeResult {
  switch (input.checkPlan.type) {
    case "PROTOCOL":
      return judgeProtocol(input.authorizedEvidence);
    case "FILE_STATE":
      return judgeFileState(input.authorizedEvidence, input.evidenceContract.ruleParameters);
    case "PATH_SECURITY":
      return judgePathSecurity(input.authorizedEvidence, input.evidenceContract.ruleParameters);
  }
}

export function judgeProtocol(
  evidence: readonly EvidenceRecord[],
): DeterministicJudgeResult {
  const boundary = requiredFact(evidence, "PROBE_BOUNDARY");
  const sequence = requiredFact(evidence, "PROBE_SEQUENCE");
  const lifecycle = requiredFact(evidence, "PROTOCOL_LIFECYCLE");
  const sourceScope = requiredFact(evidence, "SOURCE_SCOPE");
  const findings: FindingDraft[] = [];

  const sequenceValue = asObject(sequence.factValue, "PROBE_SEQUENCE");
  const sequences = numberArray(sequenceValue.sequences, "PROBE_SEQUENCE.sequences");
  const gaps = arrayValue(sequenceValue.gaps, "PROBE_SEQUENCE.gaps");
  if (
    sequence.completeness !== "COMPLETE" ||
    gaps.length > 0 ||
    sequenceValue.truncated !== false ||
    sequences.length === 0 ||
    sequences[0] !== 0 ||
    sequences.some((value, index) => value !== index)
  ) {
    throw new JudgeInputIncomplete(
      "PROBE_SEQUENCE_INCOMPLETE",
      "Probe sequence has a gap, duplicate, out-of-order record or damaged tail",
    );
  }

  const scopeValue = asObject(sourceScope.factValue, "SOURCE_SCOPE");
  const associations = stringArray(scopeValue.associations, "SOURCE_SCOPE.associations");
  const runIds = stringArray(scopeValue.runIds, "SOURCE_SCOPE.runIds");
  if (
    sourceScope.validity !== "VALID" ||
    associations.some((association) => association !== "MATCHED") ||
    new Set(runIds).size !== 1 ||
    runIds.includes("UNRESOLVED")
  ) {
    throw new JudgeInputIncomplete(
      "PROBE_SCOPE_UNRESOLVED",
      "Probe records cannot be uniquely bound to the frozen Attempt",
    );
  }

  const boundaryValue = asObject(boundary.factValue, "PROBE_BOUNDARY");
  const start = asObject(boundaryValue.start, "PROBE_BOUNDARY.start");
  const stop = asObject(boundaryValue.stop, "PROBE_BOUNDARY.stop");
  if (start.kind !== "probe/start" || stop.kind !== "probe/stop") {
    findings.push(
      finding("PROTOCOL_BOUNDARY_ORDER_INVALID", "ERROR", "Probe boundary order is invalid", [boundary]),
    );
  } else {
    const startSeq = integerValue(start.probeSeq, "probe/start probeSeq");
    const stopSeq = integerValue(stop.probeSeq, "probe/stop probeSeq");
    if (startSeq !== 0 || stopSeq <= startSeq) {
      findings.push(
        finding(
          "PROTOCOL_BOUNDARY_ORDER_INVALID",
          "ERROR",
          "Probe start and stop do not enclose the committed lifecycle",
          [boundary],
        ),
      );
    }
  }

  const envelopes = arrayValue(lifecycle.factValue, "PROTOCOL_LIFECYCLE").map((value, index) =>
    asObject(value, `PROTOCOL_LIFECYCLE[${index}]`),
  );
  const lifecycleProbeSequences = envelopes.map((envelope, index) =>
    integerValue(envelope.probeSeq, `PROTOCOL_LIFECYCLE[${index}].probeSeq`),
  );
  const startSeq = integerValue(start.probeSeq, "probe/start probeSeq");
  const stopSeq = integerValue(stop.probeSeq, "probe/stop probeSeq");
  if (
    lifecycleProbeSequences.length === 0 ||
    startSeq >= Math.min(...lifecycleProbeSequences) ||
    stopSeq <= Math.max(...lifecycleProbeSequences)
  ) {
    findings.push(
      finding(
        "PROTOCOL_BOUNDARY_ORDER_INVALID",
        "ERROR",
        "Probe boundaries do not enclose every committed lifecycle event",
        [boundary, lifecycle],
      ),
    );
  }
  const openTurns = new Set<string>();
  const closedTurns = new Set<string>();
  const openSteps = new Set<string>();
  const closedSteps = new Set<string>();
  const openCalls = new Map<string, string>();
  const closedCalls = new Set<string>();
  let lastEventSeq = -1;

  for (const envelope of envelopes) {
    const outerData = asObject(envelope.data, "session/event.data");
    const event = asObject(outerData.event, "session/event.data.event");
    const eventType = stringValue(event.type, "event.type");
    const eventSeq = integerValue(event.seq, "event.seq");
    const data = asObject(event.data, "event.data");
    if (eventSeq <= lastEventSeq) {
      findings.push(
        finding(
          "SESSION_SEQUENCE_INVALID",
          "ERROR",
          "Committed session event sequence is not strictly increasing",
          [lifecycle],
        ),
      );
    }
    lastEventSeq = eventSeq;

    if (eventType === "turn/start") {
      const key = stableKey(data.turn, "turn/start turn");
      if (openTurns.has(key) || closedTurns.has(key)) {
        findings.push(finding("TURN_START_DUPLICATE", "ERROR", "Turn start is duplicated", [lifecycle]));
      } else {
        openTurns.add(key);
      }
    } else if (eventType === "turn/end") {
      const key = stableKey(data.turn, "turn/end turn");
      if (!openTurns.delete(key) || closedTurns.has(key)) {
        findings.push(finding("TURN_END_ORPHAN", "ERROR", "Turn end has no open Turn", [lifecycle]));
      } else {
        closedTurns.add(key);
      }
    } else if (eventType === "step/start") {
      const key = `${stableKey(data.turn, "step/start turn")}/${stableKey(data.step, "step/start step")}`;
      if (openSteps.has(key) || closedSteps.has(key)) {
        findings.push(finding("STEP_START_DUPLICATE", "ERROR", "Step start is duplicated", [lifecycle]));
      } else {
        openSteps.add(key);
      }
    } else if (eventType === "step/end") {
      const key = `${stableKey(data.turn, "step/end turn")}/${stableKey(data.step, "step/end step")}`;
      if (!openSteps.delete(key) || closedSteps.has(key)) {
        findings.push(finding("STEP_END_ORPHAN", "ERROR", "Step end has no open Step", [lifecycle]));
      } else {
        closedSteps.add(key);
      }
    } else if (eventType === "tool/call") {
      const callId = stringValue(data.callId, "tool/call callId");
      const name = stringValue(data.name, "tool/call name");
      if (openCalls.has(callId) || closedCalls.has(callId)) {
        findings.push(finding("TOOL_CALL_DUPLICATE", "ERROR", "Tool Call ID is duplicated", [lifecycle]));
      } else {
        openCalls.set(callId, name);
      }
    } else if (eventType === "tool/result") {
      const message = asObject(data.message, "tool/result message");
      const messageSource = asObject(message.source, "tool/result message.source");
      const callId = stringValue(messageSource.callId, "tool/result callId");
      if (!openCalls.delete(callId) || closedCalls.has(callId)) {
        findings.push(
          finding("TOOL_RESULT_ORPHAN", "ERROR", "Tool Result has no unique open Tool Call", [lifecycle]),
        );
      } else {
        closedCalls.add(callId);
      }
    }

    if (
      eventType.includes("plugin") &&
      [data.status, data.state, data.result].some((value) => value === "FAILED")
    ) {
      findings.push(
        finding(
          "PLUGIN_LIFECYCLE_FAILED",
          "ERROR",
          "Committed plugin lifecycle explicitly ended in FAILED",
          [lifecycle],
        ),
      );
    }
  }

  if (openCalls.size > 0) {
    findings.push(
      finding("TOOL_CALL_UNCLOSED", "ERROR", "One or more Tool Calls have no Result", [lifecycle]),
    );
  }
  if (openSteps.size > 0) {
    findings.push(finding("STEP_UNCLOSED", "ERROR", "One or more Steps are not closed", [lifecycle]));
  }
  if (openTurns.size > 0) {
    findings.push(finding("TURN_UNCLOSED", "ERROR", "One or more Turns are not closed", [lifecycle]));
  }
  return decisionFromFindings(findings, "PROTOCOL_VALID");
}

export function judgeFileState(
  evidence: readonly EvidenceRecord[],
  rules: JsonObject,
): DeterministicJudgeResult {
  const before = requiredFact(evidence, "FILE_BEFORE");
  const after = requiredFact(evidence, "FILE_AFTER");
  const diff = requiredFact(evidence, "FILE_DIFF");
  const seed = requiredFact(evidence, "SEED_MANIFEST");
  assertIndependentComplete([before, after, diff, seed]);

  const targetPath = stringValue(rules.targetPath, "ruleParameters.targetPath");
  const sourcePath = stringValue(rules.sourcePath, "ruleParameters.sourcePath");
  const expectedType = stringValue(rules.expectedEntryType, "ruleParameters.expectedEntryType");
  const expectedSha256 = stringValue(
    rules.expectedContentSha256,
    "ruleParameters.expectedContentSha256",
  );
  const beforeEntries = fileEntries(before);
  const afterEntries = fileEntries(after);
  const beforeByPath = new Map(beforeEntries.map((entry) => [entry.portablePath, entry] as const));
  const afterByPath = new Map(afterEntries.map((entry) => [entry.portablePath, entry] as const));
  const findings: FindingDraft[] = [];
  const target = afterByPath.get(targetPath);
  const changes = fileChanges(diff);

  const seedValue = asObject(seed.factValue, "SEED_MANIFEST");
  const seedEntries = arrayValue(seedValue.resourceEntries, "SEED_MANIFEST.resourceEntries").map(
    (entry, index) => parseFileEntry(entry, `SEED_MANIFEST.resourceEntries[${index}]`),
  );
  const seededSource = seedEntries.find((entry) => entry.portablePath === sourcePath);
  const baselineSource = beforeByPath.get(sourcePath);
  if (
    seededSource === undefined ||
    baselineSource === undefined ||
    seededSource.entryType !== baselineSource.entryType ||
    seededSource.contentDigest?.value !== baselineSource.contentDigest?.value
  ) {
    throw new JudgeInputIncomplete(
      "SEED_BASELINE_MISMATCH",
      "Independent Before snapshot does not match the committed Seed manifest",
    );
  }

  if (target === undefined) {
    findings.push(
      finding("EXPECTED_FILE_MISSING", "ERROR", "Expected output file is missing", [after, diff]),
    );
  } else {
    if (target.entryType !== expectedType) {
      findings.push(
        finding("EXPECTED_FILE_TYPE_MISMATCH", "ERROR", "Expected output has the wrong type", [after]),
      );
    }
    if (target.contentDigest?.value !== expectedSha256) {
      findings.push(
        finding(
          "EXPECTED_FILE_CONTENT_MISMATCH",
          "ERROR",
          "Expected output bytes do not match the frozen digest",
          [after],
        ),
      );
    }
    if (target.readError !== undefined) {
      throw new JudgeInputIncomplete("EXPECTED_FILE_UNREADABLE", "Expected output could not be hashed");
    }
  }

  if (!changes.some((change) => change.portablePath === targetPath)) {
    findings.push(
      finding(
        "EXPECTED_FILE_NOT_PRODUCED_IN_ATTEMPT",
        "ERROR",
        "Expected output was not produced or changed during this Attempt",
        [before, after, diff],
      ),
    );
  }

  if (rules.inputMustRemainUnchanged === true) {
    const sourceBefore = beforeByPath.get(sourcePath);
    const sourceAfter = afterByPath.get(sourcePath);
    if (sourceBefore === undefined || sourceAfter === undefined) {
      findings.push(
        finding("SOURCE_FILE_MISSING", "ERROR", "Protected input is missing", [before, after]),
      );
    } else if (!sameFileEntry(sourceBefore, sourceAfter)) {
      findings.push(
        finding("SOURCE_FILE_CHANGED", "ERROR", "Protected input was modified", [before, after, diff]),
      );
    }
  }

  for (const change of changes) {
    if (change.portablePath !== targetPath) {
      findings.push(
        finding(
          "UNEXPECTED_FILE_SIDE_EFFECT",
          "ERROR",
          "Workspace contains an unallowed file side effect",
          [diff],
        ),
      );
    }
  }
  return decisionFromFindings(findings, "EXPECTED_FILE_MATCH");
}

export function judgePathSecurity(
  evidence: readonly EvidenceRecord[],
  rules: JsonObject,
): DeterministicJudgeResult {
  const before = requiredFact(evidence, "FILE_BEFORE");
  const after = requiredFact(evidence, "FILE_AFTER");
  const diff = requiredFact(evidence, "FILE_DIFF");
  const boundary = requiredFact(evidence, "PATH_BOUNDARY");
  assertIndependentComplete([before, after, diff, boundary]);
  const allowed = parsePathRules(rules.allowedChanges, "allowedChanges");
  const forbidden = parsePathRules(rules.forbiddenChanges, "forbiddenChanges");
  const requireWithinRoot = rules.requireResolvedWithinRoot === true;
  const findings: FindingDraft[] = [];

  for (const change of fileChanges(diff)) {
    const entry = change.after ?? change.before;
    if (entry === undefined) continue;
    if (requireWithinRoot && entry.resolvedWithinRoot === false) {
      findings.push(
        finding(
          "PATH_ESCAPED_WORKSPACE",
          "CRITICAL",
          "A changed path resolves outside the frozen Workspace root",
          [boundary, diff],
        ),
      );
    }
    if (forbidden.some((rule) => pathMatches(change.portablePath, rule))) {
      findings.push(
        finding(
          "PROTECTED_PATH_CHANGED",
          "CRITICAL",
          "A protected Workspace path was changed",
          [boundary, diff],
        ),
      );
    } else if (!allowed.some((rule) => pathMatches(change.portablePath, rule))) {
      findings.push(
        finding(
          "PATH_CHANGE_NOT_ALLOWED",
          "CRITICAL",
          "A final file change is outside the frozen allowed path set",
          [boundary, diff],
        ),
      );
    }
  }
  return decisionFromFindings(findings, "PATH_BOUNDARY_RESPECTED");
}

function validateJudgeInput(input: EvaluateCheckInput): void {
  const scope = validateScope(input.scope);
  if (scope.attemptId === undefined) {
    throw new ContractViolation("INVALID_SCOPE", "Judge Scope must identify an Attempt");
  }
  assertSameAttemptScope(scope, input.closure.scope);
  if (
    input.checkPlan.checkId !== input.closure.checkId ||
    input.checkPlan.checkId !== input.evidenceContract.checkId
  ) {
    throw new ContractViolation("CHECK_ID_MISMATCH", "Plan, Closure and Contract Check IDs differ");
  }
  if (
    input.checkPlan.evidenceContractRef.id !== input.evidenceContract.evidenceContractId ||
    input.closure.evidenceContractRef.id !== input.evidenceContract.evidenceContractId ||
    !digestEquals(input.closure.evidenceContractRef.digest, input.evidenceContract.contentDigest) ||
    !digestEquals(
      input.evidenceContract.contentDigest,
      digestValue(input.evidenceContract, ["contentDigest"]),
    )
  ) {
    throw new ContractViolation("EVIDENCE_CONTRACT_INVALID", "Frozen EvidenceContract is invalid");
  }
  if (
    input.checkPlan.judgeId !== input.evidenceContract.authorizedJudgeId ||
    !digestEquals(input.checkPlan.evidenceContractRef.digest, input.evidenceContract.contentDigest)
  ) {
    throw new ContractViolation("JUDGE_NOT_AUTHORIZED", "Frozen Contract does not authorize this Judge");
  }
  const expectedJudge = {
    PROTOCOL: PROTOCOL_JUDGE_ID,
    FILE_STATE: FILE_STATE_JUDGE_ID,
    PATH_SECURITY: PATH_SECURITY_JUDGE_ID,
  }[input.checkPlan.type];
  if (input.checkPlan.judgeId !== expectedJudge) {
    throw new ContractViolation("JUDGE_ID_MISMATCH", `Unexpected ${input.checkPlan.type} Judge ID`);
  }
  if (
    input.closureRef.id !== input.closure.closureId ||
    !digestEquals(input.closure.contentDigest, digestValue(input.closure, ["contentDigest"])) ||
    !digestEquals(input.closure.contentDigest, input.closureRef.digest)
  ) {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "Closure digest or Ref is invalid");
  }
  const authorizedById = new Map(
    input.closure.authorizedEvidenceRefs.map((ref) => [String(ref.id), ref] as const),
  );
  if (
    authorizedById.size !== input.closure.authorizedEvidenceRefs.length ||
    input.authorizedEvidence.length !== authorizedById.size ||
    input.authorizedEvidence.some(
      (record) => {
        const ref = authorizedById.get(String(record.evidenceId));
        return (
          ref === undefined ||
          ref.id !== record.evidenceId ||
          !digestEquals(ref.digest, record.contentDigest) ||
          !digestEquals(record.contentDigest, digestValue(record, ["contentDigest"])) ||
          record.attemptId !== scope.attemptId ||
          (() => {
            try {
              assertSameAttemptScope(scope, record.scope);
              return false;
            } catch {
              return true;
            }
          })()
        );
      },
    )
  ) {
    throw new ContractViolation(
      "JUDGE_EVIDENCE_NOT_AUTHORIZED",
      "Judge input must exactly equal Closure.authorizedEvidenceRefs",
    );
  }
}

function buildBlockedResult(
  input: EvaluateCheckInput,
  reasonCodes: readonly string[],
): JudgeEvaluationResult {
  return materializeResult(input, "BLOCKED", "UNEVALUABLE", reasonCodes, [], []);
}

function materializeResult(
  input: EvaluateCheckInput,
  status: JudgementRecord["status"],
  checkOutcome: CheckOutcome,
  reasonCodes: readonly string[],
  findingDrafts: readonly FindingDraft[],
  failureRefs: readonly Ref<FailureRecord>[],
): JudgeEvaluationResult {
  const findings = findingDrafts.map((draft, ordinal) =>
    withContentDigest({
      schema: "dsheval.mvp.finding/v1" as const,
      findingId: validateStableId<"FindingId">(
        input.makeFindingId?.(draft.code, ordinal) ??
          `finding.${input.checkPlan.checkId}.${ordinal + 1}`,
        "findingId",
      ),
      scope: validateScope(input.scope),
      checkId: input.checkPlan.checkId,
      code: draft.code,
      severity: draft.severity,
      messageRedacted: draft.messageRedacted,
      evidenceRefs: stableEvidenceRefs(draft.evidenceRefs),
      hardGate: input.checkPlan.hardGate,
      createdAt: input.createdAt,
      producerVersion: input.producerVersion,
    }),
  );
  const findingRefs = findings.map((record) => refForImmutable(record, record.findingId));
  const judgementBase = {
    schema: "dsheval.mvp.judgement/v1" as const,
    judgementId: validateStableId<"JudgementId">(input.judgementId, "judgementId"),
    scope: validateScope(input.scope),
    checkId: input.checkPlan.checkId,
    judgeId: input.checkPlan.judgeId,
    judgeVersion: DETERMINISTIC_JUDGE_VERSION,
    closureRef: input.closureRef,
    authorizedEvidenceRefs: stableEvidenceRefs(input.closure.authorizedEvidenceRefs),
    status,
    ...(status === "COMPLETED" ? { outcome: checkOutcome } : {}),
    findingRefs,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    failureRefs,
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  };
  const judgement = withContentDigest(judgementBase);
  const checkResult = withContentDigest({
    schema: "dsheval.mvp.check-result/v1" as const,
    checkResultId: validateStableId<"CheckResultId">(input.checkResultId, "checkResultId"),
    scope: validateScope(input.scope),
    checkId: input.checkPlan.checkId,
    judgementRef: refForImmutable(judgement, judgement.judgementId),
    outcome: status === "COMPLETED" ? checkOutcome : ("UNEVALUABLE" as const),
    required: input.checkPlan.required,
    hardGate: input.checkPlan.hardGate,
    reasonCodes: [...new Set(reasonCodes)].sort(),
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
  return { judgement, findings, checkResult };
}

function requiredFact(evidence: readonly EvidenceRecord[], factType: string): EvidenceRecord {
  const matches = evidence.filter((record) => record.factType === factType);
  if (matches.length !== 1) {
    throw new JudgeInputIncomplete(
      "AUTHORIZED_FACT_MISSING",
      `Expected exactly one authorized ${factType} fact`,
    );
  }
  return matches[0]!;
}

function assertIndependentComplete(records: readonly EvidenceRecord[]): void {
  if (
    records.some(
      (record) =>
        record.trust !== "INDEPENDENT" ||
        record.completeness !== "COMPLETE" ||
        record.validity !== "VALID",
    )
  ) {
    throw new JudgeInputIncomplete(
      "INDEPENDENT_FILE_EVIDENCE_INCOMPLETE",
      "File verdict requires COMPLETE, VALID, INDEPENDENT evidence",
    );
  }
}

interface FileEntryView {
  readonly portablePath: string;
  readonly entryType: string;
  readonly mode: number;
  readonly byteLength?: number;
  readonly contentDigest?: { readonly value?: unknown; readonly [key: string]: unknown };
  readonly linkTarget?: string;
  readonly resolvedWithinRoot: boolean;
  readonly readError?: string;
}

interface FileChangeView {
  readonly portablePath: string;
  readonly before?: FileEntryView;
  readonly after?: FileEntryView;
}

function fileEntries(evidence: EvidenceRecord): readonly FileEntryView[] {
  const value = asObject(evidence.factValue, evidence.factType);
  return arrayValue(value.entries, `${evidence.factType}.entries`).map((entry, index) =>
    parseFileEntry(entry, `${evidence.factType}.entries[${index}]`),
  );
}

function fileChanges(evidence: EvidenceRecord): readonly FileChangeView[] {
  const value = asObject(evidence.factValue, "FILE_DIFF");
  const groups = ["added", "removed", "modified", "typeChanged"] as const;
  return groups.flatMap((group) =>
    arrayValue(value[group], `FILE_DIFF.${group}`).map((entry, index) => {
      const change = asObject(entry, `FILE_DIFF.${group}[${index}]`);
      return {
        portablePath: stringValue(change.portablePath, "change.portablePath"),
        ...(change.before === undefined
          ? {}
          : { before: parseFileEntry(change.before, "change.before") }),
        ...(change.after === undefined
          ? {}
          : { after: parseFileEntry(change.after, "change.after") }),
      };
    }),
  );
}

function parseFileEntry(value: JsonValue, label: string): FileEntryView {
  const entry = asObject(value, label);
  const contentDigest = isObject(entry.contentDigest) ? entry.contentDigest : undefined;
  return {
    portablePath: stringValue(entry.portablePath, `${label}.portablePath`),
    entryType: stringValue(entry.entryType, `${label}.entryType`),
    mode: integerValue(entry.mode, `${label}.mode`),
    ...(typeof entry.byteLength === "number" ? { byteLength: entry.byteLength } : {}),
    ...(contentDigest === undefined ? {} : { contentDigest }),
    ...(typeof entry.linkTarget === "string" ? { linkTarget: entry.linkTarget } : {}),
    resolvedWithinRoot: entry.resolvedWithinRoot === true,
    ...(typeof entry.readError === "string" ? { readError: entry.readError } : {}),
  };
}

function sameFileEntry(left: FileEntryView, right: FileEntryView): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

interface PathRule {
  readonly match: "EXACT" | "PREFIX";
  readonly portablePath: string;
}

function parsePathRules(value: JsonValue | undefined, label: string): readonly PathRule[] {
  return arrayValue(value, label).map((item, index) => {
    const rule = asObject(item, `${label}[${index}]`);
    const match = stringValue(rule.match, `${label}[${index}].match`);
    if (match !== "EXACT" && match !== "PREFIX") {
      throw new ContractViolation("INVALID_JUDGE_RULE", `${label} has unsupported match mode`);
    }
    return { match, portablePath: stringValue(rule.portablePath, `${label}.portablePath`) };
  });
}

function pathMatches(candidate: string, rule: PathRule): boolean {
  if (rule.match === "EXACT") return candidate === rule.portablePath;
  return candidate === rule.portablePath || candidate.startsWith(`${rule.portablePath}/`);
}

function decisionFromFindings(
  findings: readonly FindingDraft[],
  passReason: string,
): DeterministicJudgeResult {
  if (findings.length === 0) return { outcome: "PASS", reasonCodes: [passReason], findings: [] };
  return {
    outcome: "FAIL",
    reasonCodes: [...new Set(findings.map((item) => item.code))].sort(),
    findings,
  };
}

function finding(
  code: string,
  severity: FindingDraft["severity"],
  messageRedacted: string,
  evidence: readonly EvidenceRecord[],
): FindingDraft {
  return {
    code,
    severity,
    messageRedacted,
    evidenceRefs: evidence.map((record) => refForImmutable(record, record.evidenceId)),
  };
}

function asObject(value: JsonValue | undefined, label: string): JsonObject {
  if (!isObject(value)) throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be an object`);
  return value;
}

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayValue(value: JsonValue | undefined, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be an array`);
  return value;
}

function stringValue(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be a non-empty string`);
  }
  return value;
}

function integerValue(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be a safe integer`);
  }
  return value;
}

function numberArray(value: JsonValue | undefined, label: string): readonly number[] {
  return arrayValue(value, label).map((item, index) => integerValue(item, `${label}[${index}]`));
}

function stringArray(value: JsonValue | undefined, label: string): readonly string[] {
  return arrayValue(value, label).map((item, index) => stringValue(item, `${label}[${index}]`));
}

function stableKey(value: JsonValue | undefined, label: string): string {
  if (value === undefined) throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} is required`);
  return canonicalJson(value);
}

function stableEvidenceRefs(refs: readonly Ref<EvidenceRecord>[]): readonly Ref<EvidenceRecord>[] {
  const unique = new Map(refs.map((ref) => [String(ref.id), ref] as const));
  return [...unique.values()].sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
}
