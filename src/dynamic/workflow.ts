/** 编排构造、冻结和 15 × 6 × 4 正式运行；两阶段 ID/会话/轨迹严格隔离。 */
import type { CaseSpec, FrozenSuite, Profile, Proposer, RunRecord, SearchPolicy } from "./types.js";
import { RolloutRunner } from "./runner.js";
import { constructCase } from "./search.js";
import { accepted, admitted, score, VERIFIER } from "./scoring.js";
import { digest, list, object, requireThat, unique, validateCase, validatePolicy, validateProfile } from "./validation.js";

export async function constructSuite(cases: CaseSpec[], reference: Profile, policy: SearchPolicy, runner: RolloutRunner,
  proposer: Proposer, components: FrozenSuite["content"]["components"]): Promise<FrozenSuite> {
  cases.forEach(validateCase); validateProfile(reference); validatePolicy(policy);
  requireThat(cases.length > 0, "EMPTY_SUITE", "At least one case required");
  unique(cases.map(c => c.id), "cases"); unique(cases.map(c => c.behavior), "V1 behavior coverage");
  for (const c of cases) requireThat(c.readiness === (runner.mode === "demo" ? "demo" : "reviewed"), "UNREVIEWED_CASE", "DSH requires reviewed cases; demo/template cases cannot become formal data");
  const content: FrozenSuite["content"] = { schema: "dsheval.dynamic.suite/v1", mode: runner.mode, createdAt: new Date().toISOString(),
    referenceProfile: structuredClone(reference), policy: structuredClone(policy), verifier: VERIFIER, components,
    accepted: [], rejected: [], constructionRunIds: [], constructionSessionIds: [] };
  for (const spec of cases) {
    const result = await constructCase(spec, reference, policy, runner, proposer);
    if (result.accepted) content.accepted.push(result.accepted);
    else content.rejected.push({ caseId: spec.id, behavior: spec.behavior, reason: result.reason });
  }
  content.constructionRunIds = [...runner.runIds]; content.constructionSessionIds = [...runner.sessionIds];
  const suite = { digest: digest(content), content };
  await runner.recorder.write("suite", "frozen", suite);
  return suite;
}
export function verifySuite(value: unknown): FrozenSuite {
  const envelope = object(value); const content = object(envelope.content);
  requireThat(envelope.digest === digest(content), "SUITE_DIGEST_MISMATCH", "Frozen suite changed");
  requireThat(content.schema === "dsheval.dynamic.suite/v1" && ["demo", "dsh"].includes(String(content.mode)), "BAD_SUITE", "Unsupported suite");
  requireThat(digest(content.verifier) === digest(VERIFIER), "VERIFIER_CHANGED", "Verifier version changed; reconstruct suite");
  validateProfile(content.referenceProfile); validatePolicy(content.policy);
  const suite = value as FrozenSuite;
  const reference = suite.content.referenceProfile;
  const runIds = list(content.constructionRunIds) as string[];
  const sessions = list(content.constructionSessionIds) as string[];
  unique(runIds, "construction runs"); unique(sessions, "construction sessions");
  const components = object(content.components);
  for (const key of ["runner", "proposer", "judge"]) requireThat(typeof components[key] === "string", "BAD_SUITE", "Missing component lock");
  const frozenCases = list(content.accepted) as FrozenSuite["content"]["accepted"];
  unique(frozenCases.map(f => f.case.id), "frozen case IDs");
  unique(frozenCases.map(f => f.case.behavior), "frozen behaviors");
  const used = new Set<string>(); const usedSessions = new Set<string>();
  for (const frozen of frozenCases) {
    validateCase(frozen.case);
    requireThat(frozen.case.readiness === (suite.content.mode === "demo" ? "demo" : "reviewed"), "UNREVIEWED_CASE", "Wrong case provenance");
    requireThat(typeof frozen.payload === "string" && frozen.payload !== frozen.case.field.benign && Buffer.byteLength(frozen.payload) <= suite.content.policy.maxPayloadBytes,
      "BAD_SUITE", "Frozen payload invalid");
    requireThat(frozen.admission.length === suite.content.policy.benignRepeats && frozen.acceptance.length === suite.content.policy.constructionRepeats, "BAD_SUITE", "Wrong construction repeat count");
    for (const [variant, records] of [["benign", frozen.admission], ["malicious", frozen.acceptance]] as const) {
      for (const [index, record] of records.entries()) {
        const r = record.request;
        requireThat(r.schema === "dsheval.dynamic.request/v1" && r.phase === "construction" && r.variant === variant && r.attempt === index + 1
          && r.mode === suite.content.mode && r.payload === (variant === "benign" ? frozen.case.field.benign : frozen.payload), "BAD_SUITE", "Construction request mismatch");
        requireThat(digest(r.case) === digest(frozen.case) && r.caseDigest === digest(frozen.case)
          && digest(r.profile) === digest(reference) && r.profileDigest === digest(reference)
          && r.initialStateDigest === digest(frozen.case.initialState), "BAD_SUITE", "Construction binding mismatch");
        requireThat(runIds.includes(r.runId) && !used.has(r.runId), "RUN_REUSED", "Invalid construction run membership"); used.add(r.runId);
        requireThat(record.evidence && sessions.includes(record.evidence.sessionId) && !usedSessions.has(record.evidence.sessionId), "SESSION_REUSED", "Invalid construction session membership");
        usedSessions.add(record.evidence.sessionId);
        requireThat(digest(score(r, record.evidence, record.judgments)) === digest(record.score), "SCORE_CHANGED", "Construction score cannot be reproduced");
      }
    }
    requireThat(admitted(frozen.admission.map(r => r.score)) && accepted(frozen.acceptance.map(r => r.score)), "ACCEPTANCE_FAILED", "Unaccepted case in frozen suite");
    requireThat(frozen.admission.every(r => r.evidence!.trace.some(t => t.kind === "exposure" && t.objectId === frozen.case.field.id && t.payloadDigest === digest(frozen.case.field.benign))), "FIELD_UNREACHABLE", "Frozen injection field was not reached in benign admission");
  }
  return suite;
}
export function validateEvaluation(suite: FrozenSuite, profiles: Profile[], components: FrozenSuite["content"]["components"]): void {
  verifySuite(suite);
  profiles.forEach(validateProfile); unique(profiles.map(p => p.id), "evaluation profiles");
  unique(profiles.map(p => digest({ ...p, id: "normalized" })), "distinct profile configurations");
  requireThat(profiles.length === 6, "V1_PROFILE_COUNT", "V1 requires exactly 6 distinct profiles");
  requireThat(suite.content.accepted.length === 15 && Array.from({ length: 15 }, (_, i) => `B${i + 1}`).every(b => suite.content.accepted.some(f => f.case.behavior === b)),
    "V1_COVERAGE_GAP", "V1 requires 15 accepted behaviors; rejected/uncovered cases cannot be silently omitted");
  const ref = suite.content.referenceProfile;
  for (const p of profiles) requireThat(p.model === ref.model && p.modelVersion === ref.modelVersion && p.harnessVersion === ref.harnessVersion && p.image === ref.image
    && digest(p.settings) === digest(ref.settings) && digest(p.permissions) === digest(ref.permissions),
    "BASE_CONFIG_MISMATCH", "Model/version/harness/image/settings/permissions must remain fixed when comparing plugin profiles");
  requireThat(digest(components) === digest(suite.content.components), "COMPONENT_CHANGED", "Runner/proposer/judge configuration differs from frozen suite");
}
export async function evaluateSuite(suite: FrozenSuite, profiles: Profile[], runner: RolloutRunner,
  components: FrozenSuite["content"]["components"]): Promise<RunRecord[]> {
  validateEvaluation(suite, profiles, components);
  requireThat(runner.mode === suite.content.mode, "MODE_MISMATCH", "Demo and DSH evidence must never mix");
  suite.content.constructionRunIds.forEach(id => runner.runIds.add(id));
  suite.content.constructionSessionIds.forEach(id => runner.sessionIds.add(id));
  const records: RunRecord[] = [];
  await runner.recorder.write("evaluation", "manifest", { suiteDigest: suite.digest, profiles, components, expectedRuns: 360 });
  for (const p of profiles) for (const f of suite.content.accepted) {
    records.push(await runner.run(f.case, p, f.case.field.benign, "evaluation", "benign", 1));
    for (let i = 1; i <= 3; i++) records.push(await runner.run(f.case, p, f.payload, "evaluation", "malicious", i));
  }
  await runner.recorder.write("evaluation", "complete", { suiteDigest: suite.digest,
    runDigests: Object.fromEntries(records.map(r => [r.request.runId, digest(r)])), expectedRuns: 360 });
  return records;
}
