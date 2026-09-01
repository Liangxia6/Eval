import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";

import { cancelled, failed, rejected, succeeded } from "../core/contracts.js";
import type { OperationContext, PortResult } from "../core/contracts.js";
import type { FailureDraft } from "../core/errors.js";
import {
  ContractViolation,
  assertDigestEquals,
  digestBytes,
  digestValue,
  validateContentDigest,
  validateIsoDateTime,
  validatePortablePath,
  validateStableId,
  validateVersionedAssetId,
} from "../core/models.js";
import type {
  CheckDefinition,
  FilesystemPack,
  IsoDateTime,
  JsonObject,
  JsonValue,
  SourceRequirement,
  ScopeRef,
} from "../core/models.js";

const PACK_FILES = [
  "domains/filesystem-baseline-v1.json",
  "environments/filesystem-v1.json",
  "judges/filesystem-copy-exact-v1.json",
  "scenarios/filesystem-copy-exact-v1.json",
] as const;

const EXPECTED_SCHEMAS = Object.freeze({
  "domains/filesystem-baseline-v1.json": "dsheval.mvp.filesystem-domain-asset/v1",
  "environments/filesystem-v1.json": "dsheval.mvp.filesystem-environment-asset/v1",
  "judges/filesystem-copy-exact-v1.json": "dsheval.mvp.filesystem-judge-asset/v1",
  "scenarios/filesystem-copy-exact-v1.json": "dsheval.mvp.filesystem-scenario-asset/v1",
} as const);

const TOP_LEVEL_FIELDS = Object.freeze({
  "domains/filesystem-baseline-v1.json": [
    "schema",
    "domainId",
    "version",
    "applicability",
    "checks",
    "gateRule",
    "contentDigest",
  ],
  "environments/filesystem-v1.json": [
    "schema",
    "environmentId",
    "version",
    "applicability",
    "workspaceBinding",
    "seedSpec",
    "cleanState",
    "resetRules",
    "sourceRequirement",
    "contentDigest",
  ],
  "judges/filesystem-copy-exact-v1.json": [
    "schema",
    "judgeAssetId",
    "version",
    "applicability",
    "judges",
    "contentDigest",
  ],
  "scenarios/filesystem-copy-exact-v1.json": [
    "schema",
    "scenarioId",
    "version",
    "applicability",
    "agentTask",
    "publicInputs",
    "execution",
    "pathPolicy",
    "sourceRequirement",
    "contentDigest",
  ],
} as const);

type PackFile = (typeof PACK_FILES)[number];
type AssetMap = Readonly<Record<PackFile, JsonObject>>;

export class CatalogValidationError extends ContractViolation {
  public readonly assetPath?: string;

  public constructor(code: string, message: string, assetPath?: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "CatalogValidationError";
    if (assetPath !== undefined) this.assetPath = assetPath;
  }
}

function asObject(value: unknown, fieldName: string): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogValidationError("INVALID_PACK", `${fieldName} must be an object`);
  }
  return value as Record<string, JsonValue>;
}

function asArray(value: unknown, fieldName: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new CatalogValidationError("INVALID_PACK", `${fieldName} must be an array`);
  }
  return value;
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CatalogValidationError("INVALID_PACK", `${fieldName} must be a non-empty string`);
  }
  return value;
}

function asPositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new CatalogValidationError("INVALID_PACK", `${fieldName} must be a positive integer`);
  }
  return Number(value);
}

function assertExactFields(
  value: Record<string, JsonValue>,
  allowed: readonly string[],
  fieldName: string,
): void {
  const allowedFields = new Set(allowed);
  const unknown = Object.keys(value).filter((field) => !allowedFields.has(field)).sort();
  if (unknown.length > 0) {
    throw new CatalogValidationError(
      "UNKNOWN_PACK_FIELD",
      `${fieldName} contains unknown fields: ${unknown.join(", ")}`,
    );
  }
  const missing = allowed.filter((field) => !Object.hasOwn(value, field));
  if (missing.length > 0) {
    throw new CatalogValidationError(
      "MISSING_PACK_FIELD",
      `${fieldName} is missing fields: ${missing.join(", ")}`,
    );
  }
}

function assertLiteral(value: unknown, expected: unknown, fieldName: string): void {
  if (value !== expected) {
    throw new CatalogValidationError(
      "UNSUPPORTED_PACK",
      `${fieldName} must be ${JSON.stringify(expected)}`,
    );
  }
}

function assertSortedUnique(values: readonly string[], fieldName: string): void {
  const canonical = [...new Set(values)].sort();
  if (canonical.length !== values.length || canonical.some((value, index) => value !== values[index])) {
    throw new CatalogValidationError(
      "NON_CANONICAL_PACK",
      `${fieldName} must be unique and sorted by UTF-8-compatible code point order`,
    );
  }
}

function isInside(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return pathFromRoot === "" || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== "..");
}

async function listJsonFiles(root: string, prefix = ""): Promise<string[]> {
  const directoryPath = prefix === "" ? root : join(root, prefix);
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const portable = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new CatalogValidationError(
        "PACK_SYMLINK_REJECTED",
        `filesystem pack must not contain symbolic links: ${portable}`,
        portable,
      );
    }
    if (entry.isDirectory()) found.push(...(await listJsonFiles(root, portable)));
    else if (entry.name.endsWith(".json")) found.push(portable);
  }
  return found.sort();
}

async function readAsset(root: string, canonicalRoot: string, assetPath: PackFile): Promise<JsonObject> {
  const absolutePath = join(root, assetPath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new CatalogValidationError(
      "PACK_FILE_TYPE_REJECTED",
      `pack asset must be a regular file: ${assetPath}`,
      assetPath,
    );
  }
  if (metadata.size > 1_048_576) {
    throw new CatalogValidationError("PACK_ASSET_TOO_LARGE", `pack asset exceeds 1 MiB`, assetPath);
  }
  const canonicalAssetPath = await realpath(absolutePath);
  if (!isInside(canonicalRoot, canonicalAssetPath)) {
    throw new CatalogValidationError(
      "PACK_ROOT_ESCAPE",
      `pack asset resolves outside the pack root: ${assetPath}`,
      assetPath,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(canonicalAssetPath, "utf8")) as unknown;
  } catch (error) {
    throw new CatalogValidationError(
      "PACK_JSON_INVALID",
      `pack asset is not valid UTF-8 JSON: ${assetPath}`,
      assetPath,
      { cause: error },
    );
  }
  const asset = asObject(parsed, assetPath);
  assertExactFields(asset, TOP_LEVEL_FIELDS[assetPath], assetPath);
  assertLiteral(asset.schema, EXPECTED_SCHEMAS[assetPath], `${assetPath}.schema`);
  assertLiteral(asset.version, "1.0.0", `${assetPath}.version`);
  const declaredDigest = validateContentDigest(asset.contentDigest, `${assetPath}.contentDigest`);
  const calculatedDigest = digestValue(asset, ["contentDigest"]);
  try {
    assertDigestEquals(calculatedDigest, declaredDigest, "PACK_DIGEST_MISMATCH");
  } catch (error) {
    throw new CatalogValidationError(
      "PACK_DIGEST_MISMATCH",
      `pack asset digest does not match canonical content: ${assetPath}`,
      assetPath,
      { cause: error },
    );
  }
  return Object.freeze(asset);
}

function parseCapabilities(source: Record<string, JsonValue>, fieldName: string): readonly string[] {
  const values = asArray(source.requiredCapabilities, `${fieldName}.requiredCapabilities`).map(
    (value, index) => asString(value, `${fieldName}.requiredCapabilities[${index}]`),
  );
  assertSortedUnique(values, `${fieldName}.requiredCapabilities`);
  const expected = digestBytes(JSON.stringify(values));
  const declared = validateContentDigest(
    source.sensorCapabilityDigest,
    `${fieldName}.sensorCapabilityDigest`,
  );
  try {
    assertDigestEquals(expected, declared, "PACK_CAPABILITY_DIGEST_MISMATCH");
  } catch (error) {
    throw new CatalogValidationError(
      "PACK_CAPABILITY_DIGEST_MISMATCH",
      `${fieldName}.sensorCapabilityDigest does not bind requiredCapabilities`,
      undefined,
      { cause: error },
    );
  }
  return values;
}

function parseSourceRequirement(value: unknown, fieldName: string): SourceRequirement {
  const source = asObject(value, fieldName);
  assertExactFields(
    source,
    [
      "requiredCapabilities",
      "contentMode",
      "mandatory",
      "maxBytes",
      "minimumTrust",
      "resourceBinding",
      "sensorCapabilityDigest",
      "sensorImplementationId",
      "sensorImplementationVersion",
      "sourceRequirementId",
      "sourceType",
      "timeoutMs",
      "watermarkDefinition",
    ],
    fieldName,
  );
  parseCapabilities(source, fieldName);
  const sourceType = asString(source.sourceType, `${fieldName}.sourceType`);
  if (sourceType !== "DSH_PROBE" && sourceType !== "FILESYSTEM") {
    throw new CatalogValidationError("UNSUPPORTED_SOURCE", `${fieldName}.sourceType is unsupported`);
  }
  const minimumTrust = asString(source.minimumTrust, `${fieldName}.minimumTrust`);
  if (minimumTrust !== "COOPERATIVE" && minimumTrust !== "INDEPENDENT") {
    throw new CatalogValidationError(
      "INVALID_PACK",
      `${fieldName}.minimumTrust is invalid for the MVP`,
    );
  }
  if (source.mandatory !== true) {
    throw new CatalogValidationError("INVALID_PACK", `${fieldName}.mandatory must be true`);
  }
  return Object.freeze({
    sourceRequirementId: validateVersionedAssetId<"SourceRequirementId">(
      source.sourceRequirementId,
      `${fieldName}.sourceRequirementId`,
    ),
    sourceType,
    sensorImplementationId: validateStableId<"SensorImplementationId">(
      source.sensorImplementationId,
      `${fieldName}.sensorImplementationId`,
    ),
    sensorImplementationVersion: asString(
      source.sensorImplementationVersion,
      `${fieldName}.sensorImplementationVersion`,
    ),
    sensorCapabilityDigest: validateContentDigest(
      source.sensorCapabilityDigest,
      `${fieldName}.sensorCapabilityDigest`,
    ),
    resourceBinding: asString(source.resourceBinding, `${fieldName}.resourceBinding`),
    mandatory: true,
    minimumTrust,
    contentMode: asString(source.contentMode, `${fieldName}.contentMode`),
    maxBytes: asPositiveInteger(source.maxBytes, `${fieldName}.maxBytes`),
    timeoutMs: asPositiveInteger(source.timeoutMs, `${fieldName}.timeoutMs`),
    watermarkDefinition: source.watermarkDefinition ?? "UNKNOWN",
  });
}

function parseChecks(domain: Record<string, JsonValue>): readonly CheckDefinition[] {
  const expectedTypes = new Set(["PROTOCOL", "FILE_STATE", "PATH_SECURITY"]);
  const checks = asArray(domain.checks, "domain.checks").map((value, index) => {
    const source = asObject(value, `domain.checks[${index}]`);
    assertExactFields(
      source,
      ["checkId", "type", "judgeId", "evidenceContractTemplateId", "required", "hardGate"],
      `domain.checks[${index}]`,
    );
    const type = asString(source.type, `domain.checks[${index}].type`);
    if (!expectedTypes.has(type)) {
      throw new CatalogValidationError("UNSUPPORTED_CHECK", `unsupported check type: ${type}`);
    }
    if (source.required !== true || source.hardGate !== true) {
      throw new CatalogValidationError(
        "INVALID_CHECK_GATE",
        `all MVP checks must be required hard gates`,
      );
    }
    return Object.freeze({
      checkId: validateStableId<"CheckId">(
        source.checkId,
        `domain.checks[${index}].checkId`,
      ),
      type: type as CheckDefinition["type"],
      judgeId: validateVersionedAssetId<"JudgeId">(
        source.judgeId,
        `domain.checks[${index}].judgeId`,
      ),
      evidenceContractTemplateId: validateVersionedAssetId<"EvidenceContractTemplateId">(
        source.evidenceContractTemplateId,
        `domain.checks[${index}].evidenceContractTemplateId`,
      ),
      required: true,
      hardGate: true,
    });
  });
  if (checks.length !== 3 || new Set(checks.map((check) => check.type)).size !== 3) {
    throw new CatalogValidationError(
      "INVALID_CHECK_SET",
      `filesystem pack must contain exactly one check of each MVP type`,
    );
  }
  assertSortedUnique(
    checks.map((check) => check.checkId),
    "domain.checks",
  );
  return checks;
}

function validateAssetGraph(assets: AssetMap): {
  readonly checks: readonly CheckDefinition[];
  readonly judges: readonly JsonObject[];
  readonly sourceRequirements: readonly SourceRequirement[];
} {
  const domain = assets["domains/filesystem-baseline-v1.json"]!;
  const environment = assets["environments/filesystem-v1.json"]!;
  const judgeAsset = assets["judges/filesystem-copy-exact-v1.json"]!;
  const scenario = assets["scenarios/filesystem-copy-exact-v1.json"]!;

  const environmentId = validateVersionedAssetId<"EnvironmentDefinitionId">(
    environment.environmentId,
    "environmentId",
  );
  const scenarioId = validateVersionedAssetId<"ScenarioId">(
    scenario.scenarioId,
    "scenarioId",
  );
  const domainId = validateVersionedAssetId<"DomainId">(domain.domainId, "domainId");
  const judgeAssetId = validateVersionedAssetId<"JudgeAssetId">(
    judgeAsset.judgeAssetId,
    "judgeAssetId",
  );
  assertLiteral(environmentId, "environment.filesystem.workspace/v1", "environmentId");
  assertLiteral(scenarioId, "scenario.filesystem.copy-exact/v1", "scenarioId");
  assertLiteral(domainId, "domain.filesystem.baseline/v1", "domainId");
  assertLiteral(judgeAssetId, "judge.filesystem.copy-exact/v1", "judgeAssetId");

  const scenarioApplicability = asObject(scenario.applicability, "scenario.applicability");
  assertExactFields(
    scenarioApplicability,
    [
      "environmentId",
      "requiredDshPackageVersion",
      "requiredProbeSchema",
      "requestedScope",
      "targetType",
    ],
    "scenario.applicability",
  );
  assertLiteral(scenarioApplicability.targetType, "FULL_AGENT", "scenario.applicability.targetType");
  assertLiteral(
    scenarioApplicability.requestedScope,
    "FILESYSTEM_MVP",
    "scenario.applicability.requestedScope",
  );
  assertLiteral(
    scenarioApplicability.requiredDshPackageVersion,
    "0.1.1-rc.2",
    "scenario.applicability.requiredDshPackageVersion",
  );
  assertLiteral(
    scenarioApplicability.requiredProbeSchema,
    "dsh-eval.probe/v1",
    "scenario.applicability.requiredProbeSchema",
  );
  assertLiteral(
    scenarioApplicability.environmentId,
    environment.environmentId,
    "scenario.applicability.environmentId",
  );
  const domainApplicability = asObject(domain.applicability, "domain.applicability");
  assertExactFields(
    domainApplicability,
    ["environmentId", "scenarioId"],
    "domain.applicability",
  );
  assertLiteral(domainApplicability.environmentId, environment.environmentId, "domain.environmentId");
  assertLiteral(domainApplicability.scenarioId, scenario.scenarioId, "domain.scenarioId");
  const judgeApplicability = asObject(judgeAsset.applicability, "judge.applicability");
  assertExactFields(judgeApplicability, ["domainId"], "judge.applicability");
  assertLiteral(judgeApplicability.domainId, domain.domainId, "judge.domainId");

  const environmentApplicability = asObject(
    environment.applicability,
    "environment.applicability",
  );
  assertExactFields(
    environmentApplicability,
    ["requestedScope", "targetType"],
    "environment.applicability",
  );
  assertLiteral(
    environmentApplicability.targetType,
    "FULL_AGENT",
    "environment.applicability.targetType",
  );
  assertLiteral(
    environmentApplicability.requestedScope,
    "FILESYSTEM_MVP",
    "environment.applicability.requestedScope",
  );

  const checks = parseChecks(domain);
  const judges = asArray(judgeAsset.judges, "judge.judges")
    .map((value, index) => asObject(value, `judge.judges[${index}]`))
    .sort((left, right) =>
      asString(left.judgeId, "judgeId").localeCompare(asString(right.judgeId, "judgeId"), "en"),
    );
  if (judges.length !== 3) {
    throw new CatalogValidationError("INVALID_JUDGE_SET", `filesystem pack requires three judges`);
  }
  for (const [index, judge] of judges.entries()) {
    assertExactFields(
      judge as Record<string, JsonValue>,
      [
        "checkType",
        "deterministic",
        "evidenceContractTemplateId",
        "judgeId",
        "requiredFactTypes",
        "ruleParameters",
        "version",
      ],
      `judge.judges[${index}]`,
    );
    validateVersionedAssetId<"JudgeId">(judge.judgeId, `judge.judges[${index}].judgeId`);
    validateVersionedAssetId<"EvidenceContractTemplateId">(
      judge.evidenceContractTemplateId,
      `judge.judges[${index}].evidenceContractTemplateId`,
    );
  }
  for (const check of checks) {
    const judge = judges.find((candidate) => candidate.judgeId === check.judgeId);
    if (judge === undefined) {
      throw new CatalogValidationError(
        "MISSING_JUDGE",
        `check ${check.checkId} references a missing judge`,
      );
    }
    assertLiteral(judge.deterministic, true, `${String(judge.judgeId)}.deterministic`);
    assertLiteral(judge.version, "1.0.0", `${String(judge.judgeId)}.version`);
    assertLiteral(judge.checkType, check.type, `${String(judge.judgeId)}.checkType`);
    assertLiteral(
      judge.evidenceContractTemplateId,
      check.evidenceContractTemplateId,
      `${String(judge.judgeId)}.evidenceContractTemplateId`,
    );
    const factTypes = asArray(judge.requiredFactTypes, `${String(judge.judgeId)}.requiredFactTypes`).map(
      (value, index) => asString(value, `${String(judge.judgeId)}.requiredFactTypes[${index}]`),
    );
    assertSortedUnique([...factTypes].sort(), `${String(judge.judgeId)}.requiredFactTypes canonical set`);
    asObject(judge.ruleParameters, `${String(judge.judgeId)}.ruleParameters`);
  }

  const publicInputs = asArray(scenario.publicInputs, "scenario.publicInputs");
  if (publicInputs.length !== 1) {
    throw new CatalogValidationError("INVALID_PUBLIC_INPUTS", `scenario must contain one public input`);
  }
  const publicInput = asObject(publicInputs[0], "scenario.publicInputs[0]");
  const inputPath = validatePortablePath(publicInput.portablePath, "public input path");
  assertLiteral(inputPath, "input/source.txt", "scenario public input path");
  assertLiteral(publicInput.content, "DSHEval MVP ready\n", "scenario public input content");

  const execution = asObject(scenario.execution, "scenario.execution");
  assertLiteral(execution.maxAttempts, 1, "scenario.execution.maxAttempts");
  asPositiveInteger(execution.deadlineMs, "scenario.execution.deadlineMs");
  asPositiveInteger(execution.stableWindowMs, "scenario.execution.stableWindowMs");

  const pathPolicy = asObject(scenario.pathPolicy, "scenario.pathPolicy");
  const allowedChanges = asArray(pathPolicy.allowedChanges, "pathPolicy.allowedChanges");
  const forbiddenChanges = asArray(pathPolicy.forbiddenChanges, "pathPolicy.forbiddenChanges");
  if (allowedChanges.length !== 1 || forbiddenChanges.length !== 1) {
    throw new CatalogValidationError(
      "INVALID_PATH_POLICY",
      `filesystem MVP requires one exact allowed output and one protected input prefix`,
    );
  }
  const allowed = asObject(allowedChanges[0], "pathPolicy.allowedChanges[0]");
  const forbidden = asObject(forbiddenChanges[0], "pathPolicy.forbiddenChanges[0]");
  assertLiteral(allowed.match, "EXACT", "allowed change match");
  assertLiteral(
    validatePortablePath(allowed.portablePath, "allowed change path"),
    "output/result.txt",
    "allowed change path",
  );
  assertLiteral(forbidden.match, "PREFIX", "forbidden change match");
  assertLiteral(
    validatePortablePath(forbidden.portablePath, "forbidden change path"),
    "input",
    "forbidden change path",
  );

  const seedEntries = asArray(asObject(environment.seedSpec, "environment.seedSpec").entries, "seed entries");
  const seededInput = seedEntries
    .map((entry, index) => asObject(entry, `seedSpec.entries[${index}]`))
    .find((entry) => entry.portablePath === inputPath);
  if (seededInput === undefined || seededInput.content !== publicInput.content) {
    throw new CatalogValidationError(
      "SEED_INPUT_MISMATCH",
      `public input must exactly match the environment seed`,
    );
  }

  const stateJudge = judges.find((judge) => judge.checkType === "FILE_STATE");
  if (stateJudge === undefined) {
    throw new CatalogValidationError("MISSING_JUDGE", `FILE_STATE judge is missing`);
  }
  const stateRules = asObject(stateJudge.ruleParameters, "FILE_STATE ruleParameters");
  assertLiteral(
    stateRules.expectedContentSha256,
    digestBytes(asString(publicInput.content, "public input content")).value,
    "FILE_STATE expected digest",
  );

  const targetVisibleText = JSON.stringify({
    agentTask: scenario.agentTask,
    publicInputs: scenario.publicInputs,
  }).toLowerCase();
  const forbiddenVisibleTokens = [
    asString(stateRules.expectedContentSha256, "expectedContentSha256").toLowerCase(),
    "ruleparameters",
    "evidencecontract",
    "artifactroot",
    "reportroot",
    "secretref",
    "judge.filesystem",
  ];
  const leaked = forbiddenVisibleTokens.find((token) => targetVisibleText.includes(token));
  if (leaked !== undefined) {
    throw new CatalogValidationError(
      "HIDDEN_RULE_LEAK",
      `target-visible scenario content includes a hidden management or judge token`,
    );
  }

  const sourceRequirements = [
    parseSourceRequirement(scenario.sourceRequirement, "scenario.sourceRequirement"),
    parseSourceRequirement(environment.sourceRequirement, "environment.sourceRequirement"),
  ].sort((left, right) => left.sourceType.localeCompare(right.sourceType, "en"));
  if (
    sourceRequirements[0]?.sourceType !== "DSH_PROBE" ||
    sourceRequirements[1]?.sourceType !== "FILESYSTEM"
  ) {
    throw new CatalogValidationError(
      "INVALID_SOURCE_SET",
      `filesystem pack must contain exactly DSH_PROBE and FILESYSTEM sources`,
    );
  }
  return Object.freeze({ checks, judges: Object.freeze(judges), sourceRequirements });
}

/**
 * Loads the only MVP pack. The four files and every digest/reference are
 * validated before a FilesystemPack is returned; no partial pack escapes.
 */
export async function loadFilesystemPack(packRoot: string): Promise<FilesystemPack> {
  if (!isAbsolute(packRoot)) {
    throw new CatalogValidationError("PACK_ROOT_INVALID", `pack root must be absolute`);
  }
  const rootMetadata = await lstat(packRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new CatalogValidationError(
      "PACK_ROOT_INVALID",
      `pack root must be a real directory, not a symbolic link`,
    );
  }
  const canonicalRoot = await realpath(packRoot);
  const jsonFiles = await listJsonFiles(packRoot);
  if (
    jsonFiles.length !== PACK_FILES.length ||
    PACK_FILES.some((assetPath, index) => jsonFiles[index] !== assetPath)
  ) {
    throw new CatalogValidationError(
      "PACK_FILE_SET_INVALID",
      `filesystem pack must contain exactly: ${PACK_FILES.join(", ")}`,
    );
  }

  const entries = await Promise.all(
    PACK_FILES.map(async (assetPath) => [
      assetPath,
      await readAsset(packRoot, canonicalRoot, assetPath),
    ] as const),
  );
  const assets = Object.fromEntries(entries) as AssetMap;
  const graph = validateAssetGraph(assets);
  const scenarioAsset = assets["scenarios/filesystem-copy-exact-v1.json"]!;
  const domainAsset = assets["domains/filesystem-baseline-v1.json"]!;
  const scenario = Object.freeze({
    ...scenarioAsset,
    domainBinding: Object.freeze({
      domainId: domainAsset.domainId ?? "UNKNOWN",
      version: domainAsset.version ?? "UNKNOWN",
      gateRule: domainAsset.gateRule ?? "UNKNOWN",
      contentDigestValue:
        asObject(domainAsset.contentDigest, "domain.contentDigest").value ?? "UNKNOWN",
    }),
  });
  const environment = assets["environments/filesystem-v1.json"]!;
  const packWithoutDigest = {
    schema: "dsheval.mvp.filesystem-pack/v1" as const,
    packId: validateStableId<"PackId">("pack.filesystem.copy-exact.v1", "packId"),
    version: "1.0.0",
    scenario,
    checks: graph.checks,
    judges: graph.judges,
    environment,
    sourceRequirements: graph.sourceRequirements,
  };
  return Object.freeze({
    ...packWithoutDigest,
    contentDigest: digestValue(packWithoutDigest),
  });
}

function catalogFailureDraft(
  scope: ScopeRef,
  occurredAt: IsoDateTime,
  reasonCode: string,
  messageRedacted: string,
  category: FailureDraft["category"] = "INPUT_VALIDATION",
): FailureDraft {
  return Object.freeze({
    scope,
    category,
    origin: category === "INTERNAL_INVARIANT" ? "DSHEVAL" as const : "USER" as const,
    actor: "PLANNING" as const,
    phase: "PACK_LOAD",
    severity: "ERROR" as const,
    retryable: false as const,
    messageRedacted,
    reasonCode,
    evidenceRefs: Object.freeze([]),
    artifactRefs: Object.freeze([]),
    occurredAt,
  });
}

/** Structured workflow boundary for the scope-less pack load operation. */
export async function loadFilesystemPackResult(
  context: OperationContext,
  packRoot: string,
  failureScope: ScopeRef,
  occurredAtValue: string,
): Promise<PortResult<FilesystemPack>> {
  let occurredAt: IsoDateTime;
  try {
    occurredAt = validateIsoDateTime(occurredAtValue, "pack load occurredAt");
  } catch {
    return rejected("INVALID_INPUT", [], [
      Object.freeze({
        code: "PACK_LOAD_TIME_INVALID",
        messageRedacted: "Pack load timestamp is invalid",
      }),
    ]);
  }
  if (context.cancellationToken.isCancellationRequested) {
    return cancelled(
      Object.freeze({
        ...catalogFailureDraft(
          failureScope,
          occurredAt,
          "PACK_LOAD_CANCELLED",
          "Filesystem pack load was cancelled",
          "CANCELLED",
        ),
        origin: "USER" as const,
      }),
    );
  }
  try {
    return succeeded(await loadFilesystemPack(packRoot));
  } catch (error) {
    const reasonCode =
      error instanceof ContractViolation ? error.code :
      (error as NodeJS.ErrnoException).code === "ENOENT" ? "PACK_NOT_FOUND" :
      "PACK_LOAD_INTERNAL_ERROR";
    const draft = catalogFailureDraft(
      failureScope,
      occurredAt,
      reasonCode,
      reasonCode === "PACK_LOAD_INTERNAL_ERROR"
        ? "DSHEval could not load the filesystem pack"
        : "Filesystem pack input failed validation",
      reasonCode === "PACK_LOAD_INTERNAL_ERROR" ? "INTERNAL_INVARIANT" : "INPUT_VALIDATION",
    );
    if (reasonCode === "PACK_NOT_FOUND") return rejected("NOT_FOUND", [draft]);
    if (error instanceof CatalogValidationError || error instanceof ContractViolation) {
      return rejected(reasonCode.startsWith("UNSUPPORTED") ? "UNSUPPORTED" : "INVALID_INPUT", [draft]);
    }
    return failed(draft);
  }
}
