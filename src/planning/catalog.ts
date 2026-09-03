/**
 * 文件功能：加载并校验一个自包含的 Dataset Pack，再按标签生成唯一评测执行单元。
 *
 * Dataset Pack 是扩充评测内容的接口：每个 JSON 文件同时声明 Case、标签与指标绑定、
 * Judge 配置、执行环境和观测要求。Catalog 只检查通用结构与引用，不认识具体题目或 Judge。
 *
 * 主要交互：Bootstrap 注册 JsonEvaluationCatalog；Workflow 通过 EvaluationCatalogPort 加载；
 * Planner 消费返回的 EvaluationPack。
 */
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import { cancelled, failed, rejected, succeeded } from "../core/contracts.js";
import type { OperationContext, PortResult } from "../core/contracts.js";
import type { FailureDraft } from "../core/errors.js";
import {
  ContractViolation,
  assertDigestEquals,
  digestValue,
  validateContentDigest,
  validateIsoDateTime,
  validateStableId,
  validateVersionedAssetId,
} from "../core/models.js";
import type {
  CaseCatalogEntry,
  CatalogResolution,
  CheckDefinition,
  DatasetCatalogEntry,
  DatasetId,
  EnvironmentCatalogEntry,
  EvaluationPack,
  EvaluationRequest,
  EvaluationUnitSelection,
  IsoDateTime,
  JsonObject,
  JsonValue,
  LabelBinding,
  LabelId,
  MetricId,
  ScopeRef,
  SourceRequirement,
  SourceTrust,
} from "../core/models.js";

/** Dataset Pack 文件必须使用的顶层字段。 */
const PACK_FIELDS = [
  "schema",
  "packId",
  "version",
  "dataset",
  "metricPool",
  "scenario",
  "judges",
  "environment",
  "contentDigest",
] as const;

/** 固定标签池中的一项；每个标签只对应一个可复用指标。 */
export interface LabelDefinition {
  readonly labelId: LabelId;
  readonly metricId: MetricId;
  readonly title: string;
  readonly requiredEvidenceTypes: readonly string[];
}

/** 创建一项经过 ID 校验的标签定义。 */
function defineLabel(
  labelId: string,
  metricId: string,
  title: string,
  requiredEvidenceTypes: readonly string[],
): LabelDefinition {
  return Object.freeze({
    labelId: validateVersionedAssetId<"LabelId">(labelId, "labelId"),
    metricId: validateVersionedAssetId<"MetricId">(metricId, "metricId"),
    title,
    requiredEvidenceTypes: Object.freeze([...requiredEvidenceTypes].sort()),
  });
}

/** 全系统共用的 15 个标签。Dataset 只能引用，不能重新定义标签与指标的对应关系。 */
export const LABEL_REGISTRY: readonly LabelDefinition[] = Object.freeze([
  defineLabel("label.artifact-delivery/v1", "metric.artifact-delivery/v1", "产物交付", ["ARTIFACT"]),
  defineLabel("label.collaboration/v1", "metric.collaboration/v1", "协作与委派", ["COLLABORATION_EVENT"]),
  defineLabel("label.efficiency-reliability/v1", "metric.efficiency-reliability/v1", "效率与稳定性", ["RUNTIME_EVENT"]),
  defineLabel("label.instruction-following/v1", "metric.instruction-following/v1", "指令遵循", ["FINAL_RESPONSE", "TASK_CONSTRAINT"]),
  defineLabel("label.loop/v1", "metric.loop/v1", "执行闭环与自我修正", ["RUNTIME_EVENT", "TOOL_RESULT"]),
  defineLabel("label.memory/v1", "metric.memory/v1", "记忆", ["MEMORY_PROBE"]),
  defineLabel("label.multimodal/v1", "metric.multimodal/v1", "多模态理解", ["MULTIMODAL_INPUT"]),
  defineLabel("label.reasoning-planning/v1", "metric.reasoning-planning/v1", "推理与规划", ["ACTION_SEQUENCE"]),
  defineLabel("label.retrieval-grounding/v1", "metric.retrieval-grounding/v1", "检索与依据", ["RETRIEVED_SOURCE"]),
  defineLabel("label.safety-boundary/v1", "metric.safety-boundary/v1", "安全与权限边界", ["ENVIRONMENT_DIFF"]),
  defineLabel("label.tool-code/v1", "metric.tool-code/v1", "工具（代码与终端）", ["PROCESS_RESULT", "TOOL_CALL"]),
  defineLabel("label.tool-data/v1", "metric.tool-data/v1", "工具（数据库与数据处理）", ["DATA_STATE", "TOOL_CALL"]),
  defineLabel("label.tool-document/v1", "metric.tool-document/v1", "工具（文档与 PDF）", ["DOCUMENT_ACCESS"]),
  defineLabel("label.tool-external/v1", "metric.tool-external/v1", "工具（API 与业务系统）", ["EXTERNAL_STATE", "TOOL_CALL"]),
  defineLabel("label.tool-web/v1", "metric.tool-web/v1", "工具（浏览器与网络）", ["WEB_ACCESS"]),
]);

const LABEL_BY_ID = new Map(LABEL_REGISTRY.map((definition) => [definition.labelId, definition]));
if (LABEL_REGISTRY.length !== 15 || LABEL_BY_ID.size !== 15) {
  throw new Error("Label Registry must contain exactly 15 unique labels");
}

/** 按 ID 查找固定标签。Catalog 校验 Dataset 的标签绑定时调用。 */
export function findLabelDefinition(labelId: LabelId): LabelDefinition | undefined {
  return LABEL_BY_ID.get(labelId);
}

/** Pack 文件或交叉引用不符合 Catalog 接口时抛出的错误。 */
export class CatalogValidationError extends ContractViolation {
  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "CatalogValidationError";
  }
}

/** Workflow 使用的 Catalog 接口；当前实现读取 JSON，未来实现也必须返回同一个 EvaluationPack。 */
export interface EvaluationCatalogPort {
  load(
    context: OperationContext,
    packPath: string,
    scope: ScopeRef,
    occurredAt: string,
    request?: EvaluationRequest,
  ): Promise<PortResult<EvaluationPack>>;
}

/** 把未知值收窄为普通 JSON 对象。 */
function asObject(value: unknown, field: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogValidationError("INVALID_PACK", `${field} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

/** 把未知值收窄为 JSON 数组。 */
function asArray(value: unknown, field: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new CatalogValidationError("INVALID_PACK", `${field} must be an array`);
  }
  return value;
}

/** 读取必填非空字符串。 */
function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CatalogValidationError("INVALID_PACK", `${field} must be a non-empty string`);
  }
  return value;
}

/** 检查字段集合完全一致，避免拼错字段被静默忽略。 */
function assertExactFields(
  value: Record<string, JsonValue>,
  fields: readonly string[],
  label: string,
): void {
  const expected = new Set(fields);
  const unknown = Object.keys(value).filter((field) => !expected.has(field)).sort();
  const missing = fields.filter((field) => !Object.hasOwn(value, field));
  if (unknown.length > 0 || missing.length > 0) {
    throw new CatalogValidationError(
      "INVALID_PACK_FIELDS",
      `${label} fields differ (unknown=${unknown.join(",") || "-"}, missing=${missing.join(",") || "-"})`,
    );
  }
}

/** 生成稳定、去重、排序后的只读字符串数组。 */
function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort((left, right) => left.localeCompare(right, "en")));
}

/** 读取稳定且无重复的字符串数组。 */
function stringSet(value: unknown, field: string): readonly string[] {
  const values = asArray(value, field).map((item, index) => asString(item, `${field}[${index}]`));
  const canonical = sortedUnique(values);
  if (canonical.length !== values.length) {
    throw new CatalogValidationError("INVALID_PACK", `${field} must not contain duplicates`);
  }
  return canonical;
}

/** 验证 SourceRequirement，并确认能力摘要来自声明的能力集合。 */
function parseSourceRequirement(value: unknown, field: string): SourceRequirement {
  const source = asObject(value, field);
  assertExactFields(source, [
    "sourceRequirementId",
    "sourceType",
    "sensorImplementationId",
    "sensorImplementationVersion",
    "sensorCapabilityDigest",
    "requiredCapabilities",
    "resourceBinding",
    "mandatory",
    "minimumTrust",
    "contentMode",
    "maxBytes",
    "timeoutMs",
    "watermarkDefinition",
  ], field);
  const capabilities = stringSet(source.requiredCapabilities, `${field}.requiredCapabilities`);
  const declaredDigest = validateContentDigest(source.sensorCapabilityDigest, `${field}.sensorCapabilityDigest`);
  assertDigestEquals(digestValue(capabilities), declaredDigest, "SENSOR_CAPABILITY_DIGEST_MISMATCH");
  const minimumTrust = asString(source.minimumTrust, `${field}.minimumTrust`);
  if (minimumTrust !== "INDEPENDENT" && minimumTrust !== "COOPERATIVE" && minimumTrust !== "UNVERIFIED") {
    throw new CatalogValidationError("INVALID_PACK", `${field}.minimumTrust is invalid`);
  }
  if (source.mandatory !== true) {
    throw new CatalogValidationError("INVALID_PACK", `${field}.mandatory must be true in the MVP`);
  }
  for (const numeric of ["maxBytes", "timeoutMs"] as const) {
    if (!Number.isSafeInteger(source[numeric]) || Number(source[numeric]) <= 0) {
      throw new CatalogValidationError("INVALID_PACK", `${field}.${numeric} must be positive`);
    }
  }
  return Object.freeze({
    sourceRequirementId: validateVersionedAssetId<"SourceRequirementId">(source.sourceRequirementId, `${field}.sourceRequirementId`),
    sourceType: asString(source.sourceType, `${field}.sourceType`),
    sensorImplementationId: validateStableId<"SensorImplementationId">(source.sensorImplementationId, `${field}.sensorImplementationId`),
    sensorImplementationVersion: asString(source.sensorImplementationVersion, `${field}.sensorImplementationVersion`),
    sensorCapabilityDigest: declaredDigest,
    resourceBinding: asString(source.resourceBinding, `${field}.resourceBinding`),
    mandatory: true,
    minimumTrust: minimumTrust as SourceTrust,
    contentMode: asString(source.contentMode, `${field}.contentMode`),
    maxBytes: Number(source.maxBytes),
    timeoutMs: Number(source.timeoutMs),
    watermarkDefinition: source.watermarkDefinition!,
  });
}

/** 读取 Dataset 的 LabelBinding，并从 Metric Pool 编译 CheckDefinition。 */
function parseChecks(
  dataset: Record<string, JsonValue>,
  metricPool: Record<string, JsonValue>,
): { readonly bindings: readonly LabelBinding[]; readonly checks: readonly CheckDefinition[] } {
  const evaluationProfile = asObject(dataset.evaluationProfile, "dataset.evaluationProfile");
  const metrics = asArray(metricPool.metrics, "metricPool.metrics").map((value, index) =>
    asObject(value, `metricPool.metrics[${index}]`),
  );
  const metricById = new Map(metrics.map((metric) => [
    asString(metric.metricId, "metric.metricId"),
    metric,
  ] as const));
  const bindings = asArray(evaluationProfile.labelBindings, "dataset.evaluationProfile.labelBindings")
    .map((value, index) => {
      const source = asObject(value, `labelBindings[${index}]`);
      assertExactFields(source, [
        "labelId",
        "metricId",
        "checkId",
        "metricParameters",
        "required",
        "hardGate",
      ], `labelBindings[${index}]`);
      const labelId = validateVersionedAssetId<"LabelId">(source.labelId, `labelBindings[${index}].labelId`);
      const metricId = validateVersionedAssetId<"MetricId">(source.metricId, `labelBindings[${index}].metricId`);
      const label = findLabelDefinition(labelId);
      if (label === undefined || label.metricId !== metricId) {
        throw new CatalogValidationError("LABEL_METRIC_MISMATCH", `Label ${labelId} is not bound to its registered Metric`);
      }
      const metric = metricById.get(metricId);
      if (metric === undefined || metric.checkId !== source.checkId) {
        throw new CatalogValidationError("METRIC_CHECK_MISMATCH", `Metric ${metricId} does not match its Check`);
      }
      if (source.required !== true || typeof source.hardGate !== "boolean") {
        throw new CatalogValidationError("INVALID_PACK", "Every MVP Label binding must be required and declare hardGate");
      }
      return Object.freeze({
        labelId,
        metricId,
        checkId: validateStableId<"CheckId">(source.checkId, `labelBindings[${index}].checkId`),
        metricParameters: asObject(source.metricParameters, `labelBindings[${index}].metricParameters`),
        requiredEvidenceTypes: label.requiredEvidenceTypes,
        required: true,
        hardGate: source.hardGate,
      });
    })
    .sort((left, right) => left.labelId.localeCompare(right.labelId, "en"));
  if (
    bindings.length === 0 ||
    new Set(bindings.map((binding) => binding.labelId)).size !== bindings.length ||
    new Set(bindings.map((binding) => binding.checkId)).size !== bindings.length
  ) {
    throw new CatalogValidationError("INVALID_LABEL_BINDINGS", "Dataset must bind one or more unique Labels and Checks");
  }
  const bindingByMetric = new Map(bindings.map((binding) => [binding.metricId, binding] as const));
  const checks = metrics.map((metric, index) => {
    const metricId = validateVersionedAssetId<"MetricId">(metric.metricId, `metrics[${index}].metricId`);
    const binding = bindingByMetric.get(metricId);
    if (binding === undefined) {
      throw new CatalogValidationError("UNBOUND_METRIC", `Metric ${metricId} has no Dataset Label binding`);
    }
    return Object.freeze({
      checkId: binding.checkId,
      type: asString(metric.type, `metrics[${index}].type`),
      judgeId: validateVersionedAssetId<"JudgeId">(metric.judgeId, `metrics[${index}].judgeId`),
      evidenceContractTemplateId: validateVersionedAssetId<"EvidenceContractTemplateId">(
        metric.evidenceContractTemplateId,
        `metrics[${index}].evidenceContractTemplateId`,
      ),
      required: binding.required,
      hardGate: binding.hardGate,
    });
  }).sort((left, right) => left.checkId.localeCompare(right.checkId, "en"));
  return Object.freeze({ bindings: Object.freeze(bindings), checks: Object.freeze(checks) });
}

/** 检查 Judge 声明完整，并确认每个 Check 都有唯一 Judge。 */
function validateJudges(
  values: readonly JsonValue[],
  checks: readonly CheckDefinition[],
  sourceTypes: ReadonlySet<string>,
): readonly JsonObject[] {
  const judges = values.map((value, index) => {
    const judge = asObject(value, `judges[${index}]`);
    assertExactFields(judge, [
      "judgeId",
      "version",
      "method",
      "deterministic",
      "checkType",
      "evidenceContractTemplateId",
      "requiredFactTypes",
      "allowedSourceTypes",
      "minimumTrust",
      "timeBoundary",
      "ruleParameters",
    ], `judges[${index}]`);
    const method = asString(judge.method, `judges[${index}].method`);
    if ((method !== "RULE" && method !== "LLM") || typeof judge.deterministic !== "boolean") {
      throw new CatalogValidationError("INVALID_JUDGE", "Judge method or deterministic flag is invalid");
    }
    const allowedSourceTypes = stringSet(judge.allowedSourceTypes, `judges[${index}].allowedSourceTypes`);
    if (allowedSourceTypes.length === 0 || allowedSourceTypes.some((sourceType) => !sourceTypes.has(sourceType))) {
      throw new CatalogValidationError("INVALID_JUDGE_SOURCE", "Judge references an unavailable observation source");
    }
    const minimumTrust = asString(judge.minimumTrust, `judges[${index}].minimumTrust`);
    if (!["INDEPENDENT", "COOPERATIVE", "UNVERIFIED"].includes(minimumTrust)) {
      throw new CatalogValidationError("INVALID_JUDGE", "Judge minimumTrust is invalid");
    }
    stringSet(judge.requiredFactTypes, `judges[${index}].requiredFactTypes`);
    asObject(judge.timeBoundary, `judges[${index}].timeBoundary`);
    asObject(judge.ruleParameters, `judges[${index}].ruleParameters`);
    validateVersionedAssetId<"JudgeId">(judge.judgeId, `judges[${index}].judgeId`);
    validateVersionedAssetId<"EvidenceContractTemplateId">(
      judge.evidenceContractTemplateId,
      `judges[${index}].evidenceContractTemplateId`,
    );
    return Object.freeze(judge) as JsonObject;
  }).sort((left, right) => String(left.judgeId).localeCompare(String(right.judgeId), "en"));
  if (new Set(judges.map((judge) => judge.judgeId)).size !== judges.length) {
    throw new CatalogValidationError("INVALID_JUDGE_SET", "Judge IDs must be unique");
  }
  for (const check of checks) {
    const judge = judges.find((candidate) => candidate.judgeId === check.judgeId);
    if (
      judge === undefined ||
      judge.checkType !== check.type ||
      judge.evidenceContractTemplateId !== check.evidenceContractTemplateId
    ) {
      throw new CatalogValidationError("CHECK_JUDGE_MISMATCH", `Check ${check.checkId} has no matching Judge`);
    }
  }
  return Object.freeze(judges);
}

/** Catalog 选择所需的已解析输入。 */
export interface CatalogSelectionInput {
  readonly request: EvaluationRequest;
  readonly datasets: readonly DatasetCatalogEntry[];
  readonly cases: readonly CaseCatalogEntry[];
  readonly environments: readonly EnvironmentCatalogEntry[];
}

/** 无法唯一选择 Dataset 时返回的安全诊断。 */
export interface CatalogSelectionGap {
  readonly code: string;
  readonly affectedIds: readonly string[];
  readonly messageRedacted: string;
}

/** 标签选择要么返回完整执行单元，要么只返回缺口。 */
export type CatalogSelectionResult =
  | { readonly status: "RESOLVED"; readonly resolution: CatalogResolution }
  | { readonly status: "UNSATISFIABLE"; readonly gaps: readonly CatalogSelectionGap[] };

function selectionGap(code: string, messageRedacted: string, affectedIds: readonly string[] = []): CatalogSelectionGap {
  return Object.freeze({ code, messageRedacted, affectedIds: sortedUnique(affectedIds) });
}

/** 根据请求标签选择唯一 Dataset，并保持其 Case、环境和 Judge 原子绑定。 */
export function resolveEvaluationRequest(input: CatalogSelectionInput): CatalogSelectionResult {
  const requested = sortedUnique(input.request.requestedLabelIds) as readonly LabelId[];
  const gaps: CatalogSelectionGap[] = [];
  if (requested.length === 0 || requested.length !== input.request.requestedLabelIds.length) {
    gaps.push(selectionGap("LABEL_SELECTION_INVALID", "EvaluationRequest must contain unique Labels"));
  }
  const unknown = requested.filter((labelId) => findLabelDefinition(labelId) === undefined);
  if (unknown.length > 0) gaps.push(selectionGap("LABEL_UNKNOWN", "EvaluationRequest references unknown Labels", unknown));
  if (gaps.length > 0) return Object.freeze({ status: "UNSATISFIABLE", gaps: Object.freeze(gaps) });

  const preferred = new Set(input.request.preferredDatasetIds);
  const candidates = input.datasets.filter((dataset) => {
    const labels = new Set(dataset.labelBindings.map((binding) => binding.labelId));
    return requested.every((labelId) => labels.has(labelId)) &&
      (preferred.size === 0 || preferred.has(dataset.datasetId));
  });
  if (candidates.length !== 1) {
    return Object.freeze({
      status: "UNSATISFIABLE",
      gaps: Object.freeze([
        selectionGap(
          candidates.length === 0 ? "DATASET_NOT_FOUND" : "DATASET_AMBIGUOUS",
          "Requested Labels must resolve to exactly one Dataset",
          candidates.map((dataset) => dataset.datasetId),
        ),
      ]),
    });
  }
  const dataset = candidates[0]!;
  const excluded = new Set(input.request.excludeCaseIds);
  const cases = dataset.caseIds
    .filter((caseId) => !excluded.has(caseId))
    .map((caseId) => input.cases.find((entry) => entry.caseId === caseId))
    .filter((entry): entry is CaseCatalogEntry => entry !== undefined);
  const environment = input.environments.find((entry) => entry.environmentId === dataset.environmentId);
  if (cases.length !== 1 || environment === undefined) {
    return Object.freeze({
      status: "UNSATISFIABLE",
      gaps: Object.freeze([selectionGap("DATASET_BUNDLE_INCOMPLETE", "Dataset Case or Environment reference is incomplete")]),
    });
  }
  const requestedSet = new Set(requested);
  const labelBindings = Object.freeze(dataset.labelBindings.filter((binding) => requestedSet.has(binding.labelId)));
  const unit: EvaluationUnitSelection = Object.freeze({
    caseId: cases[0]!.caseId,
    datasetId: dataset.datasetId,
    labelBindings,
    environmentId: dataset.environmentId,
    environmentObserverSourceRequirementId: dataset.environmentObserverSourceRequirementId,
    runtimeSourceRequirementId: dataset.runtimeSourceRequirementId,
    judgeAssetId: dataset.judgeAssetId,
    checkIds: Object.freeze(labelBindings.map((binding) => binding.checkId).sort()),
  });
  const withoutDigest = {
    schema: "dsheval.mvp.catalog-resolution/v1" as const,
    requestId: input.request.requestId,
    selectedLabelIds: requested,
    selectedDatasetIds: Object.freeze([dataset.datasetId]) as readonly DatasetId[],
    units: Object.freeze([unit]),
  };
  return Object.freeze({
    status: "RESOLVED",
    resolution: Object.freeze({ ...withoutDigest, contentDigest: digestValue(withoutDigest) }),
  });
}

/** 把一个已校验的 Dataset Pack JSON 编译成 Planner 使用的 EvaluationPack。 */
function compilePack(asset: Record<string, JsonValue>, requestOverride?: EvaluationRequest): EvaluationPack {
  assertExactFields(asset, PACK_FIELDS, "pack");
  if (asset.schema !== "dsheval.mvp.evaluation-pack-asset/v1") {
    throw new CatalogValidationError("INVALID_PACK_SCHEMA", "Pack schema must be dsheval.mvp.evaluation-pack-asset/v1");
  }
  const declaredDigest = validateContentDigest(asset.contentDigest, "pack.contentDigest");
  assertDigestEquals(digestValue(asset, ["contentDigest"]), declaredDigest, "PACK_DIGEST_MISMATCH");

  const dataset = asObject(asset.dataset, "dataset");
  const metricPool = asObject(asset.metricPool, "metricPool");
  const scenario = asObject(asset.scenario, "scenario");
  const environment = asObject(asset.environment, "environment");
  const datasetId = validateVersionedAssetId<"DatasetId">(dataset.datasetId, "dataset.datasetId");
  const scenarioId = validateVersionedAssetId<"CatalogCaseId">(scenario.scenarioId, "scenario.scenarioId");
  const environmentId = validateVersionedAssetId<"EnvironmentDefinitionId">(environment.environmentId, "environment.environmentId");
  const environmentProfile = asObject(dataset.environmentProfile, "dataset.environmentProfile");
  const evaluationProfile = asObject(dataset.evaluationProfile, "dataset.evaluationProfile");
  const environmentSource = parseSourceRequirement(environment.sourceRequirement, "environment.sourceRequirement");
  const runtimeSource = parseSourceRequirement(scenario.sourceRequirement, "scenario.sourceRequirement");
  if (
    environmentProfile.environmentId !== environmentId ||
    environmentProfile.observerSourceRequirementId !== environmentSource.sourceRequirementId ||
    dataset.runtimeSourceRequirementId !== runtimeSource.sourceRequirementId ||
    !asArray(dataset.caseRefs, "dataset.caseRefs").includes(scenarioId) ||
    evaluationProfile.metricPoolId !== metricPool.metricPoolId
  ) {
    throw new CatalogValidationError("PACK_REFERENCE_MISMATCH", "Dataset, Case, Environment, Metric or Source references do not match");
  }

  const { bindings, checks } = parseChecks(dataset, metricPool);
  const sourceRequirements = Object.freeze([runtimeSource, environmentSource].sort((left, right) =>
    left.sourceRequirementId.localeCompare(right.sourceRequirementId, "en"),
  ));
  const judges = validateJudges(
    asArray(asset.judges, "judges"),
    checks,
    new Set(sourceRequirements.map((source) => source.sourceType)),
  );
  const judgeAssetId = validateVersionedAssetId<"JudgeAssetId">(evaluationProfile.judgeAssetId, "dataset.evaluationProfile.judgeAssetId");
  const defaultRequestWithoutDigest = {
    schema: "dsheval.mvp.evaluation-request/v1" as const,
    requestId: validateStableId<"EvaluationRequestId">(`request.${digestValue({ datasetId, labels: bindings.map((binding) => binding.labelId) }).value.slice(0, 20)}`),
    requestedLabelIds: Object.freeze(bindings.map((binding) => binding.labelId).sort()),
    preferredDatasetIds: Object.freeze([datasetId]),
    excludeCaseIds: Object.freeze([]),
  };
  const request = requestOverride ?? Object.freeze(defaultRequestWithoutDigest);
  const selection = resolveEvaluationRequest({
    request,
    datasets: [Object.freeze({
      datasetId,
      labelBindings: bindings,
      caseIds: Object.freeze([scenarioId]),
      environmentId,
      environmentObserverSourceRequirementId: environmentSource.sourceRequirementId,
      runtimeSourceRequirementId: runtimeSource.sourceRequirementId,
      judgeAssetId,
    })],
    cases: [Object.freeze({ caseId: scenarioId })],
    environments: [Object.freeze({
      environmentId,
      observerSourceRequirementId: environmentSource.sourceRequirementId,
    })],
  });
  if (selection.status !== "RESOLVED") {
    throw new CatalogValidationError("PACK_SELECTION_FAILED", selection.gaps.map((gap) => gap.code).join(","));
  }
  const selectedCheckIds = new Set(selection.resolution.units[0]!.checkIds);
  const selectedChecks = Object.freeze(checks.filter((check) => selectedCheckIds.has(check.checkId)));
  const selectedJudges = Object.freeze(judges.filter((judge) =>
    selectedChecks.some((check) => judge.judgeId === check.judgeId)
  ));

  const withoutDigest = {
    schema: "dsheval.mvp.evaluation-pack/v1" as const,
    packId: validateStableId<"PackId">(asset.packId, "pack.packId"),
    version: asString(asset.version, "pack.version"),
    request,
    resolution: selection.resolution,
    dataset: Object.freeze(dataset) as JsonObject,
    metricPool: Object.freeze(metricPool) as JsonObject,
    scenario: Object.freeze(scenario) as JsonObject,
    checks: selectedChecks,
    judges: selectedJudges,
    environment: Object.freeze(environment) as JsonObject,
    sourceRequirements,
  };
  return Object.freeze({ ...withoutDigest, contentDigest: digestValue(withoutDigest) });
}

/** 解析 packPath：可以直接指向 JSON，也可以指向只含一个 JSON 的目录。 */
async function resolvePackFile(packPath: string): Promise<string> {
  const absolute = resolve(packPath);
  const info = await lstat(absolute);
  if (info.isSymbolicLink()) {
    throw new CatalogValidationError("PACK_SYMLINK_REJECTED", "Dataset Pack path must not be a symbolic link");
  }
  if (info.isFile()) return await realpath(absolute);
  if (!info.isDirectory()) {
    throw new CatalogValidationError("PACK_NOT_FILE", "Dataset Pack path must be a JSON file or directory");
  }
  const entries = await readdir(absolute, { withFileTypes: true });
  const jsonFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"));
  const unsafe = entries.filter((entry) => entry.isSymbolicLink() || (!entry.isFile() && !entry.name.startsWith(".")));
  if (jsonFiles.length !== 1 || unsafe.length > 0) {
    throw new CatalogValidationError("PACK_SELECTION_AMBIGUOUS", "A Dataset Pack directory must contain exactly one JSON file");
  }
  return await realpath(join(absolute, jsonFiles[0]!.name));
}

/** 读取一个自包含 Dataset Pack；不包含任何题目名称或固定文件名判断。 */
export async function loadEvaluationPack(
  packPath: string,
  request?: EvaluationRequest,
): Promise<EvaluationPack> {
  const file = await resolvePackFile(packPath);
  const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
  return compilePack(asObject(parsed, "pack"), request);
}

/** 把 Catalog 异常转换为统一 PortResult，供 Workflow 保存准确失败类型。 */
export class JsonEvaluationCatalog implements EvaluationCatalogPort {
  public async load(
    context: OperationContext,
    packPath: string,
    scope: ScopeRef,
    occurredAtValue: string,
    request?: EvaluationRequest,
  ): Promise<PortResult<EvaluationPack>> {
    const occurredAt = validateIsoDateTime(occurredAtValue, "catalog occurredAt");
    if (context.cancellationToken.isCancellationRequested) {
      return cancelled(catalogFailure(scope, occurredAt, "CATALOG_CANCELLED", "Dataset Pack loading was cancelled", "CANCELLED", "USER"));
    }
    try {
      return succeeded(await loadEvaluationPack(packPath, request));
    } catch (error) {
      const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
      const invalid = error instanceof ContractViolation;
      const draft = catalogFailure(
        scope,
        occurredAt,
        notFound ? "PACK_NOT_FOUND" : invalid ? error.code : "CATALOG_INTERNAL_ERROR",
        notFound ? "Dataset Pack was not found" : invalid ? "Dataset Pack failed validation" : "DSHEval could not load the Dataset Pack",
        invalid || notFound ? "INPUT_VALIDATION" : "INTERNAL_INVARIANT",
        notFound ? "USER" : "DSHEVAL",
      );
      if (notFound) return rejected("NOT_FOUND", [draft]);
      if (invalid) return rejected("INVALID_INPUT", [draft]);
      return failed(draft);
    }
  }
}

/** 创建 Catalog 阶段的脱敏失败记录。 */
function catalogFailure(
  scope: ScopeRef,
  occurredAt: IsoDateTime,
  reasonCode: string,
  messageRedacted: string,
  category: FailureDraft["category"],
  origin: FailureDraft["origin"],
): FailureDraft {
  return Object.freeze({
    scope,
    category,
    origin,
    actor: "PLANNING",
    phase: "CATALOG_LOAD",
    severity: "ERROR",
    retryable: false,
    messageRedacted,
    reasonCode,
    evidenceRefs: [],
    artifactRefs: [],
    occurredAt,
  });
}
