/**
 * 文件职责：把统一 Planner 已选中的 Dataset、Label 证据要求与 Environment Observer
 * 绑定冻结成执行期 EvaluationPlan、AgentTracePlan、ObservationPlan 和 EvidenceContract。
 *
 * 本模块不选择 Dataset、不定义标签证据规则、也不调用 LLM。ObservationPlan 只是运行期派生物：
 * “采集什么”来自 Label，“怎样采集”来自 Environment。
 *
 * 与其他文件的真实交互：`app/bootstrap.ts` 构造 ExecutionPlanCompiler 并注入产物写能力；
 * `datasets/evaluation-asset.ts` 提供组合后的执行资产，`planning/target.ts` 提供静态检查结果；
 * `runtime` 消费 EvaluationPlan 与 AgentTracePlan，`observation` 只消费环境 ObservationPlan，
 * `evaluation` 使用证据契约判定。
 *
 * 公开接口：PlanningCapabilities、judgeCapabilityDigest、findPlanGaps 与实现
 * EvaluationAssetMatchingPort 的 ExecutionPlanCompiler。
 */
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
  AgentTracePlan,
  ArtifactRef,
  AssetIdentifier,
  CasePlan,
  CheckPlan,
  ConfigSnapshot,
  ContentDigest,
  EvaluationPlan,
  EvidenceContract,
  EvaluationPack,
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
  SourceTrust,
  StableId,
  TargetSnapshot,
} from "../core/models.js";

/** V0.1 Planner 接受并要求 Inspector 确认的 DSH 包版本。 */
const REQUIRED_DSH_VERSION = "0.1.1-rc.2";
/** V0.1 Planner 接受并要求已配置的 Runtime Probe schema。 */
const REQUIRED_PROBE_SCHEMA = "dsh-eval.probe/v1";

/** 平台 Preflight 向 Planner 声明的安全、持久化和 Observer 能力集合。 */
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

/** 任务文本和公开输入提交后的 Ref 与内容摘要。 */
interface MaterializedTask {
  readonly taskRef: Ref<ArtifactRef>;
  readonly visibleInputRefs: readonly Ref<ArtifactRef>[];
  readonly taskContentDigest: ContentDigest;
  readonly inputContentDigests: readonly ContentDigest[];
}

/** Dataset 声明的 EvidenceContract 及其对应 CheckPlan 编译结果。 */
interface CompiledContracts {
  readonly contracts: readonly EvidenceContract[];
  readonly checkPlans: readonly CheckPlan[];
}

/** 将 Pack/配置中的未知字段窄化为 JSON 对象。 */
function asObject(value: unknown, fieldName: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

/** 将 Pack/配置中的未知字段窄化为 JSON 数组。 */
function asArray(value: unknown, fieldName: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be an array`);
  }
  return value;
}

/** 读取规划输入中的必填非空字符串。 */
function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be a non-empty string`);
  }
  return value;
}

/** 读取规划输入中的正安全整数预算。 */
function asPositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new ContractViolation("INVALID_PLAN_INPUT", `${fieldName} must be a positive integer`);
  }
  return Number(value);
}

/** 从 schema、稳定 ID 和摘要创建冻结 Ref，供各专用 Ref helper 复用。 */
function refFor<T>(schema: string, id: StableId, digest: ContentDigest): Ref<T> {
  return Object.freeze({ schema, id, digest });
}

/** 把已提交 ArtifactRef 转换为计划关系使用的轻量 Ref。 */
function artifactRefFor(artifact: ArtifactRef): Ref<ArtifactRef> {
  return refFor(artifact.schema, artifact.artifactId, artifact.contentDigest);
}

/** 为 EvaluationPlan 构造 TargetSnapshot 引用。 */
function snapshotRef(snapshot: TargetSnapshot): Ref<TargetSnapshot> {
  return refFor(snapshot.schema, snapshot.targetSnapshotId, snapshot.contentDigest);
}

/** 为 EvaluationPlan 构造 InspectionSnapshot 引用。 */
function inspectionRef(inspection: InspectionSnapshot): Ref<InspectionSnapshot> {
  return refFor(inspection.schema, inspection.inspectionId, inspection.contentDigest);
}

/** 为 EvaluationPlan 构造 EvaluationPack 引用。 */
function packRef(pack: EvaluationPack): Ref<EvaluationPack> {
  return refFor(pack.schema, pack.packId, pack.contentDigest);
}

/** 创建 PLAN 阶段脱敏 FailureDraft，供 Planner 的取消、拒绝和异常路径复用。 */
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

/** 创建结构化 PlanGap，供所有能力与输入匹配 helper 返回。 */
function gap(
  code: string,
  messageRedacted: string,
  affectedIds: readonly AssetIdentifier[] = [],
): PlanGap {
  return Object.freeze({ code, messageRedacted, affectedIds: Object.freeze([...affectedIds]) });
}

/** 重算并验证一项冻结输入的 contentDigest。 */
function validateFrozenDigest(record: object, label: string): void {
  const source = record as Record<string, unknown>;
  const declared = validateContentDigest(source.contentDigest, `${label}.contentDigest`);
  assertDigestEquals(digestValue(source, ["contentDigest"]), declared, `${label.toUpperCase()}_DIGEST_MISMATCH`);
}

/** 从 Inspector JSON 事实读取状态字段。 */
function inspectionStatus(value: JsonValue, field: string): string | undefined {
  const object = asObject(value, field);
  return typeof object.status === "string" ? object.status : undefined;
}

/** 从 Inspector 的 DSH 版本事实读取已确认版本。 */
function inspectionVersion(value: JsonValue): string | undefined {
  const object = asObject(value, "inspection.dshVersionStatus");
  return typeof object.version === "string" ? object.version : undefined;
}

/**
 * 将 Pack 的每项 SourceRequirement 与 Sensor 注册表精确匹配，并检查注册项规范性；
 * findPlanGaps 调用并合并返回的缺口。
 */
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

/** 计算 Pack Judge 的语义能力摘要；应用注册和 Planner 匹配使用同一算法。 */
export function judgeCapabilityDigest(judge: JsonObject): ContentDigest {
  return digestValue({
    judgeId: judge.judgeId,
    judgeVersion: judge.version,
    method: judge.method,
    deterministic: judge.deterministic,
    checkType: judge.checkType,
  });
}

/** 将 Pack 的 Judge 定义与运行时 Judge 注册表按 ID、版本、确定性和能力摘要精确匹配。 */
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
    const method = asString(packJudge.method, `${judgeId}.method`);
    const deterministic = packJudge.deterministic === true;
    const expectedCapabilityDigest = judgeCapabilityDigest(packJudge);
    const exact = judges.find(
      (judge) =>
        judge.judgeId === judgeId &&
        judge.judgeVersion === judgeVersion &&
        judge.method === method &&
        judge.deterministic === deterministic &&
        digestEquals(judge.capabilityDigest, expectedCapabilityDigest),
    );
    if (exact === undefined) {
      gaps.push(
        gap(
          "MANDATORY_JUDGE_UNAVAILABLE",
          `Required Judge ${judgeId}@${judgeVersion} is unavailable or drifted`,
          [judgeId],
        ),
      );
    }
  }
  return gaps;
}

/** 检查平台是否提供 V0.1 运行所需的全部隔离、提交、网络和 Observer 能力。 */
function capabilityGaps(
  capabilities: PlanningCapabilities,
  sessionTraceFallback: boolean,
): PlanGap[] {
  const gaps: PlanGap[] = [];
  /** 必须由平台 Preflight 全部确认的布尔能力注册表。 */
  const requiredBooleans = [
    ["observerReadOnly", capabilities.observerReadOnly],
    ["identitySeparation", capabilities.identitySeparation],
    ["atomicArtifactCommit", capabilities.atomicArtifactCommit],
    ["pathIsolation", capabilities.pathIsolation],
    ["networkDefaultDeny", capabilities.networkDefaultDeny],
    ["targetHiddenRootsDenied", capabilities.targetHiddenRootsDenied],
    ...(
      sessionTraceFallback
        ? []
        : [["probeArmedBeforeHeadless", capabilities.probeArmedBeforeHeadless] as const]
    ),
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

/** 检查冻结 Config 的截止时间、稳定窗口、产物预算和隔离等级能否满足 Pack。 */
function configGaps(config: ConfigSnapshot, pack: EvaluationPack): PlanGap[] {
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
      gap("DEADLINE_INSUFFICIENT", "Frozen Config deadlines cannot satisfy the selected Case"),
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
  if (
    config.minimumIsolationLevel !== "AGENT_SEPARATED" &&
    config.minimumIsolationLevel !== "SESSION_SEPARATED"
  ) {
    gaps.push(gap("ISOLATION_LEVEL_UNSUPPORTED", "The configured isolation level is unsupported"));
  }
  return gaps;
}

/** 校验 Pack 内单 Dataset、单 Case 的引用关系；不限定具体标签、Judge 或环境类型。 */
function packApplicabilityGaps(pack: EvaluationPack): PlanGap[] {
  const gaps: PlanGap[] = [];
  try {
    const scenario = asObject(pack.scenario, "evaluationPack.scenario");
    const environment = asObject(pack.environment, "evaluationPack.environment");
    const execution = asObject(scenario.execution, "evaluationPack.scenario.execution");
    const evaluationProfile = asObject(
      pack.dataset.evaluationProfile,
      "evaluationPack.dataset.evaluationProfile",
    );
    const metricPool = asObject(pack.metricPool, "evaluationPack.metricPool");
    const unit = pack.resolution.units[0];

    if (
      unit === undefined ||
      unit.caseId !== scenario.scenarioId ||
      unit.environmentId !== environment.environmentId ||
      unit.datasetId !== validateVersionedAssetId<"DatasetId">(pack.dataset.datasetId) ||
      unit.judgeAssetId !== validateVersionedAssetId<"JudgeAssetId">(
        evaluationProfile.judgeAssetId,
      )
    ) {
      gaps.push(
        gap(
          "PACK_REFERENCE_MISMATCH",
          "Selected Dataset, Case, Environment or Judge references do not form one atomic unit",
        ),
      );
    }
    validateVersionedAssetId(scenario.scenarioId, "scenarioId");
    validateVersionedAssetId(environment.environmentId, "environmentId");
    validateVersionedAssetId(pack.dataset.datasetId, "datasetId");
    validateVersionedAssetId(metricPool.metricPoolId, "metricPoolId");

    /** 旧式或多 Case Pack 形状的字段名注册表。 */
    const forbiddenCaseFields = ["case", "cases", "casePlan", "casePlans", "scenarios"];
    if (
      execution.maxAttempts !== 1 ||
      pack.resolution.units.length !== 1 ||
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
        "EVALUATION_PACK_SHAPE_INVALID",
        "Evaluation pack applicability or versioned asset identities are invalid",
      ),
    );
  }
  return gaps;
}

/**
 * 对全部冻结输入与显式能力做确定性匹配，汇总、去重并排序 PlanGap；
 * ExecutionPlanCompiler.buildPlan 在提交任务产物前调用，测试也直接验证此纯匹配结果。
 */
export function findPlanGaps(
  input: EvaluationAssetMatchingInput,
  capabilities: PlanningCapabilities,
): readonly PlanGap[] {
  const { targetSnapshot, inspectionSnapshot, evaluationPack, configSnapshot } = input;
  const gaps: PlanGap[] = [];
  try {
    validateFrozenDigest(targetSnapshot, "target snapshot");
    validateFrozenDigest(inspectionSnapshot, "inspection snapshot");
    validateFrozenDigest(evaluationPack, "evaluation pack");
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
  const sessionTraceFallback = configSnapshot.minimumIsolationLevel === "SESSION_SEPARATED";
  if (!sessionTraceFallback) {
    if (inspectionSnapshot.probeConfigured !== true) {
      gaps.push(gap("PROBE_NOT_CONFIRMED", "Runtime Probe configuration is not confirmed"));
    }
    if (inspectionSnapshot.probeSchema !== REQUIRED_PROBE_SCHEMA) {
      gaps.push(gap("PROBE_SCHEMA_UNSATISFIED", `Runtime Probe schema is missing or incompatible`));
    }
    if (inspectionSnapshot.probeOrderStatus !== "VALID") {
      gaps.push(gap("PROBE_ORDER_UNSATISFIED", `Runtime Probe must be armed before Headless`));
    }
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
      !sessionTraceFallback &&
      code !== undefined &&
      code.startsWith("PROBE_") &&
      (record?.status === "UNKNOWN" || record?.status === "ABSENT")
    ) {
      gaps.push(gap(code, "A mandatory Runtime Probe capability is unknown or absent"));
    }
  }
  gaps.push(...packApplicabilityGaps(evaluationPack));
  gaps.push(...registryGapForSensors(evaluationPack.sourceRequirements, input.sensors));
  gaps.push(...registryGapForJudges(evaluationPack.judges, input.judges));
  gaps.push(...capabilityGaps(capabilities, sessionTraceFallback));
  gaps.push(...configGaps(configSnapshot, evaluationPack));

  if (evaluationPack.checks.length === 0 ||
      new Set(evaluationPack.checks.map((check) => check.checkId)).size !== evaluationPack.checks.length) {
    gaps.push(gap("CHECK_SET_INVALID", "Pack must contain at least one uniquely identified Check"));
  }
  if (evaluationPack.sourceRequirements.length === 0 ||
      new Set(evaluationPack.sourceRequirements.map((source) => source.sourceRequirementId)).size !==
        evaluationPack.sourceRequirements.length) {
    gaps.push(gap("SOURCE_SET_INVALID", "Pack must declare at least one uniquely identified observation source"));
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

/** 从 TargetSnapshot 构造规划与规划产物使用的目标快照级作用域。 */
function planningScope(target: TargetSnapshot): ScopeRef {
  return Object.freeze({
    targetId: target.targetId,
    targetSnapshotId: target.targetSnapshotId,
  });
}

/** 调用受限 Materializer 提交规划产物，并验证返回 ArtifactRef 与请求元数据和字节一致。 */
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

/** 用冻结 Config 补全规划产物的身份、作用域、媒体、版本和脱敏元数据。 */
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

/** 将产物提交的非成功结果转换到调用方所需泛型，同时保留原始失败语义。 */
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

/**
 * 从 Scenario 提取目标可见任务和输入，检查隐藏规则泄漏与预算，逐项提交产物；
 * ExecutionPlanCompiler.buildPlan 在匹配成功后调用。
 */
async function materializeTask(
  context: OperationContext,
  input: EvaluationAssetMatchingInput,
  materializer: PlanArtifactMaterializer,
): Promise<PortResult<MaterializedTask>> {
  const { targetSnapshot, evaluationPack, configSnapshot } = input;
  const scope = planningScope(targetSnapshot);
  const scenario = evaluationPack.scenario;
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
  const hiddenTokens = evaluationPack.judges.flatMap((judge) => {
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
    configSnapshot.resultRoot,
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
    packDigest: evaluationPack.contentDigest,
    evaluationRequest: evaluationPack.request,
    catalogResolution: evaluationPack.resolution,
    taskContentDigest,
  }).value.slice(0, 24)}`;
  const taskResult = await commitPlanningArtifact(
    context,
    materializer,
    artifactMetadata(
      taskId,
      scope,
      "AGENT_TASK",
      "agent-task.txt",
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

/**
 * 为 Dataset 中的每个 Check 编译带语义摘要的 EvidenceContract 与 CheckPlan；
 * compileFrozenPlan 调用，并把注册 Judge 的版本/能力摘要绑定到规则参数。
 */
function evidenceContracts(
  input: EvaluationAssetMatchingInput,
  semanticSeed: ContentDigest,
): CompiledContracts {
  const scope = planningScope(input.targetSnapshot);
  const createdAt = validateIsoDateTime(input.configSnapshot.createdAt);
  const contracts: EvidenceContract[] = [];
  const checkPlans: CheckPlan[] = [];
  const checks = [...input.evaluationPack.checks].sort((left, right) =>
    left.checkId.localeCompare(right.checkId, "en"),
  );
  for (const check of checks) {
    const judge = input.evaluationPack.judges.find((candidate) => candidate.judgeId === check.judgeId);
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
    const allowedSourceTypes = Object.freeze(
      asArray(judge.allowedSourceTypes, `${check.checkId}.allowedSourceTypes`)
        .map((value, index) => asString(value, `${check.checkId}.allowedSourceTypes[${index}]`))
        .sort(),
    );
    const minimumTrustValue = asString(judge.minimumTrust, `${check.checkId}.minimumTrust`);
    if (minimumTrustValue !== "INDEPENDENT" && minimumTrustValue !== "COOPERATIVE" && minimumTrustValue !== "UNVERIFIED") {
      throw new ContractViolation("INVALID_PLAN_INPUT", `${check.checkId}.minimumTrust is invalid`);
    }
    const minimumTrust = minimumTrustValue as SourceTrust;
    const sourceRules = asObject(judge.ruleParameters, `${check.checkId}.ruleParameters`);
    const ruleParameters = Object.freeze({
      ...sourceRules,
      judgeVersion: registryJudge.judgeVersion,
      judgeCapabilityDigestValue: registryJudge.capabilityDigest.value,
    });
    const timeBoundary = asObject(judge.timeBoundary, `${check.checkId}.timeBoundary`);
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
        required: check.required,
        hardGate: check.hardGate,
        judgeId: check.judgeId,
        evidenceContractRef: refFor<EvidenceContract>(
          contract.schema,
          contract.evidenceContractId,
          contract.contentDigest,
        ),
      }),
    );
  }
  return Object.freeze({
    contracts: Object.freeze(contracts),
    checkPlans: Object.freeze(checkPlans),
  });
}

/** 从 Scenario pathPolicy 提取并校验稳定排序的允许与禁止路径列表。 */
function pathLists(pack: EvaluationPack): {
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

/**
 * 将已匹配输入和已提交任务编译为 EvaluationPlan、AgentTracePlan、环境 ObservationPlan 与证据契约；
 * ExecutionPlanCompiler.buildPlan 的成功路径调用并返回 FROZEN PlanBuildResult。
 */
function compileFrozenPlan(
  input: EvaluationAssetMatchingInput,
  capabilities: PlanningCapabilities,
  materialized: MaterializedTask,
): PlanBuildResult {
  const { targetSnapshot, inspectionSnapshot, evaluationPack, configSnapshot } = input;
  const scope = planningScope(targetSnapshot);
  const execution = asObject(evaluationPack.scenario.execution, "scenario.execution");
  const scenarioId = validateVersionedAssetId<"ScenarioId">(
    evaluationPack.scenario.scenarioId,
    "scenarioId",
  );
  const environmentId = validateVersionedAssetId<"EnvironmentDefinitionId">(
    evaluationPack.environment.environmentId,
    "environmentId",
  );
  const checkIds = Object.freeze(
    [...evaluationPack.checks]
      .sort((left, right) => left.checkId.localeCompare(right.checkId, "en"))
      .map((check) => check.checkId),
  );
  const pathPolicy = pathLists(evaluationPack);
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
      pluginCatalog: inspectionSnapshot.pluginCatalog,
      probeConfigured: inspectionSnapshot.probeConfigured,
      probeSchema: inspectionSnapshot.probeSchema,
      probeOrderStatus: inspectionSnapshot.probeOrderStatus,
      headlessDriverStatus: inspectionSnapshot.headlessDriverStatus,
      toolSchemas: inspectionSnapshot.toolSchemas,
      toolDelta: inspectionSnapshot.toolDelta,
      permissionPreset: inspectionSnapshot.permissionPreset,
      sandboxMode: inspectionSnapshot.sandboxMode,
      limitations: inspectionSnapshot.limitations,
      sourceArtifactIds: inspectionSnapshot.sourceArtifactRefs.map((ref) => String(ref.id)).sort(),
    },
    packDigest: evaluationPack.contentDigest,
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
    datasetId: evaluationPack.resolution.units[0]!.datasetId,
    labelBindings: evaluationPack.resolution.units[0]!.labelBindings,
    environmentId,
    environmentObserverSourceRequirementId:
      evaluationPack.resolution.units[0]!.environmentObserverSourceRequirementId,
    runtimeSourceRequirementId: evaluationPack.resolution.units[0]!.runtimeSourceRequirementId,
    judgeAssetId: evaluationPack.resolution.units[0]!.judgeAssetId,
    agentTaskArtifactRef: materialized.taskRef,
    visibleInputArtifactRefs: materialized.visibleInputRefs,
    seedSpec: asObject(evaluationPack.environment.seedSpec, "environment.seedSpec"),
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
      datasetId: casePlan.datasetId,
      labelBindings: casePlan.labelBindings,
      environmentId,
      environmentObserverSourceRequirementId: casePlan.environmentObserverSourceRequirementId,
      runtimeSourceRequirementId: casePlan.runtimeSourceRequirementId,
      judgeAssetId: casePlan.judgeAssetId,
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
  const evaluationProfile = asObject(
    evaluationPack.dataset.evaluationProfile,
    "evaluationPack.dataset.evaluationProfile",
  );
  const gateRule = asObject(
    evaluationProfile.gateRule,
    "evaluationPack.dataset.evaluationProfile.gateRule",
  );
  const evaluationWithoutDigest = {
    schema: "dsheval.mvp.evaluation-plan/v1" as const,
    evaluationPlanId,
    scope,
    createdAt: validateIsoDateTime(configSnapshot.createdAt),
    producerVersion: configSnapshot.dshevalVersion,
    targetSnapshotRef: snapshotRef(targetSnapshot),
    inspectionRef: inspectionRef(inspectionSnapshot),
    packRef: packRef(evaluationPack),
    request: evaluationPack.request,
    catalogResolution: evaluationPack.resolution,
    casePlan,
    checkPlans: compiledContracts.checkPlans,
    budget: Object.freeze({
      runDeadlineMs: configSnapshot.runDeadlineMs,
      caseDeadlineMs: casePlan.deadlineMs,
      maxArtifactBytes: configSnapshot.maxArtifactBytes,
      maxAttempts: 1,
    }),
    gateRule,
    exclusions: Object.freeze([
      "PLUGIN_TARGET",
      "MULTI_CASE",
      "RETRY",
      "MULTI_ENVIRONMENT",
    ]),
    semanticDigest: planSemanticDigest,
    status: "FROZEN" as const,
  };
  const evaluationPlan: EvaluationPlan = Object.freeze({
    ...evaluationWithoutDigest,
    contentDigest: digestValue(evaluationWithoutDigest),
  });

  const agentTraceSourceRequirements = Object.freeze(
    evaluationPack.sourceRequirements.filter(
      (requirement) =>
        requirement.sourceRequirementId === casePlan.runtimeSourceRequirementId,
    ),
  );
  const environmentSourceRequirements = Object.freeze(
    evaluationPack.sourceRequirements.filter(
      (requirement) =>
        requirement.sourceRequirementId !== casePlan.runtimeSourceRequirementId,
    ),
  );

  const agentTraceSemanticDigest = digestValue({
    evaluationPlanSemanticDigest: evaluationPlan.semanticDigest,
    casePlanId,
    sourceRequirements: agentTraceSourceRequirements,
    lifecyclePolicy: {
      armedBeforeTargetStart: true,
      drainAfterTargetTermination: true,
    },
    contentPolicy: {
      contentMode: configSnapshot.contentMode,
      maxBytes: configSnapshot.maxArtifactBytes,
      digestAlgorithm: "sha256",
    },
  });
  const agentTracePlanId = validateStableId<"AgentTracePlanId">(
    `agent-trace-plan.${agentTraceSemanticDigest.value.slice(0, 24)}`,
    "agentTracePlanId",
  );
  const agentTraceWithoutDigest = {
    schema: "dsheval.mvp.agent-trace-plan/v1" as const,
    agentTracePlanId,
    scope,
    createdAt: validateIsoDateTime(configSnapshot.createdAt),
    producerVersion: configSnapshot.dshevalVersion,
    evaluationPlanRef: refFor<EvaluationPlan>(
      evaluationPlan.schema,
      evaluationPlan.evaluationPlanId,
      evaluationPlan.contentDigest,
    ),
    casePlanId,
    sourceRequirements: agentTraceSourceRequirements,
    lifecyclePolicy: Object.freeze({
      armedBeforeTargetStart: true,
      drainAfterTargetTermination: true,
    }),
    contentPolicy: Object.freeze({
      contentMode: configSnapshot.contentMode,
      maxBytes: configSnapshot.maxArtifactBytes,
      digestAlgorithm: "sha256",
    }),
    semanticDigest: agentTraceSemanticDigest,
  };
  const agentTracePlan: AgentTracePlan = Object.freeze({
    ...agentTraceWithoutDigest,
    contentDigest: digestValue(agentTraceWithoutDigest),
  });

  const observationSemanticDigest = digestValue({
    evaluationPlanSemanticDigest: evaluationPlan.semanticDigest,
    casePlanId,
    sourceRequirements: environmentSourceRequirements,
    boundaryPolicy: {
      baselineBeforeTargetStart: true,
      targetTerminationBeforeAfter: true,
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
    sourceRequirements: environmentSourceRequirements,
    boundaryPolicy: Object.freeze({
      baselineBeforeTargetStart: true,
      targetTerminationBeforeAfter: true,
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
    agentTracePlan,
    observationPlan,
    evidenceContracts: compiledContracts.contracts,
  });
}

/** MVP 的 EvaluationAssetMatchingPort 实现；只消费 Catalog 已选定的 Dataset 内容。 */
export class ExecutionPlanCompiler implements EvaluationAssetMatchingPort {
  readonly #capabilities: PlanningCapabilities;

  /** 冻结平台能力快照，后续每次 buildPlan 使用同一组匹配条件。 */
  public constructor(capabilities: PlanningCapabilities) {
    this.#capabilities = Object.freeze({
      ...capabilities,
      observerOperations: Object.freeze([...capabilities.observerOperations]),
    });
  }

  /**
   * 执行完整规划工作流：响应取消、返回 UNSATISFIABLE 缺口，或提交目标可见产物并编译冻结计划；
   * `app/bootstrap.ts` 通过 EvaluationAssetMatchingPort 调用。
   */
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
