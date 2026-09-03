/**
 * 测试功能：验证 Attention MVP 使用的三个 Judge、证据不足语义和计划驱动的 Gate。
 * 测试直接调用 evaluation 的公开接口，不依赖旧文件复制题的任何 ID 或规则。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  digestValue,
  refForImmutable,
  validateRef,
  validateScope,
  validateStableId,
  withContentDigest,
  type CheckResult,
  type EvidenceBundle,
  type EvidenceClosure,
  type EvidenceContract,
  type EvidenceRecord,
  type JudgementRecord,
  type JsonValue,
  type SourceTrust,
} from "../../src/core/models.js";
import {
  ARTIFACT_PRESENT_JUDGE,
  evaluateCheck,
  judgeArtifactPresent,
  judgeResponsePresent,
  judgeToolCompleted,
} from "../../src/evaluation/judging.js";
import { calculateGateVerdict } from "../../src/evaluation/scoring.js";

const NOW = "2026-09-01T00:00:00.000Z";
const scope = validateScope({
  targetId: "target.fixture",
  targetSnapshotId: "target-snapshot.fixture",
  runId: "run.fixture",
  caseId: "case.fixture",
  attemptId: "attempt.fixture",
});

function evidence(
  id: string,
  factType: string,
  factValue: JsonValue,
  trust: SourceTrust = "INDEPENDENT",
): EvidenceRecord {
  return withContentDigest({
    schema: "dsheval.mvp.evidence/v1" as const,
    evidenceId: validateStableId<"EvidenceId">(id),
    scope,
    attemptId: scope.attemptId!,
    factType,
    factValue,
    sourceRefs: [],
    observationRefs: [],
    artifactRefs: [],
    authority: "COMMITTED" as const,
    timeRange: {},
    completeness: "COMPLETE" as const,
    validity: "VALID" as const,
    trust,
    createdAt: NOW,
    producerVersion: "0.1.0",
  });
}

function lifecycleEvents(events: readonly JsonValue[]): EvidenceRecord {
  return evidence(
    "evidence.lifecycle",
    "PROTOCOL_LIFECYCLE",
    events.map((event) => ({ data: { event } })),
    "COOPERATIVE",
  );
}

test("Artifact Judge 只在独立观测确认产物存在且本次产生时 PASS", () => {
  const after = evidence("evidence.file-after", "FILE_AFTER", {
    entries: [{ portablePath: "output/attention.py", entryType: "FILE", byteLength: 420 }],
  });
  const changed = evidence("evidence.file-diff", "FILE_DIFF", {
    added: [{ portablePath: "output/attention.py" }],
    modified: [],
    typeChanged: [],
  });
  const rules = { requiredPaths: ["output/attention.py"], minimumBytes: 32 };
  assert.equal(judgeArtifactPresent([after, changed], rules).outcome, "PASS");

  const unchanged = evidence("evidence.file-diff-unchanged", "FILE_DIFF", {
    added: [],
    modified: [],
    typeChanged: [],
  });
  const failed = judgeArtifactPresent([after, unchanged], rules);
  assert.equal(failed.outcome, "FAIL");
  assert.deepEqual(failed.reasonCodes, ["ARTIFACT_NOT_PRODUCED"]);
});

test("Tool Judge 根据 Trace 中匹配的成功工具调用判定", () => {
  const success = lifecycleEvents([
    { type: "tool/call", data: { callId: "python-1", name: "python" } },
    { type: "tool/result", data: { callId: "python-1", status: "completed" } },
  ]);
  const failed = lifecycleEvents([
    { type: "tool/call", data: { callId: "python-1", name: "python" } },
    { type: "tool/result", data: { callId: "python-1", status: "failed" } },
  ]);
  const rules = { toolNamePatterns: ["python", "shell"] };
  assert.equal(judgeToolCompleted([success], rules).outcome, "PASS");
  assert.equal(judgeToolCompleted([failed], rules).outcome, "FAIL");
});

test("Response Judge 要求 Trace 中存在达到最小长度的最终回答", () => {
  const response = lifecycleEvents([
    { type: "assistant/final", data: { text: "Attention uses query, key and value vectors." } },
  ]);
  assert.equal(judgeResponsePresent([response], { minimumCharacters: 20 }).outcome, "PASS");
  assert.equal(judgeResponsePresent([response], { minimumCharacters: 80 }).outcome, "FAIL");
});

test("Judge 实现缺失被记录为 JUDGE_FAILURE 和 UNEVALUABLE", async () => {
  const artifactEvidence = evidence("evidence.artifact", "FILE_AFTER", { entries: [] });
  const checkId = validateStableId<"CheckId">("artifact.attention-code");
  const contract = withContentDigest({
    schema: "dsheval.mvp.evidence-contract/v1" as const,
    evidenceContractId: validateStableId<"EvidenceContractId">("contract.attention-artifact"),
    scope,
    checkId,
    requiredFactTypes: ["FILE_AFTER"],
    allowedSourceTypes: ["FILESYSTEM"],
    minimumTrust: "INDEPENDENT" as const,
    minimumCompleteness: "COMPLETE" as const,
    validityRequired: true,
    timeBoundary: {},
    authorizedJudgeId: ARTIFACT_PRESENT_JUDGE.descriptor.judgeId,
    ruleParameters: { judgeVersion: "1.0.0" },
    missingOutcome: "UNEVALUABLE" as const,
    semanticDigest: digestValue("contract-semantic"),
    createdAt: NOW,
    producerVersion: "0.1.0",
  }) satisfies EvidenceContract;
  const contractRef = refForImmutable(contract, contract.evidenceContractId);
  const closure = withContentDigest({
    schema: "dsheval.mvp.evidence-closure/v1" as const,
    closureId: validateStableId<"EvidenceClosureId">("closure.attention-artifact"),
    scope,
    checkId,
    bundleRef: validateRef<EvidenceBundle>({
      schema: "dsheval.mvp.evidence-bundle/v1",
      id: validateStableId<"EvidenceBundleId">("bundle.fixture"),
      digest: digestValue("bundle"),
    }),
    evidenceContractRef: contractRef,
    completeness: "COMPLETE" as const,
    validity: "VALID" as const,
    state: "CLOSED" as const,
    satisfiedRequirements: ["FILE_AFTER"],
    gaps: [],
    authorizedEvidenceRefs: [refForImmutable(artifactEvidence, artifactEvidence.evidenceId)],
    createdAt: NOW,
    producerVersion: "0.1.0",
  }) satisfies EvidenceClosure;
  const result = await evaluateCheck({
    scope,
    checkPlan: {
      checkId,
      type: ARTIFACT_PRESENT_JUDGE.checkType,
      required: true,
      hardGate: true,
      judgeId: ARTIFACT_PRESENT_JUDGE.descriptor.judgeId,
      evidenceContractRef: contractRef,
    },
    closure,
    closureRef: refForImmutable(closure, closure.closureId),
    evidenceContract: contract,
    authorizedEvidence: [artifactEvidence],
    judgementId: "judgement.attention-artifact",
    checkResultId: "check-result.attention-artifact",
    createdAt: NOW,
    producerVersion: "0.1.0",
  }, []);
  assert.equal(result.checkResult.outcome, "UNEVALUABLE");
  assert.equal(result.failureDraft?.category, "JUDGE_FAILURE");
});

function checkResult(checkIdValue: string, outcome: CheckResult["outcome"]): CheckResult {
  const checkId = validateStableId<"CheckId">(checkIdValue);
  return withContentDigest({
    schema: "dsheval.mvp.check-result/v1" as const,
    checkResultId: validateStableId<"CheckResultId">(`result.${checkIdValue}`),
    scope,
    checkId,
    judgementRef: validateRef<JudgementRecord>({
      schema: "dsheval.mvp.judgement/v1",
      id: validateStableId<"JudgementId">(`judgement.${checkIdValue}`),
      digest: digestValue(checkIdValue),
    }),
    outcome,
    required: true,
    hardGate: true,
    reasonCodes: [],
    createdAt: NOW,
    producerVersion: "0.1.0",
  });
}

test("Gate 只接受计划声明的完整 CheckResult 集合", () => {
  const ids = ["artifact.attention-code", "response.attention-explanation", "tool.pytorch-execution"];
  assert.equal(calculateGateVerdict(ids.map((id) => checkResult(id, "PASS")), ids), "PASS");
  assert.equal(
    calculateGateVerdict(ids.map((id, index) => checkResult(id, index === 0 ? "FAIL" : "PASS")), ids),
    "FAIL",
  );
  assert.equal(
    calculateGateVerdict(ids.map((id, index) => checkResult(id, index === 0 ? "UNEVALUABLE" : "PASS")), ids),
    "UNEVALUABLE",
  );
  assert.throws(() => calculateGateVerdict([checkResult(ids[0]!, "PASS")], ids));
});
