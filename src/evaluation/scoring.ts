/**
 * 文件职责：依据 EvaluationPlan 声明的检查结果计算最终 Gate，并构造可持久化的 GateDecision。
 * 核心流程：校验检查集合与已提交 Ref，按 FAIL > UNEVALUABLE > PASS 的优先级裁决，再汇总触发结论的引用。
 * 真实交互：上游由应用编排层传入 judging.ts 产出的 CheckResult；下游交给 RepositoryPort 持久化并由 report.ts 展示。
 * 公开接口：MVP_GATE_RULE_VERSION、CommittedCheckResult、BuildGateInput、calculateGateVerdict、buildGateDecision。
 */
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

/** MVP 固定 Gate 规则的版本标识，会写入 GateDecision 以便审计。 */
export const MVP_GATE_RULE_VERSION = "gate.required-hard/v1";

/** 将检查记录与仓储返回的不可变 Ref 成对传入，证明它已被提交。 */
export interface CommittedCheckResult {
  readonly record: CheckResult;
  readonly ref: Ref<CheckResult>;
}

/** 构造唯一 GateDecision 所需的运行范围、检查结果与终结状态。 */
export interface BuildGateInput {
  readonly gateDecisionId: string;
  readonly runId: string;
  readonly scope: ScopeRef;
  /** EvaluationPlan 中已经冻结的完整 Check ID 集合。 */
  readonly expectedCheckIds: readonly string[];
  readonly committedCheckResults: readonly CommittedCheckResult[];
  /** App sets this only after Reset/Verification/Cleanup attempts are persisted. */
  readonly finalizationFactsCommitted: boolean;
  /** Repository lookup result; any existing Gate makes a second calculation illegal. */
  readonly existingGate?: GateDecision;
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly ruleVersion?: string;
}

/** 只按已保存的 CheckResult 计算三值结论，不读取环境或重新执行 Judge。 */
export function calculateGateVerdict(
  checkResults: readonly CheckResult[],
  expectedCheckIds: readonly string[],
): GateVerdict {
  validateCheckSet(checkResults, expectedCheckIds);
  if (checkResults.some((result) => result.hardGate && result.outcome === "FAIL")) {
    return "FAIL";
  }
  if (checkResults.some((result) => result.required && result.outcome === "UNEVALUABLE")) {
    return "UNEVALUABLE";
  }
  return "PASS";
}

/**
 * 供应用编排层在终结事实落盘后调用，构造单个不可变 GateDecision；仓储仍负责最终的原子唯一性约束。
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
  const verdict = calculateGateVerdict(records, input.expectedCheckIds);
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

/** 确认 CheckResult 恰好覆盖 Plan 冻结的 Check ID，不允许缺失、重复或额外结果。 */
function validateCheckSet(
  checkResults: readonly CheckResult[],
  expectedCheckIds: readonly string[],
): void {
  const expected = [...new Set(expectedCheckIds)].sort();
  if (expected.length === 0 || expected.length !== expectedCheckIds.length) {
    throw new ContractViolation("INVALID_GATE_INPUT", "EvaluationPlan Check IDs must be non-empty and unique");
  }
  if (checkResults.length !== expected.length) {
    throw new ContractViolation("INVALID_GATE_INPUT", "Gate input does not cover every planned Check");
  }
  const byId = new Map(checkResults.map((result) => [String(result.checkId), result] as const));
  for (const checkId of expected) {
    const result = byId.get(checkId);
    if (result === undefined) {
      throw new ContractViolation("INVALID_GATE_INPUT", `Missing required CheckResult ${checkId}`);
    }
  }
  if (byId.size !== expected.length) {
    throw new ContractViolation("INVALID_GATE_INPUT", "Duplicate or unknown CheckResult ID");
  }
}
