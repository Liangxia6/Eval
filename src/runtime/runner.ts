import {
  assertLegalTransition,
  type AttemptState,
  type CaseState,
  type EnvironmentInstance,
  type EnvironmentState,
  type EvaluationCase,
  type EvaluationPlan,
  type EvaluationRun,
  type ExecutionAttempt,
  type ObservationPlan,
  type Ref,
  type RunState,
  type ScopeRef,
  type SourceRunId,
  type StateTransition,
  type TargetSnapshot,
  validateIsoDateTime,
  validateScope,
  validateStableId,
  validateVersionedAssetId,
  withProjectionDigest,
  refForProjection,
} from "../core/models.js";
import type { FailureRecord } from "../core/errors.js";

export interface RuntimeProjectionIds {
  runId: string;
  caseId: string;
  attemptId: string;
  environmentInstanceId: string;
  sourceRunId: string;
}

export interface RuntimeProjectionGraph {
  run: EvaluationRun;
  evaluationCase: EvaluationCase;
  attempt: ExecutionAttempt;
  environment: EnvironmentInstance;
  scope: ScopeRef;
}

export function createRuntimeProjectionGraph(input: {
  ids: RuntimeProjectionIds;
  targetId: string;
  targetSnapshotId: string;
  targetSnapshotRef: Ref<TargetSnapshot>;
  evaluationPlanRef: Ref<EvaluationPlan>;
  observationPlanRef: Ref<ObservationPlan>;
  casePlanId: string;
  environmentId: string;
  workspacePath: string;
  runtimeDshHomePath: string;
  now: string;
}): RuntimeProjectionGraph {
  const runId = validateStableId<"RunId">(input.ids.runId, "runId");
  const caseId = validateStableId<"CaseId">(input.ids.caseId, "caseId");
  const attemptId = validateStableId<"AttemptId">(input.ids.attemptId, "attemptId");
  const environmentInstanceId = validateStableId<"EnvironmentInstanceId">(
    input.ids.environmentInstanceId,
    "environmentInstanceId",
  );
  const sourceRunId = validateStableId<"SourceRunId">(
    input.ids.sourceRunId,
    "sourceRunId",
  ) as SourceRunId;
  const runScope = validateScope({
    targetId: input.targetId,
    targetSnapshotId: input.targetSnapshotId,
    runId,
  });
  const caseScope = validateScope({
    ...runScope,
    caseId,
  });
  const scope = validateScope({
    ...caseScope,
    attemptId,
  });
  const now = validateIsoDateTime(input.now, "now");

  const run = withProjectionDigest({
    schema: "dsheval.mvp.run/v1" as const,
    aggregateId: runId,
    runId,
    scope: runScope,
    state: "CREATED" as const,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    failureRefs: [] as readonly Ref<FailureRecord>[],
    targetSnapshotRef: input.targetSnapshotRef,
    evaluationPlanRef: input.evaluationPlanRef,
    observationPlanRef: input.observationPlanRef,
    caseId,
    operationalHealth: "HEALTHY" as const,
  }) as EvaluationRun;
  const evaluationCase = withProjectionDigest({
    schema: "dsheval.mvp.case/v1" as const,
    aggregateId: caseId,
    caseId,
    runId,
    scope: caseScope,
    state: "PENDING" as const,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    failureRefs: [] as readonly Ref<FailureRecord>[],
    casePlanId: validateStableId<"CasePlanId">(input.casePlanId, "casePlanId"),
    attemptId,
    checkResultRefs: [],
  }) as EvaluationCase;
  const attempt = withProjectionDigest({
    schema: "dsheval.mvp.attempt/v1" as const,
    aggregateId: attemptId,
    attemptId,
    caseId,
    scope,
    state: "PENDING" as const,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    failureRefs: [] as readonly Ref<FailureRecord>[],
    ordinal: 1 as const,
    workspacePath: input.workspacePath,
    runtimeDshHomePath: input.runtimeDshHomePath,
    sourceRunId,
  }) as ExecutionAttempt;
  const environment = withProjectionDigest({
    schema: "dsheval.mvp.environment/v1" as const,
    aggregateId: environmentInstanceId,
    environmentInstanceId,
    attemptId,
    scope,
    state: "CREATED" as const,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    failureRefs: [] as readonly Ref<FailureRecord>[],
    environmentId: validateVersionedAssetId<"EnvironmentDefinitionId">(
      input.environmentId,
      "environmentId",
    ),
    workspaceBinding: "attempt.workspace",
    resetGeneration: 0,
  }) as EnvironmentInstance;
  return { run, evaluationCase, attempt, environment, scope };
}

type RuntimeProjection = EvaluationRun | EvaluationCase | ExecutionAttempt | EnvironmentInstance;

type RuntimeStateFor<Projection extends RuntimeProjection> = Projection extends EvaluationRun
  ? RunState
  : Projection extends EvaluationCase
    ? CaseState
    : Projection extends ExecutionAttempt
      ? AttemptState
      : EnvironmentState;

/** Runtime owns validation and construction of its four lifecycle transitions. */
export function transitionRuntimeProjection<Projection extends RuntimeProjection>(input: {
  projection: Projection;
  toState: RuntimeStateFor<Projection>;
  reasonCode: string;
  occurredAt: string;
  supportingRefs?: readonly Ref[];
  failureRefs?: readonly Ref<FailureRecord>[];
  patch?: Readonly<Record<string, unknown>>;
}): StateTransition<Projection> {
  const { projection } = input;
  assertLegalTransition(projection.schema, projection.state, input.toState);
  const occurredAt = validateIsoDateTime(input.occurredAt, "occurredAt");
  const failureRefs = input.failureRefs ?? projection.failureRefs;
  const { projectionDigest: _priorDigest, ...projectionWithoutDigest } = projection;
  const nextProjection = withProjectionDigest({
    ...projectionWithoutDigest,
    ...(input.patch ?? {}),
    state: input.toState,
    revision: projection.revision + 1,
    updatedAt: occurredAt,
    failureRefs,
  } as Omit<Projection, "projectionDigest">) as Projection;
  return {
    aggregateRef: refForProjection(projection),
    expectedRevision: projection.revision,
    fromState: projection.state,
    toState: input.toState,
    reasonCode: input.reasonCode,
    supportingRefs: input.supportingRefs ?? [],
    failureRefs,
    occurredAt,
    nextProjection,
  } as StateTransition<Projection>;
}
