import { cancelled, failed, rejected, succeeded } from "../core/contracts.js";
import type { OperationContext, PortResult } from "../core/contracts.js";
import type { FailureDraft } from "../core/errors.js";
import {
  ContractViolation,
  assertDigestEquals,
  canonicalize,
  digestValue,
  validateIsoDateTime,
  validateRef,
  validateStableId,
} from "../core/models.js";
import type {
  ArtifactRef,
  InspectionSnapshot,
  IsoDateTime,
  JsonObject,
  JsonValue,
  Ref,
  TargetSnapshot,
  ScopeRef,
} from "../core/models.js";
import type { PlanningArtifactRead } from "./target.js";

export interface InspectTargetOptions {
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly readArtifact: PlanningArtifactRead;
}

export class InspectionError extends ContractViolation {
  public constructor(code: string, message: string, options?: ErrorOptions) {
    super(code, message, options);
    this.name = "InspectionError";
  }
}

function asObject(value: unknown): Record<string, JsonValue> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, JsonValue>;
}

function decodeObject(bytes: Uint8Array, label: string): Record<string, JsonValue> {
  try {
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    const result = asObject(parsed);
    if (result === undefined) throw new Error("not an object");
    canonicalize(result);
    return result;
  } catch (error) {
    throw new InspectionError("INSPECTION_ARTIFACT_INVALID", `${label} is not valid JSON`, {
      cause: error,
    });
  }
}

function artifactRefs(snapshot: TargetSnapshot): readonly Ref<ArtifactRef>[] {
  return Object.freeze([
    snapshot.dshHomeManifestRef,
    snapshot.effectiveConfigRef,
    snapshot.lockfileRef,
    snapshot.profileManifestRef,
    snapshot.sourceManifestRef,
  ].sort((left, right) => left.id.localeCompare(right.id, "en")));
}

function normalizeJsonArray(value: JsonValue | undefined): readonly JsonValue[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return Object.freeze(
    [...value].sort((left, right) => canonicalize(left).localeCompare(canonicalize(right), "en")),
  );
}

function normalizedProfile(
  snapshot: TargetSnapshot,
  config: Record<string, JsonValue>,
  profileArtifact: Record<string, JsonValue> | undefined,
): JsonObject {
  const declaredProfile = asObject(config.profile);
  const declaredPlugins = normalizeJsonArray(declaredProfile?.plugins);
  const manifestStatus =
    profileArtifact === undefined || profileArtifact.status === "UNKNOWN" ? "UNKNOWN" : "KNOWN";
  return Object.freeze({
    name: snapshot.profile,
    manifestStatus,
    plugins:
      declaredPlugins === undefined
        ? Object.freeze({ status: "UNKNOWN", values: Object.freeze([]) })
        : Object.freeze({ status: "KNOWN", values: declaredPlugins }),
  });
}

function probeFacts(config: Record<string, JsonValue>): {
  readonly configured: boolean | "UNKNOWN";
  readonly schema: string;
  readonly orderStatus: string;
  readonly limitations: JsonObject[];
} {
  const probe = asObject(config.probe);
  const limitations: JsonObject[] = [];
  const configured =
    typeof probe?.configured === "boolean" ? probe.configured : ("UNKNOWN" as const);
  if (configured === "UNKNOWN") {
    limitations.push(
      Object.freeze({
        code: "PROBE_CONFIGURATION_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "Probe configuration was not declared by a frozen source",
      }),
    );
  }
  const schema = typeof probe?.schema === "string" ? probe.schema : "UNKNOWN";
  if (schema === "UNKNOWN") {
    limitations.push(
      Object.freeze({
        code: "PROBE_SCHEMA_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "Probe schema could not be established",
      }),
    );
  }
  let orderStatus = "UNKNOWN";
  if (probe?.order === "BEFORE_HEADLESS") orderStatus = "VALID";
  else if (probe?.order === "AFTER_HEADLESS") orderStatus = "INVALID";
  if (orderStatus === "UNKNOWN") {
    limitations.push(
      Object.freeze({
        code: "PROBE_ORDER_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "Probe ordering relative to Headless was not declared",
      }),
    );
  }
  const requiredFlags = [
    "captureDispatch",
    "captureLogs",
    "oneShot",
    "sourceRunIdEcho",
  ] as const;
  for (const flag of requiredFlags) {
    if (probe?.[flag] !== true) {
      limitations.push(
        Object.freeze({
          code: `PROBE_${flag.replaceAll(/([A-Z])/gu, "_$1").toUpperCase()}_UNKNOWN_OR_MISSING`,
          status: probe?.[flag] === false ? "ABSENT" : "UNKNOWN",
          messageRedacted: `Required Probe capability ${flag} is not confirmed`,
        }),
      );
    }
  }
  const contentModes = normalizeJsonArray(probe?.contentModes);
  if (contentModes === undefined || !contentModes.includes("STRUCTURED")) {
    limitations.push(
      Object.freeze({
        code: "PROBE_CONTENT_MODE_UNKNOWN_OR_MISSING",
        status: contentModes === undefined ? "UNKNOWN" : "ABSENT",
        messageRedacted: "Probe STRUCTURED content mode is not confirmed",
      }),
    );
  }
  return Object.freeze({ configured, schema, orderStatus, limitations });
}

function versionStatus(snapshot: TargetSnapshot, config: Record<string, JsonValue>): JsonObject {
  const configuredVersion =
    typeof config.dshVersion === "string" ? config.dshVersion : undefined;
  if (snapshot.dshPackageVersion === undefined) {
    return Object.freeze({
      status: "UNKNOWN",
      configuredVersion: configuredVersion ?? "UNKNOWN",
      source: "TARGET_PACKAGE_MANIFEST",
    });
  }
  if (configuredVersion !== undefined && configuredVersion !== snapshot.dshPackageVersion) {
    return Object.freeze({
      status: "CONFLICT",
      packageVersion: snapshot.dshPackageVersion,
      configuredVersion,
      source: "TARGET_PACKAGE_AND_EFFECTIVE_CONFIG",
    });
  }
  return Object.freeze({
    status: "KNOWN",
    version: snapshot.dshPackageVersion,
    source: "TARGET_PACKAGE_MANIFEST",
  });
}

function headlessStatus(snapshot: TargetSnapshot): string {
  try {
    assertDigestEquals(
      snapshot.driverFingerprint.dshEntrypointDigest,
      snapshot.dshEntrypointDigest,
      "DRIVER_ENTRYPOINT_MISMATCH",
    );
  } catch {
    return "INCOMPATIBLE";
  }
  return snapshot.driverFingerprint.cliGrammarId === "dsh.headless.profile-task.v1"
    ? "COMPATIBLE"
    : "INCOMPATIBLE";
}

function targetSnapshotRef(snapshot: TargetSnapshot): Ref<TargetSnapshot> {
  return Object.freeze({
    schema: snapshot.schema,
    id: snapshot.targetSnapshotId,
    digest: snapshot.contentDigest,
  });
}

/**
 * Reads only artifacts already bound into TargetSnapshot. Missing declarations
 * remain UNKNOWN and are also recorded as limitations; absence is never guessed.
 */
export async function inspectTarget(
  snapshot: TargetSnapshot,
  options: InspectTargetOptions,
): Promise<InspectionSnapshot> {
  if (snapshot.schema !== "dsheval.mvp.target-snapshot/v1") {
    throw new InspectionError("INVALID_TARGET_SNAPSHOT", `unsupported TargetSnapshot schema`);
  }
  validateRef(snapshot.effectiveConfigRef, { fieldName: "effectiveConfigRef" });
  validateRef(snapshot.profileManifestRef, { fieldName: "profileManifestRef" });
  const createdAt: IsoDateTime = validateIsoDateTime(options.createdAt, "InspectTargetOptions.createdAt");
  if (options.producerVersion.length === 0) {
    throw new InspectionError("INVALID_INPUT", `producerVersion must not be empty`);
  }

  const limitations: JsonObject[] = [];
  let frozenConfig: Record<string, JsonValue> = {};
  try {
    const envelope = decodeObject(
      await options.readArtifact(snapshot.effectiveConfigRef),
      "effective config artifact",
    );
    const extracted = asObject(envelope.config);
    if (extracted === undefined) {
      limitations.push(
        Object.freeze({
          code: "EFFECTIVE_CONFIG_UNKNOWN",
          status: "UNKNOWN",
          messageRedacted: "Effective config artifact contains no normalized config facts",
        }),
      );
    } else {
      frozenConfig = extracted;
    }
  } catch {
    limitations.push(
      Object.freeze({
        code: "EFFECTIVE_CONFIG_READ_FAILED",
        status: "UNKNOWN",
        messageRedacted: "Effective config could not be read through the authorized artifact source",
      }),
    );
  }

  let frozenProfile: Record<string, JsonValue> | undefined;
  try {
    frozenProfile = decodeObject(
      await options.readArtifact(snapshot.profileManifestRef),
      "profile manifest artifact",
    );
  } catch {
    limitations.push(
      Object.freeze({
        code: "PROFILE_MANIFEST_READ_FAILED",
        status: "UNKNOWN",
        messageRedacted: "Profile manifest could not be read through the authorized artifact source",
      }),
    );
  }

  const probe = probeFacts(frozenConfig);
  limitations.push(...probe.limitations);
  if (snapshot.dshPackageVersion === undefined) {
    limitations.push(
      Object.freeze({
        code: "DSH_VERSION_UNKNOWN",
        status: "UNKNOWN",
        messageRedacted: "The DSH entrypoint could not be bound to a package version",
      }),
    );
  }
  const toolSchemas = normalizeJsonArray(frozenConfig.toolSchemas) ??
    Object.freeze([
      Object.freeze({
        status: "UNKNOWN",
        reasonCode: "TOOL_SCHEMAS_NOT_DECLARED",
      }),
    ]);
  if (frozenConfig.fixture === true) {
    limitations.push(
      Object.freeze({
        code: "FIXTURE_TARGET",
        status: "DECLARED",
        messageRedacted: "This inspection describes a test fixture, not a real DSH acceptance run",
      }),
    );
  }
  const declaredLimitations = normalizeJsonArray(frozenConfig.limitations);
  if (declaredLimitations !== undefined) {
    for (const limitation of declaredLimitations) {
      const object = asObject(limitation);
      limitations.push(
        object === undefined
          ? Object.freeze({
              code: "DECLARED_LIMITATION",
              status: "DECLARED",
              messageRedacted: String(limitation),
            })
          : Object.freeze({ ...object }),
      );
    }
  }
  limitations.sort((left, right) => canonicalize(left).localeCompare(canonicalize(right), "en"));

  const normalized = {
    targetSnapshotRef: targetSnapshotRef(snapshot),
    dshVersionStatus: versionStatus(snapshot, frozenConfig),
    profile: normalizedProfile(snapshot, frozenConfig, frozenProfile),
    probeConfigured: probe.configured,
    probeSchema: probe.schema,
    probeOrderStatus: probe.orderStatus,
    headlessDriverStatus: headlessStatus(snapshot),
    toolSchemas,
    permissionPreset:
      typeof frozenConfig.permissionPreset === "string"
        ? frozenConfig.permissionPreset
        : "UNKNOWN",
    sandboxMode:
      typeof frozenConfig.sandboxMode === "string" ? frozenConfig.sandboxMode : "UNKNOWN",
    limitations: Object.freeze(limitations),
    sourceArtifactRefs: artifactRefs(snapshot),
  };
  const semanticFacts = {
    targetSnapshotId: snapshot.targetSnapshotId,
    dshVersionStatus: normalized.dshVersionStatus,
    profile: normalized.profile,
    probeConfigured: normalized.probeConfigured,
    probeSchema: normalized.probeSchema,
    probeOrderStatus: normalized.probeOrderStatus,
    headlessDriverStatus: normalized.headlessDriverStatus,
    toolSchemas: normalized.toolSchemas,
    permissionPreset: normalized.permissionPreset,
    sandboxMode: normalized.sandboxMode,
    limitations: normalized.limitations,
    sourceArtifactIds: normalized.sourceArtifactRefs.map((ref) => String(ref.id)).sort(),
  };
  const inspectionId = validateStableId<"InspectionId">(
    `inspection.${digestValue(semanticFacts).value.slice(0, 24)}`,
    "inspectionId",
  );
  const withoutDigest = {
    schema: "dsheval.mvp.inspection/v1" as const,
    inspectionId,
    scope: Object.freeze({
      targetId: snapshot.targetId,
      targetSnapshotId: snapshot.targetSnapshotId,
    }),
    createdAt,
    producerVersion: options.producerVersion,
    ...normalized,
  };
  return Object.freeze({
    ...withoutDigest,
    contentDigest: digestValue(withoutDigest),
  });
}

function inspectionFailureDraft(
  scope: ScopeRef,
  occurredAt: IsoDateTime,
  category: FailureDraft["category"],
  reasonCode: string,
  messageRedacted: string,
): FailureDraft {
  return Object.freeze({
    scope,
    category,
    origin: category === "INTERNAL_INVARIANT" ? "DSHEVAL" as const : "TARGET" as const,
    actor: "PLANNING" as const,
    phase: "INSPECTION",
    severity: "ERROR" as const,
    retryable: false as const,
    messageRedacted,
    reasonCode,
    evidenceRefs: Object.freeze([]),
    artifactRefs: Object.freeze([]),
    occurredAt,
  });
}

export async function inspectTargetResult(
  context: OperationContext,
  snapshot: TargetSnapshot,
  options: InspectTargetOptions,
): Promise<PortResult<InspectionSnapshot>> {
  const scope = Object.freeze({
    targetId: snapshot.targetId,
    targetSnapshotId: snapshot.targetSnapshotId,
  });
  let occurredAt: IsoDateTime;
  try {
    occurredAt = validateIsoDateTime(options.createdAt, "inspection occurredAt");
  } catch {
    return rejected("INVALID_INPUT", [], [
      Object.freeze({
        code: "INSPECTION_TIME_INVALID",
        messageRedacted: "Inspection timestamp is invalid",
      }),
    ]);
  }
  if (context.cancellationToken.isCancellationRequested) {
    return cancelled(
      Object.freeze({
        ...inspectionFailureDraft(
          scope,
          occurredAt,
          "CANCELLED",
          "INSPECTION_CANCELLED",
          "Target inspection was cancelled",
        ),
        origin: "USER" as const,
      }),
    );
  }
  try {
    return succeeded(await inspectTarget(snapshot, options));
  } catch (error) {
    const reasonCode = error instanceof ContractViolation
      ? error.code
      : "INSPECTION_INTERNAL_ERROR";
    const draft = inspectionFailureDraft(
      scope,
      occurredAt,
      reasonCode === "INSPECTION_INTERNAL_ERROR" ? "INTERNAL_INVARIANT" : "TARGET_INTEGRITY",
      reasonCode,
      reasonCode === "INSPECTION_INTERNAL_ERROR"
        ? "DSHEval could not complete target inspection"
        : "Frozen target facts are invalid for inspection",
    );
    if (error instanceof ContractViolation) return rejected("INVALID_INPUT", [draft]);
    return failed(draft);
  }
}
