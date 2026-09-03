/**
 * 文件功能：通过 Judge 接口评估一个 Check，生成 Judgement、Finding 和 CheckResult。
 *
 * Dataset 只声明 judgeId 和规则参数；Bootstrap 注册真实 JudgeImplementation。Workflow 按 ID
 * 取出实现后调用，因此新增 Judge 不需要修改 dispatch switch。证据不足统一返回 UNEVALUABLE，
 * Agent 不满足规则返回 FAIL，Judge 自身异常单独记录为 JUDGE_FAILURE。
 */
import type { JudgeDescriptor } from "../core/contracts.js";
import {
  ContractViolation,
  assertSameAttemptScope,
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

/** 当前内置规则 Judge 的实现版本。 */
export const RULE_JUDGE_VERSION = "1.0.0";

/** Judge 规则尚未落库的 Finding。 */
export interface JudgeFinding {
  readonly code: string;
  readonly severity: Finding["severity"];
  readonly messageRedacted: string;
  readonly evidenceRefs: readonly Ref<EvidenceRecord>[];
}

/** Judge 实现返回的纯裁决，不包含持久化 ID。 */
export interface JudgeDecision {
  readonly outcome: "PASS" | "FAIL";
  readonly reasonCodes: readonly string[];
  readonly findings: readonly JudgeFinding[];
}

/**
 * Judge 扩展接口。新增规则 Judge 或 LLM Judge 时实现此接口并在 Bootstrap 注册，
 * Dataset Pack 通过 judgeId 选择实现。
 */
export interface JudgeImplementation {
  readonly descriptor: JudgeDescriptor;
  readonly checkType: string;
  evaluate(
    evidence: readonly EvidenceRecord[],
    ruleParameters: JsonObject,
  ): JudgeDecision | Promise<JudgeDecision>;
}

/** evaluateCheck 的输入图：计划、证据闭包以及闭包授权的证据。 */
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
  readonly judgeFailureRef?: Ref<FailureRecord>;
}

/** 一项 Check 的完整可保存结果。 */
export interface JudgeEvaluationResult {
  readonly judgement: JudgementRecord;
  readonly findings: readonly Finding[];
  readonly checkResult: CheckResult;
  readonly failureDraft?: FailureDraft;
}

/** 证据存在但缺少 Judge 所需字段时抛出；上层会转成 UNEVALUABLE。 */
class JudgeInputIncomplete extends Error {
  public constructor(
    public readonly reasonCode: string,
    message: string,
  ) {
    super(message);
    this.name = "JudgeInputIncomplete";
  }
}

/** 创建内置 Judge 的运行时描述；摘要只描述实现能力，不包含 Dataset 的规则参数。 */
function defineJudge(
  judgeIdValue: string,
  checkType: string,
  evaluate: JudgeImplementation["evaluate"],
): JudgeImplementation {
  const judgeId = validateVersionedAssetId<"JudgeId">(judgeIdValue);
  const capabilityDigest = digestValue({
    judgeId,
    judgeVersion: RULE_JUDGE_VERSION,
    method: "RULE",
    deterministic: true,
    checkType,
  });
  return Object.freeze({
    descriptor: Object.freeze({
      judgeId,
      judgeVersion: RULE_JUDGE_VERSION,
      method: "RULE" as const,
      deterministic: true,
      checkType,
      capabilityDigest,
    }),
    checkType,
    evaluate,
  });
}

/** 通用协议完整性 Judge，可被需要可靠 Trace 的标签复用。 */
export const PROTOCOL_JUDGE = defineJudge(
  "judge.protocol.integrity/v1",
  "PROTOCOL_INTEGRITY",
  (evidence) => judgeProtocol(evidence),
);

/** 检查 Agent 是否产生 Dataset 声明的代码产物。 */
export const ARTIFACT_PRESENT_JUDGE = defineJudge(
  "judge.artifact.presence/v1",
  "ARTIFACT_PRESENT",
  (evidence, rules) => judgeArtifactPresent(evidence, rules),
);

/** 检查 DSH Trace 中是否出现成功完成的指定工具调用。 */
export const TOOL_COMPLETED_JUDGE = defineJudge(
  "judge.tool.completed/v1",
  "TOOL_COMPLETED",
  (evidence, rules) => judgeToolCompleted(evidence, rules),
);

/** 检查 DSH Trace 中是否存在非空最终回答。 */
export const RESPONSE_PRESENT_JUDGE = defineJudge(
  "judge.response.present/v1",
  "RESPONSE_PRESENT",
  (evidence, rules) => judgeResponsePresent(evidence, rules),
);

/** Bootstrap 默认注册的真实 Judge 实现。 */
export const BUILT_IN_JUDGES: readonly JudgeImplementation[] = Object.freeze([
  ARTIFACT_PRESENT_JUDGE,
  PROTOCOL_JUDGE,
  RESPONSE_PRESENT_JUDGE,
  TOOL_COMPLETED_JUDGE,
].sort((left, right) => left.descriptor.judgeId.localeCompare(right.descriptor.judgeId, "en")));

/** 返回 Planner 用来匹配 Dataset 声明的 Judge 能力列表。 */
export function judgeDescriptors(
  implementations: readonly JudgeImplementation[] = BUILT_IN_JUDGES,
): readonly JudgeDescriptor[] {
  return Object.freeze(implementations.map((implementation) => implementation.descriptor));
}

/**
 * 验证证据图并调用 Dataset 选定的 Judge。该函数是 Workflow 唯一的 Judge 入口，
 * 同时兼容同步规则和异步 LLM 实现。
 */
export async function evaluateCheck(
  input: EvaluateCheckInput,
  implementations: readonly JudgeImplementation[] = BUILT_IN_JUDGES,
): Promise<JudgeEvaluationResult> {
  validateJudgeInput(input);
  const matches = implementations.filter(
    (implementation) =>
      implementation.descriptor.judgeId === input.checkPlan.judgeId &&
      implementation.checkType === input.checkPlan.type,
  );
  const implementation = matches.length === 1 ? matches[0] : undefined;
  const declaredVersion = stringOr(
    input.evidenceContract.ruleParameters.judgeVersion,
    implementation?.descriptor.judgeVersion ?? "UNKNOWN",
  );

  if (
    input.closure.state !== "CLOSED" ||
    input.closure.completeness !== "COMPLETE" ||
    input.closure.validity !== "VALID"
  ) {
    return materializeResult(
      input,
      declaredVersion,
      "BLOCKED",
      "UNEVALUABLE",
      [input.closure.state === "INVALID" ? "EVIDENCE_INVALID" : "EVIDENCE_INCOMPLETE"],
      [],
      [],
    );
  }
  if (implementation === undefined) {
    return judgeFailureResult(input, declaredVersion, "JUDGE_IMPLEMENTATION_UNAVAILABLE");
  }

  try {
    const decision = await implementation.evaluate(
      input.authorizedEvidence,
      input.evidenceContract.ruleParameters,
    );
    return materializeResult(
      input,
      implementation.descriptor.judgeVersion,
      "COMPLETED",
      decision.outcome,
      decision.reasonCodes,
      decision.findings,
      [],
    );
  } catch (error) {
    if (error instanceof JudgeInputIncomplete) {
      return materializeResult(
        input,
        implementation.descriptor.judgeVersion,
        "BLOCKED",
        "UNEVALUABLE",
        [error.reasonCode],
        [],
        [],
      );
    }
    return judgeFailureResult(input, implementation.descriptor.judgeVersion, "JUDGE_IMPLEMENTATION_ERROR");
  }
}

/** 协议 Judge：确认 Probe 起止、连续序列、Scope 绑定和工具调用闭合。 */
export function judgeProtocol(evidence: readonly EvidenceRecord[]): JudgeDecision {
  const boundary = requiredFact(evidence, "PROBE_BOUNDARY");
  const sequence = requiredFact(evidence, "PROBE_SEQUENCE");
  const lifecycle = requiredFact(evidence, "PROTOCOL_LIFECYCLE");
  const sourceScope = requiredFact(evidence, "SOURCE_SCOPE");
  const sequenceValue = asObject(sequence.factValue, "PROBE_SEQUENCE");
  const sequences = numberArray(sequenceValue.sequences, "PROBE_SEQUENCE.sequences");
  const gaps = arrayValue(sequenceValue.gaps, "PROBE_SEQUENCE.gaps");
  if (
    gaps.length > 0 ||
    sequenceValue.truncated !== false ||
    sequences.length === 0 ||
    sequences.some((value, index) => value !== index)
  ) {
    throw new JudgeInputIncomplete("PROBE_SEQUENCE_INCOMPLETE", "Probe sequence is incomplete");
  }
  const scopeValue = asObject(sourceScope.factValue, "SOURCE_SCOPE");
  const associations = stringArray(scopeValue.associations, "SOURCE_SCOPE.associations");
  if (associations.some((association) => association !== "MATCHED")) {
    throw new JudgeInputIncomplete("PROBE_SCOPE_UNRESOLVED", "Probe records do not belong to this Attempt");
  }
  const boundaryValue = asObject(boundary.factValue, "PROBE_BOUNDARY");
  const start = asObject(boundaryValue.start, "PROBE_BOUNDARY.start");
  const stop = asObject(boundaryValue.stop, "PROBE_BOUNDARY.stop");
  const findings: JudgeFinding[] = [];
  if (start.kind !== "probe/start" || stop.kind !== "probe/stop") {
    findings.push(finding("PROTOCOL_BOUNDARY_INVALID", "ERROR", "Probe start or stop is invalid", [boundary]));
  }
  const events = lifecycleEvents(lifecycle);
  const openCalls = new Set<string>();
  for (const event of events) {
    if (event.type === "tool/call") openCalls.add(stringValue(event.data.callId, "tool/call.callId"));
    if (event.type === "tool/result") openCalls.delete(resultCallId(event.data));
  }
  if (openCalls.size > 0) {
    findings.push(finding("TOOL_CALL_UNCLOSED", "ERROR", "A Tool Call has no Result", [lifecycle]));
  }
  return decision(findings, "PROTOCOL_VALID");
}

/** 代码产物 Judge：要求指定路径在 Attempt 中被创建或修改，并且是非空普通文件。 */
export function judgeArtifactPresent(
  evidence: readonly EvidenceRecord[],
  rules: JsonObject,
): JudgeDecision {
  const after = requiredFact(evidence, "FILE_AFTER");
  const diff = requiredFact(evidence, "FILE_DIFF");
  assertIndependentComplete([after, diff]);
  const paths = stringArray(rules.requiredPaths, "ruleParameters.requiredPaths");
  const minimumBytes = integerValue(rules.minimumBytes, "ruleParameters.minimumBytes");
  const entries = new Map(fileEntries(after).map((entry) => [entry.portablePath, entry] as const));
  const changed = new Set(fileChanges(diff));
  const findings: JudgeFinding[] = [];
  for (const path of paths) {
    const entry = entries.get(path);
    if (entry === undefined) {
      findings.push(finding("ARTIFACT_MISSING", "ERROR", `Required artifact ${path} is missing`, [after]));
    } else if (entry.entryType !== "FILE" || entry.readError !== undefined || (entry.byteLength ?? 0) < minimumBytes) {
      findings.push(finding("ARTIFACT_INVALID", "ERROR", `Required artifact ${path} is not a readable non-empty file`, [after]));
    } else if (!changed.has(path)) {
      findings.push(finding("ARTIFACT_NOT_PRODUCED", "ERROR", `Required artifact ${path} was not produced in this Attempt`, [diff]));
    }
  }
  return decision(findings, "REQUIRED_ARTIFACTS_PRESENT");
}

/** 工具 Judge：在 Trace 中查找名称匹配且具有成功 Result 的工具调用。 */
export function judgeToolCompleted(
  evidence: readonly EvidenceRecord[],
  rules: JsonObject,
): JudgeDecision {
  const lifecycle = requiredFact(evidence, "PROTOCOL_LIFECYCLE");
  const patterns = stringArray(rules.toolNamePatterns, "ruleParameters.toolNamePatterns");
  const events = lifecycleEvents(lifecycle);
  const calls = new Map<string, string>();
  const successful = new Set<string>();
  for (const event of events) {
    if (event.type === "tool/call") {
      calls.set(
        stringValue(event.data.callId, "tool/call.callId"),
        stringValue(event.data.name, "tool/call.name"),
      );
    } else if (event.type === "tool/result") {
      const callId = resultCallId(event.data);
      const status = stringOr(event.data.status, stringOr(asOptionalObject(event.data.message)?.status, "completed"));
      if (!["failed", "error", "cancelled"].includes(status.toLowerCase())) successful.add(callId);
    }
  }
  const matched = [...calls].some(([callId, name]) =>
    patterns.some((pattern) => name.toLowerCase().includes(pattern.toLowerCase())) && successful.has(callId),
  );
  return matched
    ? { outcome: "PASS", reasonCodes: ["REQUIRED_TOOL_COMPLETED"], findings: [] }
    : {
        outcome: "FAIL",
        reasonCodes: ["REQUIRED_TOOL_NOT_COMPLETED"],
        findings: [finding("REQUIRED_TOOL_NOT_COMPLETED", "ERROR", "Required code execution tool did not complete successfully", [lifecycle])],
      };
}

/** 回答 Judge：检查 Trace 中最终回答事件的文本长度。 */
export function judgeResponsePresent(
  evidence: readonly EvidenceRecord[],
  rules: JsonObject,
): JudgeDecision {
  const lifecycle = requiredFact(evidence, "PROTOCOL_LIFECYCLE");
  const minimumCharacters = integerValue(rules.minimumCharacters, "ruleParameters.minimumCharacters");
  const text = lifecycleEvents(lifecycle)
    .filter((event) => event.type === "assistant/final" || event.type === "message/assistant")
    .map((event) => responseText(event.data))
    .find((value) => value.length >= minimumCharacters);
  return text === undefined
    ? {
        outcome: "FAIL",
        reasonCodes: ["FINAL_RESPONSE_MISSING"],
        findings: [finding("FINAL_RESPONSE_MISSING", "ERROR", "Agent did not emit a sufficiently complete final response", [lifecycle])],
      }
    : { outcome: "PASS", reasonCodes: ["FINAL_RESPONSE_PRESENT"], findings: [] };
}

interface LifecycleEvent {
  readonly type: string;
  readonly data: JsonObject;
}

/** 从标准化 PROTOCOL_LIFECYCLE 事实中解析 session/event。 */
function lifecycleEvents(evidence: EvidenceRecord): readonly LifecycleEvent[] {
  return arrayValue(evidence.factValue, "PROTOCOL_LIFECYCLE").map((value, index) => {
    const envelope = asObject(value, `PROTOCOL_LIFECYCLE[${index}]`);
    const outer = asObject(envelope.data, `PROTOCOL_LIFECYCLE[${index}].data`);
    const event = asObject(outer.event, `PROTOCOL_LIFECYCLE[${index}].data.event`);
    return {
      type: stringValue(event.type, "event.type"),
      data: asObject(event.data, "event.data"),
    };
  });
}

function resultCallId(data: JsonObject): string {
  const direct = typeof data.callId === "string" ? data.callId : undefined;
  if (direct !== undefined) return direct;
  const message = asObject(data.message, "tool/result.message");
  const source = asObject(message.source, "tool/result.message.source");
  return stringValue(source.callId, "tool/result.callId");
}

function responseText(data: JsonObject): string {
  for (const value of [data.text, data.content, data.message]) {
    if (typeof value === "string") return value;
    const object = asOptionalObject(value);
    if (typeof object?.content === "string") return object.content;
    if (typeof object?.text === "string") return object.text;
  }
  return "";
}

/** 核对 Plan、Closure、Contract、Scope 和授权证据集合是否完全一致。 */
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
    !digestEquals(input.evidenceContract.contentDigest, digestValue(input.evidenceContract, ["contentDigest"]))
  ) {
    throw new ContractViolation("EVIDENCE_CONTRACT_INVALID", "Frozen EvidenceContract is invalid");
  }
  if (
    input.checkPlan.judgeId !== input.evidenceContract.authorizedJudgeId ||
    !digestEquals(input.checkPlan.evidenceContractRef.digest, input.evidenceContract.contentDigest)
  ) {
    throw new ContractViolation("JUDGE_NOT_AUTHORIZED", "Frozen Contract does not authorize this Judge");
  }
  if (
    input.closureRef.id !== input.closure.closureId ||
    !digestEquals(input.closure.contentDigest, digestValue(input.closure, ["contentDigest"])) ||
    !digestEquals(input.closure.contentDigest, input.closureRef.digest)
  ) {
    throw new ContractViolation("EVIDENCE_INTEGRITY", "Closure digest or Ref is invalid");
  }
  const authorized = new Map(input.closure.authorizedEvidenceRefs.map((ref) => [String(ref.id), ref] as const));
  if (
    authorized.size !== input.closure.authorizedEvidenceRefs.length ||
    input.authorizedEvidence.length !== authorized.size ||
    input.authorizedEvidence.some((record) => {
      const ref = authorized.get(String(record.evidenceId));
      if (
        ref === undefined ||
        !digestEquals(ref.digest, record.contentDigest) ||
        !digestEquals(record.contentDigest, digestValue(record, ["contentDigest"])) ||
        record.attemptId !== scope.attemptId
      ) return true;
      try {
        assertSameAttemptScope(scope, record.scope);
        return false;
      } catch {
        return true;
      }
    })
  ) {
    throw new ContractViolation("JUDGE_EVIDENCE_NOT_AUTHORIZED", "Judge input differs from Closure authorization");
  }
}

/** 把 Judge 实现异常物化为 ERROR/UNEVALUABLE，并返回单独的失败草稿。 */
function judgeFailureResult(
  input: EvaluateCheckInput,
  judgeVersion: string,
  reasonCode: string,
): JudgeEvaluationResult {
  const failureDraft: FailureDraft = {
    scope: input.scope,
    category: "JUDGE_FAILURE",
    origin: "DSHEVAL",
    actor: "JUDGE",
    phase: "JUDGE_EVALUATE",
    severity: "ERROR",
    retryable: false,
    messageRedacted: "Judge implementation could not evaluate authorized Evidence",
    reasonCode,
    evidenceRefs: input.closure.authorizedEvidenceRefs,
    artifactRefs: [],
    occurredAt: input.createdAt,
  };
  return {
    ...materializeResult(
      input,
      judgeVersion,
      "ERROR",
      "UNEVALUABLE",
      [reasonCode],
      [],
      input.judgeFailureRef === undefined ? [] : [input.judgeFailureRef],
    ),
    failureDraft,
  };
}

/** 为 JudgeDecision 生成可保存的 Finding、JudgementRecord 和 CheckResult。 */
function materializeResult(
  input: EvaluateCheckInput,
  judgeVersion: string,
  status: JudgementRecord["status"],
  outcome: CheckOutcome,
  reasonCodes: readonly string[],
  drafts: readonly JudgeFinding[],
  failureRefs: readonly Ref<FailureRecord>[],
): JudgeEvaluationResult {
  const findings = drafts.map((draft, ordinal) => withContentDigest({
    schema: "dsheval.mvp.finding/v1" as const,
    findingId: validateStableId<"FindingId">(
      input.makeFindingId?.(draft.code, ordinal) ?? `finding.${input.checkPlan.checkId}.${ordinal + 1}`,
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
  }));
  const judgement = withContentDigest({
    schema: "dsheval.mvp.judgement/v1" as const,
    judgementId: validateStableId<"JudgementId">(input.judgementId, "judgementId"),
    scope: validateScope(input.scope),
    checkId: input.checkPlan.checkId,
    judgeId: input.checkPlan.judgeId,
    judgeVersion,
    closureRef: input.closureRef,
    authorizedEvidenceRefs: stableEvidenceRefs(input.closure.authorizedEvidenceRefs),
    status,
    ...(status === "COMPLETED" ? { outcome } : {}),
    findingRefs: findings.map((record) => refForImmutable(record, record.findingId)),
    reasonCodes: sortedUnique(reasonCodes),
    failureRefs,
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
  const checkResult = withContentDigest({
    schema: "dsheval.mvp.check-result/v1" as const,
    checkResultId: validateStableId<"CheckResultId">(input.checkResultId, "checkResultId"),
    scope: validateScope(input.scope),
    checkId: input.checkPlan.checkId,
    judgementRef: refForImmutable(judgement, judgement.judgementId),
    outcome: status === "COMPLETED" ? outcome : "UNEVALUABLE" as const,
    required: input.checkPlan.required,
    hardGate: input.checkPlan.hardGate,
    reasonCodes: sortedUnique(reasonCodes),
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
  return { judgement, findings, checkResult };
}

interface FileEntryView {
  readonly portablePath: string;
  readonly entryType: string;
  readonly byteLength?: number;
  readonly readError?: string;
}

function fileEntries(evidence: EvidenceRecord): readonly FileEntryView[] {
  const value = asObject(evidence.factValue, evidence.factType);
  return arrayValue(value.entries, `${evidence.factType}.entries`).map((item, index) => {
    const entry = asObject(item, `${evidence.factType}.entries[${index}]`);
    return {
      portablePath: stringValue(entry.portablePath, "entry.portablePath"),
      entryType: stringValue(entry.entryType, "entry.entryType"),
      ...(typeof entry.byteLength === "number" ? { byteLength: entry.byteLength } : {}),
      ...(typeof entry.readError === "string" ? { readError: entry.readError } : {}),
    };
  });
}

function fileChanges(evidence: EvidenceRecord): readonly string[] {
  const value = asObject(evidence.factValue, "FILE_DIFF");
  return ["added", "modified", "typeChanged"].flatMap((group) =>
    arrayValue(value[group], `FILE_DIFF.${group}`).map((item) =>
      stringValue(asObject(item, "file change").portablePath, "file change.portablePath"),
    ),
  );
}

function requiredFact(evidence: readonly EvidenceRecord[], factType: string): EvidenceRecord {
  const matches = evidence.filter((record) => record.factType === factType);
  if (matches.length !== 1) {
    throw new JudgeInputIncomplete("AUTHORIZED_FACT_MISSING", `Expected exactly one ${factType} fact`);
  }
  return matches[0]!;
}

function assertIndependentComplete(records: readonly EvidenceRecord[]): void {
  if (records.some((record) =>
    record.trust !== "INDEPENDENT" ||
    record.completeness !== "COMPLETE" ||
    record.validity !== "VALID"
  )) {
    throw new JudgeInputIncomplete("INDEPENDENT_EVIDENCE_INCOMPLETE", "Independent evidence is incomplete");
  }
}

function decision(findings: readonly JudgeFinding[], passReason: string): JudgeDecision {
  return findings.length === 0
    ? { outcome: "PASS", reasonCodes: [passReason], findings: [] }
    : { outcome: "FAIL", reasonCodes: sortedUnique(findings.map((item) => item.code)), findings };
}

function finding(
  code: string,
  severity: JudgeFinding["severity"],
  messageRedacted: string,
  evidence: readonly EvidenceRecord[],
): JudgeFinding {
  return {
    code,
    severity,
    messageRedacted,
    evidenceRefs: evidence.map((record) => refForImmutable(record, record.evidenceId)),
  };
}

function asObject(value: JsonValue | undefined, label: string): JsonObject {
  const object = asOptionalObject(value);
  if (object === undefined) {
    throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be an object`);
  }
  return object;
}

function asOptionalObject(value: JsonValue | undefined): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function arrayValue(value: JsonValue | undefined, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be an array`);
  }
  return value;
}

function stringValue(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be a non-empty string`);
  }
  return value;
}

function stringOr(value: JsonValue | undefined, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function integerValue(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContractViolation("INVALID_JUDGE_INPUT", `${label} must be a non-negative integer`);
  }
  return value;
}

function numberArray(value: JsonValue | undefined, label: string): readonly number[] {
  return arrayValue(value, label).map((item, index) => integerValue(item, `${label}[${index}]`));
}

function stringArray(value: JsonValue | undefined, label: string): readonly string[] {
  return arrayValue(value, label).map((item, index) => stringValue(item, `${label}[${index}]`));
}

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "en"));
}

function stableEvidenceRefs(refs: readonly Ref<EvidenceRecord>[]): readonly Ref<EvidenceRecord>[] {
  const unique = new Map(refs.map((ref) => [String(ref.id), ref] as const));
  return [...unique.values()].sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
}
