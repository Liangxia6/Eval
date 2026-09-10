/**
 * 把外部 Dataset Case、Label、Agent Trace 与 Environment 配置组合成内部 EvaluationPack。
 * 生产链路只接受当前 question.json/private/final.json 目录格式；旧示例 Pack 只留在 tests/fixtures。
 */
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  digestBytes,
  digestValue,
  validatePortablePath,
  validateVersionedAssetId,
  type DatasetId,
  type EvaluationPack,
  type EvaluationRequest,
  type JsonObject,
  type JsonValue,
  type LabelId,
} from "../core/models.js";
import { labelJudgeId } from "../evaluation/llm-label-judge.js";
import { compileEvaluationAsset } from "../evaluation/evaluation-asset.js";

function object(value: unknown, field: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

function string(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

async function json(file: string): Promise<Record<string, JsonValue>> {
  const info = await lstat(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error(`${file} must be a regular file`);
  return object(JSON.parse(await readFile(file, "utf8")), file);
}

function slugFromLabel(labelId: LabelId): string {
  return String(labelId).replace(/^label\./u, "").replace(/\/v1$/u, "");
}

function datasetSlug(datasetId: DatasetId): string {
  return String(datasetId).replace(/^dataset\./u, "").replace(/\/v1$/u, "");
}

function currentDatasetDirectoryName(datasetId: DatasetId): string {
  const slug = datasetSlug(datasetId);
  return slug.startsWith("harbor-") ? slug.slice("harbor-".length) : slug;
}

async function currentQuestionCases(root: string, datasetId: DatasetId): Promise<readonly string[]> {
  const group = path.join(root, currentDatasetDirectoryName(datasetId));
  const groupInfo = await lstat(group).catch((error: NodeJS.ErrnoException) =>
    error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (groupInfo === undefined || !groupInfo.isDirectory() || groupInfo.isSymbolicLink()) return Object.freeze([]);
  const files: string[] = [];
  for (const entry of await readdir(group, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const candidate = path.join(group, entry.name, "question.json");
    const info = await lstat(candidate).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (info?.isFile() && !info.isSymbolicLink()) files.push(candidate);
  }
  return Object.freeze(files.sort((left, right) => left.localeCompare(right, "en")));
}

/** Planner 的可用题量以磁盘上的真实 question.json 为准，不信任 Catalog 中可能过期的声明。 */
export async function countDatasetQuestionCases(root: string, datasetId: DatasetId): Promise<number> {
  return (await currentQuestionCases(root, datasetId)).length;
}

async function labelAsset(root: string, labelId: LabelId): Promise<Record<string, JsonValue>> {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const asset = await json(path.join(root, entry.name));
    if (asset.labelId === labelId) return asset;
  }
  throw new Error(`Label asset not found for ${labelId}`);
}

function mediaType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".gif": return "image/gif";
    case ".json": return "application/json";
    case ".txt":
    case ".md": return "text/plain; charset=utf-8";
    default: return "application/octet-stream";
  }
}

function deterministicOptions(questionId: string, values: readonly JsonValue[]): readonly string[] {
  const options = values.map((value, index) => ({
    value: string(value, `environment.setup.options[${index}]`),
    key: digestValue({ questionId, index, value }).value,
  }));
  return Object.freeze(options.sort((left, right) => left.key.localeCompare(right.key, "en")).map((item) => item.value));
}

async function currentCase(questionFile: string, selectedLabels: readonly LabelId[]): Promise<{
  readonly version: string;
  readonly caseId: string;
  readonly task: string;
  readonly deadlineMs: number;
  readonly seedEntries: readonly JsonObject[];
  readonly expectedAnswer: JsonValue;
  readonly expectedRubric: JsonValue;
  readonly expectedOutputPath: string;
  readonly expectedEvidence: JsonValue;
  readonly evaluator: JsonValue;
  readonly labelIds: readonly LabelId[];
}> {
  const question = await json(questionFile);
  if (question.schema !== "dsheval.question/v1") throw new Error(`${questionFile} has an unsupported schema`);
  const questionId = string(question.id, "question.id");
  const task = object(question.task, "question.task");
  const environment = object(question.environment, "question.environment");
  if (environment.platform !== "darwin") throw new Error(`${questionId} is not a macOS Case`);
  const timeoutSeconds = Number(environment.timeoutSeconds);
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1) throw new Error(`${questionId} timeoutSeconds is invalid`);
  const declaredLabels = Array.isArray(question.capabilityLabels)
    ? question.capabilityLabels.map((value, index) => validateVersionedAssetId<"LabelId">(
        `label.${string(value, `capabilityLabels[${index}]`)}/v1`,
        `capabilityLabels[${index}]`,
      ))
    : [];
  const selectedLabelSet = new Set(selectedLabels.map(String));
  if (declaredLabels.length === 0 || declaredLabels.some((labelId) => !selectedLabelSet.has(String(labelId)))) {
    throw new Error(`${questionId} labels are not covered by the selected Dataset catalog labels`);
  }

  const caseRoot = path.dirname(questionFile);
  const entries: JsonObject[] = [
    { entryType: "DIRECTORY", mode: "0555", portablePath: "input", readOnlyForTarget: true },
    { entryType: "DIRECTORY", mode: "0775", portablePath: "output", readOnlyForTarget: false },
  ];
  if (!Array.isArray(environment.inputs)) throw new Error(`${questionId} environment.inputs must be an array`);
  for (const [index, rawInput] of environment.inputs.entries()) {
    const item = object(rawInput, `environment.inputs[${index}]`);
    const source = string(item.source, `environment.inputs[${index}].source`);
    const destination = validatePortablePath(item.destination, `environment.inputs[${index}].destination`);
    if (!String(destination).startsWith("input/")) throw new Error(`${questionId} input destination must stay under input/`);
    const sourcePath = path.resolve(caseRoot, source);
    const relative = path.relative(caseRoot, sourcePath);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`${questionId} input source escapes its Case directory`);
    }
    const info = await lstat(sourcePath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${questionId} input source must be a regular file`);
    const bytes = await readFile(sourcePath);
    const declaredSha256 = string(item.sha256, `environment.inputs[${index}].sha256`);
    if (digestBytes(bytes).value !== declaredSha256) throw new Error(`${questionId} input digest mismatch`);
    entries.push({
      entryType: "FILE",
      mode: "0444",
      portablePath: String(destination),
      readOnlyForTarget: true,
      encoding: "base64",
      content: bytes.toString("base64"),
      mediaType: mediaType(sourcePath),
    });
  }

  const setup = object(environment.setup, "environment.setup");
  let instructions = string(task.instructions, "task.instructions");
  if (setup.kind === "shuffle-options") {
    if (!Array.isArray(setup.options)) throw new Error(`${questionId} shuffle-options requires options`);
    const options = deterministicOptions(questionId, setup.options);
    const mapping = Object.fromEntries(options.map((value, index) => [String.fromCharCode(65 + index), value]));
    const mappingDestination = validatePortablePath(setup.mappingDestination, "environment.setup.mappingDestination");
    entries.push({
      entryType: "FILE",
      mode: "0444",
      portablePath: String(mappingDestination),
      readOnlyForTarget: true,
      encoding: "utf8",
      content: `${JSON.stringify(mapping, null, 2)}\n`,
      mediaType: "application/json",
    });
    instructions = instructions.replaceAll("{options}", options.map((value, index) => `${String.fromCharCode(65 + index)}. ${value}`).join("\n"));
  } else if (setup.kind !== "none") {
    throw new Error(`${questionId} setup kind is unsupported`);
  }

  const final = object(question.final, "question.final");
  if (!Array.isArray(final.checks) || final.checks.length !== 1) throw new Error(`${questionId} must contain one final check`);
  const finalCheck = object(final.checks[0], "final.checks[0]");
  if (finalCheck.kind !== "llm") throw new Error(`${questionId} final check must use llm`);
  const outputPath = validatePortablePath(finalCheck.output, "final.checks[0].output");
  if (!String(outputPath).startsWith("output/")) throw new Error(`${questionId} final output must stay under output/`);
  const referencePath = path.resolve(caseRoot, string(finalCheck.reference, "final.checks[0].reference"));
  const referenceRelative = path.relative(caseRoot, referencePath);
  if (referenceRelative === ".." || referenceRelative.startsWith(`..${path.sep}`) || path.isAbsolute(referenceRelative)) {
    throw new Error(`${questionId} private reference escapes its Case directory`);
  }
  const reference = await json(referencePath);

  return Object.freeze({
    version: string(question.version, "question.version"),
    caseId: `scenario.${questionId.replace(/^harbor\./u, "harbor-")}/v1`,
    task: instructions,
    deadlineMs: timeoutSeconds * 1000,
    seedEntries: Object.freeze(entries),
    expectedAnswer: reference.answer ?? null,
    expectedRubric: reference.rubric ?? null,
    expectedOutputPath: String(outputPath),
    expectedEvidence: question.evidence ?? {},
    evaluator: finalCheck,
    labelIds: Object.freeze(declaredLabels),
  });
}

/** 读取一道题，并在内存中组合 Dataset、Label、Agent Trace 和 macOS Environment 配置。 */
export async function loadDatasetEvaluationAsset(input: {
  readonly datasetsRoot: string;
  readonly labelsRoot: string;
  readonly traceFile: string;
  readonly environmentFile: string;
  readonly datasetId: DatasetId;
  readonly labelIds: readonly LabelId[];
  readonly request: EvaluationRequest;
  readonly caseIndex?: number;
}): Promise<EvaluationPack> {
  const caseIndex = input.caseIndex ?? 0;
  if (!Number.isSafeInteger(caseIndex) || caseIndex < 0) throw new Error("caseIndex must be a non-negative integer");
  const currentCases = await currentQuestionCases(input.datasetsRoot, input.datasetId);
  const caseData = await currentCase(
    currentCases[caseIndex] ?? (() => {
      throw new Error(`Dataset question.json not found for ${input.datasetId} case ${caseIndex}`);
    })(),
    input.labelIds,
  );
  const effectiveLabelIds = caseData.labelIds;
  const traceAsset = await json(input.traceFile);
  const environmentAsset = await json(input.environmentFile);
  const components = object(environmentAsset.components, "environment.components");
  const workspaceComponent = object(components.workspace, "environment.components.workspace");
  const runtimeSource = object(traceAsset.sourceRequirement, "trace.sourceRequirement");
  const workspaceSource = object(workspaceComponent.sourceRequirement, "workspace.sourceRequirement");
  const additionalSources = Object.values(components)
    .filter((component): component is JsonObject => component !== null && typeof component === "object" && !Array.isArray(component))
    .map((component) => component.sourceRequirement)
    .filter((source): source is JsonObject => source !== undefined && source !== workspaceComponent.sourceRequirement)
    .map((source) => object(source, "environment component sourceRequirement"));
  const workspace = object(environmentAsset.workspace, "environment.workspace");
  const slug = datasetSlug(input.datasetId);
  const scenarioId = validateVersionedAssetId<"CatalogCaseId">(caseData.caseId);

  const labelAssets = await Promise.all(effectiveLabelIds.map(async (labelId) => ({
    labelId,
    asset: await labelAsset(input.labelsRoot, labelId),
  })));
  const labelBindings = labelAssets.map(({ labelId, asset }) => {
    const labelSlug = slugFromLabel(labelId);
    const evidence = object(asset.evidence, `${labelId}.evidence`);
    return {
      labelId,
      metricId: asset.metricId,
      checkId: `check.${labelSlug}`,
      metricParameters: {},
      requiredEvidenceTypes: evidence.requiredFactTypes,
      required: true,
      hardGate: true,
    };
  });
  const metrics = labelAssets.map(({ labelId, asset }) => {
    const labelSlug = slugFromLabel(labelId);
    return {
      metricId: asset.metricId,
      checkId: `check.${labelSlug}`,
      type: "LLM_LABEL_SCORE",
      resultType: "VERDICT",
      judgeId: labelJudgeId(labelId),
      evidenceContractTemplateId: `contract.label.${labelSlug}/v1`,
    };
  });
  const judges = labelAssets.map(({ labelId, asset }) => {
    const labelSlug = slugFromLabel(labelId);
    const evidence = object(asset.evidence, `${labelId}.evidence`);
    return {
      judgeId: labelJudgeId(labelId),
      version: "1.0.0",
      method: "LLM",
      deterministic: false,
      checkType: "LLM_LABEL_SCORE",
      evidenceContractTemplateId: `contract.label.${labelSlug}/v1`,
      requiredFactTypes: evidence.requiredFactTypes,
      allowedSourceTypes: evidence.allowedSourceTypes,
      minimumTrust: evidence.minimumTrust,
      timeBoundary: {},
      ruleParameters: {
        expectedAnswer: caseData.expectedAnswer,
        expectedRubric: caseData.expectedRubric,
        expectedOutputPath: caseData.expectedOutputPath,
        expectedEvidence: caseData.expectedEvidence,
        evaluator: caseData.evaluator,
      },
    };
  });
  const assetWithoutDigest = {
    schema: "dsheval.mvp.evaluation-pack-asset/v1",
    packId: `evaluation-assets.${slug}.case-${caseIndex + 1}`,
    version: "1.0.0",
    dataset: {
      datasetId: input.datasetId,
      version: caseData.version,
      caseRefs: [scenarioId],
      environmentProfile: {
        environmentId: environmentAsset.environmentId,
        observerSourceRequirementId: workspaceSource.sourceRequirementId,
      },
      runtimeSourceRequirementId: runtimeSource.sourceRequirementId,
      evaluationProfile: {
        metricPoolId: `metric-pool.${slug}/v1`,
        judgeAssetId: `judge-assets.${slug}/v1`,
        labelBindings,
        gateRule: { precedence: ["HARD_FAIL", "REQUIRED_UNEVALUABLE", "PASS"], ruleVersion: "gate.required-hard/v1" },
      },
    },
    metricPool: { metricPoolId: `metric-pool.${slug}/v1`, version: "1.0.0", metrics },
    scenario: {
      scenarioId,
      version: caseData.version,
      applicability: { requiredDshPackageVersion: "0.1.1-rc.2", requiredProbeSchema: "dsh-eval.probe/v1", targetType: "FULL_AGENT" },
      agentTask: caseData.task,
      publicInputs: [],
      execution: { deadlineMs: caseData.deadlineMs, maxAttempts: 1, stableWindowMs: 250 },
      pathPolicy: { allowedChanges: [{ match: "PREFIX", portablePath: "output" }], forbiddenChanges: [{ match: "PREFIX", portablePath: "input" }], permittedReads: ["input"] },
      sourceRequirement: runtimeSource,
    },
    judges,
    environment: {
      environmentId: environmentAsset.environmentId,
      version: environmentAsset.version,
      ...workspace,
      seedSpec: { entries: caseData.seedEntries },
      sourceRequirement: workspaceSource,
      additionalSourceRequirements: additionalSources,
    },
  } as const;
  const normalized = JSON.parse(JSON.stringify(assetWithoutDigest)) as JsonObject;
  const asset: JsonObject = { ...normalized, contentDigest: { ...digestValue(normalized) } };
  return compileEvaluationAsset(asset, Object.freeze({
    ...input.request,
    requestedLabelIds: Object.freeze([...effectiveLabelIds]),
  }));
}
