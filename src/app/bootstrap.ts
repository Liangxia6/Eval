import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  EvaluationAssetMatchingPort,
  OperationContext,
  PortResult,
} from "../core/contracts.js";
import type { FailureActor, FailureDraft } from "../core/errors.js";
import {
  assertDigestEquals,
  digestValue,
  type ConfigSnapshot,
  type FilesystemPack,
  type IsoDateTime,
  type JsonObject,
  type SensorAdapterDescriptor,
  type StableId,
  type TargetDescriptor,
  validateIsoDateTime,
  validateStableId,
  withContentDigest,
} from "../core/models.js";
import {
  DETERMINISTIC_JUDGE_VERSION,
} from "../evaluation/judging.js";
import {
  FILE_SENSOR_DESCRIPTOR,
  FileEnvironmentSensor,
  type EnvironmentSensor,
} from "../observation/environment.js";
import {
  PROBE_CAPABILITIES,
  PROBE_CAPABILITY_DIGEST,
  PROBE_IMPLEMENTATION_ID,
  PROBE_IMPLEMENTATION_VERSION,
} from "../observation/runtime.js";
import {
  FilesystemPlanner,
  judgeCapabilityDigest,
  type PlanningCapabilities,
} from "../planning/planner.js";
import { freezeConfig, type MvpConfigValues } from "../platform/config.js";
import { checkLocalServices, type HealthCheckResult } from "../platform/services.js";
import { FileArtifactStore } from "../storage/artifacts.js";
import { FileRepository } from "../storage/repositories.js";
import type { JudgeDescriptor } from "../core/contracts.js";

export const DSHEVAL_VERSION = "0.1.0";

const TARGET_FIELDS = new Set([
  "schema",
  "targetId",
  "targetType",
  "sourceRoot",
  "dshExecutable",
  "dshHome",
  "profile",
  "targetIdentity",
  "requestedScope",
  "contentDigest",
]);

export interface BootstrapInput {
  readonly cwd: string;
  readonly runId: string;
  readonly descriptor: TargetDescriptor;
  readonly createdAt: string;
  readonly configFile?: string;
  readonly configOverrides?: Partial<MvpConfigValues>;
  readonly signal?: AbortSignal;
}

export interface ApplicationServices {
  readonly config: ConfigSnapshot;
  readonly repository: FileRepository;
  readonly artifacts: FileArtifactStore;
  readonly health: HealthCheckResult;
  readonly sensors: readonly SensorAdapterDescriptor[];
  readonly planner: EvaluationAssetMatchingPort;
  readonly fileSensor: EnvironmentSensor;
  readonly operation: (actor: FailureActor, label: string) => OperationContext;
}

export class PortOperationError extends Error {
  public readonly result: Exclude<PortResult<unknown>, { readonly status: "SUCCEEDED" }>;

  public constructor(
    operation: string,
    result: Exclude<PortResult<unknown>, { readonly status: "SUCCEEDED" }>,
  ) {
    super(`${operation} returned ${result.status}`);
    this.name = "PortOperationError";
    this.result = result;
  }
}

export class UnsupportedTargetKindError extends Error {
  public readonly reasonCode = "UNSUPPORTED_TARGET_KIND" as const;

  public constructor() {
    super("DSHEval MVP supports only FULL_AGENT targets");
    this.name = "UnsupportedTargetKindError";
  }
}

export function requireSucceeded<T>(operation: string, result: PortResult<T>): T {
  if (result.status === "SUCCEEDED") return result.value;
  throw new PortOperationError(operation, result);
}

export function failureDraftsFrom(error: unknown): readonly FailureDraft[] {
  return error instanceof PortOperationError ? error.result.failureDrafts : [];
}

export function createRunId(prefix = "run"): StableId<"RunId"> {
  const time = Date.now().toString(36);
  const random = randomUUID().replaceAll("-", "").slice(0, 16);
  return validateStableId<"RunId">(`${prefix}-${time}-${random}`, "runId");
}

export async function loadTargetDescriptor(file: string): Promise<TargetDescriptor> {
  const descriptorPath = path.resolve(file);
  const parsed = JSON.parse(await readFile(descriptorPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("target descriptor must be a JSON object");
  }
  const raw = parsed as Record<string, unknown>;
  if (raw.targetType !== undefined && raw.targetType !== "FULL_AGENT") {
    throw new UnsupportedTargetKindError();
  }
  const unknown = Object.keys(raw).filter((field) => !TARGET_FIELDS.has(field)).sort();
  if (unknown.length > 0) {
    throw new Error(`target descriptor contains unknown fields: ${unknown.join(", ")}`);
  }
  if (
    raw.schema !== "dsheval.mvp.target-descriptor/v1" ||
    raw.targetType !== "FULL_AGENT" ||
    raw.requestedScope !== "FILESYSTEM_MVP"
  ) {
    throw new Error("target descriptor must declare the MVP FULL_AGENT/filesystem schema");
  }
  for (const field of [
    "sourceRoot",
    "dshExecutable",
    "dshHome",
    "profile",
    "targetIdentity",
  ] as const) {
    if (typeof raw[field] !== "string" || raw[field].length === 0) {
      throw new Error(`target descriptor ${field} must be a non-empty string`);
    }
  }
  const sourceRoot = path.resolve(path.dirname(descriptorPath), raw.sourceRoot as string);
  const withoutDigest = {
    schema: "dsheval.mvp.target-descriptor/v1" as const,
    targetId: validateStableId<"TargetId">(raw.targetId, "targetId"),
    targetType: "FULL_AGENT" as const,
    sourceRoot,
    dshExecutable: raw.dshExecutable as string,
    dshHome: raw.dshHome as string,
    profile: raw.profile as string,
    targetIdentity: raw.targetIdentity as string,
    requestedScope: "FILESYSTEM_MVP" as const,
  };
  const descriptor = withContentDigest(withoutDigest) as TargetDescriptor;
  if (raw.contentDigest !== undefined) {
    if (!path.isAbsolute(raw.sourceRoot as string)) {
      throw new Error("a descriptor with contentDigest must use an absolute sourceRoot");
    }
    assertDigestEquals(
      descriptor.contentDigest,
      raw.contentDigest as TargetDescriptor["contentDigest"],
      "TARGET_DESCRIPTOR_DIGEST_MISMATCH",
    );
  }
  return descriptor;
}

export async function bootstrapApplication(input: BootstrapInput): Promise<ApplicationServices> {
  const createdAt = validateIsoDateTime(input.createdAt, "createdAt");
  const runId = validateStableId<"RunId">(input.runId, "runId");
  const config = await freezeConfig({
    cwd: path.resolve(input.cwd),
    configId: `config.${runId}`,
    invocationId: `invocation.${runId}`,
    createdAt,
    dshevalVersion: DSHEVAL_VERSION,
    ...(input.configFile === undefined ? {} : { configFile: input.configFile }),
    cli: {
      ...(input.configOverrides ?? {}),
      targetRoot: input.descriptor.sourceRoot,
    },
  });
  const scope = Object.freeze({ targetId: input.descriptor.targetId });
  const repository = new FileRepository({
    runRoot: config.runRoot,
    runId,
    scope,
    producerVersion: DSHEVAL_VERSION,
  });
  const artifacts = new FileArtifactStore({
    artifactRoot: config.artifactRoot,
    runRoot: config.runRoot,
    runId,
    scope,
    maxArtifactBytes: config.maxArtifactBytes,
  });
  const health = await checkLocalServices({
    run: config.runRoot,
    artifact: config.artifactRoot,
    report: config.reportRoot,
    workspace: config.workspaceRoot,
    runtimeHome: config.runtimeDshHomeRoot,
  });
  const startupRecovery = health.checks.find((check) => check.name === "startup-recovery");
  if (startupRecovery?.status === "FAIL") {
    throw new Error(`STARTUP_RECOVERY_REQUIRED: ${startupRecovery.detail}`);
  }
  const probeDescriptor: SensorAdapterDescriptor = Object.freeze({
    implementationId: validateStableId<"SensorImplementationId">(PROBE_IMPLEMENTATION_ID),
    implementationVersion: PROBE_IMPLEMENTATION_VERSION,
    capabilityDigest: PROBE_CAPABILITY_DIGEST,
    sourceType: "DSH_PROBE",
    capabilities: PROBE_CAPABILITIES,
  });

  let operationCounter = 0;
  const requestedCancellationToken = {
    get isCancellationRequested(): boolean {
      return input.signal?.aborted ?? false;
    },
    throwIfCancellationRequested(): void {
      if (input.signal?.aborted === true) throw new Error("operation cancelled");
    },
  };
  const finalizationCancellationToken = Object.freeze({
    isCancellationRequested: false,
    throwIfCancellationRequested(): void {},
  });
  const operation = (actor: FailureActor, label: string): OperationContext => {
    operationCounter += 1;
    const safeLabel = label.replaceAll(/[^A-Za-z0-9._-]/gu, "-").slice(0, 48) || "operation";
    const operationId = validateStableId<"OperationId">(
      `op.${runId}.${operationCounter}.${safeLabel}`.slice(0, 128),
      "operationId",
    );
    return Object.freeze({
      operationId,
      idempotencyKey: `${runId}:${operationCounter}:${safeLabel}`,
      deadlineAt: new Date(Date.now() + config.runDeadlineMs).toISOString() as IsoDateTime,
      cancellationToken:
        actor === "PLANNING" ? requestedCancellationToken : finalizationCancellationToken,
      actorRole: actor,
      traceId: validateStableId<"TraceId">(`trace.${runId}`, "traceId"),
    });
  };

  const planningCapabilities: PlanningCapabilities = Object.freeze({
    observerReadOnly: true,
    identitySeparation: true,
    atomicArtifactCommit: true,
    pathIsolation: true,
    networkDefaultDeny: true,
    targetHiddenRootsDenied: true,
    probeArmedBeforeHeadless: true,
    observerOperations: Object.freeze(["READ", "SNAPSHOT", "DRAIN"] as const),
  });

  return {
    config,
    repository,
    artifacts,
    health,
    sensors: Object.freeze([probeDescriptor, FILE_SENSOR_DESCRIPTOR]),
    planner: new FilesystemPlanner(planningCapabilities),
    fileSensor: new FileEnvironmentSensor(),
    operation,
  };
}

export function judgeRegistry(pack: FilesystemPack): readonly JudgeDescriptor[] {
  return Object.freeze(
    pack.judges
      .map((judge) => {
        if (
          typeof judge.judgeId !== "string" ||
          typeof judge.version !== "string" ||
          judge.deterministic !== true
        ) {
          throw new Error("filesystem pack contains an invalid deterministic Judge descriptor");
        }
        return Object.freeze({
          judgeId: judge.judgeId as JudgeDescriptor["judgeId"],
          judgeVersion: DETERMINISTIC_JUDGE_VERSION,
          deterministic: true as const,
          capabilityDigest: judgeCapabilityDigest(judge as JsonObject),
        });
      })
      .sort((left, right) => String(left.judgeId).localeCompare(String(right.judgeId), "en")),
  );
}

export function verifyConfigSnapshot(config: ConfigSnapshot): void {
  assertDigestEquals(digestValue(config, ["contentDigest"]), config.contentDigest);
}
