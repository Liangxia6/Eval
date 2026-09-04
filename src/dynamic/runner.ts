/** 每次 rollout 生成独立请求，强制绑定配置/初态，并拒绝复用执行会话。 */
import { randomUUID } from "node:crypto";
import type { AgentAdapter, CaseSpec, Mode, Phase, Profile, RunRecord, RunRequest, TrajectoryJudge, Variant } from "./types.js";
import type { Recorder } from "./storage.js";
import { score, validateEvidence, validateJudgments, invalid } from "./scoring.js";
import { digest, DynamicError, requireThat } from "./validation.js";

export class RolloutRunner {
  readonly runIds = new Set<string>();
  readonly sessionIds = new Set<string>();
  constructor(
    readonly mode: Mode,
    private readonly adapter: AgentAdapter,
    private readonly judge: TrajectoryJudge,
    readonly recorder: Recorder,
    priorRunIds: string[] = [],
    priorSessionIds: string[] = [],
  ) {
    priorRunIds.forEach(id => this.runIds.add(id));
    priorSessionIds.forEach(id => this.sessionIds.add(id));
  }
  async run(spec: CaseSpec, profile: Profile, payload: string, phase: Phase, variant: Variant, attempt: number): Promise<RunRecord> {
    const runId = `${phase}-${randomUUID()}`;
    requireThat(!this.runIds.has(runId), "RUN_REUSED", "Run ID has already been used");
    this.runIds.add(runId);
    const request: RunRequest = { schema: "dsheval.dynamic.request/v1", runId, phase, variant, attempt, mode: this.mode,
      case: structuredClone(spec), profile: structuredClone(profile), payload,
      caseDigest: digest(spec), profileDigest: digest(profile), initialStateDigest: digest(spec.initialState) };
    await this.recorder.write("requests", runId, request);
    let evidence: RunRecord["evidence"] = null;
    let judgments: RunRecord["judgments"] = null;
    let result: RunRecord["score"];
    try {
      const raw = await this.adapter.run(structuredClone(request));
      await this.recorder.write("raw-evidence", runId, raw);
      evidence = validateEvidence(raw, request);
      requireThat(!this.sessionIds.has(evidence.sessionId), "SESSION_REUSED", "Every rollout must have a fresh reset session");
      this.sessionIds.add(evidence.sessionId);
      const rawJudgment = await this.judge.judge(structuredClone(request), structuredClone(evidence));
      await this.recorder.write("raw-judgments", runId, rawJudgment);
      judgments = validateJudgments(rawJudgment, request);
      result = score(request, evidence, judgments);
    } catch (error) {
      // Filesystem failures are experiment failures, not Agent safety outcomes.
      if (error instanceof Error && "code" in error && !(error instanceof DynamicError)) throw error;
      result = invalid(error instanceof DynamicError ? error.code : "ADAPTER_OR_JUDGE_ERROR");
    }
    const record = { request, evidence, judgments, score: result };
    await this.recorder.write("runs", runId, record);
    return record;
  }
}
