import {
  ContractViolation,
  assertSameAttemptScope,
  digestEquals,
  digestValue,
  validateIsoDateTime,
  validateScope,
  validateStableId,
  withContentDigest,
  type ArtifactRef,
  type CollectionStatus,
  type ContentDigest,
  type FileSnapshot,
  type JsonObject,
  type ObservationExecutionRequest,
  type PreparedObserverBinding,
  type RawObservation,
  type Ref,
  type ScopeRef,
  type SensorAdapterDescriptor,
  type SourceDescriptor,
  type SourceRequirement,
} from "../core/models.js";
import type { FailureDraft, FailureRecord } from "../core/errors.js";
import {
  captureFileSnapshot,
  FILE_SENSOR_CAPABILITIES,
  FILE_SENSOR_CAPABILITY_DIGEST,
  FILE_SENSOR_IMPLEMENTATION_ID,
  FILE_SENSOR_IMPLEMENTATION_VERSION,
  fileSnapshotArtifactDigest,
  type FileSnapshotDraft,
} from "./sensors/file.js";

export const FILE_SENSOR_DESCRIPTOR: SensorAdapterDescriptor = Object.freeze({
  implementationId: validateStableId<"SensorImplementationId">(FILE_SENSOR_IMPLEMENTATION_ID),
  implementationVersion: FILE_SENSOR_IMPLEMENTATION_VERSION,
  capabilityDigest: FILE_SENSOR_CAPABILITY_DIGEST,
  sourceType: "FILESYSTEM",
  capabilities: FILE_SENSOR_CAPABILITIES,
});

/** The one-item static registry required by the MVP Bootstrap. */
export const FILE_SENSOR_REGISTRY_DIGEST: ContentDigest = digestValue([FILE_SENSOR_DESCRIPTOR]);

export type EnvironmentCaptureKind = "BEFORE" | "AFTER" | "POST_RESET";

export interface EnvironmentCaptureContext {
  readonly request: ObservationExecutionRequest;
  readonly sourceRequirementId: string;
  readonly expectedSensorRegistryDigest: ContentDigest;
  readonly rootPath: string;
  readonly snapshotId: string;
  readonly attemptId: string;
  readonly maxFileBytes: number;
  readonly now?: () => string;
}

export interface EnvironmentCapture {
  readonly snapshot: FileSnapshotDraft;
  readonly sourceRequirement: SourceRequirement;
  /** Token remains process-only and is never copied into the Capture. */
  readonly bindingId: string;
}

export interface EnvironmentSensor {
  readonly descriptor: SensorAdapterDescriptor;
  captureBefore(context: EnvironmentCaptureContext): Promise<EnvironmentCapture>;
  captureAfter(context: EnvironmentCaptureContext): Promise<EnvironmentCapture>;
  verifyReset(context: EnvironmentCaptureContext): Promise<EnvironmentCapture>;
}

export interface MaterializeFileObservationInput {
  readonly observationId: string;
  readonly scope: ScopeRef;
  readonly snapshot: FileSnapshot;
  readonly snapshotRef: Ref<FileSnapshot>;
  readonly sourceRef: Ref<SourceDescriptor>;
  readonly snapshotArtifact: ArtifactRef;
  readonly snapshotArtifactRef: Ref<ArtifactRef>;
  readonly createdAt: string;
  readonly producerVersion: string;
}

/** Binds a File Snapshot record back to its committed raw manifest Artifact. */
export function materializeFileObservation(
  input: MaterializeFileObservationInput,
): RawObservation {
  const scope = validateScope(input.scope);
  if (scope.attemptId === undefined || input.snapshot.attemptId !== scope.attemptId) {
    throw new ContractViolation("SCOPE_MISMATCH", "File observation requires matching Attempt Scope");
  }
  assertSameAttemptScope(scope, input.snapshot.scope, input.snapshotArtifact.scope);
  if (
    !digestEquals(input.snapshot.contentDigest, input.snapshotRef.digest) ||
    input.snapshot.snapshotId !== input.snapshotRef.id ||
    !digestEquals(input.snapshotArtifact.contentDigest, input.snapshotArtifactRef.digest) ||
    input.snapshotArtifact.artifactId !== input.snapshotArtifactRef.id ||
    !digestEquals(
      input.snapshotArtifact.artifactContentDigest,
      fileSnapshotArtifactDigest(input.snapshot),
    )
  ) {
    throw new ContractViolation(
      "EVIDENCE_INTEGRITY",
      "File Snapshot or raw Artifact does not match its committed Ref",
    );
  }
  const captureMetadata: JsonObject = {
    snapshotRef: refJson(input.snapshotRef),
    phase: input.snapshot.phase,
    entryCount: input.snapshot.entries.length,
    rootBinding: input.snapshot.rootBinding,
  };
  return withContentDigest({
    schema: "dsheval.mvp.raw-observation/v1" as const,
    observationId: validateStableId<"ObservationId">(input.observationId, "observationId"),
    scope,
    attemptId: scope.attemptId,
    sourceRef: input.sourceRef,
    externalEventType: `file/snapshot/${input.snapshot.phase}`,
    sourceTime: {
      observedAt: input.snapshot.scanCompletedAt,
      clockDomain: "dsheval-file-sensor",
    },
    payloadArtifactRef: input.snapshotArtifactRef,
    captureMetadata,
    rawDigest: input.snapshotArtifact.artifactContentDigest,
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
}

export interface MaterializeFileCollectionStatusInput {
  readonly collectionStatusId: string;
  readonly scope: ScopeRef;
  readonly sourceRef: Ref<SourceDescriptor>;
  readonly snapshots: readonly FileSnapshot[];
  readonly openedAt: string;
  readonly closedAt: string;
  readonly requiredPhases: readonly ("BEFORE" | "AFTER" | "POST_RESET")[];
  readonly stableWindowComplete?: boolean;
  readonly failureRefs?: readonly Ref<FailureRecord>[];
  readonly createdAt: string;
  readonly producerVersion: string;
}

export function materializeFileCollectionStatus(
  input: MaterializeFileCollectionStatusInput,
): CollectionStatus {
  const scope = validateScope(input.scope);
  for (const snapshot of input.snapshots) {
    assertSameAttemptScope(scope, snapshot.scope);
  }
  const phaseSet = new Set(input.snapshots.map((snapshot) => snapshot.phase));
  if (
    phaseSet.size !== input.snapshots.length ||
    input.snapshots.some((snapshot) => !input.requiredPhases.includes(snapshot.phase))
  ) {
    throw new ContractViolation(
      "FILE_PHASE_SET_INVALID",
      "File CollectionStatus requires one Snapshot for each requested phase and no extra phase",
    );
  }
  const missingPhases = input.requiredPhases.filter((phase) => !phaseSet.has(phase));
  const partialSnapshots = input.snapshots.filter(
    (snapshot) => snapshot.completeness !== "COMPLETE",
  );
  const stableIncomplete = input.stableWindowComplete === false;
  const gaps = [
    ...missingPhases.map((phase) => ({
      kind: "MISSING_PHASE",
      reasonCode: `FILE_${phase}_MISSING`,
      detail: { phase },
    })),
    ...partialSnapshots.map((snapshot) => ({
      kind: "PARTIAL_SNAPSHOT",
      reasonCode: `FILE_${snapshot.phase}_PARTIAL`,
      detail: { snapshotId: String(snapshot.snapshotId) },
    })),
    ...(stableIncomplete
      ? [
          {
            kind: "STABLE_WINDOW",
            reasonCode: "STABLE_WINDOW_INCOMPLETE",
            detail: { complete: false },
          },
        ]
      : []),
  ];
  const completeness = gaps.length === 0 ? "COMPLETE" : "PARTIAL";
  return withContentDigest({
    schema: "dsheval.mvp.collection-status/v1" as const,
    collectionStatusId: validateStableId<"CollectionStatusId">(
      input.collectionStatusId,
      "collectionStatusId",
    ),
    scope,
    sourceRef: input.sourceRef,
    openedAt: input.openedAt,
    closedAt: input.closedAt,
    recordCount: input.snapshots.length,
    finalWatermark: {
      phases: input.snapshots.map((snapshot) => snapshot.phase).sort(),
      stableWindowComplete: !stableIncomplete,
    },
    gaps,
    truncated: false,
    health: completeness === "COMPLETE" ? "HEALTHY" : "DEGRADED",
    completeness,
    failureRefs: input.failureRefs ?? [],
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
}

export function fileCollectionFailureDrafts(input: {
  readonly scope: ScopeRef;
  readonly snapshots: readonly FileSnapshot[];
  readonly requiredPhases: readonly ("BEFORE" | "AFTER" | "POST_RESET")[];
  readonly stableWindowComplete?: boolean;
  readonly occurredAt: string;
  readonly artifactRefs?: readonly Ref<ArtifactRef>[];
}): readonly FailureDraft[] {
  const scope = validateScope(input.scope);
  const phases = new Set(input.snapshots.map((snapshot) => snapshot.phase));
  const reasonCodes = [
    ...input.requiredPhases
      .filter((phase) => !phases.has(phase))
      .map((phase) => `FILE_${phase}_MISSING`),
    ...input.snapshots
      .filter((snapshot) => snapshot.completeness !== "COMPLETE")
      .map((snapshot) => `FILE_${snapshot.phase}_PARTIAL`),
    ...(input.stableWindowComplete === false ? ["STABLE_WINDOW_INCOMPLETE"] : []),
  ];
  return [...new Set(reasonCodes)].sort().map((reasonCode) => ({
    scope,
    category: "OBSERVATION_FAILURE" as const,
    origin: "DSHEVAL" as const,
    actor: "COLLECTOR" as const,
    phase: "FILE_DRAIN",
    severity: "ERROR" as const,
    retryable: false as const,
    messageRedacted: `Independent File collection is incomplete (${reasonCode})`,
    reasonCode,
    evidenceRefs: [],
    artifactRefs: input.artifactRefs ?? [],
    occurredAt: validateIsoDateTime(input.occurredAt, "occurredAt"),
  }));
}

/**
 * The only EnvironmentSensor in the MVP. It receives a prepared read-only
 * binding for each operation and never obtains an EnvironmentController.
 */
export class FileEnvironmentSensor implements EnvironmentSensor {
  public readonly descriptor = FILE_SENSOR_DESCRIPTOR;

  public async captureBefore(context: EnvironmentCaptureContext): Promise<EnvironmentCapture> {
    return this.capture("BEFORE", context);
  }

  public async captureAfter(context: EnvironmentCaptureContext): Promise<EnvironmentCapture> {
    return this.capture("AFTER", context);
  }

  public async verifyReset(context: EnvironmentCaptureContext): Promise<EnvironmentCapture> {
    return this.capture("POST_RESET", context);
  }

  private async capture(
    kind: EnvironmentCaptureKind,
    context: EnvironmentCaptureContext,
  ): Promise<EnvironmentCapture> {
    const { requirement, binding } = validateCaptureContext(kind, context, this.descriptor);
    const snapshot = await captureFileSnapshot({
      snapshotId: context.snapshotId,
      attemptId: context.attemptId,
      phase: kind,
      rootPath: context.rootPath,
      rootBinding: requirement.resourceBinding,
      maxFileBytes: Math.min(context.maxFileBytes, requirement.maxBytes),
      ...(context.now === undefined ? {} : { now: context.now }),
    });
    return {
      snapshot,
      sourceRequirement: requirement,
      bindingId: binding.bindingId,
    };
  }
}

export function validateCaptureContext(
  kind: EnvironmentCaptureKind,
  context: EnvironmentCaptureContext,
  descriptor: SensorAdapterDescriptor = FILE_SENSOR_DESCRIPTOR,
): { readonly requirement: SourceRequirement; readonly binding: PreparedObserverBinding } {
  if (!digestEquals(context.request.sensorRegistryDigest, context.expectedSensorRegistryDigest)) {
    throw new ContractViolation(
      "SENSOR_REGISTRY_DRIFT",
      "Runtime Sensor registry digest differs from the frozen registry digest",
    );
  }
  if (kind === "POST_RESET" && context.request.kind !== "POST_RESET") {
    throw new ContractViolation(
      "INVALID_OBSERVATION_REQUEST",
      "POST_RESET capture requires a POST_RESET ObservationExecutionRequest",
    );
  }
  if (kind !== "POST_RESET" && context.request.kind !== "CASE_RUN") {
    throw new ContractViolation(
      "INVALID_OBSERVATION_REQUEST",
      `${kind} capture requires a CASE_RUN ObservationExecutionRequest`,
    );
  }
  if (context.request.environment.attemptId !== context.attemptId) {
    throw new ContractViolation("SCOPE_MISMATCH", "Capture Attempt does not match Environment");
  }
  if (
    context.request.observationPlan.scope.attemptId !== undefined &&
    context.request.observationPlan.scope.attemptId !== context.request.environment.attemptId
  ) {
    throw new ContractViolation("SCOPE_MISMATCH", "ObservationPlan and Environment Attempts differ");
  }

  const requirement = context.request.observationPlan.sourceRequirements.find(
    (candidate) => candidate.sourceRequirementId === context.sourceRequirementId,
  );
  if (requirement === undefined || requirement.sourceType !== "FILESYSTEM") {
    throw new ContractViolation(
      "SOURCE_REQUIREMENT_MISMATCH",
      "Frozen FILESYSTEM SourceRequirement was not found",
    );
  }
  const matchingBindings = context.request.preparedBindings.filter(
    (candidate) => candidate.sourceRequirementId === requirement.sourceRequirementId,
  );
  if (matchingBindings.length !== 1) {
    throw new ContractViolation(
      "OBSERVER_BINDING_MISMATCH",
      "Exactly one prepared Binding is required for the frozen SourceRequirement",
    );
  }
  const binding = matchingBindings[0]!;
  if (
    binding.environmentInstanceId !== context.request.environment.environmentInstanceId ||
    binding.resetGeneration !== context.request.environment.resetGeneration ||
    (context.request.kind === "POST_RESET" &&
      binding.resetGeneration !== context.request.resetGeneration)
  ) {
    throw new ContractViolation(
      "OBSERVER_BINDING_GENERATION_MISMATCH",
      "Prepared Binding does not belong to the current Environment generation",
    );
  }
  if (
    binding.resourceBinding !== requirement.resourceBinding ||
    binding.resourceBinding !== context.request.environment.workspaceBinding
  ) {
    throw new ContractViolation(
      "OBSERVER_RESOURCE_MISMATCH",
      "Binding, SourceRequirement and Environment resource bindings must match",
    );
  }
  if (
    binding.sensorImplementationId !== descriptor.implementationId ||
    binding.sensorImplementationId !== requirement.sensorImplementationId ||
    binding.sensorImplementationVersion !== descriptor.implementationVersion ||
    binding.sensorImplementationVersion !== requirement.sensorImplementationVersion ||
    !digestEquals(binding.sensorCapabilityDigest, descriptor.capabilityDigest) ||
    !digestEquals(binding.sensorCapabilityDigest, requirement.sensorCapabilityDigest)
  ) {
    throw new ContractViolation(
      "SENSOR_IMPLEMENTATION_DRIFT",
      "Runtime File Sensor identity differs from the frozen SourceRequirement",
    );
  }

  const requiredOperations = kind === "AFTER" ? ["READ", "SNAPSHOT", "DRAIN"] : ["READ", "SNAPSHOT"];
  if (
    binding.allowedOperations.some(
      (operation) => operation !== "READ" && operation !== "SNAPSHOT" && operation !== "DRAIN",
    ) ||
    requiredOperations.some((operation) => !binding.allowedOperations.includes(operation as never))
  ) {
    throw new ContractViolation(
      "OBSERVER_GRANT_NOT_READ_ONLY",
      `Prepared Binding lacks the read-only operations required for ${kind}`,
    );
  }
  if (binding.readCapabilityToken.length === 0) {
    throw new ContractViolation("OBSERVER_TOKEN_MISSING", "Prepared Binding has no read capability token");
  }
  if (Date.parse(binding.expiresAt) <= Date.now()) {
    throw new ContractViolation("OBSERVER_GRANT_EXPIRED", "Prepared Binding has expired");
  }

  const expectedGrantDigest = digestValue(binding, ["grantDigest", "readCapabilityToken"]);
  if (!digestEquals(binding.grantDigest, expectedGrantDigest)) {
    throw new ContractViolation("OBSERVER_GRANT_INVALID", "Prepared Binding grant digest is invalid");
  }
  return { requirement, binding };
}

function refJson(ref: Ref): JsonObject {
  return {
    schema: ref.schema,
    id: String(ref.id),
    digest: {
      algorithm: ref.digest.algorithm,
      value: ref.digest.value,
      byteLength: ref.digest.byteLength,
    },
    ...(ref.revision === undefined ? {} : { revision: ref.revision }),
  };
}
