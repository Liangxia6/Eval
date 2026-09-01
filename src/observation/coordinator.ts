import {
  ContractViolation,
  assertLegalTransition,
  refForProjection,
  validateIsoDateTime,
  validateScope,
  validateStableId,
  withContentDigest,
  withProjectionDigest,
  type CollectionStatus,
  type CompletionLedger,
  type CompletionLedgerItem,
  type ContentDigest,
  type FileSnapshot,
  type ObservationPlan,
  type ObservationSession,
  type ObservationSessionState,
  type Ref,
  type ScopeRef,
  type SourceDescriptor,
  type StateTransition,
} from "../core/models.js";
import type { FailureDraft, FailureRecord } from "../core/errors.js";
import {
  FILE_SENSOR_CAPABILITY_DIGEST,
  FILE_SENSOR_IMPLEMENTATION_ID,
  FILE_SENSOR_IMPLEMENTATION_VERSION,
} from "./sensors/file.js";
import {
  PROBE_CAPABILITY_DIGEST,
  PROBE_IMPLEMENTATION_ID,
  PROBE_IMPLEMENTATION_VERSION,
} from "./runtime.js";

const LEDGER_ORDER = [
  "TARGET_TERMINATION",
  "TOOL_CALLS",
  "SESSION_FLUSH",
  "PROBE_WATERMARK",
  "STABLE_WINDOW",
  "FINAL_FILE_SNAPSHOT",
] as const satisfies readonly CompletionLedgerItem["kind"][];

export interface SourceDescriptorInput {
  readonly sourceId: string;
  readonly scope: ScopeRef;
  readonly resourceBinding: string;
  readonly contentMode: string;
  readonly watermarkDefinition: SourceDescriptor["watermarkDefinition"];
  readonly knownBlindSpots?: readonly string[];
  readonly createdAt: string;
  readonly producerVersion: string;
}

export function createProbeSourceDescriptor(input: SourceDescriptorInput): SourceDescriptor {
  return withContentDigest({
    schema: "dsheval.mvp.source/v1" as const,
    sourceId: validateStableId<"SourceId">(input.sourceId, "sourceId"),
    scope: validateScope(input.scope),
    sourceType: "DSH_PROBE" as const,
    externalSchema: "dsh-eval.probe/v1",
    collectorName: PROBE_IMPLEMENTATION_ID,
    collectorVersion: PROBE_IMPLEMENTATION_VERSION,
    collectorCapabilityDigest: PROBE_CAPABILITY_DIGEST,
    trust: "COOPERATIVE" as const,
    resourceBinding: input.resourceBinding,
    sequenceMode: "CONTIGUOUS_FROM_ZERO",
    watermarkDefinition: input.watermarkDefinition,
    contentMode: input.contentMode,
    knownBlindSpots: input.knownBlindSpots ?? ["COOPERATIVE_IN_PROCESS_SOURCE"],
    createdAt: validateIsoDateTime(input.createdAt, "createdAt"),
    producerVersion: input.producerVersion,
  });
}

export function createFileSourceDescriptor(input: SourceDescriptorInput): SourceDescriptor {
  return withContentDigest({
    schema: "dsheval.mvp.source/v1" as const,
    sourceId: validateStableId<"SourceId">(input.sourceId, "sourceId"),
    scope: validateScope(input.scope),
    sourceType: "FILESYSTEM" as const,
    externalSchema: "dsheval.mvp.file-snapshot/v1",
    collectorName: FILE_SENSOR_IMPLEMENTATION_ID,
    collectorVersion: FILE_SENSOR_IMPLEMENTATION_VERSION,
    collectorCapabilityDigest: FILE_SENSOR_CAPABILITY_DIGEST,
    trust: "INDEPENDENT" as const,
    resourceBinding: input.resourceBinding,
    sequenceMode: "SNAPSHOT_PHASE",
    watermarkDefinition: input.watermarkDefinition,
    contentMode: input.contentMode,
    knownBlindSpots: input.knownBlindSpots ?? ["BLOCKED_ACCESS_ATTEMPTS_NOT_OBSERVED"],
    createdAt: validateIsoDateTime(input.createdAt, "createdAt"),
    producerVersion: input.producerVersion,
  });
}

export interface CreateObservationSessionInput {
  readonly observationSessionId: string;
  readonly attemptId: string;
  readonly scope: ScopeRef;
  readonly observationPlanRef: Ref<ObservationPlan>;
  readonly sourceRefs: readonly Ref<SourceDescriptor>[];
  readonly createdAt: string;
  readonly failureRefs?: readonly Ref<FailureRecord>[];
}

export function createObservationSession(input: CreateObservationSessionInput): ObservationSession {
  const scope = validateScope(input.scope);
  const attemptId = validateStableId<"AttemptId">(input.attemptId, "attemptId");
  if (scope.attemptId !== attemptId) {
    throw new ContractViolation("SCOPE_MISMATCH", "ObservationSession Attempt must match its Scope");
  }
  if (input.sourceRefs.length !== 2) {
    throw new ContractViolation(
      "INVALID_OBSERVATION_SOURCES",
      "MVP ObservationSession requires exactly Probe and File sources",
    );
  }
  const sessionId = validateStableId<"ObservationSessionId">(
    input.observationSessionId,
    "observationSessionId",
  );
  const createdAt = validateIsoDateTime(input.createdAt, "createdAt");
  return withProjectionDigest({
    schema: "dsheval.mvp.observation-session/v1" as const,
    aggregateId: sessionId,
    observationSessionId: sessionId,
    attemptId,
    scope,
    observationPlanRef: input.observationPlanRef,
    state: "PLANNED" as const,
    revision: 0,
    sourceRefs: stableRefs(input.sourceRefs),
    collectionStatusRefs: [],
    failureRefs: input.failureRefs ?? [],
    createdAt,
    updatedAt: createdAt,
  });
}

export interface ObservationTransitionInput {
  readonly occurredAt: string;
  readonly reasonCode: string;
  readonly supportingRefs?: readonly Ref[];
  readonly failureRefs?: readonly Ref<FailureRecord>[];
}

export function beginBaseline(
  current: ObservationSession,
  input: ObservationTransitionInput,
): StateTransition<ObservationSession> {
  return transitionSession(current, "BASELINING", input, {
    baselineStartedAt: validateIsoDateTime(input.occurredAt),
  });
}

export function completeBaseline(
  current: ObservationSession,
  input: ObservationTransitionInput & {
    readonly beforeSnapshotRef: Ref<FileSnapshot>;
  },
): StateTransition<ObservationSession> {
  if (current.baselineStartedAt === undefined) {
    throw new ContractViolation("BASELINE_NOT_STARTED", "Baseline cannot complete before it starts");
  }
  return transitionSession(current, "BASELINED", input, {
    baselinedAt: validateIsoDateTime(input.occurredAt),
  });
}

export function activateObservation(
  current: ObservationSession,
  input: ObservationTransitionInput,
): StateTransition<ObservationSession> {
  if (current.baselinedAt === undefined) {
    throw new ContractViolation("BASELINE_NOT_COMMITTED", "ACTIVE requires a committed baseline");
  }
  return transitionSession(current, "ACTIVE", input, {
    activeAt: validateIsoDateTime(input.occurredAt),
  });
}

export function beginDrain(
  current: ObservationSession,
  input: ObservationTransitionInput & {
    readonly targetTerminatedAt: string;
  },
): StateTransition<ObservationSession> {
  const targetTerminatedAt = validateIsoDateTime(input.targetTerminatedAt, "targetTerminatedAt");
  const drainStartedAt = validateIsoDateTime(input.occurredAt, "drainStartedAt");
  if (Date.parse(drainStartedAt) < Date.parse(targetTerminatedAt)) {
    throw new ContractViolation(
      "DRAIN_BEFORE_TERMINATION",
      "Probe drain cannot start before Target termination is recorded",
    );
  }
  return transitionSession(current, "DRAINING", input, {
    targetTerminatedAt,
    drainStartedAt,
  });
}

export interface SealObservationInput extends ObservationTransitionInput {
  readonly collectionStatusRefs: readonly Ref<CollectionStatus>[];
  readonly completionLedger: CompletionLedger;
  readonly allRawArtifactsCommitted: boolean;
}

export function sealObservation(
  current: ObservationSession,
  input: SealObservationInput,
): StateTransition<ObservationSession> {
  if (current.targetTerminatedAt === undefined || current.drainStartedAt === undefined) {
    throw new ContractViolation(
      "TERMINATION_NOT_RECORDED",
      "Observation cannot Seal before bounded drain after Target termination",
    );
  }
  if (!input.allRawArtifactsCommitted) {
    throw new ContractViolation(
      "RAW_ARTIFACT_NOT_COMMITTED",
      "Observation cannot Seal before every captured raw Artifact is committed",
    );
  }
  if (input.collectionStatusRefs.length !== current.sourceRefs.length) {
    throw new ContractViolation(
      "COLLECTION_STATUS_MISSING",
      "Every planned Source requires a committed CollectionStatus before Seal",
    );
  }
  validateCompletionLedger(input.completionLedger);
  return transitionSession(current, "SEALED", input, {
    sealedAt: validateIsoDateTime(input.occurredAt, "sealedAt"),
    collectionStatusRefs: stableRefs(input.collectionStatusRefs),
    completionLedger: input.completionLedger,
  });
}

export function failObservation(
  current: ObservationSession,
  input: ObservationTransitionInput,
): StateTransition<ObservationSession> {
  if (current.state === "SEALED" || current.state === "FAILED") {
    throw new ContractViolation("OBSERVATION_IMMUTABLE", "Terminal ObservationSession is immutable");
  }
  return transitionSession(current, "FAILED", input, {});
}

/** A late record is diagnostic-only and never produces a revised Session. */
export function rejectPostSealObservation(
  session: ObservationSession,
  input: {
    readonly occurredAt: string;
    readonly diagnosticArtifactRefs?: readonly Ref[];
  },
): FailureDraft {
  if (session.state !== "SEALED") {
    throw new ContractViolation(
      "SESSION_NOT_SEALED",
      "POST_SEAL_OBSERVATION applies only to a sealed Session",
    );
  }
  return {
    scope: session.scope,
    category: "OBSERVATION_FAILURE",
    origin: "DSHEVAL",
    actor: "COLLECTOR",
    phase: "OBSERVATION_POST_SEAL",
    severity: "WARNING",
    retryable: false,
    messageRedacted: "Observation arrived after the immutable Session seal",
    reasonCode: "POST_SEAL_OBSERVATION",
    evidenceRefs: [],
    artifactRefs: (input.diagnosticArtifactRefs ?? []) as FailureDraft["artifactRefs"],
    occurredAt: validateIsoDateTime(input.occurredAt),
  };
}

export function sessionCompleteness(session: ObservationSession): "COMPLETE" | "PARTIAL" {
  if (session.state !== "SEALED" || session.completionLedger === undefined) return "PARTIAL";
  return session.completionLedger.every(
    (item) => !item.required || item.status === "COMPLETE",
  )
    ? "COMPLETE"
    : "PARTIAL";
}

function transitionSession(
  current: ObservationSession,
  toState: ObservationSessionState,
  input: ObservationTransitionInput,
  fields: Partial<ObservationSession>,
): StateTransition<ObservationSession> {
  assertLegalTransition(current.schema, current.state, toState);
  const occurredAt = validateIsoDateTime(input.occurredAt, "occurredAt");
  if (Date.parse(occurredAt) < Date.parse(current.updatedAt)) {
    throw new ContractViolation("TIME_ORDER_INVALID", "Session transition time moved backwards");
  }
  const mergedFailureRefs = stableRefs([
    ...current.failureRefs,
    ...(input.failureRefs ?? []),
  ]);
  const { projectionDigest: _discardedDigest, ...currentWithoutDigest } = current;
  const nextProjection = withProjectionDigest({
    ...currentWithoutDigest,
    ...fields,
    state: toState,
    revision: current.revision + 1,
    updatedAt: occurredAt,
    failureRefs: mergedFailureRefs,
  }) as ObservationSession;
  return {
    aggregateRef: refForProjection(current),
    expectedRevision: current.revision,
    fromState: current.state,
    toState,
    reasonCode: input.reasonCode,
    supportingRefs: stableRefs(input.supportingRefs ?? []),
    failureRefs: input.failureRefs ?? [],
    occurredAt,
    nextProjection,
  };
}

function validateCompletionLedger(ledger: CompletionLedger): void {
  if (ledger.length !== LEDGER_ORDER.length) {
    throw new ContractViolation(
      "INVALID_COMPLETION_LEDGER",
      "CompletionLedger must contain exactly the six MVP items",
    );
  }
  for (const [index, expectedKind] of LEDGER_ORDER.entries()) {
    const item = ledger[index];
    if (item?.kind !== expectedKind || item.required !== true) {
      throw new ContractViolation(
        "INVALID_COMPLETION_LEDGER",
        `CompletionLedger item ${index} must be required ${expectedKind}`,
      );
    }
    if (item.reasonCodes.some((code) => code.length === 0)) {
      throw new ContractViolation(
        "INVALID_COMPLETION_LEDGER",
        `${expectedKind} contains an empty reasonCode`,
      );
    }
  }
}

function stableRefs<T extends Ref>(refs: readonly T[]): readonly T[] {
  const byIdentity = new Map<string, T>();
  for (const ref of refs) {
    const key = `${ref.schema}\u0000${ref.id}\u0000${ref.revision ?? ""}\u0000${ref.digest.value}`;
    byIdentity.set(key, ref);
  }
  return [...byIdentity.values()].sort((left, right) => {
    const leftKey = `${left.schema}\u0000${left.id}\u0000${left.revision ?? ""}`;
    const rightKey = `${right.schema}\u0000${right.id}\u0000${right.revision ?? ""}`;
    return leftKey.localeCompare(rightKey, "en");
  });
}

export function ledgerItem(
  kind: CompletionLedgerItem["kind"],
  status: CompletionLedgerItem["status"],
  options: {
    readonly reasonCodes?: readonly string[];
    readonly supportingRefs?: readonly Ref[];
  } = {},
): CompletionLedgerItem {
  return {
    kind,
    required: true,
    status,
    reasonCodes: [...(options.reasonCodes ?? [])].sort(),
    supportingRefs: stableRefs(options.supportingRefs ?? []),
  };
}

export function completionLedger(
  items: Readonly<Record<CompletionLedgerItem["kind"], CompletionLedgerItem>>,
): CompletionLedger {
  return LEDGER_ORDER.map((kind) => items[kind]) as unknown as CompletionLedger;
}

/** Useful for integrity assertions in tests and before repository CAS. */
export function observationProjectionDigest(session: ObservationSession): ContentDigest {
  return session.projectionDigest;
}
