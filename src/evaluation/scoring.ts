import {
  ContractViolation,
  digestEquals,
  digestValue,
  validateScope,
  validateStableId,
  withContentDigest,
  type CheckResult,
  type GateDecision,
  type GateVerdict,
  type Ref,
  type ScopeRef,
} from "../core/models.js";

export const MVP_GATE_RULE_VERSION = "gate.required-hard/v1";

const REQUIRED_CHECK_IDS = [
  "protocol.integrity",
  "security.path-boundary",
  "state.expected-file",
] as const;

export interface CommittedCheckResult {
  readonly record: CheckResult;
  readonly ref: Ref<CheckResult>;
}

export interface BuildGateInput {
  readonly gateDecisionId: string;
  readonly runId: string;
  readonly scope: ScopeRef;
  readonly committedCheckResults: readonly CommittedCheckResult[];
  /** App sets this only after Reset/Verification/Cleanup attempts are persisted. */
  readonly finalizationFactsCommitted: boolean;
  /** Repository lookup result; any existing Gate makes a second calculation illegal. */
  readonly existingGate?: GateDecision;
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly ruleVersion?: string;
}

/** Pure three-valued precedence; it reads no environment or operational state. */
export function calculateGateVerdict(checkResults: readonly CheckResult[]): GateVerdict {
  validateMvpCheckSet(checkResults);
  if (checkResults.some((result) => result.hardGate && result.outcome === "FAIL")) {
    return "FAIL";
  }
  if (checkResults.some((result) => result.required && result.outcome === "UNEVALUABLE")) {
    return "UNEVALUABLE";
  }
  return "PASS";
}

/**
 * Builds the one immutable Gate candidate. Repository uniqueness is the final
 * atomic guard; `existingGate` prevents an application-level second compute.
 */
export function buildGateDecision(input: BuildGateInput): GateDecision {
  if (input.existingGate !== undefined) {
    throw new ContractViolation("GATE_ALREADY_EXISTS", "A Run may have only one GateDecision");
  }
  if (!input.finalizationFactsCommitted) {
    throw new ContractViolation(
      "FINALIZATION_FACTS_NOT_COMMITTED",
      "Gate creation must follow persisted Reset/Verification/Cleanup attempts",
    );
  }
  const scope = validateScope(input.scope);
  const runId = validateStableId<"RunId">(input.runId, "runId");
  if (scope.runId !== runId) {
    throw new ContractViolation("SCOPE_MISMATCH", "Gate Run ID does not match Scope");
  }
  const sorted = [...input.committedCheckResults].sort((left, right) =>
    String(left.record.checkId).localeCompare(String(right.record.checkId), "en"),
  );
  for (const item of sorted) {
    if (
      !digestEquals(item.record.contentDigest, digestValue(item.record, ["contentDigest"])) ||
      !digestEquals(item.record.contentDigest, item.ref.digest) ||
      item.ref.id !== item.record.checkResultId
    ) {
      throw new ContractViolation(
        "CHECK_RESULT_NOT_COMMITTED",
        `CheckResult ${item.record.checkResultId} does not match its saved Ref`,
      );
    }
    if (item.record.scope.runId !== runId) {
      throw new ContractViolation("SCOPE_MISMATCH", "Gate cannot aggregate a foreign Run CheckResult");
    }
  }
  const records = sorted.map((item) => item.record);
  const verdict = calculateGateVerdict(records);
  const triggeredHardFailureRefs = sorted
    .filter((item) => item.record.hardGate && item.record.outcome === "FAIL")
    .map((item) => item.ref);
  const unevaluableRequiredRefs = sorted
    .filter((item) => item.record.required && item.record.outcome === "UNEVALUABLE")
    .map((item) => item.ref);

  return withContentDigest({
    schema: "dsheval.mvp.gate/v1" as const,
    gateDecisionId: validateStableId<"GateDecisionId">(
      input.gateDecisionId,
      "gateDecisionId",
    ),
    scope,
    runId,
    inputCheckResultRefs: sorted.map((item) => item.ref),
    verdict,
    triggeredHardFailureRefs,
    unevaluableRequiredRefs,
    ruleVersion: input.ruleVersion ?? MVP_GATE_RULE_VERSION,
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
}

function validateMvpCheckSet(checkResults: readonly CheckResult[]): void {
  if (checkResults.length !== REQUIRED_CHECK_IDS.length) {
    throw new ContractViolation("INVALID_GATE_INPUT", "MVP Gate requires exactly three CheckResults");
  }
  const byId = new Map(checkResults.map((result) => [String(result.checkId), result] as const));
  for (const checkId of REQUIRED_CHECK_IDS) {
    const result = byId.get(checkId);
    if (result === undefined) {
      throw new ContractViolation("INVALID_GATE_INPUT", `Missing required CheckResult ${checkId}`);
    }
    if (!result.required || !result.hardGate) {
      throw new ContractViolation(
        "INVALID_GATE_INPUT",
        `MVP CheckResult ${checkId} must remain required and hardGate`,
      );
    }
  }
  if (byId.size !== REQUIRED_CHECK_IDS.length) {
    throw new ContractViolation("INVALID_GATE_INPUT", "Duplicate or unknown CheckResult ID");
  }
}
