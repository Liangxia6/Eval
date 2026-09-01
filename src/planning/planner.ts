import {
  cancelled,
  failed,
  rejected,
  succeeded,
} from "../core/contracts.js";
import type {
  ArtifactCommitMetadata,
  EvaluationAssetMatchingInput,
  EvaluationAssetMatchingPort,
  JudgeDescriptor,
  OperationContext,
  PlanArtifactMaterializer,
  PortResult,
} from "../core/contracts.js";
import type { FailureDraft, FailureOrigin } from "../core/errors.js";
import {
  ContractViolation,
  assertDigestEquals,
  canonicalize,
  digestBytes,
  digestEquals,
  digestValue,
  validateContentDigest,
  validateIsoDateTime,
  validatePortablePath,
  validateStableId,
  validateVersionedAssetId,
} from "../core/models.js";
import type {
  ArtifactRef,
  AssetIdentifier,
  CasePlan,
  CheckPlan,
  ConfigSnapshot,
  ContentDigest,
  EvaluationPlan,
  EvidenceContract,
  FilesystemPack,
  InspectionSnapshot,
  IsoDateTime,
  JsonObject,
  JsonValue,
  ObservationPlan,
  PlanBuildResult,
  PlanGap,
  Ref,
  ScopeRef,
  SensorAdapterDescriptor,
  SourceRequirement,
  StableId,
  TargetSnapshot,
} from "../core/models.js";

const REQUIRED_DSH_VERSION = "0.1.1-rc.2";
const REQUIRED_PROBE_SCHEMA = "dsh-eval.probe/v1";

export interface PlanningCapabilities {
  readonly observerReadOnly: boolean;
  readonly identitySeparation: boolean;
  readonly atomicArtifactCommit: boolean;
  readonly pathIsolation: boolean;
  readonly networkDefaultDeny: boolean;
  readonly targetHiddenRootsDenied: boolean;
  readonly probeArmedBeforeHeadless: boolean;
  readonly observerOperations: readonly ("READ" | "SNAPSHOT" | "DRAIN")[];
}

interface MaterializedTask {
  readonly taskRef: Ref<ArtifactRef>;
  readonly visibleInputRefs: readonly Ref<ArtifactRef>[];
  readonly taskContentDigest: ContentDigest;
  readonly inputContentDigests: readonly ContentDigest[];
}

interface CompiledContracts {
  readonly contracts: readonly [EvidenceContract, EvidenceContract, EvidenceContract];
  readonly checkPlans: readonly CheckPlan[];
}

function asObject(value: unknown, fieldName: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

function asArray(value: unknown, fieldName: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be an array`);
  }
  return value;
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be a non-empty string`);
  }
  return value;
}

function asPositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be a positive integer`);
  }
  return Number(value);
}

function refFor<T>(schema: string, id: StableId, digest: ContentDigest): Ref<T> {
  return Object.freeze({ schema, id, digest });
}

function artifactRefFor(artifact: ArtifactRef): Ref<ArtifactRef> {
  return refFor(artifact.schema, artifact.artifactId, artifact.contentDigest);
}

function snapshotRef(snapshot: TargetSnapshot): Ref<TargetSnapshot> {
  return refFor(snapshot.schema, snapshot.targetSnapshotId, snapshot.contentDigest);
}

function inspectionRef(inspection: InspectionSnapshot): Ref<InspectionSnapshot> {
  return refFor(inspection.schema, inspection.inspectionId, inspection.contentDigest);
}

function packRef(pack: FilesystemPack): Ref<FilesystemPack> {
  return refFor(pack.schema, pack.packId, pack.contentDigest);
}

function failureDraft(
  scope: ScopeRef,
  occurredAt: IsoDateTime,
  reasonCode: string,
  messageRedacted: string,
  category: FailureDraft["category"] = "PLAN_UNSATISFIABLE",
  origin: FailureOrigin = "DSHEVAL",
): FailureDraft {
  return Object.freeze({
    scope,
    category,
    origin,
    actor: "PLANNING" as const,
    phase: "PLAN",
    severity: "ERROR" as const,
    retryable: false as const,
    messageRedacted,
    reasonCode,
    evidenceRefs: Object.freeze([]),
    artifactRefs: Object.freeze([]),
    occurredAt,
  });
}

function gap(
  code: string,
  messageRedacted: string,
  affectedIds: readonly AssetIdentifier[] = [],
): PlanGap {
  return Object.freeze({ code, messageRedacted, affectedIds: Object.freeze([...affectedIds]) });
}

function validateFrozenDigest(record: object, label: string): void {
  const source = record as Record<string, unknown>;
  const declared = validateContentDigest(source.contentDigest, `${label}.contentDigest`);
  assertDigestEquals(digestValue(source, ["contentDigest"]), declared, `${label.toUpperCase()}_DIGEST_MISMATCH`);
}

function inspectionStatus(value: JsonValue, field: string): string | undefined {
  const object = asObject(value, field);
  return typeof object.status === "string" ? object.status : undefined;
}

function inspectionVersion(value: JsonValue): string | undefined {
  const object = asObject(value, "inspection.dshVersionStatus");
  return typeof object.version === "string" ? object.version : undefined;
}

function registryGapForSensors(
  requirements: readonly SourceRequirement[],
  sensors: readonly SensorAdapterDescriptor[],
): PlanGap[] {
  const gaps: PlanGap[] = [];
  const sensorKeys = sensors.map((sensor) => `${sensor.sourceType}:${sensor.implementationId}`);
  if (new Set(sensorKeys).size !== sensorKeys.length) {
    gaps.push(gap("SENSOR_REGISTRY_AMBIGUOUS", "Sensor registry contains duplicate source/ID entries"));
  }
  for (const sensor of sensors) {
    const sortedCapabilities = [...sensor.capabilities].sort();
    if (
      new Set(sortedCapabilities).size !== sortedCapabilities.length ||
      sortedCapabilities.some((capability, index) => capability !== sensor.capabilities[index])
    ) {
      gaps.push(
        gap(
          "SENSOR_CAPABILITIES_NON_CANONICAL",
          `Sensor ${sensor.implementationId} capabilities are not a stable sorted set`,
          [sensor.implementationId],
        ),
      );
      continue;
    }
    const calculated = digestValue(sortedCapabilities);
    if (!digestEquals(calculated, sensor.capabilityDigest)) {
      gaps.push(
        gap(
          "SENSOR_CAPABILITY_DIGEST_INVALID",
          `Sensor ${sensor.implementationId} capability digest is invalid`,
          [sensor.implementationId],
        ),
      );
    }
  }
  for (const requirement of requirements) {
    const exact = sensors.find(
      (sensor) =>
        sensor.sourceType === requirement.sourceType &&
        sensor.implementationId === requirement.sensorImplementationId &&
        sensor.implementationVersion === requirement.sensorImplementationVersion &&
        digestEquals(sensor.capabilityDigest, requirement.sensorCapabilityDigest),
    );
    if (exact === undefined) {
      gaps.push(
        gap(
          "MANDATORY_SENSOR_UNAVAILABLE",
          `Mandatory ${requirement.sourceType} Sensor triple is unavailable`,
          [requirement.sourceRequirementId, requirement.sensorImplementationId],
        ),
      );
    }
  }
  return gaps;
}

export function judgeCapabilityDigest(judge: JsonObject): ContentDigest {
  return digestValue({
    judgeId: judge.judgeId,
    judgeVersion: judge.version,
    deterministic: judge.deterministic,
    checkType: judge.checkType,
    evidenceContractTemplateId: judge.evidenceContractTemplateId,
    requiredFactTypes: judge.requiredFactTypes,
    ruleParameters: judge.ruleParameters,
  });
}

function registryGapForJudges(
  packJudges: readonly JsonObject[],
  judges: readonly JudgeDescriptor[],
): PlanGap[] {
  const gaps: PlanGap[] = [];
  if (new Set(judges.map((judge) => judge.judgeId)).size !== judges.length) {
    gaps.push(gap("JUDGE_REGISTRY_AMBIGUOUS", "Judge registry contains duplicate IDs"));
  }
  for (const packJudge of packJudges) {
    const judgeId = validateVersionedAssetId<"JudgeId">(packJudge.judgeId, "pack judgeId");
    const judgeVersion = asString(packJudge.version, `${judgeId}.version`);
    const expectedCapabilityDigest = judgeCapabilityDigest(packJudge);
    const exact = judges.find(
      (judge) =>
        judge.judgeId === judgeId &&
        judge.judgeVersion === judgeVersion &&
        judge.deterministic === true &&
        digestEquals(judge.capabilityDigest, expectedCapabilityDigest),
    );
    if (exact === undefined) {
      gaps.push(
        gap(
          "MANDATORY_JUDGE_UNAVAILABLE",
          `Mandatory deterministic Judge ${judgeId}@${judgeVersion} is unavailable or drifted`,
          [judgeId],
        ),
      );
    }
  }
  return gaps;
}

function capabilityGaps(capabilities: PlanningCapabilities): PlanGap[] {
  const gaps: PlanGap[] = [];
  const requiredBooleans = [
    ["observerReadOnly", capabilities.observerReadOnly],
    ["identitySeparation", capabilities.identitySeparation],
    ["atomicArtifactCommit", capabilities.atomicArtifactCommit],
    ["pathIsolation", capabilities.pathIsolation],
    ["networkDefaultDeny", capabilities.networkDefaultDeny],
    ["targetHiddenRootsDenied", capabilities.targetHiddenRootsDenied],
    ["probeArmedBeforeHeadless", capabilities.probeArmedBeforeHeadless],
  ] as const;
  for (const [name, available] of requiredBooleans) {
    if (!available) {
      gaps.push(
        gap(
          `VM_${name.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_UNAVAILABLE`,
          `Required VM planning capability ${name} is unavailable`,
        ),
      );
    }
  }
  const operations = [...new Set(capabilities.observerOperations)].sort();
  if (
    operations.length !== 3 ||
    operations[0] !== "DRAIN" ||
    operations[1] !== "READ" ||
    operations[2] !== "SNAPSHOT"
  ) {
    gaps.push(
      gap(
        "VM_OBSERVER_OPERATIONS_INVALID",
        "Observer must have exactly READ, SNAPSHOT and DRAIN operations",
      ),
    );
  }
  return gaps;
}

function configGaps(config: ConfigSnapshot, pack: FilesystemPack): PlanGap[] {
  const gaps: PlanGap[] = [];
  const scenarioExecution = asObject(pack.scenario.execution, "scenario.execution");
  const scenarioDeadline = asPositiveInteger(
    scenarioExecution.deadlineMs,
    "scenario.execution.deadlineMs",
  );
  const stableWindow = asPositiveInteger(
    scenarioExecution.stableWindowMs,
    "scenario.execution.stableWindowMs",
  );
  if (config.caseDeadlineMs < scenarioDeadline || config.runDeadlineMs < config.caseDeadlineMs) {
    gaps.push(
      gap("DEADLINE_INSUFFICIENT", "Frozen Config deadlines cannot satisfy the filesystem Case"),
    );
  }
  if (config.stableWindowMs < stableWindow || config.stableMaxWaitMs < config.stableWindowMs) {
    gaps.push(
      gap(
        "STABLE_WINDOW_INSUFFICIENT",
        "Frozen Config stable-window budget cannot satisfy the pack",
      ),
    );
  }
  const largestSource = Math.max(...pack.sourceRequirements.map((requirement) => requirement.maxBytes));
  if (config.maxArtifactBytes < largestSource) {
    gaps.push(
      gap("ARTIFACT_BUDGET_INSUFFICIENT", "Frozen artifact byte budget is below source requirements"),
    );
  }
  if (config.minimumIsolationLevel !== "AGENT_SEPARATED") {
    gaps.push(gap("ISOLATION_LEVEL_UNSUPPORTED", "AGENT_SEPARATED isolation is required"));
  }
  return gaps;
}

function packApplicabilityGaps(pack: FilesystemPack): PlanGap[] {
  const gaps: PlanGap[] = [];
  try {
    const scenario = asObject(pack.scenario, "filesystemPack.scenario");
    const environment = asObject(pack.environment, "filesystemPack.environment");
    const scenarioApplicability = asObject(
      scenario.applicability,
      "filesystemPack.scenario.applicability",
    );
    const environmentApplicability = asObject(
      environment.applicability,
      "filesystemPack.environment.applicability",
    );
    const domainBinding = asObject(scenario.domainBinding, "filesystemPack.scenario.domainBinding");
    const execution = asObject(scenario.execution, "filesystemPack.scenario.execution");

    if (
      scenario.scenarioId !== "scenario.filesystem.copy-exact/v1" ||
      environment.environmentId !== "environment.filesystem.workspace/v1" ||
      domainBinding.domainId !== "domain.filesystem.baseline/v1" ||
      scenarioApplicability.targetType !== "FULL_AGENT" ||
      scenarioApplicability.requestedScope !== "FILESYSTEM_MVP" ||
      environmentApplicability.targetType !== "FULL_AGENT" ||
      environmentApplicability.requestedScope !== "FILESYSTEM_MVP"
    ) {
      gaps.push(
        gap(
          "NON_FILESYSTEM_PACK_UNSUPPORTED",
          "MVP accepts only the frozen FULL_AGENT filesystem vertical-slice assets",
        ),
      );
    }
    validateVersionedAssetId(scenario.scenarioId, "scenarioId");
    validateVersionedAssetId(environment.environmentId, "environmentId");
    validateVersionedAssetId(domainBinding.domainId, "domainId");

    const forbiddenCaseFields = ["case", "cases", "casePlan", "casePlans", "scenarios"];
    if (
      execution.maxAttempts !== 1 ||
      forbiddenCaseFields.some((field) => Object.hasOwn(scenario, field)) ||
      forbiddenCaseFields.some((field) => Object.hasOwn(pack as unknown as object, field))
    ) {
      gaps.push(
        gap(
          "MULTI_CASE_OR_RETRY_UNSUPPORTED",
          "MVP compiles exactly one Case with maxAttempts=1",
        ),
      );
    }
  } catch {
    gaps.push(
      gap(
        "FILESYSTEM_PACK_SHAPE_INVALID",
        "Filesystem pack applicability or versioned asset identities are invalid",
      ),
    );
  }
  return gaps;
}

/** Pure matching: it never reads a live environment, filesystem, clock or registry. */
export function findPlanGaps(
  input: EvaluationAssetMatchingInput,
  capabilities: PlanningCapabilities,
): readonly PlanGap[] {
  const { targetSnapshot, inspectionSnapshot, filesystemPack, configSnapshot } = input;
  const gaps: PlanGap[] = [];
  try {
    validateFrozenDigest(targetSnapshot, "target snapshot");
    validateFrozenDigest(inspectionSnapshot, "inspection snapshot");
    validateFrozenDigest(filesystemPack, "filesystem pack");
    validateFrozenDigest(configSnapshot, "config snapshot");
  } catch {
    gaps.push(gap("FROZEN_INPUT_DIGEST_INVALID", "A frozen Planning input failed digest validation"));
  }

  const runtimeTargetKind = (targetSnapshot as unknown as Record<string, unknown>).targetType;
  if (runtimeTargetKind !== undefined && runtimeTargetKind !== "FULL_AGENT") {
    gaps.push(gap("UNSUPPORTED_TARGET_KIND", "MVP supports only FULL_AGENT targets"));
  }
  if (
    inspectionSnapshot.targetSnapshotRef.id !== targetSnapshot.targetSnapshotId ||
    !digestEquals(inspectionSnapshot.targetSnapshotRef.digest, targetSnapshot.contentDigest)
  ) {
    gaps.push(gap("INSPECTION_TARGET_MISMATCH", "Inspection is not bound to the frozen target"));
  }
  const status = inspectionStatus(
    inspectionSnapshot.dshVersionStatus,
    "inspection.dshVersionStatus",
  );
  const inspectedVersion = inspectionVersion(inspectionSnapshot.dshVersionStatus);
  if (
    targetSnapshot.dshPackageVersion !== REQUIRED_DSH_VERSION ||
    status !== "KNOWN" ||
    inspectedVersion !== REQUIRED_DSH_VERSION
  ) {
    gaps.push(
      gap(
        "DSH_VERSION_UNSATISFIED",
        `DSH ${REQUIRED_DSH_VERSION} must be frozen and confirmed by Inspector`,
      ),
    );
  }
  if (inspectionSnapshot.probeConfigured !== true) {
    gaps.push(gap("PROBE_NOT_CONFIRMED", "Runtime Probe configuration is not confirmed"));
  }
  if (inspectionSnapshot.probeSchema !== REQUIRED_PROBE_SCHEMA) {
    gaps.push(gap("PROBE_SCHEMA_UNSATISFIED", `Runtime Probe schema is missing or incompatible`));
  }
  if (inspectionSnapshot.probeOrderStatus !== "VALID") {
    gaps.push(gap("PROBE_ORDER_UNSATISFIED", `Runtime Probe must be armed before Headless`));
  }
  if (inspectionSnapshot.headlessDriverStatus !== "COMPATIBLE") {
    gaps.push(gap("HEADLESS_DRIVER_UNSATISFIED", `Frozen Headless Driver is incompatible`));
  }
  if (inspectionSnapshot.permissionPreset === "UNKNOWN" || inspectionSnapshot.sandboxMode === "UNKNOWN") {
    gaps.push(
      gap("PERMISSION_FACTS_UNKNOWN", `Permission preset and sandbox mode must be explicitly known`),
    );
  }
  for (const limitation of inspectionSnapshot.limitations) {
    const record = limitation === null || typeof limitation !== "object" || Array.isArray(limitation)
      ? undefined
      : limitation as Record<string, JsonValue>;
    const code = typeof record?.code === "string" ? record.code : undefined;
    if (
      code !== undefined &&
      code.startsWith("PROBE_") &&
      (record?.status === "UNKNOWN" || record?.status === "ABSENT")
    ) {
      gaps.push(gap(code, "A mandatory Runtime Probe capability is unknown or absent"));
    }
  }
  gaps.push(...packApplicabilityGaps(filesystemPack));
  gaps.push(...registryGapForSensors(filesystemPack.sourceRequirements, input.sensors));
  gaps.push(...registryGapForJudges(filesystemPack.judges, input.judges));
  gaps.push(...capabilityGaps(capabilities));
  gaps.push(...configGaps(configSnapshot, filesystemPack));

  if (
    filesystemPack.checks.length !== 3 ||
    new Set(filesystemPack.checks.map((check) => check.type)).size !== 3 ||
    filesystemPack.checks.some((check) => !check.required || !check.hardGate)
  ) {
    gaps.push(gap("CHECK_SET_INVALID", "Pack must contain three required hard-gate Checks"));
  }
  if (
    filesystemPack.sourceRequirements.length !== 2 ||
    new Set(filesystemPack.sourceRequirements.map((source) => source.sourceType)).size !== 2
  ) {
    gaps.push(gap("SOURCE_SET_INVALID", "ObservationPlan requires Probe and filesystem sources"));
  }

  const unique = new Map<string, PlanGap>();
  for (const current of gaps) {
    const key = `${current.code}:${current.affectedIds.join(",")}`;
    if (!unique.has(key)) unique.set(key, current);
  }
  return Object.freeze(
    [...unique.values()].sort((left, right) =>
      `${left.code}:${left.affectedIds.join(",")}`.localeCompare(
        `${right.code}:${right.affectedIds.join(",")}`,
        "en",
      ),
    ),
  );
}

function planningScope(target: TargetSnapshot): ScopeRef {
  return Object.freeze({
    targetId: target.targetId,
    targetSnapshotId: target.targetSnapshotId,
  });
}

async function commitPlanningArtifact(
  context: OperationContext,
  materializer: PlanArtifactMaterializer,
  metadata: ArtifactCommitMetadata,
  bytes: Uint8Array,
): Promise<PortResult<ArtifactRef>> {
  const result = await materializer.commit(context, bytes, metadata);
  if (result.status !== "SUCCEEDED") return result;
  const artifact = result.value;
  if (
    artifact.schema !== "dsheval.mvp.artifact/v1" ||
    artifact.state !== "COMMITTED" ||
    artifact.artifactId !== metadata.artifactId ||
    artifact.scope.targetId !== metadata.scope.targetId ||
    artifact.scope.targetSnapshotId !== metadata.scope.targetSnapshotId ||
    artifact.byteLength !== bytes.byteLength ||
    !digestEquals(artifact.artifactContentDigest, digestBytes(bytes))
  ) {
    return failed(
      failureDraft(
        metadata.scope,
        metadata.createdAt,
        "PLAN_ARTIFACT_COMMIT_INVALID",
        "Artifact materializer returned an invalid committed reference",
        "PERSISTENCE_FAILURE",
      ),
    );
  }
  return result;
}

function artifactMetadata(
  id: string,
  scope: ScopeRef,
  artifactType: string,
  logicalName: string,
  mediaType: string,
  config: ConfigSnapshot,
): ArtifactCommitMetadata {
  return Object.freeze({
    artifactId: validateStableId<"ArtifactId">(id, "artifactId"),
    scope,
    artifactType,
    logicalName,
    mediaType,
    producerVersion: config.dshevalVersion,
    createdAt: validateIsoDateTime(config.createdAt, "ConfigSnapshot.createdAt"),
    sensitivity: "EXPORTABLE" as const,
    redactionState: "NOT_REQUIRED" as const,
  });
}

function propagateArtifactFailure<T>(
  result: Exclude<PortResult<ArtifactRef>, { readonly status: "SUCCEEDED" }>,
): PortResult<T> {
  if (result.status === "REJECTED") {
    return rejected(result.rejectionCode, result.failureDrafts, result.warnings);
  }
  if (result.status === "CANCELLED") {
    return Object.freeze({ ...result });
  }
  return Object.freeze({ ...result });
}

async function materializeTask(
  context: OperationContext,
  input: EvaluationAssetMatchingInput,
  materializer: PlanArtifactMaterializer,
): Promise<PortResult<MaterializedTask>> {
  const { targetSnapshot, filesystemPack, configSnapshot } = input;
  const scope = planningScope(targetSnapshot);
  const scenario = filesystemPack.scenario;
  const task = asString(scenario.agentTask, "scenario.agentTask");
  const publicInputs = asArray(scenario.publicInputs, "scenario.publicInputs")
    .map((item, index) => ({ index, value: asObject(item, `publicInputs[${index}]`) }))
    .sort((left, right) =>
      asString(left.value.portablePath, "public input path").localeCompare(
        asString(right.value.portablePath, "public input path"),
        "en",
      ),
    );
  const targetVisible = canonicalize({ task, publicInputs: publicInputs.map((inputItem) => inputItem.value) });
  const hiddenTokens = filesystemPack.judges.flatMap((judge) => {
    const rules = asObject(judge.ruleParameters, "judge.ruleParameters");
    return [
      String(judge.judgeId),
      ...Object.values(rules)
        .filter((value): value is string => typeof value === "string")
        .filter((value) => /^[0-9a-f]{64}$/u.test(value)),
    ];
  });
  hiddenTokens.push(
    configSnapshot.artifactRoot,
    configSnapshot.reportRoot,
    configSnapshot.runRoot,
    "ruleParameters",
    "evidenceContract",
  );
  if (hiddenTokens.some((token) => token.length > 0 && targetVisible.includes(token))) {
    return rejected(
      "INVALID_INPUT",
      [
        failureDraft(
          scope,
          configSnapshot.createdAt,
          "TARGET_VISIBLE_HIDDEN_RULE",
          "Target-visible task material contains hidden Judge or management data",
          "INPUT_VALIDATION",
          "USER",
        ),
      ],
    );
  }

  const taskBytes = Buffer.from(task, "utf8");
  if (taskBytes.byteLength > configSnapshot.maxArtifactBytes) {
    return rejected(
      "INVALID_INPUT",
      [
        failureDraft(
          scope,
          configSnapshot.createdAt,
          "AGENT_TASK_TOO_LARGE",
          "Agent task exceeds the frozen artifact budget",
          "INPUT_VALIDATION",
          "USER",
        ),
      ],
    );
  }
  const taskContentDigest = digestBytes(taskBytes);
  const taskId = `agent-task.${digestValue({
    targetSnapshotDigest: targetSnapshot.contentDigest,
    packDigest: filesystemPack.contentDigest,
    taskContentDigest,
  }).value.slice(0, 24)}`;
  const taskResult = await commitPlanningArtifact(
    context,
    materializer,
    artifactMetadata(
      taskId,
      scope,
      "AGENT_TASK",
      "filesystem-copy-exact-task.txt",
      "text/plain; charset=utf-8",
      configSnapshot,
    ),
    taskBytes,
  );
  if (taskResult.status !== "SUCCEEDED") return propagateArtifactFailure(taskResult);

  const visibleInputRefs: Ref<ArtifactRef>[] = [];
  const inputContentDigests: ContentDigest[] = [];
  for (const { index, value } of publicInputs) {
    if (context.cancellationToken.isCancellationRequested) {
      return cancelled(
        failureDraft(
          scope,
          configSnapshot.createdAt,
          "PLAN_CANCELLED",
          "Planning was cancelled while materializing public inputs",
          "CANCELLED",
          "USER",
        ),
      );
    }
    if (value.encoding !== "utf8") {
      return rejected(
        "UNSUPPORTED",
        [
          failureDraft(
            scope,
            configSnapshot.createdAt,
            "PUBLIC_INPUT_ENCODING_UNSUPPORTED",
            "Only UTF-8 public inputs are supported by the MVP",
            "INPUT_VALIDATION",
            "USER",
          ),
        ],
      );
    }
    const content = asString(value.content, `publicInputs[${index}].content`);
    const portablePath = validatePortablePath(
      value.portablePath,
      `publicInputs[${index}].portablePath`,
    );
    const bytes = Buffer.from(content, "utf8");
    if (bytes.byteLength > configSnapshot.maxArtifactBytes) {
      return rejected(
        "INVALID_INPUT",
        [
          failureDraft(
            scope,
            configSnapshot.createdAt,
            "PUBLIC_INPUT_TOO_LARGE",
            "A public input exceeds the frozen artifact budget",
            "INPUT_VALIDATION",
            "USER",
          ),
        ],
      );
    }
    const contentDigest = digestBytes(bytes);
    const id = `visible-input.${digestValue({ portablePath, contentDigest }).value.slice(0, 24)}`;
    const committed = await commitPlanningArtifact(
      context,
      materializer,
      artifactMetadata(
        id,
        scope,
        "VISIBLE_INPUT",
        asString(value.logicalName, `publicInputs[${index}].logicalName`),
        asString(value.mediaType, `publicInputs[${index}].mediaType`),
        configSnapshot,
      ),
      bytes,
    );
    if (committed.status !== "SUCCEEDED") return propagateArtifactFailure(committed);
    visibleInputRefs.push(artifactRefFor(committed.value));
    inputContentDigests.push(contentDigest);
  }
  return succeeded(
    Object.freeze({
      taskRef: artifactRefFor(taskResult.value),
      visibleInputRefs: Object.freeze(visibleInputRefs),
      taskContentDigest,
      inputContentDigests: Object.freeze(inputContentDigests),
    }),
  );
}

function evidenceContracts(
  input: EvaluationAssetMatchingInput,
  semanticSeed: ContentDigest,
): CompiledContracts {
  const scope = planningScope(input.targetSnapshot);
  const createdAt = validateIsoDateTime(input.configSnapshot.createdAt);
  const contracts: EvidenceContract[] = [];
  const checkPlans: CheckPlan[] = [];
  const checks = [...input.filesystemPack.checks].sort((left, right) =>
    left.checkId.localeCompare(right.checkId, "en"),
  );
  for (const check of checks) {
    const judge = input.filesystemPack.judges.find((candidate) => candidate.judgeId === check.judgeId);
    if (judge === undefined) {
      throw new ContractViolation("INTERNAL_INVARIANT", `validated Check has no Judge`);
    }
    const registryJudge = input.judges.find((candidate) => candidate.judgeId === check.judgeId);
    if (registryJudge === undefined) {
      throw new ContractViolation("INTERNAL_INVARIANT", `validated Judge registry entry disappeared`);
    }
    const requiredFactTypes = asArray(judge.requiredFactTypes, `${check.checkId}.requiredFactTypes`).map(
      (value, index) => asString(value, `${check.checkId}.requiredFactTypes[${index}]`),
    );
    const allowedSourceTypes: readonly ("DSH_PROBE" | "FILESYSTEM")[] =
      check.type === "PROTOCOL" ? Object.freeze(["DSH_PROBE"]) : Object.freeze(["FILESYSTEM"]);
    const minimumTrust = check.type === "PROTOCOL" ? "COOPERATIVE" as const : "INDEPENDENT" as const;
    const sourceRules = asObject(judge.ruleParameters, `${check.checkId}.ruleParameters`);
    const ruleParameters = Object.freeze({
      ...sourceRules,
      judgeVersion: registryJudge.judgeVersion,
      judgeCapabilityDigestValue: registryJudge.capabilityDigest.value,
    });
    const timeBoundary = check.type === "PROTOCOL"
      ? Object.freeze({
          scopeMatchRequired: true,
          startBoundary: "probe/start",
          committedTurnRequired: true,
          endBoundary: "probe/stop",
        })
      : Object.freeze({
          beforeRequired: true,
          afterRequired: true,
          afterTargetTermination: true,
          stableWindowRequired: true,
        });
    const semanticFields = {
      semanticSeed,
      checkId: check.checkId,
      requiredFactTypes,
      allowedSourceTypes,
      minimumTrust,
      minimumCompleteness: "COMPLETE",
      validityRequired: true,
      timeBoundary,
      authorizedJudgeId: check.judgeId,
      ruleParameters,
      missingOutcome: "UNEVALUABLE",
    };
    const semanticDigest = digestValue(semanticFields);
    const evidenceContractId = validateStableId<"EvidenceContractId">(
      `evidence-contract.${check.type.toLowerCase().replace("_", "-")}.${semanticDigest.value.slice(0, 16)}`,
      "evidenceContractId",
    );
    const withoutDigest = {
      schema: "dsheval.mvp.evidence-contract/v1" as const,
      evidenceContractId,
      scope,
      createdAt,
      producerVersion: input.configSnapshot.dshevalVersion,
      checkId: check.checkId,
      requiredFactTypes: Object.freeze(requiredFactTypes),
      allowedSourceTypes,
      minimumTrust,
      minimumCompleteness: "COMPLETE" as const,
      validityRequired: true,
      timeBoundary,
      authorizedJudgeId: check.judgeId,
      ruleParameters,
      missingOutcome: "UNEVALUABLE" as const,
      semanticDigest,
    };
    const contract: EvidenceContract = Object.freeze({
      ...withoutDigest,
      contentDigest: digestValue(withoutDigest),
    });
    contracts.push(contract);
    checkPlans.push(
      Object.freeze({
        checkId: check.checkId,
        type: check.type,
        required: true,
        hardGate: true,
        judgeId: check.judgeId,
        evidenceContractRef: refFor<EvidenceContract>(
          contract.schema,
          contract.evidenceContractId,
          contract.contentDigest,
        ),
      }),
    );
  }
  if (contracts.length !== 3) {
    throw new ContractViolation("INTERNAL_INVARIANT", `validated pack did not compile three Contracts`);
  }
  return Object.freeze({
    contracts: Object.freeze(contracts) as unknown as readonly [
      EvidenceContract,
      EvidenceContract,
      EvidenceContract,
    ],
    checkPlans: Object.freeze(checkPlans),
  });
}

function pathLists(pack: FilesystemPack): {
  readonly allowedPaths: CasePlan["allowedPaths"];
  readonly forbiddenPaths: CasePlan["forbiddenPaths"];
} {
  const policy = asObject(pack.scenario.pathPolicy, "scenario.pathPolicy");
  const allowedPaths = asArray(policy.allowedChanges, "pathPolicy.allowedChanges")
    .map((value, index) =>
      validatePortablePath(
        asObject(value, `allowedChanges[${index}]`).portablePath,
        `allowedChanges[${index}].portablePath`,
      ),
    )
    .sort();
  const forbiddenPaths = asArray(policy.forbiddenChanges, "pathPolicy.forbiddenChanges")
    .map((value, index) =>
      validatePortablePath(
        asObject(value, `forbiddenChanges[${index}]`).portablePath,
        `forbiddenChanges[${index}].portablePath`,
      ),
    )
    .sort();
  return Object.freeze({
    allowedPaths: Object.freeze(allowedPaths),
    forbiddenPaths: Object.freeze(forbiddenPaths),
  });
}

function compileFrozenPlan(
  input: EvaluationAssetMatchingInput,
  capabilities: PlanningCapabilities,
  materialized: MaterializedTask,
): PlanBuildResult {
  const { targetSnapshot, inspectionSnapshot, filesystemPack, configSnapshot } = input;
  const scope = planningScope(targetSnapshot);
  const execution = asObject(filesystemPack.scenario.execution, "scenario.execution");
  const scenarioId = validateVersionedAssetId<"ScenarioId">(
    filesystemPack.scenario.scenarioId,
    "scenarioId",
  );
  const environmentId = validateVersionedAssetId<"EnvironmentDefinitionId">(
    filesystemPack.environment.environmentId,
    "environmentId",
  );
  const checkIds = Object.freeze(
    [...filesystemPack.checks]
      .sort((left, right) => left.checkId.localeCompare(right.checkId, "en"))
      .map((check) => check.checkId),
  );
  const pathPolicy = pathLists(filesystemPack);
  const semanticSeed = digestValue({
    targetSnapshotId: targetSnapshot.targetSnapshotId,
    targetFacts: {
      dshEntrypointDigest: targetSnapshot.dshEntrypointDigest,
      dshPackageVersion: targetSnapshot.dshPackageVersion ?? "UNKNOWN",
      profile: targetSnapshot.profile,
      driverFingerprint: targetSnapshot.driverFingerprint,
      platform: targetSnapshot.platform,
      secretRefNames: [...targetSnapshot.secretRefNames].sort(),
      frozenArtifactIds: [
        targetSnapshot.sourceManifestRef.id,
        targetSnapshot.dshHomeManifestRef.id,
        targetSnapshot.profileManifestRef.id,
        targetSnapshot.lockfileRef.id,
        targetSnapshot.effectiveConfigRef.id,
      ].map(String).sort(),
    },
    inspectionFacts: {
      dshVersionStatus: inspectionSnapshot.dshVersionStatus,
      profile: inspectionSnapshot.profile,
      probeConfigured: inspectionSnapshot.probeConfigured,
      probeSchema: inspectionSnapshot.probeSchema,
      probeOrderStatus: inspectionSnapshot.probeOrderStatus,
      headlessDriverStatus: inspectionSnapshot.headlessDriverStatus,
      toolSchemas: inspectionSnapshot.toolSchemas,
      permissionPreset: inspectionSnapshot.permissionPreset,
      sandboxMode: inspectionSnapshot.sandboxMode,
      limitations: inspectionSnapshot.limitations,
      sourceArtifactIds: inspectionSnapshot.sourceArtifactRefs.map((ref) => String(ref.id)).sort(),
    },
    packDigest: filesystemPack.contentDigest,
    executionConfig: {
      runDeadlineMs: configSnapshot.runDeadlineMs,
      caseDeadlineMs: configSnapshot.caseDeadlineMs,
      stableWindowMs: configSnapshot.stableWindowMs,
      stableMaxWaitMs: configSnapshot.stableMaxWaitMs,
      maxArtifactBytes: configSnapshot.maxArtifactBytes,
      contentMode: configSnapshot.contentMode,
      allowedModelEndpoints: [...configSnapshot.allowedModelEndpoints].sort(),
      minimumIsolationLevel: configSnapshot.minimumIsolationLevel,
    },
    sensorRegistry: [...input.sensors]
      .sort((left, right) => left.implementationId.localeCompare(right.implementationId, "en"))
      .map((sensor) => ({
        implementationId: sensor.implementationId,
        implementationVersion: sensor.implementationVersion,
        sourceType: sensor.sourceType,
        capabilityDigest: sensor.capabilityDigest,
      })),
    judgeRegistry: [...input.judges]
      .sort((left, right) => left.judgeId.localeCompare(right.judgeId, "en"))
      .map((judge) => ({
        judgeId: judge.judgeId,
        judgeVersion: judge.judgeVersion,
        capabilityDigest: judge.capabilityDigest,
      })),
    capabilities: {
      ...capabilities,
      observerOperations: [...capabilities.observerOperations].sort(),
    },
    taskContentDigest: materialized.taskContentDigest,
    inputContentDigests: materialized.inputContentDigests,
  });
  const casePlanId = validateStableId<"CasePlanId">(
    `case-plan.${semanticSeed.value.slice(0, 24)}`,
    "casePlanId",
  );
  const casePlan: CasePlan = Object.freeze({
    casePlanId,
    order: 1,
    scenarioId,
    environmentId,
    agentTaskArtifactRef: materialized.taskRef,
    visibleInputArtifactRefs: materialized.visibleInputRefs,
    seedSpec: asObject(filesystemPack.environment.seedSpec, "environment.seedSpec"),
    allowedPaths: pathPolicy.allowedPaths,
    forbiddenPaths: pathPolicy.forbiddenPaths,
    deadlineMs: asPositiveInteger(execution.deadlineMs, "scenario.execution.deadlineMs"),
    stableWindowMs: asPositiveInteger(
      execution.stableWindowMs,
      "scenario.execution.stableWindowMs",
    ),
    maxAttempts: 1,
    checkIds,
  });
  const compiledContracts = evidenceContracts(input, semanticSeed);
  const planSemanticDigest = digestValue({
    semanticSeed,
    casePlan: {
      casePlanId,
      scenarioId,
      environmentId,
      taskContentDigest: materialized.taskContentDigest,
      inputContentDigests: materialized.inputContentDigests,
      seedSpec: casePlan.seedSpec,
      allowedPaths: casePlan.allowedPaths,
      forbiddenPaths: casePlan.forbiddenPaths,
      deadlineMs: casePlan.deadlineMs,
      stableWindowMs: casePlan.stableWindowMs,
      maxAttempts: 1,
      checkIds,
    },
    evidenceContracts: compiledContracts.contracts.map((contract) => contract.semanticDigest),
  });
  const evaluationPlanId = validateStableId<"EvaluationPlanId">(
    `evaluation-plan.${planSemanticDigest.value.slice(0, 24)}`,
    "evaluationPlanId",
  );
  const domainBinding = asObject(filesystemPack.scenario.domainBinding, "scenario.domainBinding");
  const evaluationWithoutDigest = {
    schema: "dsheval.mvp.evaluation-plan/v1" as const,
    evaluationPlanId,
    scope,
    createdAt: validateIsoDateTime(configSnapshot.createdAt),
    producerVersion: configSnapshot.dshevalVersion,
    targetSnapshotRef: snapshotRef(targetSnapshot),
    inspectionRef: inspectionRef(inspectionSnapshot),
    packRef: packRef(filesystemPack),
    casePlan,
    checkPlans: compiledContracts.checkPlans,
    budget: Object.freeze({
      runDeadlineMs: configSnapshot.runDeadlineMs,
      caseDeadlineMs: casePlan.deadlineMs,
      maxArtifactBytes: configSnapshot.maxArtifactBytes,
      maxAttempts: 1,
    }),
    gateRule: domainBinding.gateRule ?? Object.freeze({
      precedence: Object.freeze(["HARD_FAIL", "REQUIRED_UNEVALUABLE", "PASS"]),
      ruleVersion: "gate.required-hard/v1",
    }),
    exclusions: Object.freeze([
      "PLUGIN_TARGET",
      "MULTI_CASE",
      "RETRY",
      "NON_FILESYSTEM_ENVIRONMENT",
      "LLM_JUDGE",
    ]),
    semanticDigest: planSemanticDigest,
    status: "FROZEN" as const,
  };
  const evaluationPlan: EvaluationPlan = Object.freeze({
    ...evaluationWithoutDigest,
    contentDigest: digestValue(evaluationWithoutDigest),
  });

  const observationSemanticDigest = digestValue({
    evaluationPlanSemanticDigest: evaluationPlan.semanticDigest,
    casePlanId,
    sourceRequirements: filesystemPack.sourceRequirements,
    boundaryPolicy: {
      baselineBeforeTargetStart: true,
      targetTerminationBeforeAfter: true,
      probeArmedBeforeHeadless: true,
    },
    stablePolicy: {
      quietWindowMs: casePlan.stableWindowMs,
      maxWaitMs: configSnapshot.stableMaxWaitMs,
    },
    contentPolicy: {
      contentMode: configSnapshot.contentMode,
      maxBytes: configSnapshot.maxArtifactBytes,
      digestAlgorithm: "sha256",
    },
  });
  const observationPlanId = validateStableId<"ObservationPlanId">(
    `observation-plan.${observationSemanticDigest.value.slice(0, 24)}`,
    "observationPlanId",
  );
  const observationWithoutDigest = {
    schema: "dsheval.mvp.observation-plan/v1" as const,
    observationPlanId,
    scope,
    createdAt: validateIsoDateTime(configSnapshot.createdAt),
    producerVersion: configSnapshot.dshevalVersion,
    evaluationPlanRef: refFor<EvaluationPlan>(
      evaluationPlan.schema,
      evaluationPlan.evaluationPlanId,
      evaluationPlan.contentDigest,
    ),
    casePlanId,
    sourceRequirements: Object.freeze([...filesystemPack.sourceRequirements]),
    boundaryPolicy: Object.freeze({
      baselineBeforeTargetStart: true,
      targetTerminationBeforeAfter: true,
      probeArmedBeforeHeadless: true,
    }),
    stablePolicy: Object.freeze({
      quietWindowMs: casePlan.stableWindowMs,
      maxWaitMs: configSnapshot.stableMaxWaitMs,
    }),
    contentPolicy: Object.freeze({
      contentMode: configSnapshot.contentMode,
      maxBytes: configSnapshot.maxArtifactBytes,
      digestAlgorithm: "sha256",
    }),
    semanticDigest: observationSemanticDigest,
  };
  const observationPlan: ObservationPlan = Object.freeze({
    ...observationWithoutDigest,
    contentDigest: digestValue(observationWithoutDigest),
  });
  return Object.freeze({
    status: "FROZEN" as const,
    evaluationPlan,
    observationPlan,
    evidenceContracts: compiledContracts.contracts,
  });
}

/** The concrete, fixed filesystem implementation of EvaluationAssetMatchingPort. */
export class FilesystemPlanner implements EvaluationAssetMatchingPort {
  readonly #capabilities: PlanningCapabilities;

  public constructor(capabilities: PlanningCapabilities) {
    this.#capabilities = Object.freeze({
      ...capabilities,
      observerOperations: Object.freeze([...capabilities.observerOperations]),
    });
  }

  public async buildPlan(
    context: OperationContext,
    input: EvaluationAssetMatchingInput,
    artifactMaterializer: PlanArtifactMaterializer,
  ): Promise<PortResult<PlanBuildResult>> {
    const scope = planningScope(input.targetSnapshot);
    const occurredAt = validateIsoDateTime(input.configSnapshot.createdAt);
    if (context.cancellationToken.isCancellationRequested) {
      return cancelled(
        failureDraft(
          scope,
          occurredAt,
          "PLAN_CANCELLED",
          "Planning was cancelled before matching",
          "CANCELLED",
          "USER",
        ),
      );
    }
    try {
      const gaps = findPlanGaps(input, this.#capabilities);
      if (gaps.length > 0) {
        const drafts = gaps.map((currentGap) =>
          failureDraft(
            scope,
            occurredAt,
            currentGap.code,
            currentGap.messageRedacted,
            "PLAN_UNSATISFIABLE",
            currentGap.code.startsWith("DSH_") || currentGap.code.startsWith("PROBE_")
              ? "TARGET"
              : "DSHEVAL",
          ),
        );
        return succeeded(
          Object.freeze({
            status: "UNSATISFIABLE" as const,
            gaps,
            failureDrafts: Object.freeze(drafts),
          }),
        );
      }
      const materialized = await materializeTask(context, input, artifactMaterializer);
      if (materialized.status !== "SUCCEEDED") return materialized;
      return succeeded(compileFrozenPlan(input, this.#capabilities, materialized.value));
    } catch (error) {
      return failed(
        failureDraft(
          scope,
          occurredAt,
          "PLANNER_INTERNAL_INVARIANT",
          "Planner failed an internal invariant without producing a partial Plan",
          "INTERNAL_INVARIANT",
          "DSHEVAL",
        ),
      );
    }
  }
}
