import type {
  ArtifactId,
  ArtifactReadPurpose,
  ArtifactRef,
  ConfigSnapshot,
  ContentDigest,
  FilesystemPack,
  InspectionSnapshot,
  IsoDateTime,
  LifecycleProjectionBase,
  PlanBuildResult,
  Ref,
  ScopeRef,
  SensorAdapterDescriptor,
  StableId,
  VersionedAssetId,
  StateTransition,
  TargetSnapshot,
} from "./models.js";
import type { FailureActor, FailureDraft } from "./errors.js";

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  throwIfCancellationRequested?(): void;
}

export interface OperationContext {
  readonly operationId: StableId<"OperationId">;
  readonly idempotencyKey: string;
  readonly deadlineAt: IsoDateTime;
  readonly cancellationToken: CancellationToken;
  readonly actorRole: FailureActor;
  readonly traceId: StableId<"TraceId">;
}

/** Linux Appliance identity launcher used by both Preflight probes and the DSH process. */
export const LINUX_SETPRIV_PATH = "/usr/bin/setpriv";

export function linuxSetprivArguments(
  uid: number,
  gid: number,
  executablePath: string,
  argv: readonly string[],
): readonly string[] {
  if (!Number.isSafeInteger(uid) || uid < 0 || !Number.isSafeInteger(gid) || gid < 0) {
    throw new Error("setpriv uid and gid must be non-negative safe integers");
  }
  if (!executablePath.startsWith("/") || executablePath.includes("\0")) {
    throw new Error("setpriv executable must be an absolute NUL-free Linux path");
  }
  if (argv.some((argument) => argument.includes("\0"))) {
    throw new Error("setpriv argv must be NUL-free");
  }
  return Object.freeze([
    `--reuid=${uid}`,
    `--regid=${gid}`,
    "--clear-groups",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--no-new-privs",
    "--",
    executablePath,
    ...argv,
  ]);
}

export type RejectionCode =
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNSUPPORTED"
  | "PRECONDITION_FAILED"
  | "STALE_REVISION"
  | "AUTHORIZATION_DENIED";

export interface PortWarning {
  readonly code: string;
  readonly messageRedacted: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export type PortResult<T> =
  | {
      readonly status: "SUCCEEDED";
      readonly value: T;
      readonly failureDrafts: readonly FailureDraft[];
      readonly warnings: readonly PortWarning[];
    }
  | {
      readonly status: "REJECTED";
      readonly rejectionCode: RejectionCode;
      readonly failureDrafts: readonly FailureDraft[];
      readonly warnings: readonly PortWarning[];
    }
  | {
      readonly status: "FAILED";
      readonly failureDrafts: readonly [FailureDraft, ...FailureDraft[]];
      readonly warnings: readonly PortWarning[];
    }
  | {
      readonly status: "CANCELLED";
      readonly failureDrafts: readonly [FailureDraft, ...FailureDraft[]];
      readonly warnings: readonly PortWarning[];
    };

export function succeeded<T>(value: T, warnings: readonly PortWarning[] = []): PortResult<T> {
  return Object.freeze({ status: "SUCCEEDED", value, failureDrafts: [], warnings });
}

export function rejected<T = never>(
  rejectionCode: RejectionCode,
  failureDrafts: readonly FailureDraft[] = [],
  warnings: readonly PortWarning[] = [],
): PortResult<T> {
  return Object.freeze({ status: "REJECTED", rejectionCode, failureDrafts, warnings });
}

export function failed<T = never>(
  first: FailureDraft,
  ...rest: readonly FailureDraft[]
): PortResult<T> {
  const failureDrafts: readonly [FailureDraft, ...FailureDraft[]] = [first, ...rest];
  return Object.freeze({ status: "FAILED", failureDrafts, warnings: [] });
}

export function cancelled<T = never>(
  first: FailureDraft,
  ...rest: readonly FailureDraft[]
): PortResult<T> {
  const failureDrafts: readonly [FailureDraft, ...FailureDraft[]] = [first, ...rest];
  return Object.freeze({ status: "CANCELLED", failureDrafts, warnings: [] });
}

export interface RepositoryPort {
  putImmutable<T extends object>(
    context: OperationContext,
    record: T,
  ): Promise<PortResult<Readonly<Ref<T>>>>;

  createProjection<T extends LifecycleProjectionBase>(
    context: OperationContext,
    initialProjection: T,
  ): Promise<PortResult<Readonly<Ref<T> & { readonly revision: 0 }>>>;

  appendTransition<T extends LifecycleProjectionBase>(
    context: OperationContext,
    transition: StateTransition<T>,
  ): Promise<PortResult<Readonly<Ref<T> & { readonly revision: number }>>>;

  get<T>(context: OperationContext, ref: Ref<T>): Promise<PortResult<Readonly<T>>>;
}

export interface ArtifactCommitMetadata {
  readonly artifactId: ArtifactId;
  readonly scope: ScopeRef;
  readonly artifactType: string;
  readonly logicalName: string;
  readonly mediaType: string;
  readonly producerVersion: string;
  readonly createdAt: IsoDateTime;
  readonly sensitivity: "EXPORTABLE" | "RESTRICTED";
  readonly redactionState: "NOT_REQUIRED" | "APPLIED" | "FAILED";
}

export interface ArtifactStorePort {
  commit(
    context: OperationContext,
    bytes: Uint8Array | string,
    metadata: ArtifactCommitMetadata,
  ): Promise<PortResult<Readonly<ArtifactRef>>>;

  readVerified(
    context: OperationContext,
    ref: ArtifactRef,
    scope: ScopeRef,
    purpose: ArtifactReadPurpose,
  ): Promise<PortResult<Uint8Array>>;
}

/** Narrow write capability used by Planning; it cannot read or enumerate artifacts. */
export interface PlanArtifactMaterializer {
  commit(
    context: OperationContext,
    bytes: Uint8Array | string,
    metadata: ArtifactCommitMetadata,
  ): Promise<PortResult<Readonly<ArtifactRef>>>;
}

export interface JudgeDescriptor {
  readonly judgeId: VersionedAssetId<"JudgeId">;
  readonly judgeVersion: string;
  readonly deterministic: true;
  readonly capabilityDigest: ContentDigest;
}

export interface EvaluationAssetMatchingInput {
  readonly targetSnapshot: TargetSnapshot;
  readonly inspectionSnapshot: InspectionSnapshot;
  readonly filesystemPack: FilesystemPack;
  readonly configSnapshot: ConfigSnapshot;
  readonly sensors: readonly SensorAdapterDescriptor[];
  readonly judges: readonly JudgeDescriptor[];
}

/** The only stable asset extension boundary in the MVP. */
export interface EvaluationAssetMatchingPort {
  buildPlan(
    context: OperationContext,
    input: EvaluationAssetMatchingInput,
    artifactMaterializer: PlanArtifactMaterializer,
  ): Promise<PortResult<PlanBuildResult>>;
}
