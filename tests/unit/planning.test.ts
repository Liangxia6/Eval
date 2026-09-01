import assert from "node:assert/strict";
import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { succeeded, type ArtifactCommitMetadata, type OperationContext } from "../../src/core/contracts.js";
import {
  canonicalJson,
  digestBytes,
  digestValue,
  refForArtifact,
  refForImmutable,
  validateScope,
  validateStableId,
  validateVersionedAssetId,
  withContentDigest,
  type ArtifactRef,
  type ConfigSnapshot,
  type FilesystemPack,
  type InspectionSnapshot,
  type JsonObject,
  type SensorAdapterDescriptor,
  type SourceRequirement,
  type TargetSnapshot,
} from "../../src/core/models.js";
import { CatalogValidationError, loadFilesystemPack } from "../../src/planning/catalog.js";
import { inspectTarget } from "../../src/planning/inspector.js";
import {
  FilesystemPlanner,
  findPlanGaps,
  judgeCapabilityDigest,
  type PlanningCapabilities,
} from "../../src/planning/planner.js";

const NOW = "2026-09-01T00:00:00.000Z";
const PACK_ROOT = resolve("packs");

const PROBE_CAPABILITIES = [
  "CONTENT_MODE_STRUCTURED",
  "CONTIGUOUS_SEQUENCE",
  "ONE_SHOT",
  "PROBE_START_STOP",
  "SESSION_LIFECYCLE",
  "SOURCE_RUN_ID",
  "TOOL_LIFECYCLE",
] as const;
const FILE_CAPABILITIES = [
  "FILE_TYPE",
  "READ_ERRORS",
  "READ_ONLY",
  "SHA256",
  "SNAPSHOT_AFTER",
  "SNAPSHOT_BEFORE",
  "SNAPSHOT_POST_RESET",
  "STABLE_WINDOW",
  "SYMLINK_BOUNDARY",
] as const;

const CAPABILITIES: PlanningCapabilities = Object.freeze({
  observerReadOnly: true,
  identitySeparation: true,
  atomicArtifactCommit: true,
  pathIsolation: true,
  networkDefaultDeny: true,
  targetHiddenRootsDenied: true,
  probeArmedBeforeHeadless: true,
  observerOperations: Object.freeze(["READ", "SNAPSHOT", "DRAIN"] as const),
});

function operationContext(): OperationContext {
  return Object.freeze({
    operationId: validateStableId<"OperationId">("operation.plan-test"),
    idempotencyKey: "planning-test",
    deadlineAt: "2026-09-01T00:01:00.000Z",
    cancellationToken: Object.freeze({ isCancellationRequested: false }),
    actorRole: "PLANNING" as const,
    traceId: validateStableId<"TraceId">("trace.plan-test"),
  });
}

function artifact(
  artifactIdValue: string,
  scope: TargetSnapshot["scope"],
  bytes = Buffer.from(artifactIdValue, "utf8"),
): ArtifactRef {
  const artifactId = validateStableId<"ArtifactId">(artifactIdValue);
  return withContentDigest({
    schema: "dsheval.mvp.artifact/v1" as const,
    artifactId,
    scope,
    artifactType: "PLANNING_FIXTURE",
    logicalName: `${artifactIdValue}.json`,
    mediaType: "application/json",
    portablePath: `planning/${artifactIdValue}.json`,
    byteLength: bytes.byteLength,
    artifactContentDigest: digestBytes(bytes),
    sensitivity: "EXPORTABLE" as const,
    redactionState: "NOT_REQUIRED" as const,
    state: "COMMITTED" as const,
    createdAt: NOW,
    producerVersion: "0.1.0",
  });
}

function frozenInputs(pack: FilesystemPack): {
  readonly targetSnapshot: TargetSnapshot;
  readonly inspectionSnapshot: InspectionSnapshot;
  readonly configSnapshot: ConfigSnapshot;
  readonly sensors: readonly SensorAdapterDescriptor[];
  readonly judges: readonly {
    readonly judgeId: ReturnType<typeof validateVersionedAssetId<"JudgeId">>;
    readonly judgeVersion: string;
    readonly deterministic: true;
    readonly capabilityDigest: ReturnType<typeof digestValue>;
  }[];
} {
  const targetId = validateStableId<"TargetId">("target.fixture");
  const targetSnapshotId = validateStableId<"TargetSnapshotId">("target-snapshot.fixture");
  const scope = validateScope({ targetId, targetSnapshotId });
  const source = artifact("target-source.fixture", scope);
  const home = artifact("target-home.fixture", scope);
  const profile = artifact("target-profile.fixture", scope);
  const lock = artifact("target-lock.fixture", scope);
  const configArtifact = artifact("target-effective-config.fixture", scope);
  const entrypointDigest = digestBytes("fixture dsh entrypoint");
  const targetSnapshot = withContentDigest({
    schema: "dsheval.mvp.target-snapshot/v1" as const,
    targetSnapshotId,
    targetId,
    scope,
    sourceManifestRef: refForArtifact(source),
    dshExecutablePath: "fake-dsh.mjs",
    dshPackageVersion: "0.1.1-rc.2",
    dshEntrypointDigest: entrypointDigest,
    dshHomeManifestRef: refForArtifact(home),
    profile: "fixture-filesystem",
    profileManifestRef: refForArtifact(profile),
    lockfileRef: refForArtifact(lock),
    effectiveConfigRef: refForArtifact(configArtifact),
    driverFingerprint: Object.freeze({
      driverCapabilityId: validateStableId("dsh.headless"),
      dshEntrypointDigest: entrypointDigest,
      dshPackageVersion: "0.1.1-rc.2",
      headlessBundleVersion: "0.1.1-rc.2",
      headlessBundleDigest: digestBytes("fixture headless bundle"),
      cliGrammarId: validateStableId("dsh.headless.profile-task.v1"),
      cancelSupported: true,
      stdoutSemantics: "captured",
      stderrSemantics: "captured",
      exitSemantics: "process-exit",
      workspaceSemantics: "cwd",
      profileMutationSemantics: "isolated-clone",
    }),
    platform: Object.freeze({ os: "fixture" }),
    secretRefNames: Object.freeze([]),
    createdAt: NOW,
    producerVersion: "0.1.0",
  });
  const inspectionSnapshot = withContentDigest({
    schema: "dsheval.mvp.inspection/v1" as const,
    inspectionId: validateStableId<"InspectionId">("inspection.fixture"),
    scope,
    targetSnapshotRef: refForImmutable(targetSnapshot, targetSnapshotId),
    dshVersionStatus: Object.freeze({ status: "KNOWN", version: "0.1.1-rc.2" }),
    profile: Object.freeze({ status: "KNOWN" }),
    probeConfigured: true,
    probeSchema: "dsh-eval.probe/v1",
    probeOrderStatus: "VALID",
    headlessDriverStatus: "COMPATIBLE",
    toolSchemas: Object.freeze([]),
    permissionPreset: "FIXTURE_READ_WRITE",
    sandboxMode: "FIXTURE_ISOLATED",
    limitations: Object.freeze([]),
    sourceArtifactRefs: Object.freeze([]),
    createdAt: NOW,
    producerVersion: "0.1.0",
  });
  const configSnapshot = withContentDigest({
    schema: "dsheval.mvp.config/v1" as const,
    configId: validateStableId<"ConfigId">("config.fixture"),
    invocationId: validateStableId<"InvocationId">("invocation.fixture"),
    targetRoot: "/fixture/target",
    runRoot: "/fixture/run",
    artifactRoot: "/fixture/artifacts",
    reportRoot: "/fixture/reports",
    workspaceRoot: "/fixture/workspaces",
    runtimeDshHomeRoot: "/fixture/runtime-home",
    runDeadlineMs: 60_000,
    caseDeadlineMs: 30_000,
    stableWindowMs: 250,
    stableMaxWaitMs: 2_000,
    maxArtifactBytes: 1_048_576,
    contentMode: "SHA256",
    allowedModelEndpoints: Object.freeze(["https://api.fixture.invalid"]),
    minimumIsolationLevel: "AGENT_SEPARATED" as const,
    rendererVersion: "1.0.0",
    fieldSources: Object.freeze({ fixture: "TEST" }),
    platform: "fixture",
    nodeVersion: process.version,
    dshevalVersion: "0.1.0",
    secretRefNames: Object.freeze([]),
    createdAt: NOW,
  });
  const capabilityByType = {
    DSH_PROBE: PROBE_CAPABILITIES,
    FILESYSTEM: FILE_CAPABILITIES,
  } as const;
  const sensors = pack.sourceRequirements.map((requirement) => ({
    implementationId: requirement.sensorImplementationId,
    implementationVersion: requirement.sensorImplementationVersion,
    capabilityDigest: requirement.sensorCapabilityDigest,
    sourceType: requirement.sourceType,
    capabilities: capabilityByType[requirement.sourceType],
  }));
  const judges = pack.judges.map((judge) => ({
    judgeId: validateVersionedAssetId<"JudgeId">(judge.judgeId),
    judgeVersion: String(judge.version),
    deterministic: true as const,
    capabilityDigest: judgeCapabilityDigest(judge),
  }));
  return { targetSnapshot, inspectionSnapshot, configSnapshot, sensors, judges };
}

function materializer(commits: ArtifactRef[]) {
  return {
    async commit(_context: OperationContext, bytes: Uint8Array | string, metadata: ArtifactCommitMetadata) {
      const raw = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes);
      const committed = withContentDigest({
        schema: "dsheval.mvp.artifact/v1" as const,
        artifactId: metadata.artifactId,
        scope: metadata.scope,
        artifactType: metadata.artifactType,
        logicalName: metadata.logicalName,
        mediaType: metadata.mediaType,
        portablePath: `planning/${metadata.artifactId}.bin`,
        byteLength: raw.byteLength,
        artifactContentDigest: digestBytes(raw),
        sensitivity: metadata.sensitivity,
        redactionState: metadata.redactionState,
        state: "COMMITTED" as const,
        createdAt: metadata.createdAt,
        producerVersion: metadata.producerVersion,
      });
      commits.push(committed);
      return succeeded(committed);
    },
  };
}

function redigestPack(pack: FilesystemPack, scenario: JsonObject): FilesystemPack {
  const { contentDigest: _oldDigest, ...withoutDigest } = pack;
  return withContentDigest({ ...withoutDigest, scenario });
}

function redigestPackSources(
  pack: FilesystemPack,
  sourceRequirements: readonly SourceRequirement[],
): FilesystemPack {
  const { contentDigest: _oldDigest, ...withoutDigest } = pack;
  return withContentDigest({ ...withoutDigest, sourceRequirements });
}

test("MVP-CT-CATALOG-001 catalog loads exactly the unique filesystem pack", async (context) => {
  const pack = await loadFilesystemPack(PACK_ROOT);
  assert.equal(pack.packId, "pack.filesystem.copy-exact.v1");
  assert.equal(pack.scenario.scenarioId, "scenario.filesystem.copy-exact/v1");
  assert.equal(pack.environment.environmentId, "environment.filesystem.workspace/v1");
  assert.deepEqual(pack.checks.map((check) => check.checkId), [
    "protocol.integrity",
    "security.path-boundary",
    "state.expected-file",
  ]);

  const copiedRoot = await mkdtemp(join(tmpdir(), "dsheval-pack-"));
  context.after(async () => rm(copiedRoot, { recursive: true, force: true }));
  await cp(PACK_ROOT, copiedRoot, { recursive: true });
  await writeFile(join(copiedRoot, "scenarios", "extra-case.json"), "{}\n", "utf8");
  await assert.rejects(
    loadFilesystemPack(copiedRoot),
    (error: unknown) => error instanceof CatalogValidationError && error.code === "PACK_FILE_SET_INVALID",
  );
});

test("MVP-UT-INSPECT-001 missing declarations remain sourced UNKNOWN and conflicts are preserved", async () => {
  const pack = await loadFilesystemPack(PACK_ROOT);
  const { targetSnapshot } = frozenInputs(pack);
  const inspection = await inspectTarget(targetSnapshot, {
    createdAt: NOW,
    producerVersion: "0.1.0",
    readArtifact: async (ref) => {
      if (ref.id === targetSnapshot.effectiveConfigRef.id) {
        return Buffer.from(JSON.stringify({
          config: {
            dshVersion: "0.1.1-rc.3",
          },
        }), "utf8");
      }
      if (ref.id === targetSnapshot.profileManifestRef.id) {
        throw new Error("fixture profile manifest unavailable");
      }
      throw new Error("Inspector attempted to read an unbound Artifact");
    },
  });
  assert.equal((inspection.dshVersionStatus as { status: string }).status, "CONFLICT");
  assert.equal((inspection.dshVersionStatus as { source: string }).source, "TARGET_PACKAGE_AND_EFFECTIVE_CONFIG");
  assert.equal((inspection.profile as { manifestStatus: string }).manifestStatus, "UNKNOWN");
  assert.equal(inspection.probeConfigured, "UNKNOWN");
  assert.equal(inspection.probeSchema, "UNKNOWN");
  assert.equal(inspection.probeOrderStatus, "UNKNOWN");
  const limitationCodes = (inspection.limitations as Array<{ code?: string }>).map(
    (limitation) => limitation.code,
  );
  assert.ok(limitationCodes.includes("PROFILE_MANIFEST_READ_FAILED"));
  assert.ok(limitationCodes.includes("PROBE_CONFIGURATION_UNKNOWN"));
  assert.equal(inspection.sourceArtifactRefs.length, 5);
});

test("MVP-UT-PLAN-001 MVP-CT-MATCH-001 MVP-CT-PLAN-SOURCE-001 planner creates one deterministic, bidirectionally matched frozen plan", async () => {
  const pack = await loadFilesystemPack(PACK_ROOT);
  const inputs = frozenInputs(pack);
  const planner = new FilesystemPlanner(CAPABILITIES);
  const firstCommits: ArtifactRef[] = [];
  const secondCommits: ArtifactRef[] = [];
  const first = await planner.buildPlan(
    operationContext(),
    { ...inputs, filesystemPack: pack },
    materializer(firstCommits),
  );
  const second = await planner.buildPlan(
    operationContext(),
    { ...inputs, filesystemPack: pack },
    materializer(secondCommits),
  );
  assert.equal(first.status, "SUCCEEDED");
  assert.equal(second.status, "SUCCEEDED");
  assert.equal(first.status === "SUCCEEDED" && first.value.status, "FROZEN");
  assert.equal(second.status === "SUCCEEDED" && second.value.status, "FROZEN");
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(firstCommits.length, 2, "task and one public input are committed before plans");
  if (first.status === "SUCCEEDED" && first.value.status === "FROZEN") {
    assert.equal(first.value.evaluationPlan.casePlan.order, 1);
    assert.equal(first.value.evaluationPlan.casePlan.maxAttempts, 1);
    assert.equal(first.value.evaluationPlan.checkPlans.length, 3);
    assert.equal(first.value.evidenceContracts.length, 3);
    assert.deepEqual(
      [...first.value.evaluationPlan.casePlan.checkIds].sort(),
      first.value.evaluationPlan.checkPlans.map((check) => check.checkId).sort(),
    );
    assert.deepEqual(
      first.value.evaluationPlan.checkPlans.map((check) => check.evidenceContractRef.id).sort(),
      first.value.evidenceContracts.map((contract) => contract.evidenceContractId).sort(),
    );
    assert.equal(first.value.observationPlan.casePlanId, first.value.evaluationPlan.casePlan.casePlanId);
    for (const frozenRequirement of pack.sourceRequirements) {
      const plannedRequirement: SourceRequirement | undefined =
        first.value.observationPlan.sourceRequirements.find(
          (candidate) => candidate.sourceRequirementId === frozenRequirement.sourceRequirementId,
        );
      assert.ok(plannedRequirement, `${frozenRequirement.sourceRequirementId} is retained in ObservationPlan`);
      assert.equal(
        plannedRequirement.sensorImplementationId,
        frozenRequirement.sensorImplementationId,
      );
      assert.equal(
        plannedRequirement.sensorImplementationVersion,
        frozenRequirement.sensorImplementationVersion,
      );
      assert.deepEqual(
        plannedRequirement.sensorCapabilityDigest,
        frozenRequirement.sensorCapabilityDigest,
      );
    }
  }
});

test("MVP-CT-EXT-001 a compatible File Sensor replacement changes only pack and registry inputs", async () => {
  const originalPack = await loadFilesystemPack(PACK_ROOT);
  const replacementImplementationId = validateStableId<"SensorImplementationId">(
    "fixture.compatible-file-sensor",
  );
  const replacementVersion = "2.0.0";
  const replacementPack = redigestPackSources(
    originalPack,
    originalPack.sourceRequirements.map((requirement) =>
      requirement.sourceType === "FILESYSTEM"
        ? Object.freeze({
            ...requirement,
            sensorImplementationId: replacementImplementationId,
            sensorImplementationVersion: replacementVersion,
          })
        : requirement,
    ),
  );
  const originalInputs = frozenInputs(originalPack);
  const replacementInputs = frozenInputs(replacementPack);
  const replacementFileDescriptor = replacementInputs.sensors.find(
    (sensor) => sensor.sourceType === "FILESYSTEM",
  );
  assert.ok(replacementFileDescriptor);
  assert.equal(replacementFileDescriptor.implementationId, replacementImplementationId);
  assert.equal(replacementFileDescriptor.implementationVersion, replacementVersion);
  assert.deepEqual(replacementFileDescriptor.capabilities, FILE_CAPABILITIES);
  assert.deepEqual(
    replacementFileDescriptor.capabilityDigest,
    digestValue(FILE_CAPABILITIES),
  );

  const planner = new FilesystemPlanner(CAPABILITIES);
  const original = await planner.buildPlan(
    operationContext(),
    { ...originalInputs, filesystemPack: originalPack },
    materializer([]),
  );
  const replacement = await planner.buildPlan(
    operationContext(),
    { ...replacementInputs, filesystemPack: replacementPack },
    materializer([]),
  );
  assert.equal(original.status, "SUCCEEDED");
  assert.equal(replacement.status, "SUCCEEDED");
  if (
    original.status === "SUCCEEDED" &&
    original.value.status === "FROZEN" &&
    replacement.status === "SUCCEEDED" &&
    replacement.value.status === "FROZEN"
  ) {
    const plannedFileRequirement = replacement.value.observationPlan.sourceRequirements.find(
      (requirement) => requirement.sourceType === "FILESYSTEM",
    );
    assert.ok(plannedFileRequirement);
    assert.equal(plannedFileRequirement.sensorImplementationId, replacementImplementationId);
    assert.equal(plannedFileRequirement.sensorImplementationVersion, replacementVersion);
    assert.deepEqual(
      plannedFileRequirement.sensorCapabilityDigest,
      replacementFileDescriptor.capabilityDigest,
    );
    assert.notEqual(
      replacement.value.evaluationPlan.semanticDigest.value,
      original.value.evaluationPlan.semanticDigest.value,
      "replacement identity is part of the frozen Plan semantics",
    );
  } else {
    assert.fail("both the original and compatible replacement must produce FROZEN plans");
  }
});

test("MVP-UT-PLAN-002 MVP-CT-PLAN-SOURCE-001 capability triple and Judge drift are UNSATISFIABLE before artifacts", async () => {
  const pack = await loadFilesystemPack(PACK_ROOT);
  const inputs = frozenInputs(pack);
  const planner = new FilesystemPlanner(CAPABILITIES);
  const sensorVariants = [
    inputs.sensors.map((sensor, index) =>
      index === 0
        ? { ...sensor, implementationId: validateStableId<"SensorImplementationId">("sensor.drifted") }
        : sensor,
    ),
    inputs.sensors.map((sensor, index) =>
      index === 0 ? { ...sensor, implementationVersion: "9.9.9" } : sensor,
    ),
    inputs.sensors.map((sensor, index) =>
      index === 0 ? { ...sensor, capabilityDigest: digestBytes("drifted capabilities") } : sensor,
    ),
  ];
  for (const sensors of sensorVariants) {
    const commits: ArtifactRef[] = [];
    const result = await planner.buildPlan(
      operationContext(),
      {
        ...inputs,
        filesystemPack: pack,
        sensors,
        judges: inputs.judges.map((judge, index) =>
          index === 0 ? { ...judge, judgeVersion: "9.9.9" } : judge,
        ),
      },
      materializer(commits),
    );
    assert.equal(result.status, "SUCCEEDED");
    if (result.status === "SUCCEEDED") {
      assert.equal(result.value.status, "UNSATISFIABLE");
      if (result.value.status === "UNSATISFIABLE") {
        const codes = result.value.gaps.map((gap) => gap.code);
        assert.ok(codes.includes("MANDATORY_SENSOR_UNAVAILABLE"));
        assert.ok(codes.includes("MANDATORY_JUDGE_UNAVAILABLE"));
      }
    }
    assert.equal(commits.length, 0);
  }
});

test("MVP-UT-PLAN-004 non-filesystem and extra-case packs are explicitly UNSATISFIABLE", async () => {
  const pack = await loadFilesystemPack(PACK_ROOT);
  const inputs = frozenInputs(pack);
  const nonFilesystemScenario = Object.freeze({
    ...pack.scenario,
    applicability: Object.freeze({
      ...(pack.scenario.applicability as JsonObject),
      requestedScope: "NETWORK_MVP",
    }),
  });
  const nonFilesystem = redigestPack(pack, nonFilesystemScenario);
  assert.ok(
    findPlanGaps({ ...inputs, filesystemPack: nonFilesystem }, CAPABILITIES).some(
      (gap) => gap.code === "NON_FILESYSTEM_PACK_UNSUPPORTED",
    ),
  );

  const extraCase = redigestPack(
    pack,
    Object.freeze({ ...pack.scenario, cases: Object.freeze([{ order: 2 }]) }),
  );
  assert.ok(
    findPlanGaps({ ...inputs, filesystemPack: extraCase }, CAPABILITIES).some(
      (gap) => gap.code === "MULTI_CASE_OR_RETRY_UNSUPPORTED",
    ),
  );
});
