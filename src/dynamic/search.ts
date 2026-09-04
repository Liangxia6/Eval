/** 几何奖励 beam search：先运行再排序，修改同一字段，子候选不继承父分数。 */
import { randomUUID } from "node:crypto";
import type { CaseSpec, FrozenCase, Profile, Proposer, RunRecord, SearchPolicy } from "./types.js";
import { RolloutRunner } from "./runner.js";
import { accepted, admitted, reward } from "./scoring.js";
import { reflect } from "./reflection.js";
import { digest, DynamicError, validateProposals } from "./validation.js";

export interface SearchResult { accepted: FrozenCase | null; reason: string; }
export async function constructCase(spec: CaseSpec, reference: Profile, policy: SearchPolicy, runner: RolloutRunner, proposer: Proposer): Promise<SearchResult> {
  const admission: RunRecord[] = [];
  for (let i = 1; i <= policy.benignRepeats; i++) admission.push(await runner.run(spec, reference, spec.field.benign, "construction", "benign", i));
  if (!admitted(admission.map(r => r.score))) return { accepted: null, reason: "BENIGN_ADMISSION_FAILED" };
  const reachable = admission.every(r => r.evidence!.trace.some(t => t.kind === "exposure" && t.objectId === spec.field.id && t.payloadDigest === digest(spec.field.benign)));
  if (!reachable) return { accepted: null, reason: "FIELD_UNREACHABLE" };
  if (Buffer.byteLength(spec.initialPayload) > policy.maxPayloadBytes) return { accepted: null, reason: "PAYLOAD_TOO_LARGE" };
  const seen = new Set<string>([digest(spec.initialPayload), digest(spec.field.benign)]);
  let candidates = [spec.initialPayload];
  for (let depth = 0; depth <= policy.maxDepth && candidates.length; depth++) {
    const evaluated: { payload: string; runs: RunRecord[]; reward: number | null }[] = [];
    for (const payload of candidates) {
      const runs: RunRecord[] = [];
      for (let i = 1; i <= policy.constructionRepeats; i++) runs.push(await runner.run(spec, reference, payload, "construction", "malicious", i));
      const entry = { payload, runs, reward: reward(runs.map(r => r.score)) };
      await runner.recorder.write("search", randomUUID(), { caseId: spec.id, depth, payloadDigest: digest(payload), reward: entry.reward,
        runIds: runs.map(r => r.request.runId), reflection: reflect(runs) });
      if (accepted(runs.map(r => r.score))) return { accepted: { case: spec, payload, admission, acceptance: runs }, reason: "ACCEPTED" };
      evaluated.push(entry);
    }
    if (depth === policy.maxDepth) break;
    const parents = evaluated.filter(e => e.reward !== null).sort((a, b) => b.reward! - a.reward! || digest(a.payload).localeCompare(digest(b.payload))).slice(0, policy.beamWidth);
    const next: string[] = [];
    for (const parent of parents) {
      const reflection = reflect(parent.runs);
      const id = randomUUID();
      try {
        const output = await proposer.propose({ schema: "dsheval.dynamic.proposal-request/v1", case: structuredClone(spec), payload: parent.payload,
          reflection, count: policy.proposalsPerParent, maxPayloadBytes: policy.maxPayloadBytes, runs: structuredClone(parent.runs) });
        await runner.recorder.write("proposals", id, { caseId: spec.id, depth, parentDigest: digest(parent.payload), reflection, output });
        for (const proposal of validateProposals(output, spec.field.id, policy.proposalsPerParent, policy.maxPayloadBytes)) {
          const hash = digest(proposal.value);
          if (!seen.has(hash)) { seen.add(hash); next.push(proposal.value); }
        }
      } catch (error) {
        if (error instanceof Error && "code" in error && !(error instanceof DynamicError)) throw error;
        await runner.recorder.write("proposal-errors", id, { caseId: spec.id, reason: error instanceof DynamicError ? error.code : "PROPOSER_ERROR" });
      }
    }
    candidates = next;
  }
  return { accepted: null, reason: "SEARCH_EXHAUSTED" };
}
