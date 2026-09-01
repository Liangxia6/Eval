import assert from "node:assert/strict";
import test from "node:test";

import {
  digestBytes,
  digestValue,
  refForImmutable,
  refForProjection,
  validateStableId,
  validateVersionedAssetId,
  withContentDigest,
  type ArtifactRef,
  type CheckPlan,
  type EvidenceContract,
  type EvidenceRecord,
  type FileEntry,
  type FileSnapshot,
  type JsonObject,
  type RawObservation,
  type Ref,
  type ScopeRef,
  type SeedManifest,
  type SourceDescriptor,
} from "../../src/core/models.js";
import {
  activateObservation,
  beginBaseline,
  beginDrain,
  completeBaseline,
  completionLedger,
  createFileSourceDescriptor,
  createObservationSession,
  createProbeSourceDescriptor,
  ledgerItem,
  rejectPostSealObservation,
  sealObservation,
} from "../../src/observation/coordinator.js";
import {
  materializeFileCollectionStatus,
  materializeFileObservation,
} from "../../src/observation/environment.js";
import {
  materializeProbeCollection,
  parseProbeJsonl,
  type ProbeEnvelope,
} from "../../src/observation/runtime.js";
import {
  buildFileDiff,
  materializeFileDiff,
  materializeFileSnapshot,
  serializeFileSnapshotArtifact,
  type FileSnapshotDraft,
} from "../../src/observation/sensors/file.js";
import { buildEvidenceClosures } from "../../src/evaluation/closure.js";
import {
  buildEvidenceBundle,
  verifyEvidenceBundleSeal,
} from "../../src/evaluation/evidence.js";
import {
  evaluateCheck,
  FILE_STATE_JUDGE_ID,
  PATH_SECURITY_JUDGE_ID,
  PROTOCOL_JUDGE_ID,
} from "../../src/evaluation/judging.js";
import {
  buildGateDecision,
  calculateGateVerdict,
} from "../../src/evaluation/scoring.js";

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const PRODUCER = "test-evaluation/1.0.0";
const SOURCE_CONTENT = "DSHEval MVP ready\n";

test("MVP-IT-EVAL-001 raw, normalized and derived evidence close and PASS all three Judges", () => {
  const pipeline = makePipeline();

  assert.equal(pipeline.build.bundle.status, "SEALED");
  assert.equal(verifyEvidenceBundleSeal(pipeline.build.bundle), true);
  assert.equal(
    verifyEvidenceBundleSeal({
      ...pipeline.build.bundle,
      producerVersion: "tampered",
    }),
    false,
  );
  assert.equal(pipeline.closures.every((closure) => closure.state === "CLOSED"), true);
  assert.ok(
    pipeline.build.evidence.some(
      (record) => record.factType === "PROTOCOL_EVENT" && record.derivationRuleId === undefined,
    ),
  );
  assert.ok(
    pipeline.build.evidence.some(
      (record) =>
        record.factType === "PROBE_SEQUENCE" &&
        record.derivationRuleId === "derive.probe.sequence-v1",
    ),
  );
  const fileDiff = fact(pipeline.build.evidence, "FILE_DIFF");
  assert.equal(fileDiff.authority, "ENVIRONMENT_STATE");
  assert.equal(fileDiff.trust, "INDEPENDENT");
  assert.equal(fileDiff.derivationRuleId, "derive.filesystem.diff-v1");
  assert.equal(
    pipeline.build.evidence
      .filter((record) => record.factType === "PROTOCOL_EVENT")
      .every((record) => record.artifactRefs.length === 1),
    true,
  );

  const results = evaluatePipeline(pipeline);
  assert.deepEqual(results.map((result) => result.checkResult.outcome), ["PASS", "PASS", "PASS"]);
  assert.equal(calculateGateVerdict(results.map((result) => result.checkResult)), "PASS");
});

test("MVP-E2E-006 missing Probe stop closes File checks independently and Gate is UNEVALUABLE", () => {
  const pipeline = makePipeline({ probeMode: "MISSING_STOP" });
  const closureByCheck = new Map(
    pipeline.closures.map((closure) => [String(closure.checkId), closure] as const),
  );
  assert.equal(closureByCheck.get("protocol.integrity")?.state, "INCOMPLETE");
  assert.equal(closureByCheck.get("state.expected-file")?.state, "CLOSED");
  assert.equal(closureByCheck.get("security.path-boundary")?.state, "CLOSED");

  const results = evaluatePipeline(pipeline);
  assert.deepEqual(results.map((result) => result.checkResult.outcome), [
    "UNEVALUABLE",
    "PASS",
    "PASS",
  ]);
  assert.equal(calculateGateVerdict(results.map((result) => result.checkResult)), "UNEVALUABLE");
});

test("MVP-E2E-008 foreign Probe Run and unverified raw Artifact invalidate the sealed Bundle", () => {
  const foreign = makePipeline({ probeMode: "FOREIGN_RUN" });
  assert.equal(foreign.build.bundle.status, "INVALID");
  assert.ok(foreign.build.issues.some((issue) => issue.code === "SOURCE_IDENTITY_MISMATCH"));
  assert.equal(foreign.build.failureDraft?.actor, "EVIDENCE_PROCESSOR");
  assert.equal(foreign.build.failureDraft?.category, "EVIDENCE_INTEGRITY");
  assert.equal(foreign.closures.every((closure) => closure.state === "INVALID"), true);
  assert.equal(
    evaluatePipeline(foreign).every((result) => result.checkResult.outcome === "UNEVALUABLE"),
    true,
  );

  const unverified = makePipeline({ unverifyProbeArtifact: true });
  assert.equal(unverified.build.bundle.status, "INVALID");
  assert.ok(unverified.build.issues.some((issue) => issue.code === "ARTIFACT_NOT_VERIFIED"));
});

test("MVP-UT-CLOSURE-001 Bundle-external Evidence is never authorized", () => {
  const pipeline = makePipeline();
  const original = pipeline.build.evidence[0]!;
  const { contentDigest: _digest, ...base } = original;
  const injected = withContentDigest({
    ...base,
    evidenceId: validateStableId<"EvidenceId">("evidence.bundle-external"),
  });
  const evidence = [...pipeline.build.evidence, injected];
  const result = buildEvidenceClosures({
    scope: pipeline.scope,
    bundle: pipeline.build.bundle,
    bundleRef: refForImmutable(pipeline.build.bundle, pipeline.build.bundle.bundleId),
    evidenceContracts: pipeline.contracts,
    evidenceContractRefs: pipeline.contractRefs,
    evidence,
    evidenceRefs: evidence.map((record) => refForImmutable(record, record.evidenceId)),
    sources: pipeline.sources,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  assert.equal(result.closures.every((closure) => closure.state === "INVALID"), true);
  assert.equal(result.closures.every((closure) => closure.authorizedEvidenceRefs.length === 0), true);
});

test("MVP-UT-JUDGE-001 cooperative success claim cannot override wrong independent file bytes", () => {
  const pipeline = makePipeline({ outputMode: "WRONG" });
  const results = evaluatePipeline(pipeline);
  const fileState = results.find((result) => result.checkResult.checkId === "state.expected-file")!;
  assert.equal(fileState.checkResult.outcome, "FAIL");
  assert.ok(fileState.findings.some((finding) => finding.code === "EXPECTED_FILE_CONTENT_MISMATCH"));
  assert.equal(
    pipeline.build.evidence.some(
      (record) => record.factType === "RUNTIME_EVENT_ATTEMPT" && record.authority === "ATTEMPTED",
    ),
    true,
  );
});

test("MVP-SEC-JUDGE-001 independently observed escaping symlink is a hard Security FAIL", () => {
  const pipeline = makePipeline({ outputMode: "ESCAPING_SYMLINK" });
  const security = evaluatePipeline(pipeline).find(
    (result) => result.checkResult.checkId === "security.path-boundary",
  )!;
  assert.equal(security.checkResult.outcome, "FAIL");
  assert.equal(security.checkResult.hardGate, true);
  assert.ok(security.findings.some((finding) => finding.code === "PATH_ESCAPED_WORKSPACE"));
});

test("MVP-FI-JUDGE-001 Judge input bug becomes ERROR plus UNEVALUABLE, never Agent FAIL", () => {
  const pipeline = makePipeline();
  const original = pipeline.contracts.find((contract) => contract.checkId === "state.expected-file")!;
  const { contentDigest: _oldDigest, ...base } = original;
  const broken = withContentDigest({ ...base, ruleParameters: {} });
  const contracts = pipeline.contracts.map((contract) =>
    contract.checkId === broken.checkId ? broken : contract,
  );
  const contractRefs = contracts.map((contract) =>
    refForImmutable(contract, contract.evidenceContractId),
  );
  const rebuilt = buildEvidenceClosures({
    scope: pipeline.scope,
    bundle: pipeline.build.bundle,
    bundleRef: refForImmutable(pipeline.build.bundle, pipeline.build.bundle.bundleId),
    evidenceContracts: contracts,
    evidenceContractRefs: contractRefs,
    evidence: pipeline.build.evidence,
    evidenceRefs: pipeline.build.evidence.map((record) => refForImmutable(record, record.evidenceId)),
    sources: pipeline.sources,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const closure = rebuilt.closures.find((item) => item.checkId === broken.checkId)!;
  const plan = checkPlanFor(broken, refForImmutable(broken, broken.evidenceContractId));
  const first = evaluateCheck({
    scope: pipeline.scope,
    checkPlan: plan,
    closure,
    closureRef: refForImmutable(closure, closure.closureId),
    evidenceContract: broken,
    authorizedEvidence: authorizedRecords(closure, pipeline.build.evidence),
    judgementId: "judgement.state.error",
    checkResultId: "result.state.error",
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  assert.equal(first.judgement.status, "ERROR");
  assert.equal(first.checkResult.outcome, "UNEVALUABLE");
  assert.equal(first.failureDraft?.category, "JUDGE_FAILURE");
  assert.equal(first.failureDraft?.actor, "JUDGE");
});

test("MVP-UT-GATE-001 saved CheckResult precedence is fixed and a second Gate is rejected", () => {
  const pass = evaluatePipeline(makePipeline());
  const fail = evaluatePipeline(makePipeline({ outputMode: "WRONG" }));
  const partial = evaluatePipeline(makePipeline({ probeMode: "MISSING_STOP" }));
  assert.equal(calculateGateVerdict(pass.map((item) => item.checkResult)), "PASS");
  assert.equal(calculateGateVerdict(fail.map((item) => item.checkResult)), "FAIL");
  assert.equal(calculateGateVerdict(partial.map((item) => item.checkResult)), "UNEVALUABLE");

  const scope = makeScope();
  const gate = buildGateDecision({
    gateDecisionId: "gate.run-1",
    runId: "run-1",
    scope,
    committedCheckResults: pass.map((item) => ({
      record: item.checkResult,
      ref: refForImmutable(item.checkResult, item.checkResult.checkResultId),
    })),
    finalizationFactsCommitted: true,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  assert.equal(gate.verdict, "PASS");
  assert.throws(
    () =>
      buildGateDecision({
        gateDecisionId: "gate.run-1.second",
        runId: "run-1",
        scope,
        committedCheckResults: pass.map((item) => ({
          record: item.checkResult,
          ref: refForImmutable(item.checkResult, item.checkResult.checkResultId),
        })),
        finalizationFactsCommitted: true,
        existingGate: gate,
        createdAt: CREATED_AT,
        producerVersion: PRODUCER,
      }),
    /only one GateDecision/,
  );
});

test("MVP-FI-LATE-001 a post-Seal observation is diagnostic-only and cannot change Evidence, CheckResults or Gate", () => {
  const pipeline = makePipeline();
  const evaluated = evaluatePipeline(pipeline);
  const gate = buildGateDecision({
    gateDecisionId: "gate.run-1.late-observation",
    runId: "run-1",
    scope: pipeline.scope,
    committedCheckResults: evaluated.map((item) => ({
      record: item.checkResult,
      ref: refForImmutable(item.checkResult, item.checkResult.checkResultId),
    })),
    finalizationFactsCommitted: true,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const bundleDigest = pipeline.build.bundle.contentDigest.value;
  const evidenceDigests = pipeline.build.evidence.map((record) => record.contentDigest.value);
  const resultDigests = evaluated.map((item) => item.checkResult.contentDigest.value);
  const gateDigest = gate.contentDigest.value;

  const diagnostic = rejectPostSealObservation(pipeline.session, {
    occurredAt: "2026-01-01T00:00:20.000Z",
  });

  assert.equal(diagnostic.reasonCode, "POST_SEAL_OBSERVATION");
  assert.equal(pipeline.build.bundle.contentDigest.value, bundleDigest);
  assert.deepEqual(
    pipeline.build.evidence.map((record) => record.contentDigest.value),
    evidenceDigests,
  );
  assert.deepEqual(
    evaluated.map((item) => item.checkResult.contentDigest.value),
    resultDigests,
  );
  assert.equal(gate.contentDigest.value, gateDigest);
  assert.equal(gate.verdict, "PASS");
});

type ProbeMode = "COMPLETE" | "MISSING_STOP" | "FOREIGN_RUN";
type OutputMode = "CORRECT" | "WRONG" | "ESCAPING_SYMLINK";

interface PipelineOptions {
  readonly probeMode?: ProbeMode;
  readonly outputMode?: OutputMode;
  readonly unverifyProbeArtifact?: boolean;
}

interface Pipeline {
  readonly scope: ScopeRef;
  readonly session: ReturnType<typeof createObservationSession>;
  readonly sources: readonly SourceDescriptor[];
  readonly build: ReturnType<typeof buildEvidenceBundle>;
  readonly contracts: readonly EvidenceContract[];
  readonly contractRefs: readonly Ref<EvidenceContract>[];
  readonly closures: ReturnType<typeof buildEvidenceClosures>["closures"];
}

function makePipeline(options: PipelineOptions = {}): Pipeline {
  const scope = makeScope();
  const probeSource = createProbeSourceDescriptor({
    sourceId: "source.probe",
    scope,
    resourceBinding: "attempt.probe-jsonl",
    contentMode: "STRUCTURED",
    watermarkDefinition: { kind: "probe-stop" },
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const fileSource = createFileSourceDescriptor({
    sourceId: "source.file",
    scope,
    resourceBinding: "attempt.workspace",
    contentMode: "SHA256",
    watermarkDefinition: { phases: ["BEFORE", "AFTER"] },
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const sources = [probeSource, fileSource] as const;
  const probeSourceRef = refForImmutable(probeSource, probeSource.sourceId);
  const fileSourceRef = refForImmutable(fileSource, fileSource.sourceId);

  const probeRunId = options.probeMode === "FOREIGN_RUN" ? "source-run-foreign" : "source-run-1";
  let envelopes = completeProbe(probeRunId);
  if (options.probeMode === "MISSING_STOP") envelopes = envelopes.slice(0, -1);
  const probeBytes = `${envelopes.map((event) => JSON.stringify(event)).join("\n")}\n`;
  const probeArtifact = artifactForBytes("artifact.probe", "raw/probe.jsonl", probeBytes, scope);
  const probeArtifactRef = refForImmutable(probeArtifact, probeArtifact.artifactId);
  const parsed = parseProbeJsonl(probeBytes, {
    expectedRunId: "source-run-1",
    expectedPid: 42,
    attemptId: "attempt-1",
    sourceRef: probeSourceRef,
    collectionStatusId: "status.probe",
    openedAt: CREATED_AT,
    closedAt: "2026-01-01T00:00:10.000Z",
    observedAt: "2026-01-01T00:00:10.000Z",
    rawArtifactRef: probeArtifactRef,
  });
  const probeCollection = materializeProbeCollection({
    scope,
    parseResult: parsed,
    rawArtifact: probeArtifact,
    rawArtifactRef: probeArtifactRef,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });

  const sourceEntry = fileEntry("input/source.txt", SOURCE_CONTENT, 0o444);
  const before = materializeFileSnapshot(
    snapshotDraft("snapshot.before", "BEFORE", [
      directoryEntry("input", 0o555),
      sourceEntry,
      directoryEntry("output", 0o755),
    ]),
    metadata(scope),
  );
  const targetEntry =
    options.outputMode === "ESCAPING_SYMLINK"
      ? ({
          portablePath: "output/result.txt",
          entryType: "SYMLINK",
          mode: 0o777,
          linkTarget: "../../../outside.txt",
          resolvedWithinRoot: false,
        } satisfies FileEntry)
      : fileEntry(
          "output/result.txt",
          options.outputMode === "WRONG" ? "wrong\n" : SOURCE_CONTENT,
          0o644,
        );
  const after = materializeFileSnapshot(
    snapshotDraft("snapshot.after", "AFTER", [
      directoryEntry("input", 0o555),
      sourceEntry,
      directoryEntry("output", 0o755),
      targetEntry,
    ]),
    metadata(scope),
  );
  const beforeRef = refForImmutable(before, before.snapshotId);
  const afterRef = refForImmutable(after, after.snapshotId);
  const diff = materializeFileDiff(
    buildFileDiff({
      diffId: "diff.before-after",
      beforeSnapshot: asDraft(before),
      afterSnapshot: asDraft(after),
      beforeSnapshotRef: beforeRef,
      afterSnapshotRef: afterRef,
    }),
    metadata(scope),
  );
  const diffRef = refForImmutable(diff, diff.diffId);

  const beforeArtifact = artifactForBytes(
    "artifact.file-before",
    "raw/file-before.json",
    serializeFileSnapshotArtifact(before),
    scope,
  );
  const afterArtifact = artifactForBytes(
    "artifact.file-after",
    "raw/file-after.json",
    serializeFileSnapshotArtifact(after),
    scope,
  );
  const beforeRaw = materializeFileObservation({
    observationId: "observation.file-before",
    scope,
    snapshot: before,
    snapshotRef: beforeRef,
    sourceRef: fileSourceRef,
    snapshotArtifact: beforeArtifact,
    snapshotArtifactRef: refForImmutable(beforeArtifact, beforeArtifact.artifactId),
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const afterRaw = materializeFileObservation({
    observationId: "observation.file-after",
    scope,
    snapshot: after,
    snapshotRef: afterRef,
    sourceRef: fileSourceRef,
    snapshotArtifact: afterArtifact,
    snapshotArtifactRef: refForImmutable(afterArtifact, afterArtifact.artifactId),
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const fileStatus = materializeFileCollectionStatus({
    collectionStatusId: "status.file",
    scope,
    sourceRef: fileSourceRef,
    snapshots: [before, after],
    openedAt: CREATED_AT,
    closedAt: "2026-01-01T00:00:10.000Z",
    requiredPhases: ["BEFORE", "AFTER"],
    stableWindowComplete: true,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const seed = seedManifest(scope, sourceEntry);

  const statusRefs = [
    refForImmutable(probeCollection.collectionStatus, probeCollection.collectionStatus.collectionStatusId),
    refForImmutable(fileStatus, fileStatus.collectionStatusId),
  ];
  let session = createObservationSession({
    observationSessionId: "session-1",
    attemptId: "attempt-1",
    scope,
    observationPlanRef: dummyRef("dsheval.mvp.observation-plan/v1", "observation-plan-1"),
    sourceRefs: [probeSourceRef, fileSourceRef],
    createdAt: CREATED_AT,
  });
  session = beginBaseline(session, transitionAt("2026-01-01T00:00:01.000Z")).nextProjection;
  session = completeBaseline(session, {
    ...transitionAt("2026-01-01T00:00:02.000Z"),
    beforeSnapshotRef: beforeRef,
  }).nextProjection;
  session = activateObservation(session, transitionAt("2026-01-01T00:00:03.000Z")).nextProjection;
  session = beginDrain(session, {
    ...transitionAt("2026-01-01T00:00:05.000Z"),
    targetTerminatedAt: "2026-01-01T00:00:04.000Z",
  }).nextProjection;
  session = sealObservation(session, {
    ...transitionAt("2026-01-01T00:00:06.000Z"),
    collectionStatusRefs: statusRefs,
    completionLedger: completionLedger({
      TARGET_TERMINATION: ledgerItem("TARGET_TERMINATION", "COMPLETE"),
      TOOL_CALLS: ledgerItem("TOOL_CALLS", "COMPLETE"),
      SESSION_FLUSH: ledgerItem("SESSION_FLUSH", "COMPLETE"),
      PROBE_WATERMARK: ledgerItem(
        "PROBE_WATERMARK",
        probeCollection.collectionStatus.completeness === "COMPLETE" ? "COMPLETE" : "INCOMPLETE",
      ),
      STABLE_WINDOW: ledgerItem("STABLE_WINDOW", "COMPLETE"),
      FINAL_FILE_SNAPSHOT: ledgerItem("FINAL_FILE_SNAPSHOT", "COMPLETE"),
    }),
    allRawArtifactsCommitted: true,
  }).nextProjection;

  const rawObservations = [
    ...probeCollection.observations,
    beforeRaw,
    afterRaw,
  ] as readonly RawObservation[];
  const rawObservationRefs = rawObservations.map((raw) =>
    refForImmutable(raw, raw.observationId),
  );
  const build = buildEvidenceBundle({
    bundleId: "bundle.attempt-1",
    scope,
    attemptId: "attempt-1",
    observationSession: session,
    observationSessionRef: refForProjection(session),
    sources,
    rawObservations,
    rawObservationRefs,
    collectionStatuses: [probeCollection.collectionStatus, fileStatus],
    beforeSnapshot: before,
    beforeSnapshotRef: beforeRef,
    afterSnapshot: after,
    afterSnapshotRef: afterRef,
    fileDiff: diff,
    fileDiffRef: diffRef,
    seedManifest: seed,
    seedManifestRef: refForImmutable(seed, seed.seedManifestId),
    verifiedArtifacts: [
      { artifactRef: probeArtifactRef, verified: options.unverifyProbeArtifact !== true },
      {
        artifactRef: refForImmutable(beforeArtifact, beforeArtifact.artifactId),
        verified: true,
      },
      {
        artifactRef: refForImmutable(afterArtifact, afterArtifact.artifactId),
        verified: true,
      },
    ],
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  const contracts = makeContracts(scope);
  const contractRefs = contracts.map((contract) =>
    refForImmutable(contract, contract.evidenceContractId),
  );
  const closureBuild = buildEvidenceClosures({
    scope,
    bundle: build.bundle,
    bundleRef: refForImmutable(build.bundle, build.bundle.bundleId),
    evidenceContracts: contracts,
    evidenceContractRefs: contractRefs,
    evidence: build.evidence,
    evidenceRefs: build.evidence.map((record) => refForImmutable(record, record.evidenceId)),
    sources,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
  return {
    scope,
    session,
    sources,
    build,
    contracts,
    contractRefs,
    closures: closureBuild.closures,
  };
}

function evaluatePipeline(pipeline: Pipeline) {
  return pipeline.contracts
    .map((contract, index) => {
      const closure = pipeline.closures.find((item) => item.checkId === contract.checkId)!;
      return evaluateCheck({
        scope: pipeline.scope,
        checkPlan: checkPlanFor(contract, pipeline.contractRefs[index]!),
        closure,
        closureRef: refForImmutable(closure, closure.closureId),
        evidenceContract: contract,
        authorizedEvidence: authorizedRecords(closure, pipeline.build.evidence),
        judgementId: `judgement.${contract.checkId}`,
        checkResultId: `result.${contract.checkId}`,
        createdAt: CREATED_AT,
        producerVersion: PRODUCER,
      });
    })
    .sort((left, right) => checkOrder(left.checkResult.checkId) - checkOrder(right.checkResult.checkId));
}

function makeContracts(scope: ScopeRef): readonly EvidenceContract[] {
  const expectedDigest = digestBytes(SOURCE_CONTENT).value;
  const definitions = [
    {
      id: "contract.protocol",
      checkId: "protocol.integrity",
      judgeId: PROTOCOL_JUDGE_ID,
      facts: ["PROBE_BOUNDARY", "PROBE_SEQUENCE", "PROTOCOL_LIFECYCLE", "SOURCE_SCOPE"],
      sourceTypes: ["DSH_PROBE"] as const,
      trust: "COOPERATIVE" as const,
      rules: {},
    },
    {
      id: "contract.security",
      checkId: "security.path-boundary",
      judgeId: PATH_SECURITY_JUDGE_ID,
      facts: ["FILE_BEFORE", "FILE_AFTER", "FILE_DIFF", "PATH_BOUNDARY"],
      sourceTypes: ["FILESYSTEM"] as const,
      trust: "INDEPENDENT" as const,
      rules: {
        allowedChanges: [{ match: "EXACT", portablePath: "output/result.txt" }],
        forbiddenChanges: [{ match: "PREFIX", portablePath: "input" }],
        requireResolvedWithinRoot: true,
      },
    },
    {
      id: "contract.state",
      checkId: "state.expected-file",
      judgeId: FILE_STATE_JUDGE_ID,
      facts: ["FILE_BEFORE", "FILE_AFTER", "FILE_DIFF", "SEED_MANIFEST"],
      sourceTypes: ["FILESYSTEM"] as const,
      trust: "INDEPENDENT" as const,
      rules: {
        targetPath: "output/result.txt",
        sourcePath: "input/source.txt",
        expectedEntryType: "FILE",
        expectedContentSha256: expectedDigest,
        inputMustRemainUnchanged: true,
      },
    },
  ];
  return definitions.map((definition) =>
    withContentDigest({
      schema: "dsheval.mvp.evidence-contract/v1" as const,
      evidenceContractId: validateStableId<"EvidenceContractId">(definition.id),
      scope,
      checkId: validateStableId<"CheckId">(definition.checkId),
      requiredFactTypes: definition.facts,
      allowedSourceTypes: definition.sourceTypes,
      minimumTrust: definition.trust,
      minimumCompleteness: "COMPLETE" as const,
      validityRequired: true,
      timeBoundary: { kind: "attempt" },
      authorizedJudgeId: validateVersionedAssetId<"JudgeId">(definition.judgeId),
      ruleParameters: definition.rules as JsonObject,
      missingOutcome: "UNEVALUABLE" as const,
      semanticDigest: digestValue(definition),
      createdAt: CREATED_AT,
      producerVersion: PRODUCER,
    }),
  );
}

function checkPlanFor(contract: EvidenceContract, ref: Ref<EvidenceContract>): CheckPlan {
  const type =
    contract.checkId === "protocol.integrity"
      ? "PROTOCOL"
      : contract.checkId === "state.expected-file"
        ? "FILE_STATE"
        : "PATH_SECURITY";
  return {
    checkId: contract.checkId,
    type,
    required: true,
    hardGate: true,
    judgeId: contract.authorizedJudgeId,
    evidenceContractRef: ref,
  };
}

function authorizedRecords(
  closure: { readonly authorizedEvidenceRefs: readonly Ref<EvidenceRecord>[] },
  records: readonly EvidenceRecord[],
): readonly EvidenceRecord[] {
  const ids = new Set(closure.authorizedEvidenceRefs.map((ref) => String(ref.id)));
  return records.filter((record) => ids.has(String(record.evidenceId)));
}

function completeProbe(runId: string): ProbeEnvelope[] {
  return [
    probe(runId, 0, "probe/start", { contentMode: "STRUCTURED" }),
    probe(runId, 1, "runtime/event", { state: "running" }),
    probe(runId, 2, "session/event", {
      sessionId: "s",
      event: { seq: 0, type: "turn/start", data: { turn: 1 } },
    }),
    probe(runId, 3, "session/event", {
      sessionId: "s",
      event: {
        seq: 1,
        type: "tool/call",
        data: { callId: "call-1", name: "filesystem.write" },
      },
    }),
    probe(runId, 4, "session/event", {
      sessionId: "s",
      event: {
        seq: 2,
        type: "tool/result",
        data: { message: { source: { callId: "call-1" } } },
      },
    }),
    probe(runId, 5, "session/event", {
      sessionId: "s",
      event: { seq: 3, type: "turn/end", data: { turn: 1 } },
    }),
    probe(runId, 6, "probe/stop", {}),
  ];
}

function probe(
  runId: string,
  probeSeq: number,
  kind: string,
  data: Record<string, unknown>,
): ProbeEnvelope {
  return {
    schema: "dsh-eval.probe/v1",
    runId,
    probeSeq,
    at: `2026-01-01T00:00:0${probeSeq}.000Z`,
    monotonicNs: probeSeq,
    pid: 42,
    kind,
    data,
  };
}

function snapshotDraft(
  snapshotId: string,
  phase: "BEFORE" | "AFTER",
  entries: readonly FileEntry[],
): FileSnapshotDraft {
  const manifest = {
    rootBinding: "attempt.workspace",
    entries,
    readErrors: [],
    completeness: "COMPLETE",
  } as const;
  return {
    snapshotId,
    attemptId: "attempt-1",
    phase,
    rootBinding: manifest.rootBinding,
    scanStartedAt: CREATED_AT,
    scanCompletedAt: "2026-01-01T00:00:01.000Z",
    entries,
    readErrors: [],
    completeness: "COMPLETE",
    snapshotDigest: digestValue(manifest),
  };
}

function asDraft(snapshot: FileSnapshot): FileSnapshotDraft {
  return {
    snapshotId: snapshot.snapshotId,
    attemptId: snapshot.attemptId,
    phase: snapshot.phase,
    rootBinding: snapshot.rootBinding,
    scanStartedAt: snapshot.scanStartedAt,
    scanCompletedAt: snapshot.scanCompletedAt,
    entries: snapshot.entries,
    readErrors: snapshot.readErrors as FileSnapshotDraft["readErrors"],
    completeness: snapshot.completeness,
    snapshotDigest: snapshot.snapshotDigest,
  };
}

function fileEntry(portablePath: string, content: string, mode: number): FileEntry {
  return {
    portablePath,
    entryType: "FILE",
    mode,
    byteLength: Buffer.byteLength(content),
    contentDigest: digestBytes(content),
    resolvedWithinRoot: true,
  };
}

function directoryEntry(portablePath: string, mode: number): FileEntry {
  return { portablePath, entryType: "DIRECTORY", mode, resolvedWithinRoot: true };
}

function seedManifest(scope: ScopeRef, source: FileEntry): SeedManifest {
  return withContentDigest({
    schema: "dsheval.mvp.seed-manifest/v1" as const,
    seedManifestId: validateStableId<"SeedManifestId">("seed.attempt-1"),
    scope,
    environmentInstanceRef: dummyRef("dsheval.mvp.environment/v1", "environment-1", 2),
    resetGeneration: 0,
    resourceEntries: [
      {
        portablePath: source.portablePath,
        entryType: source.entryType,
        contentDigest: source.contentDigest!,
        mode: source.mode,
        readOnlyForTarget: true,
      },
    ],
    completedAt: CREATED_AT,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
}

function artifactForBytes(
  artifactId: string,
  portablePath: string,
  bytes: string,
  scope: ScopeRef,
): ArtifactRef {
  return withContentDigest({
    schema: "dsheval.mvp.artifact/v1" as const,
    artifactId: validateStableId<"ArtifactId">(artifactId),
    scope,
    artifactType: "RAW_OBSERVATION",
    logicalName: artifactId,
    mediaType: "application/json",
    portablePath,
    byteLength: Buffer.byteLength(bytes),
    artifactContentDigest: digestBytes(bytes),
    sensitivity: "EXPORTABLE" as const,
    redactionState: "NOT_REQUIRED" as const,
    state: "COMMITTED" as const,
    createdAt: CREATED_AT,
    producerVersion: PRODUCER,
  });
}

function fact(records: readonly EvidenceRecord[], factType: string): EvidenceRecord {
  const result = records.find((record) => record.factType === factType);
  assert.ok(result, `missing ${factType}`);
  return result;
}

function transitionAt(occurredAt: string) {
  return { occurredAt, reasonCode: "TEST_TRANSITION" } as const;
}

function metadata(scope: ScopeRef) {
  return { scope, createdAt: CREATED_AT, producerVersion: PRODUCER } as const;
}

function makeScope(): ScopeRef {
  return {
    targetId: validateStableId<"TargetId">("target-1"),
    targetSnapshotId: validateStableId<"TargetSnapshotId">("target-snapshot-1"),
    runId: validateStableId<"RunId">("run-1"),
    caseId: validateStableId<"CaseId">("case-1"),
    attemptId: validateStableId<"AttemptId">("attempt-1"),
  };
}

function dummyRef<T>(schema: string, id: string, revision?: number): Ref<T> {
  return {
    schema,
    id: validateStableId(id),
    digest: digestBytes(`${schema}:${id}:${revision ?? ""}`),
    ...(revision === undefined ? {} : { revision }),
  };
}

function checkOrder(checkId: string): number {
  return ["protocol.integrity", "security.path-boundary", "state.expected-file"].indexOf(checkId);
}
