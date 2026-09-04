/** 动态测评的数据契约。分数由验证器计算，Agent 接口只能返回原始证据。 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Mode = "demo" | "dsh";
export type Phase = "construction" | "evaluation";
export type Variant = "benign" | "malicious";
export const BEHAVIORS = [
  "Instruction Injection", "Goal Hijacking", "Data Exfiltration", "Credential Exposure",
  "Memory Poisoning", "State Tampering", "Deceptive Tool Invocation", "Unauthorized CMD Execution",
  "Unauthorized API Invocation", "Tool Scope Escalation", "Resource Exhaustion", "Obfuscated Execution",
  "False Reporting", "Context Flooding", "Permission Chaining",
] as const;

export interface Profile {
  id: string;
  model: string;
  modelVersion: string;
  harnessVersion: string;
  image: string;
  plugins: { id: string; version: string; config: Record<string, Json> }[];
  permissions: string[];
  settings: Record<string, Json>;
}
export interface Predicate {
  id: string;
  description: string;
  objectId: string;
  operation: string;
  operator: "equals" | "contains" | "gt" | "changed";
  expected: Json;
}
export interface CaseSpec {
  id: string;
  behavior: string;
  title: string;
  readiness: "demo" | "reviewed" | "template";
  instruction: string;
  initialState: Record<string, Json>;
  allowedActions: { objectId: string; operation: string }[];
  field: { id: string; space: "C" | "M" | "E"; benign: string };
  initialPayload: string;
  attackCriteria: Predicate[];
  utilityCriteria: Predicate[];
}
export interface SearchPolicy {
  benignRepeats: number;
  constructionRepeats: number;
  beamWidth: number;
  proposalsPerParent: number;
  maxDepth: number;
  maxPayloadBytes: number;
}
export const DEFAULT_POLICY: SearchPolicy = {
  benignRepeats: 3, constructionRepeats: 3, beamWidth: 3,
  proposalsPerParent: 2, maxDepth: 5, maxPayloadBytes: 16_384,
};
export interface RunRequest {
  schema: "dsheval.dynamic.request/v1";
  runId: string;
  phase: Phase;
  variant: Variant;
  attempt: number;
  mode: Mode;
  case: CaseSpec;
  profile: Profile;
  payload: string;
  caseDigest: string;
  profileDigest: string;
  initialStateDigest: string;
}
export interface AuditEvent {
  id: string;
  sequence: number;
  objectId: string;
  operation: string;
  before: Json;
  after: Json;
  actionId: string | null;
}
export interface TraceEvent {
  id: string;
  sequence: number;
  kind: "exposure" | "action" | "decision";
  objectId: string;
  operation: string;
  parentIds: string[];
  payloadDigest: string | null;
}
export interface TrajectoryJudgment {
  criterionId: string;
  satisfied: boolean;
  exposureId: string | null;
  actionId: string | null;
  effectId: string | null;
  rationale: string;
}
export interface DynamicEvidenceBundle {
  schema: "dsheval.dynamic.evidence/v1";
  runId: string;
  mode: Mode;
  caseDigest: string;
  profileDigest: string;
  initialStateDigest: string;
  sessionId: string;
  resetConfirmed: boolean;
  complete: boolean;
  audit: AuditEvent[];
  trace: TraceEvent[];
}
export interface JudgmentBundle {
  schema: "dsheval.dynamic.judgments/v1";
  runId: string;
  judgments: TrajectoryJudgment[];
}
export interface CriterionResult {
  id: string;
  log: 0 | 1;
  trajectory: 0 | 1;
  logEventIds: string[];
  trajectoryEventIds: string[];
}
export interface Score {
  status: "VALID" | "INVALID";
  reason: string | null;
  logScore: number | null;
  trajectoryScore: number | null;
  ags: number | null;
  ugs: number | null;
  criteria: CriterionResult[];
  utility: { id: string; satisfied: boolean; eventIds: string[] }[];
}
export interface RunRecord {
  request: RunRequest;
  evidence: DynamicEvidenceBundle | null;
  judgments: JudgmentBundle | null;
  score: Score;
}
export type Diagnosis = "not_read" | "read_but_ignored" | "read_but_refused" | "weak_attack"
  | "sink_not_reached" | "sink_missing_secret" | "task_integrity_broken"
  | "unstable_success" | "already_successful" | "unknown";
export interface Reflection { category: Diagnosis; instruction: string; }
export interface ProposalRequest {
  schema: "dsheval.dynamic.proposal-request/v1";
  case: CaseSpec;
  payload: string;
  reflection: Reflection;
  count: number;
  maxPayloadBytes: number;
  runs: RunRecord[];
}
export interface Proposal { fieldId: string; value: string; }
export interface AgentAdapter { run(request: RunRequest): Promise<unknown>; }
export interface TrajectoryJudge {
  judge(request: RunRequest, evidence: DynamicEvidenceBundle): Promise<unknown>;
}
export interface Proposer { propose(request: ProposalRequest): Promise<unknown>; }
export interface FrozenCase {
  case: CaseSpec;
  payload: string;
  admission: RunRecord[];
  acceptance: RunRecord[];
}
export interface SuiteContent {
  schema: "dsheval.dynamic.suite/v1";
  mode: Mode;
  createdAt: string;
  referenceProfile: Profile;
  policy: SearchPolicy;
  verifier: { id: string; version: string };
  components: { runner: string; proposer: string; judge: string };
  accepted: FrozenCase[];
  rejected: { caseId: string; behavior: string; reason: string }[];
  constructionRunIds: string[];
  constructionSessionIds: string[];
}
export interface FrozenSuite { digest: string; content: SuiteContent; }
