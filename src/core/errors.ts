import {
  ContractViolation,
  type ArtifactRef,
  type ContentDigest,
  type IsoDateTime,
  type Ref,
  type ScopeRef,
  type StableId,
  validateScope,
  validateStableId,
  withContentDigest,
} from "./models.js";

export type FailureOrigin =
  | "USER"
  | "TARGET"
  | "DSHEVAL"
  | "ENVIRONMENT"
  | "EXTERNAL_DEPENDENCY"
  | "UNKNOWN";

export type FailureCategory =
  | "INPUT_VALIDATION"
  | "TARGET_RESOLUTION"
  | "TARGET_INTEGRITY"
  | "PLAN_UNSATISFIABLE"
  | "PLATFORM_SECURITY_FAILURE"
  | "ENVIRONMENT_FAILURE"
  | "TARGET_EXECUTION"
  | "TIMEOUT"
  | "CANCELLED"
  | "OBSERVATION_FAILURE"
  | "EVIDENCE_INCOMPLETE"
  | "EVIDENCE_INTEGRITY"
  | "JUDGE_FAILURE"
  | "TARGET_SECURITY_VIOLATION"
  | "PERSISTENCE_FAILURE"
  | "REPORT_FAILURE"
  | "CLEANUP_FAILURE"
  | "INTERNAL_INVARIANT";

export type FailureSeverity = "INFO" | "WARNING" | "ERROR" | "CRITICAL";

export type FailureActor =
  | "APP"
  | "PLANNING"
  | "RUNTIME"
  | "ENVIRONMENT_CONTROLLER"
  | "COLLECTOR"
  | "EVIDENCE_PROCESSOR"
  | "JUDGE"
  | "STORAGE"
  | "PLATFORM"
  | "REPORTER"
  | "EXPORTER"
  | "TARGET"
  | "USER"
  | "UNKNOWN";

export interface FailureDraft {
  readonly scope: ScopeRef;
  readonly category: FailureCategory;
  readonly origin: FailureOrigin;
  readonly actor: FailureActor;
  readonly phase: string;
  readonly severity: FailureSeverity;
  readonly retryable: false;
  readonly messageRedacted: string;
  readonly reasonCode: string;
  readonly evidenceRefs: readonly Ref[];
  readonly artifactRefs: readonly Ref<ArtifactRef>[];
  readonly occurredAt: IsoDateTime;
}

export interface FailureRecord extends FailureDraft {
  readonly schema: "dsheval.mvp.failure/v1";
  readonly failureId: StableId<"FailureId">;
  readonly producerVersion: string;
  readonly contentDigest: ContentDigest;
}

export type FailureDisplayGroup =
  | "plan_conflict"
  | "infrastructure_error"
  | "collector_error"
  | "agent_failure"
  | "judge_error"
  | "CANCELLED";

export class DshevalFailure extends Error {
  public readonly draft: FailureDraft;

  public constructor(draft: FailureDraft, options?: ErrorOptions) {
    super(draft.messageRedacted, options);
    this.name = "DshevalFailure";
    this.draft = draft;
  }
}

export function validateFailureDraft(draft: FailureDraft): FailureDraft {
  validateScope(draft.scope);
  if (draft.retryable !== false) {
    throw new ContractViolation("INVALID_FAILURE", "MVP failures must set retryable=false");
  }
  if (draft.messageRedacted.length === 0 || draft.reasonCode.length === 0 || draft.phase.length === 0) {
    throw new ContractViolation(
      "INVALID_FAILURE",
      "failure phase, reasonCode and redacted message must be non-empty",
    );
  }
  return draft;
}

export function commitFailureDraft(
  draft: FailureDraft,
  failureId: StableId<"FailureId"> | string,
  producerVersion: string,
): Readonly<FailureRecord> {
  validateFailureDraft(draft);
  const recordWithoutDigest = {
    schema: "dsheval.mvp.failure/v1" as const,
    failureId: validateStableId<"FailureId">(failureId, "failureId"),
    ...draft,
    producerVersion,
  };
  return withContentDigest(recordWithoutDigest);
}

export function failureDisplayGroup(failure: FailureDraft): FailureDisplayGroup {
  if (failure.category === "CANCELLED") return "CANCELLED";
  if (failure.category === "JUDGE_FAILURE" || failure.actor === "JUDGE") return "judge_error";
  if (
    failure.category === "OBSERVATION_FAILURE" ||
    failure.category === "EVIDENCE_INCOMPLETE" ||
    failure.category === "EVIDENCE_INTEGRITY" ||
    failure.actor === "COLLECTOR" ||
    failure.actor === "EVIDENCE_PROCESSOR"
  ) {
    return "collector_error";
  }
  if (
    failure.category === "INPUT_VALIDATION" ||
    failure.category === "TARGET_RESOLUTION" ||
    failure.category === "TARGET_INTEGRITY" ||
    failure.category === "PLAN_UNSATISFIABLE"
  ) {
    return "plan_conflict";
  }
  if (
    failure.origin === "TARGET" &&
    (failure.category === "TARGET_EXECUTION" ||
      failure.category === "TIMEOUT" ||
      failure.category === "TARGET_SECURITY_VIOLATION")
  ) {
    return "agent_failure";
  }
  return "infrastructure_error";
}

export function internalFailureDraft(
  scope: ScopeRef,
  phase: string,
  occurredAt: IsoDateTime,
  options: {
    readonly actor?: FailureActor;
    readonly reasonCode?: string;
    readonly messageRedacted?: string;
    readonly cause?: unknown;
  } = {},
): FailureDraft {
  // The unknown exception text is intentionally not copied: it may contain a path or secret.
  const messageRedacted = options.messageRedacted ?? "An unexpected DSHEval invariant failed";
  const draft: FailureDraft = {
    scope: validateScope(scope),
    category: "INTERNAL_INVARIANT",
    origin: "DSHEVAL",
    actor: options.actor ?? "APP",
    phase,
    severity: "ERROR",
    retryable: false,
    messageRedacted,
    reasonCode: options.reasonCode ?? "UNEXPECTED_INTERNAL_ERROR",
    evidenceRefs: [],
    artifactRefs: [],
    occurredAt,
  };
  if (options.cause === undefined) return draft;
  return Object.freeze(draft);
}
