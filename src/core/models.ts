import { createHash } from "node:crypto";

import type { FailureDraft, FailureRecord } from "./errors.js";

/** Values accepted by DSHEval's canonical JSON boundary. */
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

declare const stableIdBrand: unique symbol;
export type StableId<Tag extends string = string> = string & {
  readonly [stableIdBrand]: Tag;
};
declare const versionedAssetIdBrand: unique symbol;
/** Catalog identity: a strict StableId base plus an explicit positive major. */
export type VersionedAssetId<Tag extends string = string> = string & {
  readonly [versionedAssetIdBrand]: Tag;
};
export type AssetIdentifier = StableId | VersionedAssetId;
export type IsoDateTime = string;
export type PortablePath = string;

export type TargetId = StableId<"TargetId">;
export type TargetSnapshotId = StableId<"TargetSnapshotId">;
export type RunId = StableId<"RunId">;
export type CaseId = StableId<"CaseId">;
export type AttemptId = StableId<"AttemptId">;
export type SessionId = StableId<"SessionId">;
export type SourceRunId = StableId<"SourceRunId">;
export type ArtifactId = StableId<"ArtifactId">;

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const VERSIONED_ASSET_ID_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127})\/v([1-9][0-9]*)$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const SCHEMA_PATTERN = /^dsheval\.mvp\.[a-z0-9][a-z0-9-]*\/v1$/u;

export class ContractViolation extends Error {
  public readonly code: string;

  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContractViolation";
    this.code = code;
  }
}

export function validateStableId<Tag extends string = string>(
  value: unknown,
  fieldName = "id",
): StableId<Tag> {
  if (typeof value !== "string" || !STABLE_ID_PATTERN.test(value)) {
    throw new ContractViolation(
      "INVALID_STABLE_ID",
      `${fieldName} must contain 1-128 ASCII letters, digits, '.', '_' or '-' and start with a letter or digit`,
    );
  }
  return value as StableId<Tag>;
}

/** Versioned asset IDs are not valid Ref IDs or filesystem routing IDs. */
export function validateVersionedAssetId<Tag extends string = string>(
  value: unknown,
  fieldName = "assetId",
): VersionedAssetId<Tag> {
  if (typeof value !== "string" || !VERSIONED_ASSET_ID_PATTERN.test(value)) {
    throw new ContractViolation(
      "INVALID_VERSIONED_ASSET_ID",
      `${fieldName} must be a strict StableId base followed by '/v' and a positive decimal major version`,
    );
  }
  return value as VersionedAssetId<Tag>;
}

export function validateSchemaId(value: unknown, fieldName = "schema"): string {
  if (typeof value !== "string" || !SCHEMA_PATTERN.test(value)) {
    throw new ContractViolation(
      "INVALID_SCHEMA",
      `${fieldName} must be a dsheval.mvp.<name>/v1 schema`,
    );
  }
  return value;
}

export function validateIsoDateTime(value: unknown, fieldName = "time"): IsoDateTime {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ContractViolation("INVALID_TIME", `${fieldName} must be an ISO-8601 timestamp`);
  }
  return value;
}

export function validatePortablePath(
  value: unknown,
  fieldName = "portablePath",
  options: { readonly allowDot?: boolean } = {},
): PortablePath {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new ContractViolation("INVALID_PORTABLE_PATH", `${fieldName} must be a non-empty path`);
  }
  if (value === "." && options.allowDot === true) {
    return value;
  }
  if (
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.includes("\\") ||
    /[*?\[\]{}]/u.test(value) ||
    /\$\{|%[^%]+%/u.test(value)
  ) {
    throw new ContractViolation(
      "INVALID_PORTABLE_PATH",
      `${fieldName} must be a literal, relative POSIX path without glob or variable syntax`,
    );
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new ContractViolation(
      "INVALID_PORTABLE_PATH",
      `${fieldName} must not contain empty, '.' or '..' segments`,
    );
  }
  return value;
}

function assertValidUnicode(value: string, location: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new ContractViolation("INVALID_JSON", `${location} contains an unpaired surrogate`);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ContractViolation("INVALID_JSON", `${location} contains an unpaired surrogate`);
    }
  }
}

function canonicalizeValue(value: unknown, ancestors: Set<object>, location: string): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertValidUnicode(value, location);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ContractViolation("INVALID_JSON", `${location} contains a non-finite number`);
    }
    return JSON.stringify(value);
  }
  if (
    value === undefined ||
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    throw new ContractViolation("INVALID_JSON", `${location} is not a JSON value`);
  }
  if (typeof value !== "object") {
    throw new ContractViolation("INVALID_JSON", `${location} is not a JSON value`);
  }
  if (ancestors.has(value)) {
    throw new ContractViolation("INVALID_JSON", `${location} contains a cycle`);
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new ContractViolation("INVALID_JSON", `${location}[${index}] is an array hole`);
        }
        items.push(canonicalizeValue(value[index], ancestors, `${location}[${index}]`));
      }
      return `[${items.join(",")}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new ContractViolation("INVALID_JSON", `${location} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new ContractViolation("INVALID_JSON", `${location} contains symbol keys`);
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const fields = keys.map((key) => {
      assertValidUnicode(key, `${location} key`);
      return `${JSON.stringify(key)}:${canonicalizeValue(record[key], ancestors, `${location}.${key}`)}`;
    });
    return `{${fields.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

/** RFC 8785/JCS-compatible serialization for the JSON subset accepted by DSHEval. */
export function canonicalize(value: unknown): string {
  return canonicalizeValue(value, new Set<object>(), "$");
}

export function canonicalJson(value: unknown): string {
  return canonicalize(value);
}

export function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export interface ContentDigest {
  readonly algorithm: "sha256";
  readonly value: string;
  readonly byteLength: number;
}

export function validateContentDigest(value: unknown, fieldName = "digest"): ContentDigest {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractViolation("INVALID_DIGEST", `${fieldName} must be an object`);
  }
  const digest = value as Partial<ContentDigest>;
  if (
    digest.algorithm !== "sha256" ||
    typeof digest.value !== "string" ||
    !DIGEST_PATTERN.test(digest.value) ||
    !Number.isSafeInteger(digest.byteLength) ||
    (digest.byteLength ?? -1) < 0
  ) {
    throw new ContractViolation("INVALID_DIGEST", `${fieldName} is not a valid SHA-256 digest`);
  }
  return digest as ContentDigest;
}

export function digestBytes(bytes: Uint8Array | string): ContentDigest {
  const buffer = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
  return Object.freeze({
    algorithm: "sha256" as const,
    value: createHash("sha256").update(buffer).digest("hex"),
    byteLength: buffer.byteLength,
  });
}

export function digestValue(
  value: unknown,
  excludedTopLevelFields: readonly string[] = [],
): ContentDigest {
  let digestInput = value;
  if (
    excludedTopLevelFields.length > 0 &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const source = value as Record<string, unknown>;
    digestInput = Object.fromEntries(
      Object.entries(source).filter(([key]) => !excludedTopLevelFields.includes(key)),
    );
  }
  return digestBytes(canonicalize(digestInput));
}

export function withContentDigest<T extends object>(
  value: T,
): Readonly<T & { readonly contentDigest: ContentDigest }> {
  if (Object.prototype.hasOwnProperty.call(value, "contentDigest")) {
    throw new ContractViolation(
      "DIGEST_FIELD_PRESENT",
      "withContentDigest expects a record without contentDigest",
    );
  }
  return Object.freeze({ ...value, contentDigest: digestValue(value) });
}

export function digestEquals(left: ContentDigest, right: ContentDigest): boolean {
  return (
    left.algorithm === right.algorithm &&
    left.value === right.value &&
    left.byteLength === right.byteLength
  );
}

export function assertDigestEquals(
  actual: ContentDigest,
  expected: ContentDigest,
  code = "EVIDENCE_INTEGRITY",
): void {
  validateContentDigest(actual, "actual digest");
  validateContentDigest(expected, "expected digest");
  if (!digestEquals(actual, expected)) {
    throw new ContractViolation(code, "content digest does not match the committed digest");
  }
}

export interface ScopeRef {
  readonly targetId: TargetId;
  readonly targetSnapshotId?: TargetSnapshotId;
  readonly runId?: RunId;
  readonly caseId?: CaseId;
  readonly attemptId?: AttemptId;
  readonly sessionId?: SessionId;
}

const SCOPE_FIELDS = new Set([
  "targetId",
  "targetSnapshotId",
  "runId",
  "caseId",
  "attemptId",
  "sessionId",
]);

export function validateScope(value: unknown, fieldName = "scope"): Readonly<ScopeRef> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractViolation("INVALID_SCOPE", `${fieldName} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const unknownFields = Object.keys(raw).filter((key) => !SCOPE_FIELDS.has(key));
  if (unknownFields.length > 0) {
    throw new ContractViolation(
      "INVALID_SCOPE",
      `${fieldName} contains unknown fields: ${unknownFields.sort().join(", ")}`,
    );
  }
  const targetId = validateStableId<"TargetId">(raw.targetId, `${fieldName}.targetId`);
  const result: ScopeRef = { targetId };
  const order = ["targetSnapshotId", "runId", "caseId", "attemptId"] as const;
  let parentPresent = true;
  for (const key of order) {
    const current = raw[key];
    if (current === undefined) {
      parentPresent = false;
      continue;
    }
    if (!parentPresent) {
      throw new ContractViolation(
        "INVALID_SCOPE",
        `${fieldName}.${key} cannot exist without every parent scope field`,
      );
    }
    Object.assign(result, { [key]: validateStableId(current, `${fieldName}.${key}`) });
  }
  if (raw.sessionId !== undefined) {
    if (result.attemptId === undefined) {
      throw new ContractViolation(
        "INVALID_SCOPE",
        `${fieldName}.sessionId requires an attemptId and every parent field`,
      );
    }
    Object.assign(result, {
      sessionId: validateStableId<"SessionId">(raw.sessionId, `${fieldName}.sessionId`),
    });
  }
  return Object.freeze(result);
}

export function assertSameScope(left: ScopeRef, right: ScopeRef): void {
  const a = validateScope(left, "left scope");
  const b = validateScope(right, "right scope");
  for (const key of SCOPE_FIELDS) {
    if (a[key as keyof ScopeRef] !== b[key as keyof ScopeRef]) {
      throw new ContractViolation("SCOPE_MISMATCH", `scope field ${key} does not match`);
    }
  }
}

export function assertSameAttemptScope(...scopes: readonly ScopeRef[]): void {
  if (scopes.length < 2) return;
  const validated = scopes.map((scope, index) => validateScope(scope, `scope[${index}]`));
  for (const [index, scope] of validated.entries()) {
    if (scope.attemptId === undefined) {
      throw new ContractViolation(
        "INVALID_SCOPE",
        `scope[${index}] must include target, snapshot, run, case and attempt`,
      );
    }
  }
  const expected = validated[0];
  if (expected === undefined) return;
  const attemptFields = ["targetId", "targetSnapshotId", "runId", "caseId", "attemptId"] as const;
  for (const scope of validated.slice(1)) {
    for (const field of attemptFields) {
      if (scope[field] !== expected[field]) {
        throw new ContractViolation("SCOPE_MISMATCH", `attempt scope field ${field} does not match`);
      }
    }
  }
}

export interface Ref<T = unknown> {
  readonly schema: string;
  readonly id: StableId;
  readonly digest: ContentDigest;
  readonly revision?: number;
  // T is deliberately phantom: Ref JSON has only the four fields above.
  readonly __referent?: T;
}

export function validateRef<T>(
  value: unknown,
  options: { readonly lifecycle?: boolean; readonly fieldName?: string } = {},
): Readonly<Ref<T>> {
  const fieldName = options.fieldName ?? "ref";
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ContractViolation("INVALID_REF", `${fieldName} must be an object`);
  }
  const raw = value as Record<string, unknown>;
  const allowed = new Set(["schema", "id", "digest", "revision"]);
  const unknownFields = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknownFields.length > 0) {
    throw new ContractViolation(
      "INVALID_REF",
      `${fieldName} contains unknown fields: ${unknownFields.sort().join(", ")}`,
    );
  }
  const schema = validateSchemaId(raw.schema, `${fieldName}.schema`);
  const id = validateStableId(raw.id, `${fieldName}.id`);
  const digest = validateContentDigest(raw.digest, `${fieldName}.digest`);
  if (raw.revision !== undefined && (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)) {
    throw new ContractViolation("INVALID_REF", `${fieldName}.revision must be a non-negative integer`);
  }
  if (options.lifecycle === true && raw.revision === undefined) {
    throw new ContractViolation("INVALID_REF", `${fieldName}.revision is required for lifecycle data`);
  }
  if (options.lifecycle !== true && raw.revision !== undefined) {
    throw new ContractViolation("INVALID_REF", `${fieldName}.revision is only valid for lifecycle data`);
  }
  const ref: Ref<T> =
    raw.revision === undefined
      ? { schema, id, digest }
      : { schema, id, digest, revision: raw.revision as number };
  return Object.freeze(ref);
}

export interface SourceTime {
  readonly wallTime?: IsoDateTime | undefined;
  readonly monotonicNs?: number | undefined;
  readonly sourceSeq?: number | undefined;
  readonly observedAt: IsoDateTime;
  readonly clockDomain: string;
}

export type CheckOutcome = "PASS" | "FAIL" | "UNEVALUABLE";
export type GateVerdict = CheckOutcome;
export type OperationalHealth = "HEALTHY" | "DEGRADED" | "FAILED";
export type EvidenceCompleteness = "COMPLETE" | "PARTIAL";
export type EvidenceValidity = "VALID" | "INVALID";
export type SourceTrust = "INDEPENDENT" | "COOPERATIVE" | "UNVERIFIED";

export interface ImmutableRecordBase {
  readonly schema: string;
  readonly scope: ScopeRef;
  readonly createdAt: IsoDateTime;
  readonly producerVersion: string;
  readonly contentDigest: ContentDigest;
}

export interface ArtifactRef extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.artifact/v1";
  readonly artifactId: ArtifactId;
  readonly artifactType: string;
  readonly logicalName: string;
  readonly mediaType: string;
  readonly portablePath: PortablePath;
  readonly byteLength: number;
  readonly artifactContentDigest: ContentDigest;
  readonly sensitivity: "EXPORTABLE" | "RESTRICTED";
  readonly redactionState: "NOT_REQUIRED" | "APPLIED" | "FAILED";
  readonly state: "COMMITTED";
}

export type ArtifactReadPurpose =
  | "TASK_INPUT"
  | "INSPECTION"
  | "EVIDENCE_CAPTURE"
  | "JUDGE_INPUT"
  | "REPORT_INPUT";

export interface DriverFingerprint {
  readonly driverCapabilityId: StableId;
  readonly dshEntrypointDigest: ContentDigest;
  readonly dshPackageVersion?: string;
  readonly headlessBundleVersion: string;
  readonly headlessBundleDigest: ContentDigest;
  readonly cliGrammarId: StableId;
  readonly cancelSupported: boolean;
  readonly stdoutSemantics: string;
  readonly stderrSemantics: string;
  readonly exitSemantics: string;
  readonly workspaceSemantics: string;
  readonly profileMutationSemantics: string;
}

export interface TargetDescriptor {
  readonly schema: "dsheval.mvp.target-descriptor/v1";
  readonly targetId: TargetId;
  readonly targetType: "FULL_AGENT";
  readonly sourceRoot: string;
  readonly dshExecutable: string;
  readonly dshHome: string;
  readonly profile: string;
  readonly targetIdentity: string;
  readonly requestedScope: "FILESYSTEM_MVP";
  readonly contentDigest: ContentDigest;
}

export interface TargetSnapshot extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.target-snapshot/v1";
  readonly targetSnapshotId: TargetSnapshotId;
  readonly targetId: TargetId;
  readonly sourceManifestRef: Ref<ArtifactRef>;
  readonly dshExecutablePath: string;
  readonly dshPackageVersion?: string;
  readonly dshEntrypointDigest: ContentDigest;
  readonly dshHomeManifestRef: Ref<ArtifactRef>;
  readonly profile: string;
  readonly profileManifestRef: Ref<ArtifactRef>;
  readonly lockfileRef: Ref<ArtifactRef>;
  readonly effectiveConfigRef: Ref<ArtifactRef>;
  readonly driverFingerprint: DriverFingerprint;
  readonly platform: JsonObject;
  readonly secretRefNames: readonly string[];
}

export interface InspectionSnapshot extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.inspection/v1";
  readonly inspectionId: StableId<"InspectionId">;
  readonly targetSnapshotRef: Ref<TargetSnapshot>;
  readonly dshVersionStatus: JsonValue;
  readonly profile: JsonValue;
  readonly probeConfigured: boolean | "UNKNOWN";
  readonly probeSchema: string;
  readonly probeOrderStatus: string;
  readonly headlessDriverStatus: string;
  readonly toolSchemas: readonly JsonValue[];
  readonly permissionPreset: string;
  readonly sandboxMode: string;
  readonly limitations: readonly JsonValue[];
  readonly sourceArtifactRefs: readonly Ref<ArtifactRef>[];
}

export interface CheckDefinition {
  readonly checkId: StableId<"CheckId">;
  readonly type: "PROTOCOL" | "FILE_STATE" | "PATH_SECURITY";
  readonly judgeId: VersionedAssetId<"JudgeId">;
  readonly evidenceContractTemplateId: VersionedAssetId<"EvidenceContractTemplateId">;
  readonly required: boolean;
  readonly hardGate: boolean;
}

export interface SourceRequirement {
  readonly sourceRequirementId: VersionedAssetId<"SourceRequirementId">;
  readonly sourceType: "DSH_PROBE" | "FILESYSTEM";
  readonly sensorImplementationId: StableId<"SensorImplementationId">;
  readonly sensorImplementationVersion: string;
  readonly sensorCapabilityDigest: ContentDigest;
  readonly resourceBinding: string;
  readonly mandatory: boolean;
  readonly minimumTrust: SourceTrust;
  readonly contentMode: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
  readonly watermarkDefinition: JsonValue;
}

export interface FilesystemPack {
  readonly schema: "dsheval.mvp.filesystem-pack/v1";
  readonly packId: StableId<"PackId">;
  readonly version: string;
  readonly scenario: JsonObject;
  readonly checks: readonly CheckDefinition[];
  readonly judges: readonly JsonObject[];
  readonly environment: JsonObject;
  readonly sourceRequirements: readonly SourceRequirement[];
  readonly contentDigest: ContentDigest;
}

export interface ConfigSnapshot {
  readonly schema: "dsheval.mvp.config/v1";
  readonly configId: StableId<"ConfigId">;
  readonly invocationId: StableId<"InvocationId">;
  readonly targetRoot: string;
  readonly runRoot: string;
  readonly artifactRoot: string;
  readonly reportRoot: string;
  readonly workspaceRoot: string;
  readonly runtimeDshHomeRoot: string;
  readonly runDeadlineMs: number;
  readonly caseDeadlineMs: number;
  readonly stableWindowMs: number;
  readonly stableMaxWaitMs: number;
  readonly maxArtifactBytes: number;
  readonly contentMode: string;
  readonly allowedModelEndpoints: readonly string[];
  readonly minimumIsolationLevel: "AGENT_SEPARATED";
  readonly rendererVersion: string;
  readonly fieldSources: JsonObject;
  readonly platform: string;
  readonly nodeVersion: string;
  readonly dshevalVersion: string;
  readonly secretRefNames: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly contentDigest: ContentDigest;
}

export interface CasePlan {
  readonly casePlanId: StableId<"CasePlanId">;
  readonly order: 1;
  readonly scenarioId: VersionedAssetId<"ScenarioId">;
  readonly environmentId: VersionedAssetId<"EnvironmentDefinitionId">;
  readonly agentTaskArtifactRef: Ref<ArtifactRef>;
  readonly visibleInputArtifactRefs: readonly Ref<ArtifactRef>[];
  readonly seedSpec: JsonObject;
  readonly allowedPaths: readonly PortablePath[];
  readonly forbiddenPaths: readonly PortablePath[];
  readonly deadlineMs: number;
  readonly stableWindowMs: number;
  readonly maxAttempts: 1;
  readonly checkIds: readonly StableId<"CheckId">[];
}

export interface CheckPlan {
  readonly checkId: StableId<"CheckId">;
  readonly type: "PROTOCOL" | "FILE_STATE" | "PATH_SECURITY";
  readonly required: boolean;
  readonly hardGate: boolean;
  readonly judgeId: VersionedAssetId<"JudgeId">;
  readonly evidenceContractRef: Ref<EvidenceContract>;
}

export interface EvaluationPlan extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.evaluation-plan/v1";
  readonly evaluationPlanId: StableId<"EvaluationPlanId">;
  readonly targetSnapshotRef: Ref<TargetSnapshot>;
  readonly inspectionRef: Ref<InspectionSnapshot>;
  readonly packRef: Ref<FilesystemPack>;
  readonly casePlan: CasePlan;
  readonly checkPlans: readonly CheckPlan[];
  readonly budget: JsonValue;
  readonly gateRule: JsonValue;
  readonly exclusions: readonly JsonValue[];
  readonly semanticDigest: ContentDigest;
  readonly status: "FROZEN";
}

export interface ObservationPlan extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.observation-plan/v1";
  readonly observationPlanId: StableId<"ObservationPlanId">;
  readonly evaluationPlanRef: Ref<EvaluationPlan>;
  readonly casePlanId: StableId<"CasePlanId">;
  readonly sourceRequirements: readonly SourceRequirement[];
  readonly boundaryPolicy: JsonValue;
  readonly stablePolicy: JsonValue;
  readonly contentPolicy: JsonValue;
  readonly semanticDigest: ContentDigest;
}

export interface EvidenceContract extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.evidence-contract/v1";
  readonly evidenceContractId: StableId<"EvidenceContractId">;
  readonly checkId: StableId<"CheckId">;
  readonly requiredFactTypes: readonly string[];
  readonly allowedSourceTypes: readonly ("DSH_PROBE" | "FILESYSTEM")[];
  readonly minimumTrust: SourceTrust;
  readonly minimumCompleteness: EvidenceCompleteness;
  readonly validityRequired: boolean;
  readonly timeBoundary: JsonValue;
  readonly authorizedJudgeId: VersionedAssetId<"JudgeId">;
  readonly ruleParameters: JsonObject;
  readonly missingOutcome: "UNEVALUABLE";
  readonly semanticDigest: ContentDigest;
}

export interface PlanGap {
  readonly code: string;
  readonly messageRedacted: string;
  readonly affectedIds: readonly AssetIdentifier[];
}

export type PlanBuildResult =
  | {
      readonly status: "FROZEN";
      readonly evaluationPlan: EvaluationPlan;
      readonly observationPlan: ObservationPlan;
      readonly evidenceContracts: readonly [EvidenceContract, EvidenceContract, EvidenceContract];
    }
  | {
      readonly status: "UNSATISFIABLE";
      readonly gaps: readonly PlanGap[];
      readonly failureDrafts: readonly FailureDraft[];
    };

export interface SensorAdapterDescriptor {
  readonly implementationId: StableId<"SensorImplementationId">;
  readonly implementationVersion: string;
  readonly capabilityDigest: ContentDigest;
  readonly sourceType: "DSH_PROBE" | "FILESYSTEM";
  readonly capabilities: readonly string[];
}

export type RunState =
  | "CREATED"
  | "PREFLIGHTING"
  | "RUNNING"
  | "FINALIZING"
  | "FINISHED"
  | "FAILED"
  | "CANCELLED";
export type CaseState = "PENDING" | "RUNNING" | "EVALUATING" | "FINISHED" | "ERRORED" | "ABORTED";
export type AttemptState =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "TARGET_FAILED"
  | "TIMED_OUT"
  | "HARNESS_ERROR"
  | "ENVIRONMENT_ERROR"
  | "CANCELLED";
export type EnvironmentState =
  | "CREATED"
  | "PREPARED"
  | "SEEDED"
  | "IN_USE"
  | "RESETTING"
  | "VERIFIED"
  | "CLEANED"
  | "QUARANTINED"
  | "CLEANUP_FAILED";
export type ObservationSessionState =
  | "PLANNED"
  | "BASELINING"
  | "BASELINED"
  | "ACTIVE"
  | "DRAINING"
  | "SEALED"
  | "FAILED";
export type LifecycleState =
  | RunState
  | CaseState
  | AttemptState
  | EnvironmentState
  | ObservationSessionState;

export type LifecycleAggregateSchema =
  | "dsheval.mvp.run/v1"
  | "dsheval.mvp.case/v1"
  | "dsheval.mvp.attempt/v1"
  | "dsheval.mvp.environment/v1"
  | "dsheval.mvp.observation-session/v1";

const LEGAL_TRANSITIONS: Readonly<Record<LifecycleAggregateSchema, Readonly<Record<string, readonly string[]>>>> = {
  "dsheval.mvp.run/v1": {
    CREATED: ["PREFLIGHTING", "FAILED", "CANCELLED"],
    PREFLIGHTING: ["RUNNING", "FAILED", "CANCELLED"],
    RUNNING: ["FINALIZING", "FAILED", "CANCELLED"],
    FINALIZING: ["FINISHED", "FAILED", "CANCELLED"],
    FINISHED: [],
    FAILED: [],
    CANCELLED: [],
  },
  "dsheval.mvp.case/v1": {
    PENDING: ["RUNNING"],
    RUNNING: ["EVALUATING", "ERRORED", "ABORTED"],
    EVALUATING: ["FINISHED", "ERRORED", "ABORTED"],
    FINISHED: [],
    ERRORED: [],
    ABORTED: [],
  },
  "dsheval.mvp.attempt/v1": {
    PENDING: ["RUNNING"],
    RUNNING: [
      "SUCCEEDED",
      "TARGET_FAILED",
      "TIMED_OUT",
      "HARNESS_ERROR",
      "ENVIRONMENT_ERROR",
      "CANCELLED",
    ],
    SUCCEEDED: [],
    TARGET_FAILED: [],
    TIMED_OUT: [],
    HARNESS_ERROR: [],
    ENVIRONMENT_ERROR: [],
    CANCELLED: [],
  },
  "dsheval.mvp.environment/v1": {
    CREATED: ["PREPARED", "QUARANTINED", "CLEANUP_FAILED"],
    PREPARED: ["SEEDED", "QUARANTINED", "CLEANUP_FAILED"],
    SEEDED: ["IN_USE", "RESETTING", "QUARANTINED", "CLEANUP_FAILED"],
    IN_USE: ["RESETTING", "QUARANTINED", "CLEANUP_FAILED"],
    RESETTING: ["VERIFIED", "QUARANTINED", "CLEANUP_FAILED"],
    VERIFIED: ["CLEANED", "QUARANTINED", "CLEANUP_FAILED"],
    CLEANED: [],
    QUARANTINED: [],
    CLEANUP_FAILED: [],
  },
  "dsheval.mvp.observation-session/v1": {
    PLANNED: ["BASELINING", "FAILED"],
    BASELINING: ["BASELINED", "FAILED"],
    BASELINED: ["ACTIVE", "FAILED"],
    ACTIVE: ["DRAINING", "FAILED"],
    DRAINING: ["SEALED", "FAILED"],
    SEALED: [],
    FAILED: [],
  },
};

export function isLifecycleSchema(schema: string): schema is LifecycleAggregateSchema {
  return Object.prototype.hasOwnProperty.call(LEGAL_TRANSITIONS, schema);
}

export function assertLegalTransition(
  schema: LifecycleAggregateSchema,
  fromState: string,
  toState: string,
): void {
  const nextStates = LEGAL_TRANSITIONS[schema][fromState];
  if (nextStates === undefined || !nextStates.includes(toState)) {
    throw new ContractViolation(
      "ILLEGAL_STATE_TRANSITION",
      `${schema} cannot transition from ${fromState} to ${toState}`,
    );
  }
}

export interface LifecycleProjectionBase<State extends LifecycleState = LifecycleState> {
  readonly schema: LifecycleAggregateSchema;
  readonly aggregateId: StableId;
  readonly scope: ScopeRef;
  readonly state: State;
  readonly revision: number;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
  readonly failureRefs: readonly Ref<FailureRecord>[];
  readonly projectionDigest: ContentDigest;
}

export interface EvaluationRun extends LifecycleProjectionBase<RunState> {
  readonly schema: "dsheval.mvp.run/v1";
  readonly runId: RunId;
  readonly targetSnapshotRef: Ref<TargetSnapshot>;
  readonly evaluationPlanRef: Ref<EvaluationPlan>;
  readonly observationPlanRef: Ref<ObservationPlan>;
  readonly caseId: CaseId;
  readonly operationalHealth: OperationalHealth;
  readonly gateDecisionRef?: Ref<GateDecision>;
  readonly environmentFinalState?: EnvironmentState;
}

export interface EvaluationCase extends LifecycleProjectionBase<CaseState> {
  readonly schema: "dsheval.mvp.case/v1";
  readonly caseId: CaseId;
  readonly runId: RunId;
  readonly casePlanId: StableId<"CasePlanId">;
  readonly attemptId: AttemptId;
  readonly checkResultRefs: readonly Ref<CheckResult>[];
}

export interface ExecutionAttempt extends LifecycleProjectionBase<AttemptState> {
  readonly schema: "dsheval.mvp.attempt/v1";
  readonly attemptId: AttemptId;
  readonly caseId: CaseId;
  readonly ordinal: 1;
  readonly workspacePath: string;
  readonly runtimeDshHomePath: string;
  readonly sourceRunId: SourceRunId;
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly terminationKind?: string;
  readonly stdoutArtifactRef?: Ref<ArtifactRef>;
  readonly stderrArtifactRef?: Ref<ArtifactRef>;
}

export interface EnvironmentInstance extends LifecycleProjectionBase<EnvironmentState> {
  readonly schema: "dsheval.mvp.environment/v1";
  readonly environmentInstanceId: StableId<"EnvironmentInstanceId">;
  readonly attemptId: AttemptId;
  readonly environmentId: VersionedAssetId<"EnvironmentDefinitionId">;
  readonly workspaceBinding: string;
  readonly resetGeneration: number;
  readonly seedManifestRef?: Ref<SeedManifest>;
  readonly baselineSnapshotRef?: Ref<FileSnapshot>;
}

export interface ControlEvent extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.control-event/v1";
  readonly controlEventId: StableId<"ControlEventId">;
  readonly operation:
    | "TARGET_START"
    | "TARGET_STOP"
    | "ENV_PREPARE"
    | "ENV_SEED"
    | "ENV_RESET"
    | "ENV_CLEANUP";
  readonly startedAt: IsoDateTime;
  readonly endedAt: IsoDateTime;
  readonly result: "SUCCEEDED" | "FAILED" | "CANCELLED";
  readonly failureRefs: readonly Ref<FailureRecord>[];
}

export interface ResourceEntry {
  readonly portablePath: PortablePath;
  readonly entryType: "FILE" | "DIRECTORY" | "SYMLINK" | "OTHER";
  readonly contentDigest?: ContentDigest;
  readonly mode: number;
  readonly readOnlyForTarget: boolean;
}

export interface SeedManifest extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.seed-manifest/v1";
  readonly seedManifestId: StableId<"SeedManifestId">;
  readonly environmentInstanceRef: Ref<EnvironmentInstance>;
  readonly resetGeneration: number;
  readonly resourceEntries: readonly ResourceEntry[];
  readonly completedAt: IsoDateTime;
}

export interface SecurityPreflight extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.security-preflight/v1";
  readonly preflightId: StableId<"SecurityPreflightId">;
  readonly runId: RunId;
  readonly targetIdentity: string;
  readonly observerIdentity: string;
  readonly judgeIdentity: string;
  readonly allowedRoots: readonly string[];
  readonly deniedRoots: readonly string[];
  readonly networkPolicyDigest: ContentDigest;
  readonly telemetryDisabled: boolean;
  readonly probeOrderValid: boolean;
  readonly status: "PASSED" | "FAILED";
  readonly failureRefs: readonly Ref<FailureRecord>[];
}

export interface ResetVerification extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.reset-verification/v1";
  readonly verificationId: StableId<"ResetVerificationId">;
  readonly environmentInstanceRef: Ref<EnvironmentInstance>;
  readonly resetGeneration: number;
  readonly expectedCleanDigest: ContentDigest;
  readonly postResetSnapshotRef: Ref<FileSnapshot>;
  readonly collectionStatusRef: Ref<CollectionStatus>;
  readonly result: "MATCH" | "MISMATCH" | "UNAVAILABLE";
  readonly differenceSummary: JsonValue;
}

export interface LeaseRecord extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.lease/v1";
  readonly leaseId: StableId<"LeaseId">;
  readonly runId: RunId;
  readonly slotId: "vm-global";
  readonly state: "ACTIVE" | "RELEASED";
  readonly ownerPid: number;
  readonly ownerProcessStartToken: string;
  readonly acquiredAt: IsoDateTime;
  readonly releasedAt?: IsoDateTime;
}

export interface SourceDescriptor extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.source/v1";
  readonly sourceId: StableId<"SourceId">;
  readonly sourceType: "DSH_PROBE" | "FILESYSTEM";
  readonly externalSchema: string;
  readonly collectorName: string;
  readonly collectorVersion: string;
  readonly collectorCapabilityDigest: ContentDigest;
  readonly trust: SourceTrust;
  readonly resourceBinding: string;
  readonly sequenceMode: string;
  readonly watermarkDefinition: JsonValue;
  readonly contentMode: string;
  readonly knownBlindSpots: readonly string[];
}

export interface CollectionGap {
  readonly kind: string;
  readonly firstMissingSeq?: number;
  readonly lastMissingSeq?: number;
  readonly reasonCode: string;
  readonly detail?: JsonValue;
}

export interface CollectionStatus extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.collection-status/v1";
  readonly collectionStatusId: StableId<"CollectionStatusId">;
  readonly sourceRef: Ref<SourceDescriptor>;
  readonly openedAt: IsoDateTime;
  readonly closedAt: IsoDateTime;
  readonly recordCount: number;
  readonly firstSourceSeq?: number;
  readonly lastSourceSeq?: number;
  readonly finalWatermark?: JsonValue;
  readonly gaps: readonly CollectionGap[];
  readonly truncated: boolean;
  readonly health: OperationalHealth;
  readonly completeness: EvidenceCompleteness;
  readonly failureRefs: readonly Ref<FailureRecord>[];
}

export interface CompletionLedgerItem {
  readonly kind:
    | "TARGET_TERMINATION"
    | "TOOL_CALLS"
    | "SESSION_FLUSH"
    | "PROBE_WATERMARK"
    | "STABLE_WINDOW"
    | "FINAL_FILE_SNAPSHOT";
  readonly required: boolean;
  readonly status: "COMPLETE" | "INCOMPLETE" | "UNKNOWN" | "FAILED";
  readonly reasonCodes: readonly string[];
  readonly supportingRefs: readonly Ref[];
}

export type CompletionLedger = readonly [
  CompletionLedgerItem,
  CompletionLedgerItem,
  CompletionLedgerItem,
  CompletionLedgerItem,
  CompletionLedgerItem,
  CompletionLedgerItem,
];

export interface ObservationSession extends LifecycleProjectionBase<ObservationSessionState> {
  readonly schema: "dsheval.mvp.observation-session/v1";
  readonly observationSessionId: StableId<"ObservationSessionId">;
  readonly attemptId: AttemptId;
  readonly observationPlanRef: Ref<ObservationPlan>;
  readonly sourceRefs: readonly Ref<SourceDescriptor>[];
  readonly baselineStartedAt?: IsoDateTime;
  readonly baselinedAt?: IsoDateTime;
  readonly activeAt?: IsoDateTime;
  readonly targetTerminatedAt?: IsoDateTime;
  readonly drainStartedAt?: IsoDateTime;
  readonly sealedAt?: IsoDateTime;
  readonly collectionStatusRefs: readonly Ref<CollectionStatus>[];
  readonly completionLedger?: CompletionLedger;
}

interface RawObservationCommon extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.raw-observation/v1";
  readonly observationId: StableId<"ObservationId">;
  readonly attemptId: AttemptId;
  readonly sourceRef: Ref<SourceDescriptor>;
  readonly externalEventType: string;
  readonly sourceTime: SourceTime;
  readonly captureMetadata: JsonObject;
  readonly rawDigest: ContentDigest;
}

export type RawObservation = RawObservationCommon &
  (
    | { readonly payloadInline: JsonValue; readonly payloadArtifactRef?: never }
    | { readonly payloadInline?: never; readonly payloadArtifactRef: Ref<ArtifactRef> }
  );

export interface FileEntry {
  readonly portablePath: PortablePath;
  readonly entryType: "FILE" | "DIRECTORY" | "SYMLINK" | "OTHER";
  readonly mode: number;
  readonly byteLength?: number;
  readonly contentDigest?: ContentDigest;
  readonly linkTarget?: string;
  readonly resolvedWithinRoot: boolean;
  readonly readError?: string;
}

export interface FileReadError {
  readonly portablePath: PortablePath;
  readonly reasonCode: string;
  readonly messageRedacted: string;
}

export interface FileSnapshot extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.file-snapshot/v1";
  readonly snapshotId: StableId<"FileSnapshotId">;
  readonly attemptId: AttemptId;
  readonly phase: "BEFORE" | "AFTER" | "POST_RESET";
  readonly rootBinding: string;
  readonly scanStartedAt: IsoDateTime;
  readonly scanCompletedAt: IsoDateTime;
  readonly entries: readonly FileEntry[];
  readonly readErrors: readonly FileReadError[];
  readonly completeness: EvidenceCompleteness;
  readonly snapshotDigest: ContentDigest;
}

export interface FileEntryChange {
  readonly portablePath: PortablePath;
  readonly kind:
    | "ADDED"
    | "REMOVED"
    | "CONTENT_CHANGED"
    | "TYPE_CHANGED"
    | "METADATA_CHANGED"
    | "SYMLINK_CHANGED"
    | "UNREADABLE";
  readonly before?: FileEntry;
  readonly after?: FileEntry;
}

export interface FileDiff extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.file-diff/v1";
  readonly diffId: StableId<"FileDiffId">;
  readonly beforeSnapshotRef: Ref<FileSnapshot>;
  readonly afterSnapshotRef: Ref<FileSnapshot>;
  readonly added: readonly FileEntryChange[];
  readonly removed: readonly FileEntryChange[];
  readonly modified: readonly FileEntryChange[];
  readonly typeChanged: readonly FileEntryChange[];
  readonly unchangedCount: number;
  readonly diffDigest: ContentDigest;
}

export interface DshProbeEvent {
  readonly schema: "dsh-eval.probe/v1";
  readonly runId: SourceRunId;
  readonly probeSeq: number;
  readonly at: string;
  readonly monotonicNs: number;
  readonly pid: number;
  readonly kind: string;
  readonly data: JsonObject;
  readonly [unknownField: string]: JsonValue;
}

export interface PreparedObserverBinding {
  readonly bindingId: StableId<"PreparedObserverBindingId">;
  readonly environmentInstanceId: StableId<"EnvironmentInstanceId">;
  readonly resetGeneration: number;
  readonly sourceRequirementId: VersionedAssetId<"SourceRequirementId">;
  readonly resourceBinding: string;
  readonly sensorImplementationId: StableId<"SensorImplementationId">;
  readonly sensorImplementationVersion: string;
  readonly sensorCapabilityDigest: ContentDigest;
  readonly allowedOperations: readonly ("READ" | "SNAPSHOT" | "DRAIN")[];
  readonly grantDigest: ContentDigest;
  /** Process-only capability. It must never be serialized, logged, or digested. */
  readonly readCapabilityToken: string;
  readonly expiresAt: IsoDateTime;
}

export type ObservationExecutionRequest =
  | {
      readonly kind: "CASE_RUN";
      readonly observationPlan: ObservationPlan;
      readonly environment: EnvironmentInstance & { readonly state: "SEEDED" };
      readonly preparedBindings: readonly PreparedObserverBinding[];
      readonly sensorRegistryDigest: ContentDigest;
    }
  | {
      readonly kind: "POST_RESET";
      readonly observationPlan: ObservationPlan;
      readonly environment: EnvironmentInstance & { readonly state: "RESETTING" };
      readonly resetGeneration: number;
      readonly expectedCleanDigest: ContentDigest;
      readonly preparedBindings: readonly PreparedObserverBinding[];
      readonly sensorRegistryDigest: ContentDigest;
    };

export type EvidenceAuthority =
  | "COMMITTED"
  | "ATTEMPTED"
  | "ENVIRONMENT_STATE"
  | "DIAGNOSTIC";

export interface EvidenceTimeRange {
  readonly startedAt?: IsoDateTime;
  readonly endedAt?: IsoDateTime;
  readonly sourceSeqStart?: number;
  readonly sourceSeqEnd?: number;
}

export interface EvidenceRecord extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.evidence/v1";
  readonly evidenceId: StableId<"EvidenceId">;
  readonly attemptId: AttemptId;
  readonly factType: string;
  readonly factValue: JsonValue;
  readonly sourceRefs: readonly Ref<SourceDescriptor>[];
  readonly observationRefs: readonly Ref<RawObservation>[];
  readonly artifactRefs: readonly Ref<ArtifactRef>[];
  readonly authority: EvidenceAuthority;
  readonly derivationRuleId?: StableId<"DerivationRuleId">;
  readonly timeRange: EvidenceTimeRange;
  readonly completeness: EvidenceCompleteness;
  readonly validity: EvidenceValidity;
  readonly trust: SourceTrust;
}

export interface EvidenceBundle extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.evidence-bundle/v1";
  readonly bundleId: StableId<"EvidenceBundleId">;
  readonly attemptId: AttemptId;
  readonly observationSessionRef: Ref<ObservationSession>;
  readonly evidenceRefs: readonly Ref<EvidenceRecord>[];
  readonly inputObservationRefs: readonly Ref<RawObservation>[];
  readonly unconsumedInputRefs: readonly Ref<RawObservation>[];
  readonly status: "SEALED" | "INVALID";
  readonly sealedAt: IsoDateTime;
  readonly sealDigest: ContentDigest;
  readonly failureRefs: readonly Ref<FailureRecord>[];
}

export interface EvidenceClosure extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.evidence-closure/v1";
  readonly closureId: StableId<"EvidenceClosureId">;
  readonly checkId: StableId<"CheckId">;
  readonly bundleRef: Ref<EvidenceBundle>;
  readonly evidenceContractRef: Ref<EvidenceContract>;
  readonly completeness: EvidenceCompleteness;
  readonly validity: EvidenceValidity;
  readonly state: "CLOSED" | "INCOMPLETE" | "INVALID";
  readonly satisfiedRequirements: readonly string[];
  readonly gaps: readonly JsonValue[];
  readonly authorizedEvidenceRefs: readonly Ref<EvidenceRecord>[];
}

export interface Finding extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.finding/v1";
  readonly findingId: StableId<"FindingId">;
  readonly checkId: StableId<"CheckId">;
  readonly code: string;
  readonly severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  readonly messageRedacted: string;
  readonly evidenceRefs: readonly Ref<EvidenceRecord>[];
  readonly hardGate: boolean;
}

export interface JudgementRecord extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.judgement/v1";
  readonly judgementId: StableId<"JudgementId">;
  readonly checkId: StableId<"CheckId">;
  readonly judgeId: VersionedAssetId<"JudgeId">;
  readonly judgeVersion: string;
  readonly closureRef: Ref<EvidenceClosure>;
  readonly authorizedEvidenceRefs: readonly Ref<EvidenceRecord>[];
  readonly status: "COMPLETED" | "BLOCKED" | "ERROR";
  readonly outcome?: CheckOutcome;
  readonly findingRefs: readonly Ref<Finding>[];
  readonly reasonCodes: readonly string[];
  readonly failureRefs: readonly Ref<FailureRecord>[];
}

export interface CheckResult extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.check-result/v1";
  readonly checkResultId: StableId<"CheckResultId">;
  readonly checkId: StableId<"CheckId">;
  readonly judgementRef: Ref<JudgementRecord>;
  readonly outcome: CheckOutcome;
  readonly required: boolean;
  readonly hardGate: boolean;
  readonly reasonCodes: readonly string[];
}

export interface GateDecision extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.gate/v1";
  readonly gateDecisionId: StableId<"GateDecisionId">;
  readonly runId: RunId;
  readonly inputCheckResultRefs: readonly Ref<CheckResult>[];
  readonly verdict: GateVerdict;
  readonly triggeredHardFailureRefs: readonly Ref<CheckResult>[];
  readonly unevaluableRequiredRefs: readonly Ref<CheckResult>[];
  readonly ruleVersion: string;
}

export interface EvaluationReport extends ImmutableRecordBase {
  readonly schema: "dsheval.mvp.report/v1";
  readonly reportId: StableId<"ReportId">;
  readonly runRef: Ref<EvaluationRun>;
  readonly targetSnapshotRef: Ref<TargetSnapshot>;
  readonly planRefs: readonly Ref[];
  readonly caseRef: Ref<EvaluationCase>;
  readonly attemptRef: Ref<ExecutionAttempt>;
  readonly sourceRefs: readonly Ref<SourceDescriptor>[];
  readonly collectionStatusRefs: readonly Ref<CollectionStatus>[];
  readonly closureRefs: readonly Ref<EvidenceClosure>[];
  readonly judgementRefs: readonly Ref<JudgementRecord>[];
  readonly checkResultRefs: readonly Ref<CheckResult>[];
  readonly gateDecisionRef?: Ref<GateDecision>;
  readonly resetVerificationRef?: Ref<ResetVerification>;
  readonly failureRefs: readonly Ref<FailureRecord>[];
  readonly operationalHealth: OperationalHealth;
  readonly artifactRefs: readonly Ref<ArtifactRef>[];
}

export interface StateTransition<Projection extends LifecycleProjectionBase = LifecycleProjectionBase> {
  readonly aggregateRef: Ref<Projection> & { readonly revision: number };
  readonly expectedRevision: number;
  readonly fromState: Projection["state"];
  readonly toState: Projection["state"];
  readonly reasonCode: string;
  readonly supportingRefs: readonly Ref[];
  readonly failureRefs: readonly Ref<FailureRecord>[];
  readonly occurredAt: IsoDateTime;
  readonly nextProjection: Projection;
}

export interface LifecycleEvent {
  readonly schema: "dsheval.mvp.lifecycle-event/v1";
  readonly eventId: StableId<"LifecycleEventId">;
  readonly aggregateSchema: LifecycleAggregateSchema;
  readonly aggregateId: StableId;
  readonly scope: ScopeRef;
  readonly revision: number;
  readonly fromState: LifecycleState;
  readonly toState: LifecycleState;
  readonly reasonCode: string;
  readonly supportingRefs: readonly Ref[];
  readonly failureRefs: readonly Ref<FailureRecord>[];
  readonly occurredAt: IsoDateTime;
  readonly priorProjectionRef: Ref<LifecycleProjectionBase> & { readonly revision: number };
  readonly nextProjectionDigest: ContentDigest;
  readonly contentDigest: ContentDigest;
}

export function withProjectionDigest<T extends object>(
  value: T,
): Readonly<T & { readonly projectionDigest: ContentDigest }> {
  if (Object.prototype.hasOwnProperty.call(value, "projectionDigest")) {
    throw new ContractViolation(
      "DIGEST_FIELD_PRESENT",
      "withProjectionDigest expects a projection without projectionDigest",
    );
  }
  return Object.freeze({ ...value, projectionDigest: digestValue(value) });
}

export function refForImmutable<T extends { readonly schema: string; readonly contentDigest: ContentDigest }>(
  record: T,
  id: StableId,
): Readonly<Ref<T>> {
  return Object.freeze({ schema: record.schema, id, digest: record.contentDigest });
}

export function refForProjection<T extends LifecycleProjectionBase>(
  projection: T,
): Readonly<Ref<T> & { readonly revision: number }> {
  return Object.freeze({
    schema: projection.schema,
    id: projection.aggregateId,
    digest: projection.projectionDigest,
    revision: projection.revision,
  });
}

export function refForArtifact(
  artifact: ArtifactRef,
): Readonly<Ref<ArtifactRef>> {
  return Object.freeze({
    schema: artifact.schema,
    id: artifact.artifactId,
    digest: artifact.contentDigest,
  });
}
