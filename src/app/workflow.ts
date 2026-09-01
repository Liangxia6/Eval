import { readFile } from "node:fs/promises";
import path from "node:path";

import type { ArtifactCommitMetadata, PortResult } from "../core/contracts.js";
import {
  commitFailureDraft,
  failureDisplayGroup,
  internalFailureDraft,
  type FailureDraft,
  type FailureRecord,
} from "../core/errors.js";
import {
  digestBytes,
  digestValue,
  refForArtifact,
  refForImmutable,
  refForProjection,
  validateStableId,
  withContentDigest,
  type ArtifactRef,
  type CheckResult,
  type CollectionStatus,
  type ConfigSnapshot,
  type ControlEvent,
  type EnvironmentInstance,
  type EvaluationCase,
  type EvaluationPlan,
  type EvaluationReport,
  type EvaluationRun,
  type EvidenceClosure,
  type EvidenceRecord,
  type ExecutionAttempt,
  type FileDiff,
  type FileSnapshot,
  type Finding,
  type GateDecision,
  type InspectionSnapshot,
  type IsoDateTime,
  type JudgementRecord,
  type JsonObject,
  type ObservationPlan,
  type ObservationSession,
  type RawObservation,
  type Ref,
  type ResetVerification,
  type ScopeRef,
  type SecurityPreflight,
  type SeedManifest,
  type SourceDescriptor,
  type TargetDescriptor,
  type TargetSnapshot,
} from "../core/models.js";
import {
  buildEvidenceClosures,
} from "../evaluation/closure.js";
import { buildEvidenceBundle } from "../evaluation/evidence.js";
import { evaluateCheck } from "../evaluation/judging.js";
import {
  buildEvaluationReport,
  buildReportDocument,
  buildReportViewModel,
  parseVerifiedReportDocument,
  renderReportHtml,
  renderStatusHtml,
  serializeReportDocument,
  type ReportViewModel,
  type WorkflowStepView,
} from "../evaluation/report.js";
import { buildGateDecision } from "../evaluation/scoring.js";
import {
  activateObservation,
  beginBaseline,
  beginDrain,
  completeBaseline,
  completionLedger,
  createFileSourceDescriptor,
  createObservationSession,
  createProbeSourceDescriptor,
  failObservation,
  ledgerItem,
  sealObservation,
} from "../observation/coordinator.js";
import {
  FILE_SENSOR_REGISTRY_DIGEST,
  fileCollectionFailureDrafts,
  materializeFileCollectionStatus,
  materializeFileObservation,
  type EnvironmentSensor,
} from "../observation/environment.js";
import {
  materializeProbeCollection,
  parseProbeJsonl,
  probeIssueFailureDrafts,
  readProbeFileBounded,
} from "../observation/runtime.js";
import {
  buildFileDiff,
  emptyWorkspaceManifestDigest,
  materializeFileDiff,
  materializeFileSnapshot,
  materializeResetVerification,
  serializeFileSnapshotArtifact,
  verifyResetSnapshot,
  type FileSnapshotDraft,
} from "../observation/sensors/file.js";
import { loadFilesystemPackResult } from "../planning/catalog.js";
import { inspectTargetResult } from "../planning/inspector.js";
import {
  freezeTargetResult,
  verifyTargetIntegrityResult,
  type PlanningArtifactCommitRequest,
} from "../planning/target.js";
import {
  commitReportHtml,
  commitReportJson,
  exportReport,
  readCommittedReportHtml,
  readCommittedReportJson,
} from "../platform/export.js";
import {
  assertSafeAgentTask,
  findSecretLeaks,
  issueObserverBinding,
  runSecurityPreflight,
} from "../platform/security.js";
import { acquireLease, releaseLease, type LeaseFact } from "../platform/services.js";
import {
  cleanupRuntimeDshHome,
  cleanupEnvironment,
  prepareEnvironment,
  resetEnvironment,
  seedEnvironment,
  stageTargetRuntime,
  type PreparedEnvironment,
  type SeedEntrySpec,
} from "../runtime/environment.js";
import { createRuntimeProjectionGraph, transitionRuntimeProjection } from "../runtime/runner.js";
import { executeTarget, type TargetExecutionResult } from "../runtime/target.js";
import {
  bootstrapApplication,
  createRunId,
  DSHEVAL_VERSION,
  failureDraftsFrom,
  judgeRegistry,
  requireSucceeded,
  type ApplicationServices,
} from "./bootstrap.js";
import type { MvpConfigValues } from "../platform/config.js";

const STEP_LABELS = [
  "Freeze Target / Config / Assets",
  "Inspect DSH / Probe / Driver",
  "Build frozen filesystem plan",
  "Compile / Lease / Run objects / Preflight",
  "Prepare / Seed / File Before / Probe armed",
  "Execute one DSH Headless Attempt",
  "Drain / File After / Evidence Closure",
  "Persist three deterministic CheckResults",
  "Reset / independent verification / Cleanup",
  "Single Gate / terminal Run / Report / Export",
] as const;

export interface FixtureHooks {
  readonly behavior?: string;
  readonly onTargetStarted?: () => Promise<void> | void;
  readonly afterTargetBeforeDrain?: (workspacePath: string) => Promise<void>;
  readonly beforeReset?: () => Promise<void> | void;
  readonly afterReset?: (workspacePath: string) => Promise<void>;
  readonly beforeReportHtml?: () => Promise<void>;
}

export interface RunWorkflowInput {
  readonly cwd: string;
  readonly descriptor: TargetDescriptor;
  readonly packRoot?: string;
  readonly configFile?: string;
  readonly configOverrides?: Partial<MvpConfigValues>;
  readonly runId?: string;
  readonly fixtureMode?: boolean;
  readonly fixtureHooks?: FixtureHooks;
  readonly signal?: AbortSignal;
  /** Inspect/plan CLI reuse the same planning gates and stop before Run creation. */
  readonly stopAfter?: "INSPECT" | "PLAN";
}

export interface WorkflowSummary {
  readonly schema: "dsheval.mvp.cli-summary/v1";
  readonly command: "run" | "inspect" | "plan";
  readonly status: "COMPLETED" | "PLAN_UNSATISFIABLE" | "FAILED" | "CANCELLED";
  readonly runId: string;
  readonly runState?: string;
  readonly gate?: "PASS" | "FAIL" | "UNEVALUABLE";
  readonly operationalHealth?: string;
  readonly fixture: boolean;
  readonly securityIsolation?: "AGENT_SEPARATED" | "PROCESS_FIXTURE";
  readonly reportJson?: string;
  readonly reportHtml?: string;
  readonly delivery?: string;
  readonly failureGroups: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly targetSnapshotId?: string;
  readonly inspectionId?: string;
  readonly evaluationPlanId?: string;
  readonly observationPlanId?: string;
  readonly recordsPath: string;
  readonly exitCode: 0 | 1 | 2 | 3 | 4 | 130;
}

export interface ReportWorkflowSummary {
  readonly schema: "dsheval.mvp.cli-summary/v1";
  readonly command: "report";
  readonly status: "COMPLETED";
  readonly runId: string;
  readonly reportJson: string;
  readonly reportHtml: string;
  readonly rendererVersion: string;
  readonly reportDigest: string;
  readonly htmlDigest: string;
  readonly htmlStatus: "CREATED" | "VERIFIED";
  readonly exitCode: 0;
}

/** Re-renders only the already committed, digest-verified report document. */
export async function rebuildCommittedReportHtml(input: {
  readonly reportRoot: string;
  readonly runId: string;
  readonly maxBytes: number;
}): Promise<ReportWorkflowSummary> {
  const runId = validateStableId<"RunId">(input.runId, "runId");
  const reportRoot = path.resolve(input.reportRoot);
  const jsonBytes = await readCommittedReportJson({
    reportRoot,
    runId,
    maxBytes: input.maxBytes,
  });
  const document = parseVerifiedReportDocument(jsonBytes.toString("utf8"));
  const renderedBytes = Buffer.from(renderReportHtml(document), "utf8");
  let htmlStatus: ReportWorkflowSummary["htmlStatus"] = "VERIFIED";
  try {
    const committed = await readCommittedReportHtml({
      reportRoot,
      runId,
      maxBytes: input.maxBytes,
    });
    if (digestBytes(committed).value !== digestBytes(renderedBytes).value) {
      throw new Error("committed report.html does not match deterministic rendering");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await commitReportHtml({
      reportRoot,
      runId,
      bytes: renderedBytes,
      maxBytes: input.maxBytes,
    });
    htmlStatus = "CREATED";
  }
  return {
    schema: "dsheval.mvp.cli-summary/v1",
    command: "report",
    status: "COMPLETED",
    runId,
    reportJson: path.join(reportRoot, runId, "report.json"),
    reportHtml: path.join(reportRoot, runId, "report.html"),
    rendererVersion: document.rendererVersion,
    reportDigest: digestBytes(jsonBytes).value,
    htmlDigest: digestBytes(renderedBytes).value,
    htmlStatus,
    exitCode: 0,
  };
}

interface MutableWorkflowFacts {
  readonly fixture: boolean;
  run?: EvaluationRun;
  evaluationCase?: EvaluationCase;
  attempt?: ExecutionAttempt;
  environment?: EnvironmentInstance;
  target?: TargetSnapshot;
  inspection?: InspectionSnapshot;
  evaluationPlan?: EvaluationPlan;
  observationPlan?: ObservationPlan;
  session?: ObservationSession;
  resetVerification?: ResetVerification;
  gate?: GateDecision;
  securityIsolation?: "AGENT_SEPARATED" | "PROCESS_FIXTURE";
  readonly sources: SourceDescriptor[];
  readonly collectionStatuses: CollectionStatus[];
  readonly rawObservations: RawObservation[];
  readonly fileSnapshots: FileSnapshot[];
  readonly fileDiffs: FileDiff[];
  readonly closures: EvidenceClosure[];
  readonly evidence: EvidenceRecord[];
  readonly findings: Finding[];
  readonly judgements: JudgementRecord[];
  readonly checkResults: CheckResult[];
  readonly failures: FailureRecord[];
  readonly artifacts: ArtifactRef[];
  readonly timeline: WorkflowStepView[];
}

class WorkflowStop extends Error {
  public readonly exitCode: WorkflowSummary["exitCode"];
  public readonly status: WorkflowSummary["status"];

  public constructor(
    message: string,
    exitCode: WorkflowSummary["exitCode"],
    status: WorkflowSummary["status"] = "FAILED",
  ) {
    super(message);
    this.name = "WorkflowStop";
    this.exitCode = exitCode;
    this.status = status;
  }
}

export async function runEvaluationWorkflow(input: RunWorkflowInput): Promise<WorkflowSummary> {
  const runId = validateStableId<"RunId">(input.runId ?? createRunId(), "runId");
  const createdAt = new Date().toISOString();
  const fixtureMode = input.fixtureMode === true;
  if (!fixtureMode && input.fixtureHooks !== undefined) {
    throw new Error("fixtureHooks require explicit fixtureMode");
  }
  if (
    fixtureMode &&
    input.stopAfter === undefined &&
    input.fixtureHooks?.behavior === undefined
  ) {
    throw new Error("fixtureMode requires an explicit fixture behavior; no success behavior is assumed");
  }
  const services = await bootstrapApplication({
    cwd: input.cwd,
    runId,
    descriptor: input.descriptor,
    createdAt,
    ...(input.configFile === undefined ? {} : { configFile: input.configFile }),
    ...(input.configOverrides === undefined ? {} : { configOverrides: input.configOverrides }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const facts: MutableWorkflowFacts = {
    fixture: fixtureMode,
    sources: [],
    collectionStatuses: [],
    rawObservations: [],
    fileSnapshots: [],
    fileDiffs: [],
    closures: [],
    evidence: [],
    findings: [],
    judgements: [],
    checkResults: [],
    failures: [],
    artifacts: [],
    timeline: STEP_LABELS.map((label, index) => ({
      number: (index + 1) as WorkflowStepView["number"],
      label,
      status: "PENDING",
      objectRefs: [],
      failureGroups: [],
    })),
  };
  let lease: LeaseFact | undefined;
  let prepared: PreparedEnvironment | undefined;
  let stagedExecutablePath: string | undefined;
  let leaseReleased = false;
  let reportPhase: ReportPhase = "NOT_STARTED";
  const artifactById = new Map<string, ArtifactRef>();
  const save = createPersistence(services, facts);

  try {
    markStep(facts, 1, "RUNNING");
    await save.immutable(services.config, services.config.configId);
    await save.immutable(input.descriptor, input.descriptor.targetId);
    const planningArtifactCommit = async (
      request: PlanningArtifactCommitRequest,
    ): Promise<ArtifactRef> => {
      assertSecretFreeBytes(request.bytes, services.config, "planning Artifact");
      const artifact = requireSucceeded(
        `commit ${request.artifactType}`,
        await services.artifacts.commit(
          services.operation("PLANNING", `artifact-${request.artifactId}`),
          request.bytes,
          {
            artifactId: validateStableId<"ArtifactId">(request.artifactId),
            scope: request.scope,
            artifactType: request.artifactType,
            logicalName: request.logicalName,
            mediaType: request.mediaType,
            producerVersion: request.producerVersion,
            createdAt: request.createdAt,
            sensitivity: request.sensitivity,
            redactionState: "NOT_REQUIRED",
          },
        ),
      );
      artifactById.set(String(artifact.artifactId), artifact);
      facts.artifacts.push(artifact);
      return artifact;
    };
    const target = requireSucceeded(
      "freeze target",
      await freezeTargetResult(
        services.operation("PLANNING", "freeze-target"),
        input.descriptor,
        services.config,
        {
          createdAt,
          producerVersion: DSHEVAL_VERSION,
          commitArtifact: planningArtifactCommit,
          effectiveConfig: JSON.parse(
            await readFile(path.join(input.descriptor.sourceRoot, "effective-config.json"), "utf8"),
          ) as JsonObject,
          secretRefNames: services.config.secretRefNames,
        },
      ),
    );
    facts.target = target;
    const targetRef = await save.immutable(target, target.targetSnapshotId);
    const readPlanningArtifact = async (ref: Ref<ArtifactRef>): Promise<Uint8Array> => {
      const artifact = requireFullArtifact(artifactById, ref);
      return requireSucceeded(
        `read planning artifact ${ref.id}`,
        await services.artifacts.readVerified(
          services.operation("PLANNING", `read-${ref.id}`),
          artifact,
          artifact.scope,
          "INSPECTION",
        ),
      );
    };
    const integrity = requireSucceeded(
      "verify target integrity",
      await verifyTargetIntegrityResult(
        services.operation("PLANNING", "verify-target"),
        target,
        {
          readArtifact: readPlanningArtifact,
          effectiveConfig: JSON.parse(
            await readFile(path.join(input.descriptor.sourceRoot, "effective-config.json"), "utf8"),
          ) as JsonObject,
        },
        new Date().toISOString(),
      ),
    );
    if (integrity.status !== "VALID") {
      await save.failure(makeFailure(target.scope, "TARGET_INTEGRITY", "TARGET", "PLANNING", "FREEZE", "TARGET_INTEGRITY_INVALID", "Frozen Target changed before planning"));
      throw new WorkflowStop("target integrity verification failed", 2, "PLAN_UNSATISFIABLE");
    }
    markStep(facts, 1, "SUCCEEDED", [targetRef]);

    markStep(facts, 2, "RUNNING");
    const inspection = requireSucceeded(
      "inspect target",
      await inspectTargetResult(
        services.operation("PLANNING", "inspect-target"),
        target,
        { createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION, readArtifact: readPlanningArtifact },
      ),
    );
    facts.inspection = inspection;
    const inspectionRef = await save.immutable(inspection, inspection.inspectionId);
    markStep(facts, 2, "SUCCEEDED", [inspectionRef]);
    if (input.stopAfter === "INSPECT") {
      return summary(facts, runId, fixtureMode, 0, "COMPLETED", services.config.runRoot, "inspect");
    }

    markStep(facts, 3, "RUNNING");
    const packRoot = path.resolve(input.packRoot ?? path.join(input.cwd, "packs"));
    const packResult = await loadFilesystemPackResult(
      services.operation("PLANNING", "load-pack"),
      packRoot,
      target.scope,
      new Date().toISOString(),
    );
    if (packResult.status === "REJECTED") {
      await save.failures(packResult.failureDrafts);
      markStep(facts, 3, "FAILED");
      return summary(
        facts,
        runId,
        fixtureMode,
        2,
        "PLAN_UNSATISFIABLE",
        services.config.runRoot,
        input.stopAfter === "PLAN" ? "plan" : "run",
      );
    }
    const pack = requireSucceeded("load filesystem pack", packResult);
    const packRef = await save.immutable(pack, pack.packId);
    const planner = services.planner;
    const planningArtifacts = {
      commit: async (
        _context: Parameters<typeof services.artifacts.commit>[0],
        bytes: Uint8Array | string,
        metadata: ArtifactCommitMetadata,
      ): Promise<PortResult<Readonly<ArtifactRef>>> => {
        assertSecretFreeBytes(bytes, services.config, "Planner Artifact");
        const result = await services.artifacts.commit(
          services.operation("PLANNING", `plan-artifact-${metadata.artifactId}`),
          bytes,
          metadata,
        );
        if (result.status === "SUCCEEDED") {
          artifactById.set(String(result.value.artifactId), result.value);
          facts.artifacts.push(result.value);
        }
        return result;
      },
    };
    const planBuild = requireSucceeded(
      "build plan",
      await planner.buildPlan(
        services.operation("PLANNING", "build-plan"),
        {
          targetSnapshot: target,
          inspectionSnapshot: inspection,
          filesystemPack: pack,
          configSnapshot: services.config,
          sensors: services.sensors,
          judges: judgeRegistry(pack),
        },
        planningArtifacts,
      ),
    );
    if (planBuild.status === "UNSATISFIABLE") {
      await save.failures(planBuild.failureDrafts);
      markStep(facts, 3, "FAILED");
      return summary(
        facts,
        runId,
        fixtureMode,
        2,
        "PLAN_UNSATISFIABLE",
        services.config.runRoot,
        input.stopAfter === "PLAN" ? "plan" : "run",
      );
    }
    for (const contract of planBuild.evidenceContracts) {
      await save.immutable(contract, contract.evidenceContractId);
    }
    facts.evaluationPlan = planBuild.evaluationPlan;
    const evaluationPlanRef = await save.immutable(
      planBuild.evaluationPlan,
      planBuild.evaluationPlan.evaluationPlanId,
    );
    facts.observationPlan = planBuild.observationPlan;
    const observationPlanRef = await save.immutable(
      planBuild.observationPlan,
      planBuild.observationPlan.observationPlanId,
    );
    markStep(facts, 3, "SUCCEEDED", [packRef, evaluationPlanRef, observationPlanRef]);
    if (input.stopAfter === "PLAN") {
      return summary(facts, runId, fixtureMode, 0, "COMPLETED", services.config.runRoot, "plan");
    }

    markStep(facts, 4, "RUNNING");
    lease = await acquireLease(services.config.runRoot, runId);
    const ids = {
      runId,
      caseId: `${runId}.case`,
      attemptId: `${runId}.attempt`,
      environmentInstanceId: `${runId}.environment`,
      sourceRunId: `${runId}.source`,
    };
    const workspacePath = path.join(
      services.config.workspaceRoot,
      runId,
      ids.caseId,
      ids.attemptId,
    );
    const runtimeDshHomePath = path.join(
      services.config.runtimeDshHomeRoot,
      runId,
      ids.caseId,
      ids.attemptId,
    );
    const graph = createRuntimeProjectionGraph({
      ids,
      targetId: target.targetId,
      targetSnapshotId: target.targetSnapshotId,
      targetSnapshotRef: targetRef as Ref<TargetSnapshot>,
      evaluationPlanRef: evaluationPlanRef as Ref<EvaluationPlan>,
      observationPlanRef: observationPlanRef as Ref<ObservationPlan>,
      casePlanId: planBuild.evaluationPlan.casePlan.casePlanId,
      environmentId: planBuild.evaluationPlan.casePlan.environmentId,
      workspacePath,
      runtimeDshHomePath,
      now: new Date().toISOString(),
    });
    facts.run = graph.run;
    facts.evaluationCase = graph.evaluationCase;
    facts.attempt = graph.attempt;
    facts.environment = graph.environment;
    await save.projection(graph.run);
    await save.projection(graph.evaluationCase);
    await save.projection(graph.attempt);
    await save.projection(graph.environment);
    await save.lease(lease, graph.run.scope, "ACTIVE");
    facts.run = await save.transition(
      transitionRuntimeProjection({
        projection: facts.run,
        toState: "PREFLIGHTING",
        reasonCode: "PREFLIGHT_STARTED",
        occurredAt: new Date().toISOString(),
      }),
    );
    await updateStatus(services, facts, "PREFLIGHTING", save.failure);
    if (services.health.status !== "HEALTHY") {
      await save.failure(makeFailure(graph.run.scope, "PLATFORM_SECURITY_FAILURE", "DSHEVAL", "PLATFORM", "PREFLIGHT", "LOCAL_SERVICE_HEALTH_FAILED", "A required local storage or environment root is unhealthy"));
      throw new WorkflowStop("local service health check failed", 4);
    }
    const prepareStartedAt = new Date().toISOString() as IsoDateTime;
    try {
      prepared = await prepareEnvironment({
        workspaceRoot: services.config.workspaceRoot,
        runtimeDshHomeRoot: services.config.runtimeDshHomeRoot,
        runId,
        caseId: ids.caseId,
        attemptId: ids.attemptId,
        sourceDshHome: path.resolve(input.descriptor.sourceRoot, input.descriptor.dshHome),
        profile: input.descriptor.profile,
      });
    } catch (error) {
      const failureRef = await save.failure(makeFailure(
        graph.scope,
        "ENVIRONMENT_FAILURE",
        "ENVIRONMENT",
        "ENVIRONMENT_CONTROLLER",
        "PREPARE",
        "ENVIRONMENT_PREPARE_FAILED",
        "Attempt environment preparation failed",
      ));
      await save.control(graph.scope, "ENV_PREPARE", "FAILED", {
        startedAt: prepareStartedAt,
        failureRefs: [failureRef],
      });
      throw error;
    }
    const stagedTarget = await stageTargetRuntime({
      sourceRoot: input.descriptor.sourceRoot,
      executablePath: target.dshExecutablePath,
      expectedExecutableSha256: target.dshEntrypointDigest.value,
      runtimeDshHomeRoot: services.config.runtimeDshHomeRoot,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      runId,
      caseId: ids.caseId,
      attemptId: ids.attemptId,
    });
    stagedExecutablePath = stagedTarget.stagedExecutablePath;
    const preflightResult = await runSecurityPreflight({
      deniedRoots: [
        services.config.targetRoot,
        services.config.runRoot,
        services.config.artifactRoot,
        services.config.reportRoot,
        services.config.workspaceRoot,
        services.config.runtimeDshHomeRoot,
      ],
      allowedRoots: [prepared.workspacePath, prepared.runtimeDshHomePath],
      ...(fixtureMode ? {} : { expectedFrameworkIdentity: "dsheval" }),
      expectedTargetIdentity: input.descriptor.targetIdentity,
      allowedModelEndpoints: services.config.allowedModelEndpoints,
      allowFixtureIdentity: fixtureMode,
    });
    if (preflightResult.status !== "FAILED") {
      facts.securityIsolation = preflightResult.isolationLevel;
    }
    const preflightFailureRef = preflightResult.status === "FAILED"
      ? await save.failure(makeFailure(
          graph.run.scope,
          "PLATFORM_SECURITY_FAILURE",
          "DSHEVAL",
          "PLATFORM",
          "PREFLIGHT",
          "SECURITY_PREFLIGHT_FAILED",
          "Required OS identity, root isolation or network policy was not verified",
        ))
      : undefined;
    const preflight = withContentDigest({
      schema: "dsheval.mvp.security-preflight/v1" as const,
      preflightId: validateStableId<"SecurityPreflightId">(`preflight.${runId}`),
      scope: graph.run.scope,
      runId,
      targetIdentity: preflightResult.targetIdentity?.name ?? input.descriptor.targetIdentity,
      observerIdentity: preflightResult.observerIdentity.name,
      judgeIdentity: preflightResult.judgeIdentity.name,
      allowedRoots: ["attempt.workspace", "attempt.runtime-home"],
      deniedRoots: ["target", "records", "artifacts", "reports", "workspace-parent", "runtime-home-parent", "framework-home", "docker-socket", "sudoers"],
      networkPolicyDigest: digestValue({ default: "DENY", endpoints: services.config.allowedModelEndpoints }),
      telemetryDisabled: preflightResult.telemetryDisabled,
      probeOrderValid: inspection.probeOrderStatus === "VALID",
      status: preflightResult.status === "PASSED" ? "PASSED" as const : "FAILED" as const,
      failureRefs: preflightFailureRef === undefined ? [] : [preflightFailureRef],
      createdAt: new Date().toISOString(),
      producerVersion: DSHEVAL_VERSION,
    }) as SecurityPreflight;
    const preflightRef = await save.immutable(preflight, preflight.preflightId);
    if (preflightResult.status === "FAILED") {
      markStep(facts, 4, "FAILED", [
        refForProjection(facts.run),
        preflightRef,
        preflightFailureRef!,
      ]);
      throw new WorkflowStop("security preflight failed", 4);
    }
    markStep(facts, 4, "SUCCEEDED", [refForProjection(graph.run), preflightRef]);
    await updateStatus(
      services,
      facts,
      fixtureMode ? "PROCESS_FIXTURE_PREFLIGHT" : "PREFLIGHT_COMPLETE",
      save.failure,
    );

    markStep(facts, 5, "RUNNING");
    facts.environment = await save.transition(
      transitionRuntimeProjection({
        projection: facts.environment!,
        toState: "PREPARED",
        reasonCode: "ENVIRONMENT_PREPARED",
        occurredAt: new Date().toISOString(),
      }),
    );
    await save.control(graph.scope, "ENV_PREPARE", "SUCCEEDED", {
      startedAt: prepareStartedAt,
    });
    const seedEntries = seedSpecs(planBuild.evaluationPlan);
    const seedStartedAt = new Date().toISOString() as IsoDateTime;
    let seeded: Awaited<ReturnType<typeof seedEnvironment>>;
    try {
      seeded = await seedEnvironment(prepared.workspacePath, seedEntries);
    } catch (error) {
      const failureRef = await save.failure(makeFailure(
        graph.scope,
        "ENVIRONMENT_FAILURE",
        "ENVIRONMENT",
        "ENVIRONMENT_CONTROLLER",
        "SEED",
        "ENVIRONMENT_SEED_FAILED",
        "Attempt environment seeding failed",
      ));
      await save.control(graph.scope, "ENV_SEED", "FAILED", {
        startedAt: seedStartedAt,
        failureRefs: [failureRef],
      });
      throw error;
    }
    const seedManifest = withContentDigest({
      schema: "dsheval.mvp.seed-manifest/v1" as const,
      seedManifestId: validateStableId<"SeedManifestId">(`seed.${ids.attemptId}`),
      scope: graph.scope,
      environmentInstanceRef: refForProjection(facts.environment),
      resetGeneration: 0,
      resourceEntries: seeded.map((entry) => ({
        portablePath: entry.portablePath,
        entryType: entry.entryType,
        ...(entry.sha256 === undefined || entry.byteLength === undefined
          ? {}
          : {
              contentDigest: {
                algorithm: "sha256" as const,
                value: entry.sha256,
                byteLength: entry.byteLength,
              },
            }),
        mode: Number.parseInt(entry.mode, 8),
        readOnlyForTarget: entry.readOnlyForTarget,
      })),
      completedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      producerVersion: DSHEVAL_VERSION,
    }) as SeedManifest;
    const seedRef = await save.immutable(seedManifest, seedManifest.seedManifestId);
    facts.environment = await save.transition(
      transitionRuntimeProjection({
        projection: facts.environment,
        toState: "SEEDED",
        reasonCode: "ENVIRONMENT_SEEDED",
        occurredAt: new Date().toISOString(),
        supportingRefs: [seedRef],
        patch: { seedManifestRef: seedRef },
      }),
    );
    await save.control(graph.scope, "ENV_SEED", "SUCCEEDED", {
      startedAt: seedStartedAt,
      identityRefs: [seedRef],
    });
    const sourceRequirements = planBuild.observationPlan.sourceRequirements;
    const probeRequirement = sourceRequirements.find((item) => item.sourceType === "DSH_PROBE")!;
    const fileRequirement = sourceRequirements.find((item) => item.sourceType === "FILESYSTEM")!;
    const probeSource = createProbeSourceDescriptor({
      sourceId: `source.probe.${ids.attemptId}`,
      scope: graph.scope,
      resourceBinding: probeRequirement.resourceBinding,
      contentMode: probeRequirement.contentMode,
      watermarkDefinition: probeRequirement.watermarkDefinition,
      createdAt: new Date().toISOString(),
      producerVersion: DSHEVAL_VERSION,
    });
    const fileSource = createFileSourceDescriptor({
      sourceId: `source.file.${ids.attemptId}`,
      scope: graph.scope,
      resourceBinding: fileRequirement.resourceBinding,
      contentMode: fileRequirement.contentMode,
      watermarkDefinition: fileRequirement.watermarkDefinition,
      createdAt: new Date().toISOString(),
      producerVersion: DSHEVAL_VERSION,
    });
    const probeSourceRef = await save.immutable(probeSource, probeSource.sourceId);
    const fileSourceRef = await save.immutable(fileSource, fileSource.sourceId);
    facts.sources.push(probeSource, fileSource);
    let session = createObservationSession({
      observationSessionId: `${runId}.observation`,
      attemptId: ids.attemptId,
      scope: graph.scope,
      observationPlanRef: observationPlanRef as Ref<ObservationPlan>,
      sourceRefs: [probeSourceRef, fileSourceRef],
      createdAt: new Date().toISOString(),
    });
    await save.projection(session);
    session = await save.transition(
      beginBaseline(session, { occurredAt: new Date().toISOString(), reasonCode: "FILE_BASELINE_STARTED" }),
    );
    const fileSensor = services.fileSensor;
    const bindingRuntime = await issueObserverBinding({
      environmentInstanceId: facts.environment.environmentInstanceId,
      resetGeneration: 0,
      sourceRequirementId: String(fileRequirement.sourceRequirementId),
      resourceBinding: fileRequirement.resourceBinding,
      sensorImplementationId: String(fileRequirement.sensorImplementationId),
      sensorImplementationVersion: fileRequirement.sensorImplementationVersion,
      sensorCapabilityDigest: fileRequirement.sensorCapabilityDigest,
      expiresAt: new Date(Date.now() + services.config.runDeadlineMs).toISOString(),
      workspacePath: prepared.workspacePath,
    });
    const observationRequest = {
      kind: "CASE_RUN" as const,
      observationPlan: planBuild.observationPlan,
      environment: facts.environment as EnvironmentInstance & { readonly state: "SEEDED" },
      preparedBindings: [bindingRuntime.binding],
      sensorRegistryDigest: FILE_SENSOR_REGISTRY_DIGEST,
    };
    const beforeDraft = (
      await fileSensor.captureBefore({
        request: observationRequest,
        sourceRequirementId: String(fileRequirement.sourceRequirementId),
        expectedSensorRegistryDigest: FILE_SENSOR_REGISTRY_DIGEST,
        rootPath: bindingRuntime.workspacePath,
        snapshotId: `snapshot.before.${ids.attemptId}`,
        attemptId: ids.attemptId,
        maxFileBytes: services.config.maxArtifactBytes,
      })
    ).snapshot;
    const before = materializeFileSnapshot(beforeDraft, recordMetadata(graph.scope));
    const beforeRef = await save.immutable(before, before.snapshotId);
    const beforeArtifact = await save.artifact(
      serializeFileSnapshotArtifact(before),
      graph.scope,
      `raw-file-before.${ids.attemptId}`,
      "FILE_SNAPSHOT_RAW",
      "file-before.json",
      "application/json",
      "RESTRICTED",
    );
    const beforeRaw = materializeFileObservation({
      observationId: `raw.file.before.${ids.attemptId}`,
      scope: graph.scope,
      snapshot: before,
      snapshotRef: beforeRef,
      sourceRef: fileSourceRef,
      snapshotArtifact: beforeArtifact,
      snapshotArtifactRef: refForArtifact(beforeArtifact),
      createdAt: new Date().toISOString(),
      producerVersion: DSHEVAL_VERSION,
    });
    const beforeRawRef = await save.immutable(beforeRaw, beforeRaw.observationId);
    if (before.completeness !== "COMPLETE") {
      const baselineFailureRefs = await save.failures(fileCollectionFailureDrafts({
        scope: graph.scope,
        snapshots: [before],
        requiredPhases: ["BEFORE"],
        stableWindowComplete: true,
        occurredAt: new Date().toISOString(),
        artifactRefs: [refForArtifact(beforeArtifact)],
      }));
      const baselineStatus = materializeFileCollectionStatus({
        collectionStatusId: `collection.baseline.${ids.attemptId}`,
        scope: graph.scope,
        sourceRef: fileSourceRef,
        snapshots: [before],
        openedAt: before.scanStartedAt,
        closedAt: before.scanCompletedAt,
        requiredPhases: ["BEFORE"],
        stableWindowComplete: true,
        failureRefs: baselineFailureRefs,
        createdAt: new Date().toISOString(),
        producerVersion: DSHEVAL_VERSION,
      });
      const baselineStatusRef = await save.immutable(
        baselineStatus,
        baselineStatus.collectionStatusId,
      );
      facts.collectionStatuses.push(baselineStatus);
      session = await save.transition(failObservation(session, {
        occurredAt: new Date().toISOString(),
        reasonCode: "FILE_BASELINE_INCOMPLETE",
        failureRefs: baselineFailureRefs,
        supportingRefs: [beforeRef, beforeRawRef, baselineStatusRef],
      }));
      facts.session = session;
      markStep(facts, 5, "FAILED", [beforeRef, baselineStatusRef, refForProjection(session)]);
      throw new WorkflowStop("independent file baseline is incomplete", 4);
    }
    session = await save.transition(
      completeBaseline(session, {
        occurredAt: new Date().toISOString(),
        reasonCode: "FILE_BASELINE_COMMITTED",
        beforeSnapshotRef: beforeRef,
        supportingRefs: [beforeRef, beforeRawRef],
      }),
    );
    facts.session = session;
    markStep(facts, 5, "SUCCEEDED", [seedRef, beforeRef, refForProjection(session)]);
    await updateStatus(services, facts, "BASELINED", save.failure);

    const missingSecretRefs = services.config.secretRefNames.filter(
      (name) => process.env[name] === undefined,
    );
    if (missingSecretRefs.length > 0) {
      await save.failure(makeFailure(
        graph.scope,
        "PLATFORM_SECURITY_FAILURE",
        "EXTERNAL_DEPENDENCY",
        "PLATFORM",
        "SECRET_RESOLUTION",
        "SECRET_REF_UNRESOLVED",
        `Configured Secret references are unresolved: ${missingSecretRefs.join(", ")}`,
      ));
      throw new WorkflowStop("configured Secret reference is unresolved", 4);
    }

    markStep(facts, 6, "RUNNING");
    facts.run = await save.transition(transitionRuntimeProjection({ projection: facts.run!, toState: "RUNNING", reasonCode: "EXECUTION_STARTED", occurredAt: new Date().toISOString() }));
    facts.evaluationCase = await save.transition(transitionRuntimeProjection({ projection: facts.evaluationCase!, toState: "RUNNING", reasonCode: "CASE_STARTED", occurredAt: new Date().toISOString() }));
    facts.environment = await save.transition(transitionRuntimeProjection({ projection: facts.environment, toState: "IN_USE", reasonCode: "TARGET_RECEIVED_ENVIRONMENT", occurredAt: new Date().toISOString(), patch: { baselineSnapshotRef: beforeRef } }));
    session = await save.transition(activateObservation(session, { occurredAt: new Date().toISOString(), reasonCode: "PROBE_ARMED" }));
    facts.session = session;
    facts.attempt = await save.transition(transitionRuntimeProjection({ projection: facts.attempt!, toState: "RUNNING", reasonCode: "TARGET_STARTING", occurredAt: new Date().toISOString(), patch: { startedAt: new Date().toISOString() } }));
    const taskArtifact = requireFullArtifact(artifactById, planBuild.evaluationPlan.casePlan.agentTaskArtifactRef);
    const task = Buffer.from(requireSucceeded("read AgentTask", await services.artifacts.readVerified(services.operation("RUNTIME", "read-agent-task"), taskArtifact, taskArtifact.scope, "TASK_INPUT"))).toString("utf8");
    assertSafeAgentTask(task, [services.config.runRoot, services.config.artifactRoot, services.config.reportRoot]);
    if (stagedExecutablePath === undefined) {
      throw new Error("staged target executable is unavailable");
    }
    const targetResult = await (async (): Promise<TargetExecutionResult> => {
      const modelEnvironment: Record<string, string> = Object.create(null) as Record<string, string>;
      for (const name of services.config.secretRefNames) {
        const value = process.env[name];
        if (value === undefined) {
          throw new Error(`Secret reference became unavailable before Target start: ${name}`);
        }
        modelEnvironment[name] = value;
      }
      try {
        return await executeTarget({
          executablePath: stagedExecutablePath,
          profile: target.profile,
          task,
          cwd: prepared.workspacePath,
          runtimeDshHomePath: prepared.runtimeDshHomePath,
          probeOutputPath: prepared.probeOutputPath,
          sourceRunId: ids.sourceRunId,
          deadlineMs: planBuild.evaluationPlan.casePlan.deadlineMs,
          maxOutputBytes: services.config.maxArtifactBytes,
          modelEnvironment,
          ...(fixtureMode || preflightResult.targetIdentity === undefined
            ? {}
            : {
                targetUid: preflightResult.targetIdentity.uid,
                targetGid: preflightResult.targetIdentity.gid,
              }),
          ...(input.fixtureHooks?.behavior === undefined ? {} : { fixtureBehavior: input.fixtureHooks.behavior }),
          ...(input.signal === undefined ? {} : { signal: input.signal }),
          onStarted: async () => {
            await save.control(graph.scope, "TARGET_START", "SUCCEEDED");
            await input.fixtureHooks?.onTargetStarted?.();
          },
        });
      } finally {
        for (const name of Object.keys(modelEnvironment)) delete modelEnvironment[name];
      }
    })();
    const stdoutArtifact = await save.outputArtifact(targetResult.stdout, graph.scope, `stdout.${ids.attemptId}`, "stdout.txt", services.config);
    const stderrArtifact = await save.outputArtifact(targetResult.stderr, graph.scope, `stderr.${ids.attemptId}`, "stderr.txt", services.config);
    let targetFailureRef: Ref<FailureRecord> | undefined;
    if (targetResult.terminationKind !== "EXITED") {
      targetFailureRef = await save.failure(targetFailure(targetResult, graph.scope));
    }
    facts.attempt = await save.transition(
      transitionRuntimeProjection({
        projection: facts.attempt,
        toState: attemptTerminalState(targetResult),
        reasonCode: `TARGET_${targetResult.terminationKind}`,
        occurredAt: targetResult.endedAt,
        ...(targetFailureRef === undefined ? {} : { failureRefs: [targetFailureRef] }),
        patch: {
          endedAt: targetResult.endedAt,
          terminationKind: targetResult.terminationKind,
          stdoutArtifactRef: refForArtifact(stdoutArtifact),
          stderrArtifactRef: refForArtifact(stderrArtifact),
        },
      }),
    );
    await save.control(
      graph.scope,
      "TARGET_STOP",
      targetResult.terminationKind === "EXITED"
        ? "SUCCEEDED"
        : targetResult.terminationKind === "CANCELLED"
          ? "CANCELLED"
          : "FAILED",
      {
        startedAt: targetResult.startedAt as IsoDateTime,
        identityRefs: [refForProjection(facts.attempt)],
        ...(targetFailureRef === undefined ? {} : { failureRefs: [targetFailureRef] }),
      },
    );
    markStep(facts, 6, "SUCCEEDED", [refForProjection(facts.attempt)]);
    await updateStatus(services, facts, "TARGET_TERMINATED", save.failure);
    await input.fixtureHooks?.afterTargetBeforeDrain?.(prepared.workspacePath);

    markStep(facts, 7, "RUNNING");
    session = await save.transition(beginDrain(session, { occurredAt: targetResult.endedAt, targetTerminatedAt: targetResult.endedAt, reasonCode: "BOUNDED_DRAIN_STARTED", supportingRefs: [refForProjection(facts.attempt)] }));

    const probeRead = await readProbeFileBounded({
      path: prepared.probeOutputPath,
      maxBytes: Math.min(probeRequirement.maxBytes, services.config.maxArtifactBytes),
      timeoutMs: probeRequirement.timeoutMs,
    });
    const probeBytes = Buffer.from(probeRead.bytes);
    const secretCanaries = services.config.secretRefNames
      .map((name) => process.env[name])
      .filter((value): value is string => value !== undefined);
    const probeLeaks = findSecretLeaks(probeBytes, secretCanaries);
    const probeArtifact = await save.artifact(
      probeBytes,
      graph.scope,
      `raw-probe.${ids.attemptId}`,
      "DSH_PROBE_JSONL",
      "probe.jsonl",
      "application/x-ndjson",
      "RESTRICTED",
      probeLeaks.length === 0 ? "NOT_REQUIRED" : "FAILED",
    );
    const parsedProbe = parseProbeJsonl(probeBytes, {
      expectedRunId: ids.sourceRunId,
      ...(targetResult.pid === undefined ? {} : { expectedPid: targetResult.pid }),
      attemptId: ids.attemptId,
      sourceRef: probeSourceRef,
      collectionStatusId: `collection.probe.${ids.attemptId}`,
      openedAt: targetResult.startedAt,
      closedAt: targetResult.endedAt,
      observedAt: new Date().toISOString(),
      rawArtifactRef: refForArtifact(probeArtifact),
      inputTruncated: probeRead.truncated,
      contentRestricted: probeLeaks.length > 0,
    });
    const probeFailureRefs = [
      ...await save.failures(probeIssueFailureDrafts(parsedProbe, {
        scope: graph.scope,
        occurredAt: new Date().toISOString(),
        rawArtifactRef: refForArtifact(probeArtifact),
      })),
      ...(probeLeaks.length === 0
        ? []
        : [await save.failure({
            ...makeFailure(
              graph.scope,
              "TARGET_SECURITY_VIOLATION",
              "TARGET",
              "TARGET",
              "PROBE_DRAIN",
              "SECRET_CANARY_EXPOSED",
              "Runtime Probe content matched a configured Secret canary and was isolated",
            ),
            artifactRefs: [refForArtifact(probeArtifact)],
          })]),
    ];
    const probeCollection = materializeProbeCollection({ scope: graph.scope, parseResult: parsedProbe, rawArtifact: probeArtifact, rawArtifactRef: refForArtifact(probeArtifact), createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION, failureRefs: probeFailureRefs });
    const probeStatusRef = await save.immutable(probeCollection.collectionStatus, probeCollection.collectionStatus.collectionStatusId);
    facts.collectionStatuses.push(probeCollection.collectionStatus);

    const stability = await captureStableAfter(fileSensor, {
      request: observationRequest,
      sourceRequirementId: String(fileRequirement.sourceRequirementId),
      expectedSensorRegistryDigest: FILE_SENSOR_REGISTRY_DIGEST,
      rootPath: bindingRuntime.workspacePath,
      attemptId: ids.attemptId,
      maxFileBytes: services.config.maxArtifactBytes,
      stableWindowMs: planBuild.evaluationPlan.casePlan.stableWindowMs,
      stableMaxWaitMs: services.config.stableMaxWaitMs,
    });
    const after = materializeFileSnapshot(stability.snapshot, recordMetadata(graph.scope));
    const afterRef = await save.immutable(after, after.snapshotId);
    const afterArtifact = await save.artifact(serializeFileSnapshotArtifact(after), graph.scope, `raw-file-after.${ids.attemptId}`, "FILE_SNAPSHOT_RAW", "file-after.json", "application/json", "RESTRICTED");
    const afterRaw = materializeFileObservation({ observationId: `raw.file.after.${ids.attemptId}`, scope: graph.scope, snapshot: after, snapshotRef: afterRef, sourceRef: fileSourceRef, snapshotArtifact: afterArtifact, snapshotArtifactRef: refForArtifact(afterArtifact), createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
    const afterRawRef = await save.immutable(afterRaw, afterRaw.observationId);
    const diffDraft = buildFileDiff({ diffId: `diff.${ids.attemptId}`, beforeSnapshot: beforeDraft, afterSnapshot: stability.snapshot, beforeSnapshotRef: beforeRef, afterSnapshotRef: afterRef, allowDiagnosticPartial: true });
    const fileDiff = materializeFileDiff(diffDraft, recordMetadata(graph.scope));
    const diffRef = await save.immutable(fileDiff, fileDiff.diffId);
    const fileFailureRefs = await save.failures(fileCollectionFailureDrafts({
      scope: graph.scope,
      snapshots: [before, after],
      requiredPhases: ["BEFORE", "AFTER"],
      stableWindowComplete: stability.stable,
      occurredAt: new Date().toISOString(),
      artifactRefs: [refForArtifact(beforeArtifact), refForArtifact(afterArtifact)],
    }));
    const fileStatus = materializeFileCollectionStatus({ collectionStatusId: `collection.file.${ids.attemptId}`, scope: graph.scope, sourceRef: fileSourceRef, snapshots: [before, after], openedAt: before.scanStartedAt, closedAt: after.scanCompletedAt, requiredPhases: ["BEFORE", "AFTER"], stableWindowComplete: stability.stable, failureRefs: fileFailureRefs, createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
    const fileStatusRef = await save.immutable(fileStatus, fileStatus.collectionStatusId);
    facts.collectionStatuses.push(fileStatus);
    const rawObservations: RawObservation[] = [beforeRaw, afterRaw, ...probeCollection.observations];
    const rawObservationRefs: Ref<RawObservation>[] = [refForImmutable(beforeRaw, beforeRaw.observationId), afterRawRef];
    for (const raw of probeCollection.observations) rawObservationRefs.push(await save.immutable(raw, raw.observationId));
    facts.rawObservations.push(...rawObservations);
    facts.fileSnapshots.push(before, after);
    facts.fileDiffs.push(fileDiff);
    const ledger = completionLedger({
      TARGET_TERMINATION: ledgerItem("TARGET_TERMINATION", "COMPLETE", { supportingRefs: [refForProjection(facts.attempt)] }),
      TOOL_CALLS: ledgerItem("TOOL_CALLS", probeCollection.collectionStatus.completeness === "COMPLETE" ? "COMPLETE" : "INCOMPLETE", { reasonCodes: parsedProbe.issues.map((issue) => issue.code) }),
      SESSION_FLUSH: ledgerItem("SESSION_FLUSH", parsedProbe.issues.some((issue) => issue.code === "PROBE_STOP_MISSING") ? "INCOMPLETE" : "COMPLETE"),
      PROBE_WATERMARK: ledgerItem("PROBE_WATERMARK", probeCollection.collectionStatus.completeness === "COMPLETE" ? "COMPLETE" : "INCOMPLETE", { supportingRefs: [probeStatusRef] }),
      STABLE_WINDOW: ledgerItem("STABLE_WINDOW", stability.stable ? "COMPLETE" : "INCOMPLETE"),
      FINAL_FILE_SNAPSHOT: ledgerItem("FINAL_FILE_SNAPSHOT", after.completeness === "COMPLETE" ? "COMPLETE" : "INCOMPLETE", { supportingRefs: [afterRef] }),
    });
    session = await save.transition(sealObservation(session, { occurredAt: new Date().toISOString(), reasonCode: "OBSERVATION_SEALED", collectionStatusRefs: [probeStatusRef, fileStatusRef], completionLedger: ledger, allRawArtifactsCommitted: true, supportingRefs: [probeStatusRef, fileStatusRef, beforeRef, afterRef, diffRef] }));
    facts.session = session;
    const verifiedArtifacts = [] as Array<{ artifactRef: Ref<ArtifactRef>; verified: boolean }>;
    for (const artifact of [beforeArtifact, afterArtifact, probeArtifact]) {
      requireSucceeded(`verify raw artifact ${artifact.artifactId}`, await services.artifacts.readVerified(services.operation("EVIDENCE_PROCESSOR", `verify-${artifact.artifactId}`), artifact, artifact.scope, "EVIDENCE_CAPTURE"));
      verifiedArtifacts.push({ artifactRef: refForArtifact(artifact), verified: true });
    }
    const evidenceCreatedAt = new Date().toISOString();
    const evidenceInput = { bundleId: `bundle.${ids.attemptId}`, scope: graph.scope, attemptId: ids.attemptId, observationSession: session, observationSessionRef: refForProjection(session), sources: facts.sources, rawObservations, rawObservationRefs, collectionStatuses: [probeCollection.collectionStatus, fileStatus], beforeSnapshot: before, beforeSnapshotRef: beforeRef, afterSnapshot: after, afterSnapshotRef: afterRef, fileDiff, fileDiffRef: diffRef, seedManifest, seedManifestRef: seedRef, verifiedArtifacts, failureRefs: [...fileFailureRefs, ...probeFailureRefs], createdAt: evidenceCreatedAt, producerVersion: DSHEVAL_VERSION } as const;
    let evidenceBuild = buildEvidenceBundle(evidenceInput);
    if (evidenceBuild.failureDraft !== undefined) {
      const evidenceFailureRef = await save.failure(evidenceBuild.failureDraft);
      evidenceBuild = buildEvidenceBundle({
        ...evidenceInput,
        failureRefs: [...evidenceInput.failureRefs, evidenceFailureRef],
      });
    }
    const evidenceRefs: Ref<EvidenceRecord>[] = [];
    for (const evidence of evidenceBuild.evidence) evidenceRefs.push(await save.immutable(evidence, evidence.evidenceId));
    facts.evidence.push(...evidenceBuild.evidence);
    const bundleRef = await save.immutable(evidenceBuild.bundle, evidenceBuild.bundle.bundleId);
    const contractRefs = planBuild.evidenceContracts.map((contract) => refForImmutable(contract, contract.evidenceContractId));
    const closureBuild = buildEvidenceClosures({ scope: graph.scope, bundle: evidenceBuild.bundle, bundleRef, evidenceContracts: planBuild.evidenceContracts, evidenceContractRefs: contractRefs, evidence: evidenceBuild.evidence, evidenceRefs, sources: facts.sources, createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
    const closureRefs: Ref<EvidenceClosure>[] = [];
    for (const closure of closureBuild.closures) closureRefs.push(await save.immutable(closure, closure.closureId));
    facts.closures.push(...closureBuild.closures);
    markStep(facts, 7, "SUCCEEDED", [refForProjection(session), bundleRef, ...closureRefs]);
    await updateStatus(services, facts, "EVIDENCE_CLOSED", save.failure);

    markStep(facts, 8, "RUNNING");
    facts.evaluationCase = await save.transition(transitionRuntimeProjection({ projection: facts.evaluationCase!, toState: "EVALUATING", reasonCode: "JUDGING_STARTED", occurredAt: new Date().toISOString() }));
    const checkResultRefs: Ref<CheckResult>[] = [];
    for (const checkPlan of planBuild.evaluationPlan.checkPlans) {
      const contract = planBuild.evidenceContracts.find((item) => item.checkId === checkPlan.checkId)!;
      const closure = facts.closures.find((item) => item.checkId === checkPlan.checkId)!;
      const closureRef = refForImmutable(closure, closure.closureId);
      const authorized = closure.authorizedEvidenceRefs.map((ref) => facts.evidence.find((item) => item.evidenceId === ref.id)!).filter(Boolean);
      let judged = evaluateCheck({ scope: graph.scope, checkPlan, closure, closureRef, evidenceContract: contract, authorizedEvidence: authorized, judgementId: `judgement.${checkPlan.checkId}.${ids.attemptId}`, checkResultId: `check-result.${checkPlan.checkId}.${ids.attemptId}`, createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
      if (judged.failureDraft !== undefined) {
        const judgeFailureRef = await save.failure(judged.failureDraft);
        judged = evaluateCheck({ scope: graph.scope, checkPlan, closure, closureRef, evidenceContract: contract, authorizedEvidence: authorized, judgementId: `judgement.${checkPlan.checkId}.${ids.attemptId}`, checkResultId: `check-result.${checkPlan.checkId}.${ids.attemptId}`, createdAt: judged.judgement.createdAt, producerVersion: DSHEVAL_VERSION, judgeFailureRef });
      }
      for (const finding of judged.findings) await save.immutable(finding, finding.findingId);
      const judgementRef = await save.immutable(judged.judgement, judged.judgement.judgementId);
      const checkResultRef = await save.immutable(judged.checkResult, judged.checkResult.checkResultId);
      facts.findings.push(...judged.findings);
      facts.judgements.push(judged.judgement);
      facts.checkResults.push(judged.checkResult);
      checkResultRefs.push(checkResultRef);
      void judgementRef;
    }
    const caseTerminal = targetResult.terminationKind === "CANCELLED"
      ? "ABORTED" as const
      : targetResult.terminationKind === "HARNESS_ERROR"
        ? "ERRORED" as const
        : "FINISHED" as const;
    facts.evaluationCase = await save.transition(transitionRuntimeProjection({ projection: facts.evaluationCase, toState: caseTerminal, reasonCode: targetResult.terminationKind === "CANCELLED" ? "USER_CANCELLED_AFTER_CHECKS" : targetResult.terminationKind === "HARNESS_ERROR" ? "HARNESS_ERROR_AFTER_CHECKS" : "CHECK_RESULTS_COMMITTED", occurredAt: new Date().toISOString(), supportingRefs: checkResultRefs, patch: { checkResultRefs } }));
    markStep(facts, 8, "SUCCEEDED", checkResultRefs);
    await updateStatus(services, facts, "CHECK_RESULTS_COMMITTED", save.failure);

    markStep(facts, 9, "RUNNING");
    const resetStartedAt = new Date().toISOString() as IsoDateTime;
    const expectedCleanDigest = emptyWorkspaceManifestDigest(fileRequirement.resourceBinding);
    let resetGeneration = facts.environment.resetGeneration;
    let resetVerificationRef: Ref<ResetVerification> | undefined;
    let reset: Awaited<ReturnType<typeof resetEnvironment>> | undefined;
    try {
      await input.fixtureHooks?.beforeReset?.();
      reset = await resetEnvironment({
        workspaceRoot: services.config.workspaceRoot,
        workspacePath: prepared.workspacePath,
        resetGeneration: facts.environment.resetGeneration,
      });
      resetGeneration = reset.resetGeneration;
    } catch (error) {
      const failureRef = await save.failure(makeFailure(
        graph.scope,
        "ENVIRONMENT_FAILURE",
        "ENVIRONMENT",
        "ENVIRONMENT_CONTROLLER",
        "RESET",
        "ENVIRONMENT_RESET_FAILED",
        "Environment Reset failed and cleanliness could not be established",
      ));
      await save.control(graph.scope, "ENV_RESET", "FAILED", {
        startedAt: resetStartedAt,
        failureRefs: [failureRef],
      });
      facts.environment = await save.transition(transitionRuntimeProjection({
        projection: facts.environment,
        toState: "QUARANTINED",
        reasonCode: "ENVIRONMENT_RESET_FAILED",
        occurredAt: new Date().toISOString(),
        failureRefs: [failureRef],
        patch: { resetGeneration },
      }));
      markStep(facts, 9, "FAILED", [failureRef, refForProjection(facts.environment)]);
      void error;
    }

    if (reset !== undefined) {
      facts.environment = await save.transition(transitionRuntimeProjection({
        projection: facts.environment,
        toState: "RESETTING",
        reasonCode: "RESET_COMPLETED_PENDING_VERIFICATION",
        occurredAt: new Date().toISOString(),
        patch: { resetGeneration },
      }));
      await save.control(graph.scope, "ENV_RESET", "SUCCEEDED", { startedAt: resetStartedAt });

      let postResetDraft: FileSnapshotDraft | undefined;
      try {
        await input.fixtureHooks?.afterReset?.(prepared.workspacePath);
        const resetBinding = await issueObserverBinding({ environmentInstanceId: facts.environment.environmentInstanceId, resetGeneration, sourceRequirementId: String(fileRequirement.sourceRequirementId), resourceBinding: fileRequirement.resourceBinding, sensorImplementationId: String(fileRequirement.sensorImplementationId), sensorImplementationVersion: fileRequirement.sensorImplementationVersion, sensorCapabilityDigest: fileRequirement.sensorCapabilityDigest, expiresAt: new Date(Date.now() + services.config.stableMaxWaitMs + 5_000).toISOString(), workspacePath: prepared.workspacePath });
        const resetRequest = { kind: "POST_RESET" as const, observationPlan: planBuild.observationPlan, environment: facts.environment as EnvironmentInstance & { readonly state: "RESETTING" }, resetGeneration, expectedCleanDigest, preparedBindings: [resetBinding.binding], sensorRegistryDigest: FILE_SENSOR_REGISTRY_DIGEST };
        postResetDraft = (await fileSensor.verifyReset({ request: resetRequest, sourceRequirementId: String(fileRequirement.sourceRequirementId), expectedSensorRegistryDigest: FILE_SENSOR_REGISTRY_DIGEST, rootPath: resetBinding.workspacePath, snapshotId: `snapshot.post-reset.${ids.attemptId}`, attemptId: ids.attemptId, maxFileBytes: services.config.maxArtifactBytes })).snapshot;
      } catch (error) {
        const failureRef = await save.failure(makeFailure(
          graph.scope,
          "OBSERVATION_FAILURE",
          "DSHEVAL",
          "COLLECTOR",
          "RESET_VERIFY",
          "RESET_VERIFICATION_COLLECTION_FAILED",
          "Independent post-reset collection failed and cleanliness could not be established",
        ));
        facts.environment = await save.transition(transitionRuntimeProjection({
          projection: facts.environment,
          toState: "QUARANTINED",
          reasonCode: "RESET_VERIFICATION_COLLECTION_FAILED",
          occurredAt: new Date().toISOString(),
          failureRefs: [failureRef],
          patch: { resetGeneration },
        }));
        markStep(facts, 9, "FAILED", [failureRef, refForProjection(facts.environment)]);
        void error;
      }

      if (postResetDraft !== undefined) {
        const postReset = materializeFileSnapshot(postResetDraft, recordMetadata(graph.scope));
        const postResetRef = await save.immutable(postReset, postReset.snapshotId);
        const postResetArtifact = await save.artifact(serializeFileSnapshotArtifact(postReset), graph.scope, `raw-file-post-reset.${ids.attemptId}`, "FILE_SNAPSHOT_RAW", "file-post-reset.json", "application/json", "RESTRICTED");
        const postResetRaw = materializeFileObservation({ observationId: `raw.file.post-reset.${ids.attemptId}`, scope: graph.scope, snapshot: postReset, snapshotRef: postResetRef, sourceRef: fileSourceRef, snapshotArtifact: postResetArtifact, snapshotArtifactRef: refForArtifact(postResetArtifact), createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
        await save.immutable(postResetRaw, postResetRaw.observationId);
        facts.rawObservations.push(postResetRaw);
        facts.fileSnapshots.push(postReset);
        const resetCollectionFailureRefs = await save.failures(fileCollectionFailureDrafts({
          scope: graph.scope,
          snapshots: [postReset],
          requiredPhases: ["POST_RESET"],
          stableWindowComplete: true,
          occurredAt: new Date().toISOString(),
          artifactRefs: [refForArtifact(postResetArtifact)],
        }));
        const resetStatus = materializeFileCollectionStatus({ collectionStatusId: `collection.reset.${ids.attemptId}`, scope: graph.scope, sourceRef: fileSourceRef, snapshots: [postReset], openedAt: postReset.scanStartedAt, closedAt: postReset.scanCompletedAt, requiredPhases: ["POST_RESET"], stableWindowComplete: true, failureRefs: resetCollectionFailureRefs, createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
        const resetStatusRef = await save.immutable(resetStatus, resetStatus.collectionStatusId);
        facts.collectionStatuses.push(resetStatus);
        const resetDraft = verifyResetSnapshot({ verificationId: `reset-verification.${ids.attemptId}`, environmentInstanceRef: refForProjection(facts.environment), resetGeneration, expectedCleanDigest, postResetSnapshot: postResetDraft, postResetSnapshotRef: postResetRef, collectionStatusRef: resetStatusRef });
        const resetVerification = materializeResetVerification(resetDraft, recordMetadata(graph.scope));
        resetVerificationRef = await save.immutable(resetVerification, resetVerification.verificationId);
        facts.resetVerification = resetVerification;
        if (resetVerification.result === "MATCH") {
          facts.environment = await save.transition(transitionRuntimeProjection({ projection: facts.environment, toState: "VERIFIED", reasonCode: "RESET_VERIFIED", occurredAt: new Date().toISOString(), supportingRefs: [resetVerificationRef], patch: { resetGeneration } }));
          const cleanupStartedAt = new Date().toISOString() as IsoDateTime;
          try {
            await cleanupEnvironment({ workspaceRoot: services.config.workspaceRoot, workspacePath: prepared.workspacePath });
            await cleanupRuntimeDshHome({
              runtimeDshHomeRoot: services.config.runtimeDshHomeRoot,
              runtimeDshHomePath: prepared.runtimeDshHomePath,
              runId,
              caseId: ids.caseId,
              attemptId: ids.attemptId,
            });
            facts.environment = await save.transition(transitionRuntimeProjection({ projection: facts.environment, toState: "CLEANED", reasonCode: "ENVIRONMENT_CLEANED", occurredAt: new Date().toISOString() }));
            await save.control(graph.scope, "ENV_CLEANUP", "SUCCEEDED", {
              startedAt: cleanupStartedAt,
            });
            markStep(facts, 9, "SUCCEEDED", [resetVerificationRef, refForProjection(facts.environment)]);
          } catch {
            const failureRef = await save.failure(makeFailure(graph.scope, "CLEANUP_FAILURE", "ENVIRONMENT", "ENVIRONMENT_CONTROLLER", "CLEANUP", "ENVIRONMENT_CLEANUP_FAILED", "Verified environment cleanup failed"));
            facts.environment = await save.transition(transitionRuntimeProjection({ projection: facts.environment, toState: "CLEANUP_FAILED", reasonCode: "CLEANUP_FAILED", occurredAt: new Date().toISOString(), failureRefs: [failureRef] }));
            await save.control(graph.scope, "ENV_CLEANUP", "FAILED", {
              startedAt: cleanupStartedAt,
              failureRefs: [failureRef],
            });
            markStep(facts, 9, "FAILED", [resetVerificationRef, refForProjection(facts.environment)]);
          }
        } else {
          const failureRef = await save.failure(makeFailure(graph.scope, "CLEANUP_FAILURE", "ENVIRONMENT", "ENVIRONMENT_CONTROLLER", "RESET_VERIFY", resetVerification.result === "MISMATCH" ? "RESET_MISMATCH" : "RESET_UNAVAILABLE", "Independent post-reset verification did not confirm a clean environment"));
          facts.environment = await save.transition(transitionRuntimeProjection({ projection: facts.environment, toState: "QUARANTINED", reasonCode: resetVerification.result, occurredAt: new Date().toISOString(), failureRefs: [failureRef], patch: { resetGeneration } }));
          markStep(facts, 9, "FAILED", [resetVerificationRef, refForProjection(facts.environment)]);
        }
      }
    }
    await updateStatus(services, facts, "RESET_FINALIZED", save.failure);

    markStep(facts, 10, "RUNNING");
    facts.run = await save.transition(transitionRuntimeProjection({ projection: facts.run!, toState: "FINALIZING", reasonCode: "FINALIZATION_FACTS_COMMITTED", occurredAt: new Date().toISOString(), patch: { environmentFinalState: facts.environment.state, operationalHealth: facts.environment.state === "CLEANED" ? "HEALTHY" : "FAILED" } }));
    const committedChecks: Array<{ record: CheckResult; ref: Ref<CheckResult> }> = [];
    for (const ref of checkResultRefs) {
      committedChecks.push({ record: requireSucceeded(`reread CheckResult ${ref.id}`, await services.repository.get(services.operation("APP", `reread-${ref.id}`), ref)) as CheckResult, ref });
    }
    const gate = buildGateDecision({ gateDecisionId: `gate.${runId}`, runId, scope: graph.run.scope, committedCheckResults: committedChecks, finalizationFactsCommitted: true, createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
    const gateRef = await save.immutable(gate, gate.gateDecisionId);
    facts.gate = gate;
    const userCancelled = targetResult.terminationKind === "CANCELLED";
    const harnessFailed = targetResult.terminationKind === "HARNESS_ERROR";
    const runTerminal = userCancelled
      ? "CANCELLED" as const
      : harnessFailed
        ? "FAILED" as const
        : facts.environment.state === "CLEANED"
        ? "FINISHED" as const
        : "FAILED" as const;
    const terminalHealth = !harnessFailed && facts.environment.state === "CLEANED"
      ? "HEALTHY" as const
      : "FAILED" as const;
    facts.run = await save.transition(transitionRuntimeProjection({ projection: facts.run, toState: runTerminal, reasonCode: userCancelled ? "USER_CANCELLED" : harnessFailed ? "HARNESS_OPERATION_FAILED" : runTerminal === "FINISHED" ? "RUN_FINISHED" : "OPERATIONAL_FINALIZATION_FAILED", occurredAt: new Date().toISOString(), supportingRefs: [gateRef], patch: { gateDecisionRef: gateRef, environmentFinalState: facts.environment.state, operationalHealth: terminalHealth } }));
    markStep(facts, 10, "SUCCEEDED", [gateRef, refForProjection(facts.run)]);
    const deliveredReport = await persistAndDeliverReport({
      services,
      facts,
      save,
      runId,
      phase: userCancelled ? "CANCELLED" : terminalHealth === "FAILED" ? "FAILED" : "COMPLETED",
      setReportPhase: (phase) => {
        reportPhase = phase;
      },
      ...(input.fixtureHooks?.beforeReportHtml === undefined
        ? {}
        : { beforeReportHtml: input.fixtureHooks.beforeReportHtml }),
    });
    await updateStatus(services, facts, "COMPLETED", save.failure);
    if (lease !== undefined) {
      const released = await releaseLease(services.config.runRoot, lease);
      leaseReleased = true;
      await save.lease(released, graph.run.scope, "RELEASED");
    }
    const operationalFailure = facts.run.operationalHealth === "FAILED";
    const exitCode = userCancelled
      ? 130
      : operationalFailure
        ? 4
      : gate.verdict === "PASS"
        ? 0
        : gate.verdict === "FAIL"
          ? 1
          : 3;
    return {
      ...summary(
        facts,
        runId,
        fixtureMode,
        exitCode,
        userCancelled ? "CANCELLED" : operationalFailure ? "FAILED" : "COMPLETED",
        services.config.runRoot,
      ),
      ...deliveredReport,
    };
  } catch (error) {
    const drafts = failureDraftsFrom(error);
    if (drafts.length > 0) await save.failures(drafts).catch(() => undefined);
    if (reportPhase !== "NOT_STARTED") {
      const scope = facts.attempt?.scope ?? facts.run?.scope ?? facts.target?.scope ?? { targetId: input.descriptor.targetId };
      await save.failure(makeFailure(
        scope,
        "REPORT_FAILURE",
        "DSHEVAL",
        reportPhase === "EXPORT" ? "EXPORTER" : "REPORTER",
        reportPhase,
        `${reportPhase}_DELIVERY_FAILED`,
        "Report delivery failed after the Agent Gate was committed",
      )).catch(() => undefined);
    } else if (!(error instanceof WorkflowStop) && drafts.length === 0) {
      const scope = facts.attempt?.scope ?? facts.run?.scope ?? facts.target?.scope ?? { targetId: input.descriptor.targetId };
      await save.failure(internalFailureDraft(scope, "WORKFLOW", new Date().toISOString() as IsoDateTime, { actor: "APP", reasonCode: "WORKFLOW_ABORTED", messageRedacted: "DSHEval stopped at a failed workflow gate", cause: error })).catch(() => undefined);
    }
    if (prepared !== undefined) {
      await recoverEnvironmentAfterFailure({
        services,
        facts,
        save,
        prepared,
        ...(input.fixtureHooks?.afterReset === undefined
          ? {}
          : { afterReset: input.fixtureHooks.afterReset }),
      });
    }
    const cancelled = input.signal?.aborted === true;
    const exitCode = cancelled ? 130 : error instanceof WorkflowStop ? error.exitCode : 4;
    const status = cancelled ? "CANCELLED" : error instanceof WorkflowStop ? error.status : "FAILED";
    const activeStep =
      facts.timeline.find((step) => step.status === "RUNNING") ??
      (reportPhase === "NOT_STARTED" ? undefined : facts.timeline[9]);
    if (activeStep !== undefined) replaceStep(facts, activeStep.number, { status: "FAILED", endedAt: new Date().toISOString(), failureGroups: uniqueGroups(facts.failures) });
    if (facts.run !== undefined && !["FINISHED", "FAILED", "CANCELLED"].includes(facts.run.state)) {
      try {
        const terminal = cancelled ? "CANCELLED" as const : "FAILED" as const;
        facts.run = await save.transition(transitionRuntimeProjection({ projection: facts.run, toState: terminal, reasonCode: cancelled ? "USER_CANCELLED" : "WORKFLOW_FAILED", occurredAt: new Date().toISOString(), failureRefs: facts.failures.map((failure) => refForImmutable(failure, failure.failureId)), patch: { operationalHealth: "FAILED", ...(facts.environment === undefined ? {} : { environmentFinalState: facts.environment.state }) } }));
      } catch {
        // The prior committed projection and FailureRecords remain authoritative.
      }
    }
    if (
      reportPhase === "NOT_STARTED" &&
      facts.gate === undefined &&
      facts.run !== undefined &&
      facts.timeline[9]?.status === "PENDING"
    ) {
      replaceStep(facts, 10, {
        status: "BLOCKED",
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        objectRefs: [`${facts.run.schema}:${facts.run.runId}@${facts.run.revision}`],
        failureGroups: uniqueGroups(facts.failures),
        hintCode: gateAbsenceReason(facts),
      });
    }
    await updateStatus(services, facts, status, save.failure);
    let diagnosticReport: DeliveredReport | undefined;
    if (reportPhase === "NOT_STARTED" && hasReportGraph(facts)) {
      try {
        diagnosticReport = await persistAndDeliverReport({
          services,
          facts,
          save,
          runId,
          phase: status,
          setReportPhase: (phase) => {
            reportPhase = phase;
          },
          ...(input.fixtureHooks?.beforeReportHtml === undefined
            ? {}
            : { beforeReportHtml: input.fixtureHooks.beforeReportHtml }),
        });
      } catch (reportError) {
        const scope = facts.attempt?.scope ?? facts.run!.scope;
        await save.failure(makeFailure(
          scope,
          "REPORT_FAILURE",
          "DSHEVAL",
          (reportPhase as ReportPhase) === "EXPORT" ? "EXPORTER" : "REPORTER",
          reportPhase,
          `${reportPhase}_DELIVERY_FAILED`,
          "Diagnostic report delivery failed",
        )).catch(() => undefined);
        await updateStatus(services, facts, status, save.failure);
        void reportError;
      }
    }
    if (lease !== undefined && !leaseReleased) {
      try {
        const released = await releaseLease(services.config.runRoot, lease);
        leaseReleased = true;
        if (facts.run !== undefined) await save.lease(released, facts.run.scope, "RELEASED");
      } catch (releaseError) {
        const scope = facts.run?.scope ?? facts.target?.scope ?? { targetId: input.descriptor.targetId };
        await save.failure(makeFailure(
          scope,
          "PERSISTENCE_FAILURE",
          "DSHEVAL",
          "PLATFORM",
          "LEASE_RELEASE",
          "LEASE_RELEASE_FAILED",
          "DSHEval could not release and persist ownership of the active Run lease",
        )).catch(() => undefined);
        void releaseError;
      }
    }
    return {
      ...summary(facts, runId, fixtureMode, exitCode, status, services.config.runRoot),
      ...(diagnosticReport ?? {}),
    };
  } finally {
    if (lease !== undefined && !leaseReleased) {
      try {
        const released = await releaseLease(services.config.runRoot, lease);
        if (facts.run !== undefined) await save.lease(released, facts.run.scope, "RELEASED");
      } catch {
        // A mismatched lease is intentionally not stolen or unlinked.
      }
    }
  }
}

type ReportPhase = "NOT_STARTED" | "JSON" | "HTML" | "EXPORT";

interface DeliveredReport {
  readonly reportJson: string;
  readonly reportHtml: string;
  readonly delivery: string;
}

function hasReportGraph(facts: MutableWorkflowFacts): boolean {
  return facts.run !== undefined &&
    facts.evaluationCase !== undefined &&
    facts.attempt !== undefined &&
    facts.target !== undefined &&
    facts.evaluationPlan !== undefined &&
    facts.observationPlan !== undefined;
}

async function persistAndDeliverReport(input: {
  readonly services: ApplicationServices;
  readonly facts: MutableWorkflowFacts;
  readonly save: ReturnType<typeof createPersistence>;
  readonly runId: string;
  readonly phase: string;
  readonly setReportPhase: (phase: Exclude<ReportPhase, "NOT_STARTED">) => void;
  readonly beforeReportHtml?: () => Promise<void>;
}): Promise<DeliveredReport> {
  input.setReportPhase("JSON");
  const report = buildFinalReport(input.facts);
  const view = buildView(input.facts, input.phase);
  const document = buildReportDocument(
    report,
    view,
    input.services.config.rendererVersion,
  );
  await input.save.immutable(document, document.reportId);
  const reportJsonBytes = Buffer.from(serializeReportDocument(document), "utf8");
  assertSecretFreeBytes(reportJsonBytes, input.services.config, "report.json");
  const jsonCommit = await commitReportJson({
    reportRoot: input.services.config.reportRoot,
    runId: input.runId,
    bytes: reportJsonBytes,
    maxBytes: input.services.config.maxArtifactBytes,
  });
  const verifiedJson = await readCommittedReportJson({
    reportRoot: input.services.config.reportRoot,
    runId: input.runId,
    maxBytes: input.services.config.maxArtifactBytes,
  });
  const verifiedDocument = parseVerifiedReportDocument(verifiedJson.toString("utf8"));
  input.setReportPhase("HTML");
  await input.beforeReportHtml?.();
  const reportHtmlBytes = Buffer.from(renderReportHtml(verifiedDocument), "utf8");
  assertSecretFreeBytes(reportHtmlBytes, input.services.config, "report.html");
  const htmlCommit = await commitReportHtml({
    reportRoot: input.services.config.reportRoot,
    runId: input.runId,
    bytes: reportHtmlBytes,
    maxBytes: input.services.config.maxArtifactBytes,
  });
  input.setReportPhase("EXPORT");
  const delivery = await exportReport({
    reportRoot: input.services.config.reportRoot,
    runId: input.runId,
    exportId: `export.${input.runId}`,
    maxBytes: input.services.config.maxArtifactBytes,
  });
  return {
    reportJson: jsonCommit.path,
    reportHtml: htmlCommit.path,
    delivery: delivery.directory,
  };
}

async function recoverEnvironmentAfterFailure(input: {
  readonly services: ApplicationServices;
  readonly facts: MutableWorkflowFacts;
  readonly save: ReturnType<typeof createPersistence>;
  readonly prepared: PreparedEnvironment;
  readonly afterReset?: (workspacePath: string) => Promise<void>;
}): Promise<void> {
  const { services, facts, save, prepared } = input;
  const environment = facts.environment;
  if (
    environment === undefined ||
    ["CLEANED", "QUARANTINED", "CLEANUP_FAILED"].includes(environment.state)
  ) {
    return;
  }
  const scope = environment.scope;
  const runId = String(scope.runId);
  const caseId = String(scope.caseId);
  const attemptId = String(scope.attemptId);
  const quarantine = async (reasonCode: string, message: string): Promise<void> => {
    const failureRef = await save.failure(makeFailure(
      scope,
      "CLEANUP_FAILURE",
      "ENVIRONMENT",
      "ENVIRONMENT_CONTROLLER",
      "SAFE_CLOSE",
      reasonCode,
      message,
    ));
    if (
      facts.environment !== undefined &&
      !["CLEANED", "QUARANTINED", "CLEANUP_FAILED"].includes(facts.environment.state)
    ) {
      facts.environment = await save.transition(transitionRuntimeProjection({
        projection: facts.environment,
        toState: "QUARANTINED",
        reasonCode,
        occurredAt: new Date().toISOString(),
        failureRefs: [failureRef],
      }));
    }
  };

  let recoveryPhase: "RESET" | "RESET_VERIFY" | "CLEANUP" = "RESET";
  try {
    if (environment.state === "VERIFIED") {
      recoveryPhase = "CLEANUP";
      await cleanupEnvironment({
        workspaceRoot: services.config.workspaceRoot,
        workspacePath: prepared.workspacePath,
      });
      await cleanupRuntimeDshHome({
        runtimeDshHomeRoot: services.config.runtimeDshHomeRoot,
        runtimeDshHomePath: prepared.runtimeDshHomePath,
        runId,
        caseId,
        attemptId,
      });
      facts.environment = await save.transition(transitionRuntimeProjection({
        projection: facts.environment!,
        toState: "CLEANED",
        reasonCode: "SAFE_CLOSE_CLEANED",
        occurredAt: new Date().toISOString(),
      }));
      await save.control(scope, "ENV_CLEANUP", "SUCCEEDED");
      return;
    }

    if (facts.resetVerification !== undefined) {
      if (environment.state !== "RESETTING") {
        await quarantine(
          "SAFE_CLOSE_VERIFICATION_STATE_MISMATCH",
          "A committed ResetVerification did not match the current Environment lifecycle state",
        );
        return;
      }
      const verificationRef = refForImmutable(
        facts.resetVerification,
        facts.resetVerification.verificationId,
      );
      if (facts.resetVerification.result !== "MATCH") {
        await quarantine(
          facts.resetVerification.result === "MISMATCH" ? "RESET_MISMATCH" : "RESET_UNAVAILABLE",
          "The committed ResetVerification did not establish a clean environment",
        );
        return;
      }
      facts.environment = await save.transition(transitionRuntimeProjection({
        projection: facts.environment!,
        toState: "VERIFIED",
        reasonCode: "SAFE_CLOSE_EXISTING_RESET_VERIFIED",
        occurredAt: new Date().toISOString(),
        supportingRefs: [verificationRef],
        patch: { resetGeneration: facts.resetVerification.resetGeneration },
      }));
      recoveryPhase = "CLEANUP";
      await cleanupEnvironment({
        workspaceRoot: services.config.workspaceRoot,
        workspacePath: prepared.workspacePath,
      });
      await cleanupRuntimeDshHome({
        runtimeDshHomeRoot: services.config.runtimeDshHomeRoot,
        runtimeDshHomePath: prepared.runtimeDshHomePath,
        runId,
        caseId,
        attemptId,
      });
      facts.environment = await save.transition(transitionRuntimeProjection({
        projection: facts.environment,
        toState: "CLEANED",
        reasonCode: "SAFE_CLOSE_CLEANED",
        occurredAt: new Date().toISOString(),
      }));
      await save.control(scope, "ENV_CLEANUP", "SUCCEEDED");
      return;
    }

    if (environment.state === "CREATED" || environment.state === "PREPARED") {
      recoveryPhase = "RESET";
      await resetEnvironment({
        workspaceRoot: services.config.workspaceRoot,
        workspacePath: prepared.workspacePath,
        resetGeneration: environment.resetGeneration,
      });
      recoveryPhase = "CLEANUP";
      await cleanupEnvironment({
        workspaceRoot: services.config.workspaceRoot,
        workspacePath: prepared.workspacePath,
      });
      await cleanupRuntimeDshHome({
        runtimeDshHomeRoot: services.config.runtimeDshHomeRoot,
        runtimeDshHomePath: prepared.runtimeDshHomePath,
        runId,
        caseId,
        attemptId,
      });
      await quarantine(
        "SAFE_CLOSE_BEFORE_SEED_VERIFICATION",
        "The pre-seed environment was removed, but its lifecycle cannot claim a post-seed Reset Verification",
      );
      return;
    }

    if (environment.state !== "SEEDED" && environment.state !== "IN_USE" && environment.state !== "RESETTING") {
      await quarantine("SAFE_CLOSE_STATE_UNSUPPORTED", "The failed environment could not enter a verified cleanup path");
      return;
    }

    recoveryPhase = "RESET";
    const reset = await resetEnvironment({
      workspaceRoot: services.config.workspaceRoot,
      workspacePath: prepared.workspacePath,
      resetGeneration: environment.resetGeneration,
    });
    if (facts.environment!.state !== "RESETTING") {
      facts.environment = await save.transition(transitionRuntimeProjection({
        projection: facts.environment!,
        toState: "RESETTING",
        reasonCode: "SAFE_CLOSE_RESET_COMPLETED",
        occurredAt: new Date().toISOString(),
        patch: { resetGeneration: reset.resetGeneration },
      }));
    }
    await save.control(scope, "ENV_RESET", "SUCCEEDED");
    recoveryPhase = "RESET_VERIFY";
    await input.afterReset?.(prepared.workspacePath);

    const observationPlan = facts.observationPlan;
    const fileSource = facts.sources.find((source) => source.sourceType === "FILESYSTEM");
    const fileRequirement = observationPlan?.sourceRequirements.find(
      (requirement) => requirement.sourceType === "FILESYSTEM",
    );
    if (observationPlan === undefined || fileSource === undefined || fileRequirement === undefined) {
      throw new Error("safe close lacks the frozen File observation binding");
    }
    const captureEnvironment = {
      ...facts.environment!,
      resetGeneration: reset.resetGeneration,
    } as EnvironmentInstance & { readonly state: "RESETTING" };
    const binding = await issueObserverBinding({
      environmentInstanceId: captureEnvironment.environmentInstanceId,
      resetGeneration: reset.resetGeneration,
      sourceRequirementId: String(fileRequirement.sourceRequirementId),
      resourceBinding: fileRequirement.resourceBinding,
      sensorImplementationId: String(fileRequirement.sensorImplementationId),
      sensorImplementationVersion: fileRequirement.sensorImplementationVersion,
      sensorCapabilityDigest: fileRequirement.sensorCapabilityDigest,
      expiresAt: new Date(Date.now() + services.config.stableMaxWaitMs + 5_000).toISOString(),
      workspacePath: prepared.workspacePath,
    });
    const expectedCleanDigest = emptyWorkspaceManifestDigest(fileRequirement.resourceBinding);
    const request = {
      kind: "POST_RESET" as const,
      observationPlan,
      environment: captureEnvironment,
      resetGeneration: reset.resetGeneration,
      expectedCleanDigest,
      preparedBindings: [binding.binding],
      sensorRegistryDigest: FILE_SENSOR_REGISTRY_DIGEST,
    };
    const recoveryKey = digestValue({ attemptId, resetGeneration: reset.resetGeneration }).value.slice(0, 16);
    const sensor = services.fileSensor;
    const postResetDraft = (await sensor.verifyReset({
      request,
      sourceRequirementId: String(fileRequirement.sourceRequirementId),
      expectedSensorRegistryDigest: FILE_SENSOR_REGISTRY_DIGEST,
      rootPath: binding.workspacePath,
      snapshotId: `snapshot.recovery.${recoveryKey}`,
      attemptId,
      maxFileBytes: services.config.maxArtifactBytes,
    })).snapshot;
    const postReset = materializeFileSnapshot(postResetDraft, recordMetadata(scope));
    const postResetRef = await save.immutable(postReset, postReset.snapshotId);
    const postResetArtifact = await save.artifact(
      serializeFileSnapshotArtifact(postReset),
      scope,
      `raw-file-recovery.${recoveryKey}`,
      "FILE_SNAPSHOT_RAW",
      "file-post-reset-recovery.json",
      "application/json",
      "RESTRICTED",
    );
    const fileSourceRef = refForImmutable(fileSource, fileSource.sourceId);
    const postResetRaw = materializeFileObservation({
      observationId: `raw.file.recovery.${recoveryKey}`,
      scope,
      snapshot: postReset,
      snapshotRef: postResetRef,
      sourceRef: fileSourceRef,
      snapshotArtifact: postResetArtifact,
      snapshotArtifactRef: refForArtifact(postResetArtifact),
      createdAt: new Date().toISOString(),
      producerVersion: DSHEVAL_VERSION,
    });
    await save.immutable(postResetRaw, postResetRaw.observationId);
    const collectionFailureRefs = await save.failures(fileCollectionFailureDrafts({
      scope,
      snapshots: [postReset],
      requiredPhases: ["POST_RESET"],
      stableWindowComplete: true,
      occurredAt: new Date().toISOString(),
      artifactRefs: [refForArtifact(postResetArtifact)],
    }));
    const collectionStatus = materializeFileCollectionStatus({
      collectionStatusId: `collection.recovery.${recoveryKey}`,
      scope,
      sourceRef: fileSourceRef,
      snapshots: [postReset],
      openedAt: postReset.scanStartedAt,
      closedAt: postReset.scanCompletedAt,
      requiredPhases: ["POST_RESET"],
      stableWindowComplete: true,
      failureRefs: collectionFailureRefs,
      createdAt: new Date().toISOString(),
      producerVersion: DSHEVAL_VERSION,
    });
    const collectionStatusRef = await save.immutable(
      collectionStatus,
      collectionStatus.collectionStatusId,
    );
    const verification = materializeResetVerification(
      verifyResetSnapshot({
        verificationId: `reset-recovery.${recoveryKey}`,
        environmentInstanceRef: refForProjection(facts.environment!),
        resetGeneration: reset.resetGeneration,
        expectedCleanDigest,
        postResetSnapshot: postResetDraft,
        postResetSnapshotRef: postResetRef,
        collectionStatusRef,
      }),
      recordMetadata(scope),
    );
    const verificationRef = await save.immutable(verification, verification.verificationId);
    facts.resetVerification = verification;
    facts.rawObservations.push(postResetRaw);
    facts.fileSnapshots.push(postReset);
    facts.collectionStatuses.push(collectionStatus);
    if (verification.result !== "MATCH") {
      await quarantine(
        verification.result === "MISMATCH" ? "RESET_MISMATCH" : "RESET_UNAVAILABLE",
        "Independent safe-close verification did not confirm a clean environment",
      );
      return;
    }
    facts.environment = await save.transition(transitionRuntimeProjection({
      projection: facts.environment!,
      toState: "VERIFIED",
      reasonCode: "SAFE_CLOSE_RESET_VERIFIED",
      occurredAt: new Date().toISOString(),
      supportingRefs: [verificationRef],
      patch: { resetGeneration: reset.resetGeneration },
    }));
    recoveryPhase = "CLEANUP";
    await cleanupEnvironment({
      workspaceRoot: services.config.workspaceRoot,
      workspacePath: prepared.workspacePath,
    });
    await cleanupRuntimeDshHome({
      runtimeDshHomeRoot: services.config.runtimeDshHomeRoot,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      runId,
      caseId,
      attemptId,
    });
    facts.environment = await save.transition(transitionRuntimeProjection({
      projection: facts.environment,
      toState: "CLEANED",
      reasonCode: "SAFE_CLOSE_CLEANED",
      occurredAt: new Date().toISOString(),
    }));
    await save.control(scope, "ENV_CLEANUP", "SUCCEEDED");
  } catch (error) {
    try {
      const details = recoveryPhase === "RESET"
        ? {
            category: "ENVIRONMENT_FAILURE" as const,
            actor: "ENVIRONMENT_CONTROLLER" as const,
            reasonCode: "SAFE_CLOSE_RESET_FAILED",
            message: "Failed-run Environment Reset did not complete",
          }
        : recoveryPhase === "RESET_VERIFY"
          ? {
              category: "OBSERVATION_FAILURE" as const,
              actor: "COLLECTOR" as const,
              reasonCode: "SAFE_CLOSE_RESET_VERIFICATION_FAILED",
              message: "Failed-run post-reset observation did not complete",
            }
          : {
              category: "CLEANUP_FAILURE" as const,
              actor: "ENVIRONMENT_CONTROLLER" as const,
              reasonCode: "SAFE_CLOSE_CLEANUP_FAILED",
              message: "Failed-run Environment cleanup did not complete",
            };
      const failureRef = await save.failure(makeFailure(
        scope,
        details.category,
        recoveryPhase === "RESET_VERIFY" ? "DSHEVAL" : "ENVIRONMENT",
        details.actor,
        recoveryPhase,
        details.reasonCode,
        details.message,
      ));
      if (recoveryPhase === "RESET") {
        await save.control(scope, "ENV_RESET", "FAILED", { failureRefs: [failureRef] });
      } else if (recoveryPhase === "CLEANUP") {
        await save.control(scope, "ENV_CLEANUP", "FAILED", { failureRefs: [failureRef] });
      }
      if (
        facts.environment !== undefined &&
        !["CLEANED", "QUARANTINED", "CLEANUP_FAILED"].includes(facts.environment.state)
      ) {
        facts.environment = await save.transition(transitionRuntimeProjection({
          projection: facts.environment,
          toState: "QUARANTINED",
          reasonCode: details.reasonCode,
          occurredAt: new Date().toISOString(),
          failureRefs: [failureRef],
        }));
      }
      void error;
    } catch {
      // The original failure and last committed Environment projection remain authoritative.
    }
  }
}

function createPersistence(services: ApplicationServices, facts: MutableWorkflowFacts) {
  let failureCounter = 0;
  const immutable = async <T extends object>(record: T, id: string): Promise<Ref<T>> => {
      assertSecretFreeValue(record, services.config, "immutable record");
      return requireSucceeded(`persist ${String((record as { schema?: string }).schema ?? "record")}`, await services.repository.putImmutable(services.operation("STORAGE", `put-${id}`), record)) as Ref<T>;
    };
  const projection = async <T extends EvaluationRun | EvaluationCase | ExecutionAttempt | EnvironmentInstance | ObservationSession>(record: T): Promise<Ref<T> & { revision: 0 }> => {
      assertSecretFreeValue(record, services.config, "lifecycle projection");
      return requireSucceeded(`create ${record.schema}`, await services.repository.createProjection(services.operation("STORAGE", `create-${record.aggregateId}`), record)) as Ref<T> & { revision: 0 };
    };
  const transition = async <T extends EvaluationRun | EvaluationCase | ExecutionAttempt | EnvironmentInstance | ObservationSession>(transitionValue: Parameters<ApplicationServices["repository"]["appendTransition"]>[1]): Promise<T> => {
      assertSecretFreeValue(transitionValue, services.config, "lifecycle transition");
      requireSucceeded("append lifecycle transition", await services.repository.appendTransition(services.operation("STORAGE", `transition-${transitionValue.nextProjection.aggregateId}-${transitionValue.nextProjection.revision}`), transitionValue));
      return transitionValue.nextProjection as T;
    };
  const failure = async (draft: FailureDraft): Promise<Ref<FailureRecord>> => {
      failureCounter += 1;
      const record = commitFailureDraft(draft, `failure.${String(facts.run?.runId ?? "planning")}.${failureCounter}`, DSHEVAL_VERSION);
      assertSecretFreeValue(record, services.config, "FailureRecord");
      const ref = requireSucceeded("persist FailureRecord", await services.repository.putImmutable(services.operation("STORAGE", `failure-${failureCounter}`), record)) as Ref<FailureRecord>;
      facts.failures.push(record);
      return ref;
    };
  const failures = async (drafts: readonly FailureDraft[]): Promise<readonly Ref<FailureRecord>[]> => {
      const refs: Ref<FailureRecord>[] = [];
      for (const draft of drafts) refs.push(await failure(draft));
      return refs;
    };
  const artifact = async (
    bytes: Uint8Array | string,
    scope: ScopeRef,
    artifactId: string,
    artifactType: string,
    logicalName: string,
    mediaType: string,
    sensitivity: "EXPORTABLE" | "RESTRICTED",
    redactionState: "NOT_REQUIRED" | "APPLIED" | "FAILED" = "NOT_REQUIRED",
  ): Promise<ArtifactRef> => {
      const canaries = services.config.secretRefNames
        .map((name) => process.env[name])
        .filter((value): value is string => value !== undefined);
      const leaks = findSecretLeaks(
        typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes,
        canaries,
      );
      if (
        leaks.length > 0 &&
        !(sensitivity === "RESTRICTED" && redactionState === "FAILED")
      ) {
        throw new Error("Artifact matched a configured Secret canary without failed-redaction isolation");
      }
      const committed = requireSucceeded(`commit artifact ${artifactId}`, await services.artifacts.commit(services.operation("STORAGE", `artifact-${artifactId}`), bytes, { artifactId: validateStableId<"ArtifactId">(artifactId), scope, artifactType, logicalName, mediaType, producerVersion: DSHEVAL_VERSION, createdAt: new Date().toISOString() as IsoDateTime, sensitivity, redactionState }));
      facts.artifacts.push(committed);
      return committed;
    };
  const outputArtifact = async (bytes: Uint8Array, scope: ScopeRef, artifactId: string, logicalName: string, config: ConfigSnapshot): Promise<ArtifactRef> => {
      const canaries = config.secretRefNames.map((name) => process.env[name]).filter((value): value is string => value !== undefined);
      const leaks = findSecretLeaks(bytes, canaries);
      const committed = await artifact(
        bytes,
        scope,
        artifactId,
        "TARGET_OUTPUT",
        logicalName,
        "text/plain; charset=utf-8",
        leaks.length === 0 ? "EXPORTABLE" : "RESTRICTED",
        leaks.length === 0 ? "NOT_REQUIRED" : "FAILED",
      );
      if (leaks.length > 0) {
        await failure({
          ...makeFailure(
            scope,
            "TARGET_SECURITY_VIOLATION",
            "TARGET",
            "TARGET",
            "TARGET_OUTPUT",
            "SECRET_CANARY_EXPOSED",
            "Target output contained a configured secret canary and was restricted",
          ),
          artifactRefs: [refForArtifact(committed)],
        });
      }
      return committed;
    };
  const control = async (
    scope: ScopeRef,
    operation: ControlEvent["operation"],
    result: ControlEvent["result"],
    options: {
      readonly startedAt?: IsoDateTime;
      readonly failureRefs?: readonly Ref<FailureRecord>[];
      /** Used only to make otherwise simultaneous receipts uniquely identifiable. */
      readonly identityRefs?: readonly Ref[];
    } = {},
  ): Promise<Ref<ControlEvent>> => {
      const endedAt = new Date().toISOString() as IsoDateTime;
      const startedAt = options.startedAt ?? endedAt;
      const failureRefs = options.failureRefs ?? [];
      const identityRefs = options.identityRefs ?? [];
      const event = withContentDigest({ schema: "dsheval.mvp.control-event/v1" as const, controlEventId: validateStableId<"ControlEventId">(`control.${String(scope.attemptId ?? scope.runId)}.${operation.toLowerCase()}.${digestValue({ startedAt, endedAt, identityRefs, failureRefs }).value.slice(0, 8)}`), scope, operation, startedAt, endedAt, result, failureRefs, createdAt: endedAt, producerVersion: DSHEVAL_VERSION });
      assertSecretFreeValue(event, services.config, "ControlEvent");
      return requireSucceeded("persist ControlEvent", await services.repository.putImmutable(services.operation("STORAGE", `control-${event.controlEventId}`), event)) as Ref<ControlEvent>;
    };
  const lease = async (leaseFact: LeaseFact, scope: ScopeRef, state: "ACTIVE" | "RELEASED"): Promise<void> => {
      const record = withContentDigest({ schema: "dsheval.mvp.lease/v1" as const, leaseId: validateStableId<"LeaseId">(`lease.${String(scope.runId)}.${state.toLowerCase()}`), scope, runId: scope.runId!, slotId: "vm-global" as const, state, ownerPid: leaseFact.ownerPid, ownerProcessStartToken: leaseFact.ownerProcessStartToken, acquiredAt: leaseFact.acquiredAt, ...(leaseFact.releasedAt === undefined ? {} : { releasedAt: leaseFact.releasedAt }), createdAt: state === "ACTIVE" ? leaseFact.acquiredAt : leaseFact.releasedAt!, producerVersion: DSHEVAL_VERSION });
      assertSecretFreeValue(record, services.config, "LeaseRecord");
      requireSucceeded("persist LeaseRecord", await services.repository.putImmutable(services.operation("STORAGE", `lease-${state}`), record));
    };
  return {
    immutable,
    projection,
    transition,
    failure,
    failures,
    artifact,
    outputArtifact,
    control,
    lease,
  };
}

function seedSpecs(plan: EvaluationPlan): readonly SeedEntrySpec[] {
  const seed = plan.casePlan.seedSpec as Record<string, unknown>;
  if (!Array.isArray(seed.entries)) throw new Error("frozen seedSpec.entries is missing");
  return seed.entries.map((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("seed entry is invalid");
    const entry = value as Record<string, unknown>;
    return {
      portablePath: String(entry.portablePath),
      entryType: entry.entryType as "DIRECTORY" | "FILE",
      mode: String(entry.mode),
      readOnlyForTarget: entry.readOnlyForTarget === true,
      ...(entry.content === undefined ? {} : { content: String(entry.content) }),
      ...(entry.encoding === undefined ? {} : { encoding: entry.encoding as "utf8" }),
    };
  });
}

function recordMetadata(scope: ScopeRef): { scope: ScopeRef; createdAt: string; producerVersion: string } {
  return { scope, createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION };
}

async function captureStableAfter(
  sensor: EnvironmentSensor,
  input: Omit<Parameters<EnvironmentSensor["captureAfter"]>[0], "snapshotId"> & {
    readonly stableWindowMs: number;
    readonly stableMaxWaitMs: number;
  },
): Promise<{ snapshot: FileSnapshotDraft; stable: boolean }> {
  const started = Date.now();
  let prior = (await sensor.captureAfter({ ...input, snapshotId: `snapshot.stability.${input.attemptId}.0` })).snapshot;
  let ordinal = 1;
  while (Date.now() - started <= input.stableMaxWaitMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, input.stableWindowMs));
    const current = (await sensor.captureAfter({ ...input, snapshotId: `snapshot.after.${input.attemptId}` })).snapshot;
    if (prior.snapshotDigest.value === current.snapshotDigest.value && prior.snapshotDigest.byteLength === current.snapshotDigest.byteLength) return { snapshot: current, stable: true };
    prior = current;
    ordinal += 1;
  }
  return { snapshot: { ...prior, snapshotId: `snapshot.after.${input.attemptId}` }, stable: false };
}

function attemptTerminalState(result: TargetExecutionResult): "SUCCEEDED" | "TARGET_FAILED" | "TIMED_OUT" | "HARNESS_ERROR" | "CANCELLED" {
  if (result.terminationKind === "EXITED") return "SUCCEEDED";
  return result.terminationKind;
}

function targetFailure(result: TargetExecutionResult, scope: ScopeRef): FailureDraft {
  return makeFailure(scope, result.terminationKind === "TIMED_OUT" ? "TIMEOUT" : result.terminationKind === "CANCELLED" ? "CANCELLED" : "TARGET_EXECUTION", result.terminationKind === "HARNESS_ERROR" ? "DSHEVAL" : result.terminationKind === "CANCELLED" ? "USER" : "TARGET", result.terminationKind === "HARNESS_ERROR" ? "RUNTIME" : result.terminationKind === "CANCELLED" ? "USER" : "TARGET", "TARGET_EXECUTION", `TARGET_${result.terminationKind}`, "Target execution ended without a successful process exit");
}

function makeFailure(scope: ScopeRef, category: FailureDraft["category"], origin: FailureDraft["origin"], actor: FailureDraft["actor"], phase: string, reasonCode: string, messageRedacted: string): FailureDraft {
  return { scope, category, origin, actor, phase, severity: category === "TARGET_SECURITY_VIOLATION" ? "CRITICAL" : "ERROR", retryable: false, messageRedacted, reasonCode, evidenceRefs: [], artifactRefs: [], occurredAt: new Date().toISOString() as IsoDateTime };
}

function requireFullArtifact(index: ReadonlyMap<string, ArtifactRef>, ref: Ref<ArtifactRef>): ArtifactRef {
  const artifact = index.get(String(ref.id));
  if (artifact === undefined || artifact.contentDigest.value !== ref.digest.value) throw new Error("committed ArtifactRef metadata is unavailable or mismatched");
  return artifact;
}

function markStep(facts: MutableWorkflowFacts, number: WorkflowStepView["number"], status: WorkflowStepView["status"], refs: readonly Ref[] = []): void {
  const current = facts.timeline[number - 1]!;
  replaceStep(facts, number, { status, ...(status === "RUNNING" ? { startedAt: new Date().toISOString() } : { startedAt: current.startedAt ?? new Date().toISOString(), endedAt: new Date().toISOString() }), objectRefs: refs.map((ref) => `${ref.schema}:${ref.id}${ref.revision === undefined ? "" : `@${ref.revision}`}`), failureGroups: uniqueGroups(facts.failures) });
}

function replaceStep(facts: MutableWorkflowFacts, number: WorkflowStepView["number"], patch: Partial<WorkflowStepView>): void {
  const index = number - 1;
  facts.timeline[index] = { ...facts.timeline[index]!, ...patch };
}

function uniqueGroups(failures: readonly FailureRecord[]): readonly string[] {
  return [...new Set(failures.map(failureDisplayGroup))].sort();
}

async function updateStatus(
  services: ApplicationServices,
  facts: MutableWorkflowFacts,
  phase: string,
  recordFailure: (draft: FailureDraft) => Promise<Ref<FailureRecord>>,
): Promise<void> {
  if (facts.run === undefined || facts.attempt === undefined || facts.target === undefined) return;
  try {
    const html = renderStatusHtml(buildView(facts, phase), services.config.rendererVersion);
    assertSecretFreeBytes(Buffer.from(html, "utf8"), services.config, "status.html");
    requireSucceeded(
      "replace status.html",
      await services.artifacts.replaceStatusHtml(
        services.operation("REPORTER", `status-${phase}`),
        html,
      ),
    );
  } catch (error) {
    await recordFailure(makeFailure(
      facts.attempt.scope,
      "REPORT_FAILURE",
      "DSHEVAL",
      "REPORTER",
      "STATUS_HTML",
      "STATUS_HTML_UPDATE_FAILED",
      "The non-authoritative status page could not be replaced; the prior committed page remains authoritative for diagnostics",
    )).catch(() => undefined);
    void error;
  }
}

function assertSecretFreeValue(value: unknown, config: ConfigSnapshot, label: string): void {
  assertSecretFreeBytes(Buffer.from(JSON.stringify(value), "utf8"), config, label);
}

function assertSecretFreeBytes(
  bytes: Uint8Array | string,
  config: ConfigSnapshot,
  label: string,
): void {
  const canaries = config.secretRefNames
    .map((name) => process.env[name])
    .filter((value): value is string => value !== undefined);
  if (findSecretLeaks(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes, canaries).length > 0) {
    throw new Error(`${label} matched a configured Secret canary and was not published`);
  }
}

function buildView(facts: MutableWorkflowFacts, phase: string): ReportViewModel {
  const sourceStatuses = facts.sources.flatMap((source) => {
    const status = [...facts.collectionStatuses]
      .reverse()
      .find((candidate) =>
        candidate.sourceRef.id === source.sourceId &&
        !String(candidate.collectionStatusId).includes(".reset.") &&
        !String(candidate.collectionStatusId).includes(".recovery."),
      );
    return status === undefined ? [] : [status];
  });
  return buildReportViewModel({ run: facts.run!, target: facts.target!, attempt: facts.attempt!, fixture: facts.fixture, securityIsolation: facts.securityIsolation ?? "NOT_VERIFIED", sources: facts.sources, collectionStatuses: sourceStatuses, closures: facts.closures, judgements: facts.judgements, checkResults: facts.checkResults, evidence: facts.evidence, rawObservations: facts.rawObservations, fileSnapshots: facts.fileSnapshots, fileDiffs: facts.fileDiffs, findings: facts.findings, ...(facts.gate === undefined ? { gateAbsenceReason: gateAbsenceReason(facts) } : { gate: facts.gate }), ...(facts.resetVerification === undefined ? {} : { resetVerification: facts.resetVerification }), environmentState: facts.environment?.state ?? "NOT_CREATED", failures: facts.failures, artifacts: facts.artifacts, timeline: facts.timeline, currentPhase: phase });
}

function gateAbsenceReason(facts: MutableWorkflowFacts): string {
  if (facts.checkResults.length === 3) return "GATE_FINALIZATION_NOT_COMMITTED";
  const causalFailure = facts.failures.find(
    (failure) => failure.category !== "CLEANUP_FAILURE",
  );
  return causalFailure?.reasonCode ?? facts.failures.at(-1)?.reasonCode ?? "CHECK_RESULTS_NOT_COMMITTED";
}

function buildFinalReport(facts: MutableWorkflowFacts): EvaluationReport {
  return buildEvaluationReport({ reportId: `report.${String(facts.run!.runId)}`, scope: facts.run!.scope, runRef: refForProjection(facts.run!), targetSnapshotRef: refForImmutable(facts.target!, facts.target!.targetSnapshotId), planRefs: [refForImmutable(facts.evaluationPlan!, facts.evaluationPlan!.evaluationPlanId), refForImmutable(facts.observationPlan!, facts.observationPlan!.observationPlanId)], caseRef: refForProjection(facts.evaluationCase!), attemptRef: refForProjection(facts.attempt!), sourceRefs: facts.sources.map((source) => refForImmutable(source, source.sourceId)), collectionStatusRefs: facts.collectionStatuses.map((status) => refForImmutable(status, status.collectionStatusId)), closureRefs: facts.closures.map((closure) => refForImmutable(closure, closure.closureId)), judgementRefs: facts.judgements.map((judgement) => refForImmutable(judgement, judgement.judgementId)), checkResultRefs: facts.checkResults.map((result) => refForImmutable(result, result.checkResultId)), ...(facts.gate === undefined ? {} : { gateDecisionRef: refForImmutable(facts.gate, facts.gate.gateDecisionId) }), ...(facts.resetVerification === undefined ? {} : { resetVerificationRef: refForImmutable(facts.resetVerification, facts.resetVerification.verificationId) }), failureRefs: facts.failures.map((failure) => refForImmutable(failure, failure.failureId)), operationalHealth: facts.run!.operationalHealth, artifactRefs: facts.artifacts.map(refForArtifact), createdAt: new Date().toISOString(), producerVersion: DSHEVAL_VERSION });
}

function summary(
  facts: MutableWorkflowFacts,
  runId: string,
  fixture: boolean,
  exitCode: WorkflowSummary["exitCode"],
  status: WorkflowSummary["status"],
  runRoot: string,
  command: WorkflowSummary["command"] = "run",
): WorkflowSummary {
  return {
    schema: "dsheval.mvp.cli-summary/v1",
    command,
    status,
    runId,
    ...(facts.run === undefined ? {} : { runState: facts.run.state, operationalHealth: facts.run.operationalHealth }),
    ...(facts.gate === undefined ? {} : { gate: facts.gate.verdict }),
    fixture,
    ...(facts.securityIsolation === undefined ? {} : { securityIsolation: facts.securityIsolation }),
    failureGroups: uniqueGroups(facts.failures),
    reasonCodes: [...new Set(facts.failures.map((failure) => failure.reasonCode))].sort(),
    ...(facts.target === undefined ? {} : { targetSnapshotId: String(facts.target.targetSnapshotId) }),
    ...(facts.inspection === undefined ? {} : { inspectionId: String(facts.inspection.inspectionId) }),
    ...(facts.evaluationPlan === undefined ? {} : { evaluationPlanId: String(facts.evaluationPlan.evaluationPlanId) }),
    ...(facts.observationPlan === undefined ? {} : { observationPlanId: String(facts.observationPlan.observationPlanId) }),
    recordsPath: path.join(runRoot, runId),
    exitCode,
  };
}
