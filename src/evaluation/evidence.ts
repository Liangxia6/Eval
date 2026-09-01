import {
  ContractViolation,
  assertSameAttemptScope,
  digestEquals,
  digestValue,
  refForImmutable,
  validateRef,
  validateScope,
  validateStableId,
  withContentDigest,
  type ArtifactRef,
  type CollectionStatus,
  type EvidenceAuthority,
  type EvidenceBundle,
  type EvidenceRecord,
  type FileDiff,
  type FileEntry,
  type FileSnapshot,
  type JsonObject,
  type JsonValue,
  type ObservationSession,
  type RawObservation,
  type Ref,
  type SeedManifest,
  type ScopeRef,
  type SourceDescriptor,
  type StableId,
} from "../core/models.js";
import type { FailureDraft, FailureRecord } from "../core/errors.js";

export interface VerifiedArtifactInput {
  readonly artifactRef: Ref<ArtifactRef>;
  /** Must be produced by ArtifactStore.readVerified, never by the Agent. */
  readonly verified: boolean;
}

export interface BuildEvidenceInput {
  readonly bundleId: string;
  readonly scope: ScopeRef;
  readonly attemptId: string;
  readonly observationSession: ObservationSession;
  readonly observationSessionRef: Ref<ObservationSession>;
  readonly sources: readonly SourceDescriptor[];
  readonly rawObservations: readonly RawObservation[];
  readonly rawObservationRefs: readonly Ref<RawObservation>[];
  readonly collectionStatuses: readonly CollectionStatus[];
  readonly beforeSnapshot?: FileSnapshot;
  readonly beforeSnapshotRef?: Ref<FileSnapshot>;
  readonly afterSnapshot?: FileSnapshot;
  readonly afterSnapshotRef?: Ref<FileSnapshot>;
  readonly fileDiff?: FileDiff;
  readonly fileDiffRef?: Ref<FileDiff>;
  readonly seedManifest?: SeedManifest;
  readonly seedManifestRef?: Ref<SeedManifest>;
  readonly verifiedArtifacts: readonly VerifiedArtifactInput[];
  readonly failureRefs?: readonly Ref<FailureRecord>[];
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly makeEvidenceId?: (factType: string, ordinal: number) => string;
}

export interface EvidenceBuildIssue {
  readonly code:
    | "SESSION_NOT_SEALED"
    | "SCOPE_MISMATCH"
    | "DIGEST_MISMATCH"
    | "REF_MISMATCH"
    | "SOURCE_IDENTITY_MISMATCH"
    | "ARTIFACT_NOT_VERIFIED"
    | "FILE_DERIVATION_MISSING";
  readonly detail: string;
}

export interface EvidenceBuildResult {
  readonly bundle: EvidenceBundle;
  readonly evidence: readonly EvidenceRecord[];
  readonly issues: readonly EvidenceBuildIssue[];
  readonly failureDraft?: FailureDraft;
}

type EvidenceBundleSealFields = Omit<EvidenceBundle, "contentDigest" | "sealDigest">;

/** Semantic seal independently binds every persisted EvidenceBundle field. */
export function evidenceBundleSealDigest(
  bundle: EvidenceBundleSealFields,
): ReturnType<typeof digestValue> {
  return digestValue({
    schema: bundle.schema,
    bundleId: bundle.bundleId,
    scope: bundle.scope,
    attemptId: bundle.attemptId,
    observationSessionRef: refJson(bundle.observationSessionRef),
    evidenceRefs: bundle.evidenceRefs.map(refJson),
    inputObservationRefs: bundle.inputObservationRefs.map(refJson),
    unconsumedInputRefs: bundle.unconsumedInputRefs.map(refJson),
    status: bundle.status,
    sealedAt: bundle.sealedAt,
    failureRefs: bundle.failureRefs.map(refJson),
    createdAt: bundle.createdAt,
    producerVersion: bundle.producerVersion,
  });
}

export function verifyEvidenceBundleSeal(bundle: EvidenceBundle): boolean {
  return (
    digestEquals(bundle.contentDigest, digestValue(bundle, ["contentDigest"])) &&
    digestEquals(bundle.sealDigest, evidenceBundleSealDigest(bundle))
  );
}

/**
 * Converts immutable observations into standardized and derived facts. Raw
 * records are never edited, and every standardized fact keeps its raw refs.
 */
export function buildEvidenceBundle(input: BuildEvidenceInput): EvidenceBuildResult {
  const scope = validateScope(input.scope);
  const attemptId = validateStableId<"AttemptId">(input.attemptId, "attemptId");
  if (scope.attemptId !== attemptId) {
    throw new ContractViolation("SCOPE_MISMATCH", "Evidence Attempt does not match its Scope");
  }
  if (input.observationSession.state !== "SEALED") {
    throw new ContractViolation(
      "SESSION_NOT_SEALED",
      "EvidenceBuilder accepts only an immutable SEALED ObservationSession",
    );
  }

  const issues: EvidenceBuildIssue[] = [];
  validateSessionIntegrity(input, issues);
  const rawRefById = indexRawRefs(input.rawObservations, input.rawObservationRefs, scope, issues);
  const sourceById = new Map(input.sources.map((source) => [source.sourceId, source] as const));
  if (
    sourceById.size !== input.sources.length ||
    input.sources.map((source) => source.sourceType).sort().join(",") !== "DSH_PROBE,FILESYSTEM"
  ) {
    issues.push({
      code: "SOURCE_IDENTITY_MISMATCH",
      detail: "MVP Evidence requires one distinct DSH_PROBE Source and one FILESYSTEM Source",
    });
  }
  for (const source of input.sources) {
    validateImmutableDigest(source, "SourceDescriptor", issues);
    try {
      assertSameAttemptScope(scope, source.scope);
    } catch {
      issues.push({ code: "SCOPE_MISMATCH", detail: `Source ${source.sourceId} has a foreign Scope` });
    }
  }
  for (const raw of input.rawObservations) {
    const source = sourceById.get(raw.sourceRef.id as StableId<"SourceId">);
    if (
      source === undefined ||
      raw.sourceRef.id !== source.sourceId ||
      !digestEquals(raw.sourceRef.digest, source.contentDigest)
    ) {
      issues.push({
        code: "SOURCE_IDENTITY_MISMATCH",
        detail: `RawObservation ${raw.observationId} refers to an unknown or altered Source`,
      });
    }
  }
  validateSessionMembers(input, issues);
  for (const status of input.collectionStatuses) {
    validateImmutableDigest(status, "CollectionStatus", issues);
    const source = sourceById.get(status.sourceRef.id as never);
    if (
      source === undefined ||
      !digestEquals(status.sourceRef.digest, source.contentDigest) ||
      status.sourceRef.id !== source.sourceId
    ) {
      issues.push({
        code: "SOURCE_IDENTITY_MISMATCH",
        detail: `CollectionStatus ${status.collectionStatusId} refers to an unknown Source`,
      });
    }
    try {
      assertSameAttemptScope(scope, status.scope);
    } catch {
      issues.push({
        code: "SCOPE_MISMATCH",
        detail: `CollectionStatus ${status.collectionStatusId} has a foreign Scope`,
      });
    }
  }
  validateArtifactCoverage(input, issues);
  for (const artifact of input.verifiedArtifacts) {
    if (!artifact.verified) {
      issues.push({
        code: "ARTIFACT_NOT_VERIFIED",
        detail: `Artifact ${artifact.artifactRef.id} failed byte-length or digest verification`,
      });
    }
  }
  validateFileInputs(input, issues);

  const invalid = issues.length > 0;
  const evidence = invalid
    ? []
    : buildEvidenceRecords(input, scope, rawRefById, sourceById);
  const evidenceRefs = evidence.map((record) =>
    refForImmutable(record, record.evidenceId),
  ) as readonly Ref<EvidenceRecord>[];
  const inputObservationRefs = stableRefs(input.rawObservationRefs);
  const consumedObservationIds = new Set(
    evidence.flatMap((record) => record.observationRefs.map((ref) => String(ref.id))),
  );
  const unconsumedInputRefs = inputObservationRefs.filter(
    (ref) => !consumedObservationIds.has(String(ref.id)),
  );
  const status: EvidenceBundle["status"] = invalid ? "INVALID" : "SEALED";
  const bundleWithoutDigests = {
    schema: "dsheval.mvp.evidence-bundle/v1" as const,
    bundleId: validateStableId<"EvidenceBundleId">(input.bundleId, "bundleId"),
    scope,
    attemptId,
    observationSessionRef: input.observationSessionRef,
    evidenceRefs,
    inputObservationRefs,
    unconsumedInputRefs,
    status,
    sealedAt: input.observationSession.sealedAt!,
    failureRefs: stableRefs(input.failureRefs ?? []),
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  };
  const bundle = withContentDigest({
    ...bundleWithoutDigests,
    sealDigest: evidenceBundleSealDigest(bundleWithoutDigests),
  });
  return {
    bundle,
    evidence,
    issues,
    ...(issues.length === 0
      ? {}
      : {
          failureDraft: {
            scope,
            category: "EVIDENCE_INTEGRITY" as const,
            origin: "DSHEVAL" as const,
            actor: "EVIDENCE_PROCESSOR" as const,
            phase: "EVIDENCE_BUILD",
            severity: "ERROR" as const,
            retryable: false as const,
            messageRedacted: "EvidenceBundle could not be sealed as valid",
            reasonCode: "EVIDENCE_BUNDLE_INVALID",
            evidenceRefs: input.rawObservationRefs,
            artifactRefs: input.verifiedArtifacts.map((artifact) => artifact.artifactRef),
            occurredAt: input.createdAt,
          },
        }),
  };
}

function buildEvidenceRecords(
  input: BuildEvidenceInput,
  scope: ScopeRef,
  rawRefById: ReadonlyMap<string, Ref<RawObservation>>,
  sourceById: ReadonlyMap<StableId<"SourceId">, SourceDescriptor>,
): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];
  let ordinal = 0;
  const statusBySource = new Map(
    input.collectionStatuses.map((status) => [String(status.sourceRef.id), status] as const),
  );

  for (const raw of [...input.rawObservations].sort(compareRawObservation)) {
    const source = sourceById.get(raw.sourceRef.id as StableId<"SourceId">);
    if (source === undefined) continue;
    const rawRef = rawRefById.get(String(raw.observationId));
    if (rawRef === undefined) continue;
    const standardized = standardizeRawObservation(raw);
    if (standardized === undefined) continue;
    const status = statusBySource.get(String(source.sourceId));
    records.push(
      makeEvidenceRecord(input, scope, {
        evidenceId: evidenceId(input, standardized.factType, ordinal++),
        factType: standardized.factType,
        factValue: standardized.factValue,
        sourceRefs: [raw.sourceRef],
        observationRefs: [rawRef],
        artifactRefs: artifactRefsForRaw(raw, input.verifiedArtifacts),
        authority: standardized.authority,
        timeRange: {
          ...(raw.sourceTime.wallTime === undefined ? {} : { startedAt: raw.sourceTime.wallTime }),
          ...(raw.sourceTime.sourceSeq === undefined
            ? {}
            : {
                sourceSeqStart: raw.sourceTime.sourceSeq,
                sourceSeqEnd: raw.sourceTime.sourceSeq,
              }),
        },
        completeness: status?.completeness ?? "PARTIAL",
        validity:
          readAssociation(raw.captureMetadata) === "UNRESOLVED" ? "INVALID" : "VALID",
        trust: source.trust,
      }),
    );
  }

  ordinal = appendProtocolAggregateEvidence({
    input,
    scope,
    records,
    ordinal,
    rawRefById,
    statusBySource,
  });

  for (const snapshot of [input.beforeSnapshot, input.afterSnapshot]) {
    if (snapshot === undefined) continue;
    if (snapshot.phase === "POST_RESET") {
      throw new ContractViolation(
        "POST_RESET_EVIDENCE_FORBIDDEN",
        "POST_RESET facts are operational verification and cannot enter Agent Evidence",
      );
    }
    const source = input.sources.find((candidate) => candidate.sourceType === "FILESYSTEM");
    if (source === undefined) continue;
    const snapshotRef = snapshot.phase === "BEFORE" ? input.beforeSnapshotRef : input.afterSnapshotRef;
    const phaseRaw = rawForFilePhase(input.rawObservations, snapshot.phase);
    const rawRefs = refsForRaw(phaseRaw, rawRefById);
    const status = statusBySource.get(String(source.sourceId));
    records.push(
      makeEvidenceRecord(input, scope, {
        evidenceId: evidenceId(input, `FILE_${snapshot.phase}`, ordinal++),
        factType: `FILE_${snapshot.phase}`,
        factValue: {
          phase: snapshot.phase,
          snapshotRef: refJson(snapshotRef!),
          rootBinding: snapshot.rootBinding,
          entries: snapshot.entries as unknown as JsonValue,
          readErrors: snapshot.readErrors as unknown as JsonValue,
          snapshotDigest: snapshot.snapshotDigest as unknown as JsonValue,
        },
        sourceRefs: [refForImmutable(source, source.sourceId)],
        observationRefs: rawRefs,
        artifactRefs: artifactRefsForRawSet(phaseRaw, input.verifiedArtifacts),
        authority: "ENVIRONMENT_STATE",
        timeRange: { startedAt: snapshot.scanStartedAt, endedAt: snapshot.scanCompletedAt },
        completeness:
          snapshot.completeness === "COMPLETE" && status?.completeness === "COMPLETE"
            ? "COMPLETE"
            : "PARTIAL",
        validity: "VALID",
        trust: source.trust,
      }),
    );
  }

  if (input.fileDiff !== undefined) {
    const source = input.sources.find((candidate) => candidate.sourceType === "FILESYSTEM")!;
    const fileRaw = [
      ...rawForFilePhase(input.rawObservations, "BEFORE"),
      ...rawForFilePhase(input.rawObservations, "AFTER"),
    ];
    const observationRefs = refsForRaw(fileRaw, rawRefById);
    const fileArtifactRefs = artifactRefsForRawSet(fileRaw, input.verifiedArtifacts);
    records.push(
      makeEvidenceRecord(input, scope, {
        evidenceId: evidenceId(input, "FILE_DIFF", ordinal++),
        factType: "FILE_DIFF",
        factValue: {
          diffRef: refJson(input.fileDiffRef!),
          added: input.fileDiff.added as unknown as JsonValue,
          removed: input.fileDiff.removed as unknown as JsonValue,
          modified: input.fileDiff.modified as unknown as JsonValue,
          typeChanged: input.fileDiff.typeChanged as unknown as JsonValue,
          unchangedCount: input.fileDiff.unchangedCount,
          diffDigest: input.fileDiff.diffDigest as unknown as JsonValue,
        },
        sourceRefs: [refForImmutable(source, source.sourceId)],
        observationRefs,
        artifactRefs: fileArtifactRefs,
        authority: "ENVIRONMENT_STATE",
        derivationRuleId: validateStableId<"DerivationRuleId">("derive.filesystem.diff-v1"),
        timeRange: {
          startedAt: input.beforeSnapshot!.scanStartedAt,
          endedAt: input.afterSnapshot!.scanCompletedAt,
        },
        completeness:
          input.beforeSnapshot!.completeness === "COMPLETE" &&
          input.afterSnapshot!.completeness === "COMPLETE"
            ? "COMPLETE"
            : "PARTIAL",
        validity: "VALID",
        trust: source.trust,
      }),
    );

    records.push(
      makeEvidenceRecord(input, scope, {
        evidenceId: evidenceId(input, "PATH_BOUNDARY", ordinal++),
        factType: "PATH_BOUNDARY",
        factValue: {
          rootBinding: input.afterSnapshot!.rootBinding,
          changes: [
            ...input.fileDiff.added,
            ...input.fileDiff.removed,
            ...input.fileDiff.modified,
            ...input.fileDiff.typeChanged,
          ] as unknown as JsonValue,
        },
        sourceRefs: [refForImmutable(source, source.sourceId)],
        observationRefs,
        artifactRefs: fileArtifactRefs,
        authority: "ENVIRONMENT_STATE",
        derivationRuleId: validateStableId<"DerivationRuleId">("derive.path-boundary-v1"),
        timeRange: {
          startedAt: input.beforeSnapshot!.scanStartedAt,
          endedAt: input.afterSnapshot!.scanCompletedAt,
        },
        completeness:
          input.beforeSnapshot!.completeness === "COMPLETE" &&
          input.afterSnapshot!.completeness === "COMPLETE"
            ? "COMPLETE"
            : "PARTIAL",
        validity: "VALID",
        trust: source.trust,
      }),
    );
  }

  if (input.seedManifest !== undefined) {
    const source = input.sources.find((candidate) => candidate.sourceType === "FILESYSTEM")!;
    records.push(
      makeEvidenceRecord(input, scope, {
        evidenceId: evidenceId(input, "SEED_MANIFEST", ordinal++),
        factType: "SEED_MANIFEST",
        factValue: {
          seedManifestRef: refJson(input.seedManifestRef!),
          resetGeneration: input.seedManifest.resetGeneration,
          resourceEntries: input.seedManifest.resourceEntries as unknown as JsonValue,
        },
        sourceRefs: [refForImmutable(source, source.sourceId)],
        observationRefs: refsForRaw(
          rawForFilePhase(input.rawObservations, "BEFORE"),
          rawRefById,
        ),
        artifactRefs: [],
        authority: "ENVIRONMENT_STATE",
        timeRange: { endedAt: input.seedManifest.completedAt },
        completeness: "COMPLETE",
        validity: "VALID",
        trust: source.trust,
      }),
    );
  }
  return records;
}

interface AppendProtocolInput {
  readonly input: BuildEvidenceInput;
  readonly scope: ScopeRef;
  readonly records: EvidenceRecord[];
  readonly ordinal: number;
  readonly rawRefById: ReadonlyMap<string, Ref<RawObservation>>;
  readonly statusBySource: ReadonlyMap<string, CollectionStatus>;
}

function appendProtocolAggregateEvidence(options: AppendProtocolInput): number {
  let ordinal = options.ordinal;
  const source = options.input.sources.find((candidate) => candidate.sourceType === "DSH_PROBE");
  if (source === undefined) return ordinal;
  const sourceRef = refForImmutable(source, source.sourceId);
  const probeRaw = options.input.rawObservations
    .filter((raw) => raw.sourceRef.id === source.sourceId && raw.payloadInline !== undefined)
    .sort(compareRawObservation);
  const refs = probeRaw
    .map((raw) => options.rawRefById.get(String(raw.observationId)))
    .filter((ref): ref is Ref<RawObservation> => ref !== undefined);
  const status = options.statusBySource.get(String(source.sourceId));
  const completeness = status?.completeness ?? "PARTIAL";
  const validity = probeRaw.some((raw) => readAssociation(raw.captureMetadata) === "UNRESOLVED")
    ? "INVALID"
    : "VALID";
  const common = {
    sourceRefs: [sourceRef],
    artifactRefs: artifactRefsForRawSet(probeRaw, options.input.verifiedArtifacts),
    trust: source.trust,
    validity,
  } as const;
  const starts = probeRaw.filter((raw) => raw.externalEventType === "probe/start");
  const stops = probeRaw.filter((raw) => raw.externalEventType === "probe/stop");
  if (starts.length === 1 && stops.length === 1) {
    options.records.push(
      makeEvidenceRecord(options.input, options.scope, {
        ...common,
        evidenceId: evidenceId(options.input, "PROBE_BOUNDARY", ordinal++),
        factType: "PROBE_BOUNDARY",
        factValue: {
          start: starts[0]!.payloadInline!,
          stop: stops[0]!.payloadInline!,
        },
        observationRefs: refsForRaw([...starts, ...stops], options.rawRefById),
        authority: "COMMITTED",
        derivationRuleId: validateStableId<"DerivationRuleId">("derive.probe.boundary-v1"),
        timeRange: sourceTimeRange([...starts, ...stops]),
        completeness,
      }),
    );
  }

  if (probeRaw.length > 0) {
    options.records.push(
      makeEvidenceRecord(options.input, options.scope, {
        ...common,
        evidenceId: evidenceId(options.input, "PROBE_SEQUENCE", ordinal++),
        factType: "PROBE_SEQUENCE",
        factValue: {
          sequences: probeRaw.map((raw) => raw.sourceTime.sourceSeq ?? -1),
          gaps: (status?.gaps ?? []) as unknown as JsonValue,
          truncated: status?.truncated ?? true,
          finalWatermark: (status?.finalWatermark ?? null) as JsonValue,
        },
        observationRefs: refs,
        authority: "COMMITTED",
        derivationRuleId: validateStableId<"DerivationRuleId">("derive.probe.sequence-v1"),
        timeRange: sourceTimeRange(probeRaw),
        completeness,
      }),
    );
    options.records.push(
      makeEvidenceRecord(options.input, options.scope, {
        ...common,
        evidenceId: evidenceId(options.input, "SOURCE_SCOPE", ordinal++),
        factType: "SOURCE_SCOPE",
        factValue: {
          sourceId: String(source.sourceId),
          runIds: probeRaw.map((raw) =>
            isJsonObject(raw.payloadInline) && typeof raw.payloadInline.runId === "string"
              ? raw.payloadInline.runId
              : "UNRESOLVED",
          ),
          associations: probeRaw.map((raw) => readAssociation(raw.captureMetadata) ?? "UNRESOLVED"),
        },
        observationRefs: refs,
        authority: "COMMITTED",
        derivationRuleId: validateStableId<"DerivationRuleId">("derive.probe.scope-v1"),
        timeRange: sourceTimeRange(probeRaw),
        completeness,
      }),
    );
  }
  const lifecycleRaw = probeRaw.filter((raw) => raw.externalEventType === "session/event");
  if (lifecycleRaw.length > 0) {
    options.records.push(
      makeEvidenceRecord(options.input, options.scope, {
        ...common,
        evidenceId: evidenceId(options.input, "PROTOCOL_LIFECYCLE", ordinal++),
        factType: "PROTOCOL_LIFECYCLE",
        factValue: lifecycleRaw.map((raw) => raw.payloadInline!) as JsonValue,
        observationRefs: refsForRaw(lifecycleRaw, options.rawRefById),
        authority: "COMMITTED",
        derivationRuleId: validateStableId<"DerivationRuleId">("derive.protocol.lifecycle-v1"),
        timeRange: sourceTimeRange(lifecycleRaw),
        completeness,
      }),
    );
  }
  return ordinal;
}

interface EvidenceFields {
  readonly evidenceId: StableId<"EvidenceId">;
  readonly factType: string;
  readonly factValue: JsonValue;
  readonly sourceRefs: readonly Ref<SourceDescriptor>[];
  readonly observationRefs: readonly Ref<RawObservation>[];
  readonly artifactRefs: readonly Ref<ArtifactRef>[];
  readonly authority: EvidenceAuthority;
  readonly derivationRuleId?: StableId<"DerivationRuleId">;
  readonly timeRange: EvidenceRecord["timeRange"];
  readonly completeness: EvidenceRecord["completeness"];
  readonly validity: EvidenceRecord["validity"];
  readonly trust: EvidenceRecord["trust"];
}

function makeEvidenceRecord(
  input: BuildEvidenceInput,
  scope: ScopeRef,
  fields: EvidenceFields,
): EvidenceRecord {
  return withContentDigest({
    schema: "dsheval.mvp.evidence/v1" as const,
    evidenceId: fields.evidenceId,
    scope,
    attemptId: validateStableId<"AttemptId">(input.attemptId),
    factType: fields.factType,
    factValue: fields.factValue,
    sourceRefs: stableRefs(fields.sourceRefs),
    observationRefs: stableRefs(fields.observationRefs),
    artifactRefs: stableRefs(fields.artifactRefs),
    authority: fields.authority,
    ...(fields.derivationRuleId === undefined ? {} : { derivationRuleId: fields.derivationRuleId }),
    timeRange: fields.timeRange,
    completeness: fields.completeness,
    validity: fields.validity,
    trust: fields.trust,
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
}

function standardizeRawObservation(raw: RawObservation):
  | { readonly factType: string; readonly factValue: JsonValue; readonly authority: EvidenceAuthority }
  | undefined {
  if (raw.payloadInline === undefined) {
    return {
      factType: `RAW_ARTIFACT_${raw.externalEventType}`,
      factValue: {
        externalEventType: raw.externalEventType,
        artifactRef: refJson(raw.payloadArtifactRef),
      },
      authority: "DIAGNOSTIC",
    };
  }
  const payload = raw.payloadInline;
  if (raw.externalEventType === "session/event") {
    return { factType: "PROTOCOL_EVENT", factValue: payload, authority: "COMMITTED" };
  }
  if (raw.externalEventType === "runtime/event") {
    return { factType: "RUNTIME_EVENT_ATTEMPT", factValue: payload, authority: "ATTEMPTED" };
  }
  if (raw.externalEventType === "probe/start") {
    return { factType: "PROBE_START", factValue: payload, authority: "COMMITTED" };
  }
  if (raw.externalEventType === "probe/stop") {
    return { factType: "PROBE_STOP", factValue: payload, authority: "COMMITTED" };
  }
  if (raw.externalEventType === "runtime/log") {
    return { factType: "RUNTIME_LOG", factValue: payload, authority: "DIAGNOSTIC" };
  }
  return { factType: "PROBE_EVENT_UNKNOWN", factValue: payload, authority: "DIAGNOSTIC" };
}

function validateSessionIntegrity(input: BuildEvidenceInput, issues: EvidenceBuildIssue[]): void {
  if (
    !digestEquals(
      input.observationSession.projectionDigest,
      digestValue(input.observationSession, ["projectionDigest"]),
    ) ||
    !digestEquals(input.observationSession.projectionDigest, input.observationSessionRef.digest)
  ) {
    issues.push({ code: "DIGEST_MISMATCH", detail: "ObservationSession Ref digest is invalid" });
  }
  if (
    input.observationSessionRef.id !== input.observationSession.observationSessionId ||
    input.observationSessionRef.revision !== input.observationSession.revision
  ) {
    issues.push({ code: "REF_MISMATCH", detail: "ObservationSession Ref revision is stale" });
  }
  try {
    assertSameAttemptScope(input.scope, input.observationSession.scope);
  } catch {
    issues.push({ code: "SCOPE_MISMATCH", detail: "ObservationSession has a foreign Scope" });
  }
  if (input.observationSession.attemptId !== input.attemptId) {
    issues.push({ code: "SCOPE_MISMATCH", detail: "ObservationSession belongs to another Attempt" });
  }
  if (input.observationSession.sealedAt === undefined) {
    issues.push({ code: "SESSION_NOT_SEALED", detail: "SEALED Session has no sealedAt watermark" });
  }
}

function validateSessionMembers(input: BuildEvidenceInput, issues: EvidenceBuildIssue[]): void {
  const sourceRefs = input.sources.map((source) => refForImmutable(source, source.sourceId));
  if (!sameRefSet(sourceRefs, input.observationSession.sourceRefs)) {
    issues.push({
      code: "SOURCE_IDENTITY_MISMATCH",
      detail: "SEALED Session Source refs differ from the supplied Source descriptors",
    });
  }
  const statusRefs = input.collectionStatuses.map((status) =>
    refForImmutable(status, status.collectionStatusId),
  );
  if (!sameRefSet(statusRefs, input.observationSession.collectionStatusRefs)) {
    issues.push({
      code: "REF_MISMATCH",
      detail: "SEALED Session CollectionStatus refs differ from the supplied statuses",
    });
  }
  for (const source of input.sources) {
    if (
      input.collectionStatuses.filter((status) => status.sourceRef.id === source.sourceId).length !== 1
    ) {
      issues.push({
        code: "SOURCE_IDENTITY_MISMATCH",
        detail: `Source ${source.sourceId} does not have exactly one CollectionStatus`,
      });
    }
  }
}

function indexRawRefs(
  observations: readonly RawObservation[],
  refs: readonly Ref<RawObservation>[],
  expectedScope: ScopeRef,
  issues: EvidenceBuildIssue[],
): ReadonlyMap<string, Ref<RawObservation>> {
  const refsById = new Map(refs.map((ref) => [String(ref.id), ref] as const));
  const observationIds = new Set<string>();
  for (const observation of observations) {
    if (observationIds.has(String(observation.observationId))) {
      issues.push({
        code: "REF_MISMATCH",
        detail: `RawObservation ${observation.observationId} is duplicated`,
      });
    }
    observationIds.add(String(observation.observationId));
    validateImmutableDigest(observation, "RawObservation", issues);
    const ref = refsById.get(String(observation.observationId));
    if (ref === undefined || !digestEquals(ref.digest, observation.contentDigest)) {
      issues.push({
        code: "REF_MISMATCH",
        detail: `RawObservation ${observation.observationId} does not match its committed Ref`,
      });
    }
    try {
      assertSameAttemptScope(observation.scope, expectedScope);
    } catch {
      issues.push({
        code: "SCOPE_MISMATCH",
        detail: `RawObservation ${observation.observationId} has a foreign Scope`,
      });
    }
    if (readAssociation(observation.captureMetadata) === "UNRESOLVED") {
      issues.push({
        code: "SOURCE_IDENTITY_MISMATCH",
        detail: `RawObservation ${observation.observationId} is not uniquely associated with the Attempt`,
      });
    }
  }
  if (refsById.size !== observations.length) {
    issues.push({ code: "REF_MISMATCH", detail: "RawObservation and Ref sets differ" });
  }
  return refsById;
}

function validateArtifactCoverage(input: BuildEvidenceInput, issues: EvidenceBuildIssue[]): void {
  const verifiedByKey = new Map<string, VerifiedArtifactInput>();
  for (const artifact of input.verifiedArtifacts) {
    const key = refKey(artifact.artifactRef);
    if (verifiedByKey.has(key)) {
      issues.push({
        code: "REF_MISMATCH",
        detail: `Artifact ${artifact.artifactRef.id} verification was supplied more than once`,
      });
    }
    verifiedByKey.set(key, artifact);
  }
  for (const raw of input.rawObservations) {
    const refs = artifactRefsDeclaredByRaw(raw);
    if (refs.length === 0) {
      issues.push({
        code: "ARTIFACT_NOT_VERIFIED",
        detail: `RawObservation ${raw.observationId} has no committed raw Artifact linkage`,
      });
      continue;
    }
    for (const ref of refs) {
      const verified = verifiedByKey.get(refKey(ref));
      if (verified?.verified !== true) {
        issues.push({
          code: "ARTIFACT_NOT_VERIFIED",
          detail: `RawObservation ${raw.observationId} references an unverified Artifact`,
        });
      }
    }
  }
}

function validateFileInputs(input: BuildEvidenceInput, issues: EvidenceBuildIssue[]): void {
  const pairs = [
    [input.beforeSnapshot, input.beforeSnapshotRef, "BEFORE"],
    [input.afterSnapshot, input.afterSnapshotRef, "AFTER"],
  ] as const;
  for (const [snapshot, ref, phase] of pairs) {
    if ((snapshot === undefined) !== (ref === undefined)) {
      issues.push({ code: "REF_MISMATCH", detail: `${phase} Snapshot and Ref must occur together` });
      continue;
    }
    if (snapshot === undefined || ref === undefined) continue;
    validateImmutableDigest(snapshot, `${phase} FileSnapshot`, issues);
    const expectedManifestDigest = digestValue({
      rootBinding: snapshot.rootBinding,
      entries: snapshot.entries,
      readErrors: snapshot.readErrors,
      completeness: snapshot.completeness,
    });
    if (
      !digestEquals(snapshot.snapshotDigest, expectedManifestDigest) ||
      !digestEquals(snapshot.contentDigest, ref.digest) ||
      ref.id !== snapshot.snapshotId ||
      snapshot.phase !== phase ||
      snapshot.attemptId !== input.attemptId
    ) {
      issues.push({ code: "DIGEST_MISMATCH", detail: `${phase} FileSnapshot digest is invalid` });
    }
    try {
      assertSameAttemptScope(input.scope, snapshot.scope);
    } catch {
      issues.push({ code: "SCOPE_MISMATCH", detail: `${phase} FileSnapshot has a foreign Scope` });
    }
    const rawForPhase = rawForFilePhase(input.rawObservations, phase);
    if (rawForPhase.length !== 1 || !metadataRefMatches(rawForPhase[0]!, "snapshotRef", ref)) {
      issues.push({
        code: "REF_MISMATCH",
        detail: `${phase} FileSnapshot does not have exactly one matching RawObservation`,
      });
    }
  }
  if ((input.fileDiff === undefined) !== (input.fileDiffRef === undefined)) {
    issues.push({ code: "REF_MISMATCH", detail: "FileDiff and Ref must occur together" });
  } else if (input.fileDiff !== undefined && input.fileDiffRef !== undefined) {
    validateImmutableDigest(input.fileDiff, "FileDiff", issues);
    const expectedDiffDigest = digestValue({
      added: input.fileDiff.added,
      removed: input.fileDiff.removed,
      modified: input.fileDiff.modified,
      typeChanged: input.fileDiff.typeChanged,
      unchangedCount: input.fileDiff.unchangedCount,
    });
    if (
      !digestEquals(input.fileDiff.diffDigest, expectedDiffDigest) ||
      !digestEquals(input.fileDiff.contentDigest, input.fileDiffRef.digest) ||
      input.fileDiffRef.id !== input.fileDiff.diffId
    ) {
      issues.push({ code: "DIGEST_MISMATCH", detail: "FileDiff digest is invalid" });
    }
  }
  if (
    input.fileDiff !== undefined &&
    (input.beforeSnapshot === undefined || input.afterSnapshot === undefined)
  ) {
    issues.push({
      code: "FILE_DERIVATION_MISSING",
      detail: "FileDiff cannot be authorized without Before and After inputs",
    });
  }
  if (
    input.fileDiff !== undefined &&
    input.beforeSnapshotRef !== undefined &&
    input.afterSnapshotRef !== undefined &&
    (!sameRef(input.fileDiff.beforeSnapshotRef, input.beforeSnapshotRef) ||
      !sameRef(input.fileDiff.afterSnapshotRef, input.afterSnapshotRef))
  ) {
    issues.push({
      code: "FILE_DERIVATION_MISSING",
      detail: "FileDiff does not cite the supplied Before and After Snapshot refs",
    });
  }
  if (
    input.fileDiff !== undefined &&
    input.beforeSnapshot !== undefined &&
    input.afterSnapshot !== undefined &&
    !digestEquals(
      input.fileDiff.diffDigest,
      deriveFileDiffDigest(input.beforeSnapshot.entries, input.afterSnapshot.entries),
    )
  ) {
    issues.push({
      code: "FILE_DERIVATION_MISSING",
      detail: "FileDiff is not the deterministic derivation of Before and After",
    });
  }
  if ((input.seedManifest === undefined) !== (input.seedManifestRef === undefined)) {
    issues.push({ code: "REF_MISMATCH", detail: "SeedManifest and Ref must occur together" });
  } else if (input.seedManifest !== undefined && input.seedManifestRef !== undefined) {
    validateImmutableDigest(input.seedManifest, "SeedManifest", issues);
    if (
      !digestEquals(input.seedManifest.contentDigest, input.seedManifestRef.digest) ||
      input.seedManifestRef.id !== input.seedManifest.seedManifestId
    ) {
      issues.push({ code: "REF_MISMATCH", detail: "SeedManifest Ref digest is invalid" });
    }
    try {
      assertSameAttemptScope(input.scope, input.seedManifest.scope);
    } catch {
      issues.push({ code: "SCOPE_MISMATCH", detail: "SeedManifest has a foreign Scope" });
    }
  }
}

function validateImmutableDigest(
  record: { readonly contentDigest: ReturnType<typeof digestValue> },
  label: string,
  issues: EvidenceBuildIssue[],
): void {
  if (!digestEquals(record.contentDigest, digestValue(record, ["contentDigest"]))) {
    issues.push({ code: "DIGEST_MISMATCH", detail: `${label} contentDigest is invalid` });
  }
}

function rawForFilePhase(
  observations: readonly RawObservation[],
  phase: "BEFORE" | "AFTER",
): readonly RawObservation[] {
  return observations
    .filter(
      (observation) =>
        observation.externalEventType === `file/snapshot/${phase}` ||
        observation.externalEventType === `FILE_SNAPSHOT_${phase}`,
    );
}

function readAssociation(metadata: JsonObject): string | undefined {
  return typeof metadata.association === "string" ? metadata.association : undefined;
}

function refsForRaw(
  observations: readonly RawObservation[],
  refsById: ReadonlyMap<string, Ref<RawObservation>>,
): readonly Ref<RawObservation>[] {
  return stableRefs(
    observations
      .map((observation) => refsById.get(String(observation.observationId)))
      .filter((ref): ref is Ref<RawObservation> => ref !== undefined),
  );
}

function sourceTimeRange(observations: readonly RawObservation[]): EvidenceRecord["timeRange"] {
  const wallTimes = observations
    .map((observation) => observation.sourceTime.wallTime)
    .filter((value): value is string => value !== undefined)
    .sort();
  const sequences = observations
    .map((observation) => observation.sourceTime.sourceSeq)
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  return {
    ...(wallTimes[0] === undefined ? {} : { startedAt: wallTimes[0] }),
    ...(wallTimes.at(-1) === undefined ? {} : { endedAt: wallTimes.at(-1)! }),
    ...(sequences[0] === undefined ? {} : { sourceSeqStart: sequences[0] }),
    ...(sequences.at(-1) === undefined ? {} : { sourceSeqEnd: sequences.at(-1)! }),
  };
}

function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function evidenceId(
  input: BuildEvidenceInput,
  factType: string,
  ordinal: number,
): StableId<"EvidenceId"> {
  return validateStableId<"EvidenceId">(
    input.makeEvidenceId?.(factType, ordinal) ?? `evidence.${input.attemptId}.${ordinal + 1}`,
    "evidenceId",
  );
}

function compareRawObservation(left: RawObservation, right: RawObservation): number {
  const leftSeq = left.sourceTime.sourceSeq ?? Number.MAX_SAFE_INTEGER;
  const rightSeq = right.sourceTime.sourceSeq ?? Number.MAX_SAFE_INTEGER;
  return leftSeq - rightSeq || String(left.observationId).localeCompare(String(right.observationId), "en");
}

function refJson(ref: Ref | undefined): JsonObject {
  if (ref === undefined) return {};
  return {
    schema: ref.schema,
    id: String(ref.id),
    digest: {
      algorithm: ref.digest.algorithm,
      value: ref.digest.value,
      byteLength: ref.digest.byteLength,
    },
    ...(ref.revision === undefined ? {} : { revision: ref.revision }),
  };
}

function stableRefs<T extends Ref>(refs: readonly T[]): readonly T[] {
  const unique = new Map<string, T>();
  for (const ref of refs) {
    unique.set(`${ref.schema}\u0000${ref.id}\u0000${ref.revision ?? ""}`, ref);
  }
  return [...unique.values()].sort((left, right) =>
    `${left.schema}\u0000${left.id}\u0000${left.revision ?? ""}`.localeCompare(
      `${right.schema}\u0000${right.id}\u0000${right.revision ?? ""}`,
      "en",
    ),
  );
}

function artifactRefsDeclaredByRaw(raw: RawObservation): readonly Ref<ArtifactRef>[] {
  if (raw.payloadArtifactRef !== undefined) return [raw.payloadArtifactRef];
  const candidate = raw.captureMetadata.rawArtifactRef;
  if (candidate === undefined) return [];
  try {
    const ref = validateRef<ArtifactRef>(candidate, { fieldName: "captureMetadata.rawArtifactRef" });
    return ref.schema === "dsheval.mvp.artifact/v1" ? [ref] : [];
  } catch {
    return [];
  }
}

function metadataRefMatches(raw: RawObservation, field: string, expected: Ref): boolean {
  const candidate = raw.captureMetadata[field];
  if (candidate === undefined) return false;
  try {
    return sameRef(validateRef(candidate, { fieldName: `captureMetadata.${field}` }), expected);
  } catch {
    return false;
  }
}

function artifactRefsForRaw(
  raw: RawObservation,
  verified: readonly VerifiedArtifactInput[],
): readonly Ref<ArtifactRef>[] {
  const verifiedKeys = new Set(
    verified.filter((entry) => entry.verified).map((entry) => refKey(entry.artifactRef)),
  );
  return artifactRefsDeclaredByRaw(raw).filter((ref) => verifiedKeys.has(refKey(ref)));
}

function artifactRefsForRawSet(
  observations: readonly RawObservation[],
  verified: readonly VerifiedArtifactInput[],
): readonly Ref<ArtifactRef>[] {
  return stableRefs(observations.flatMap((raw) => artifactRefsForRaw(raw, verified)));
}

function refKey(ref: Ref): string {
  return `${ref.schema}\u0000${ref.id}\u0000${ref.revision ?? ""}\u0000${ref.digest.value}\u0000${ref.digest.byteLength}`;
}

function sameRef(left: Ref, right: Ref): boolean {
  return refKey(left) === refKey(right);
}

function sameRefSet(left: readonly Ref[], right: readonly Ref[]): boolean {
  const leftKeys = left.map(refKey).sort();
  const rightKeys = right.map(refKey).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

function deriveFileDiffDigest(
  beforeEntries: readonly FileEntry[],
  afterEntries: readonly FileEntry[],
): ReturnType<typeof digestValue> {
  const before = new Map(beforeEntries.map((entry) => [entry.portablePath, entry] as const));
  const after = new Map(afterEntries.map((entry) => [entry.portablePath, entry] as const));
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) =>
    Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
  );
  const added: FileDiff["added"][number][] = [];
  const removed: FileDiff["removed"][number][] = [];
  const modified: FileDiff["modified"][number][] = [];
  const typeChanged: FileDiff["typeChanged"][number][] = [];
  let unchangedCount = 0;
  for (const portablePath of paths) {
    const prior = before.get(portablePath);
    const next = after.get(portablePath);
    if (prior === undefined) {
      added.push({ portablePath, kind: "ADDED", after: next! });
    } else if (next === undefined) {
      removed.push({ portablePath, kind: "REMOVED", before: prior });
    } else if (prior.entryType !== next.entryType) {
      typeChanged.push({ portablePath, kind: "TYPE_CHANGED", before: prior, after: next });
    } else {
      const kind = classifyFileChange(prior, next);
      if (kind === undefined) unchangedCount += 1;
      else modified.push({ portablePath, kind, before: prior, after: next });
    }
  }
  return digestValue({ added, removed, modified, typeChanged, unchangedCount });
}

function classifyFileChange(
  before: FileEntry,
  after: FileEntry,
): "CONTENT_CHANGED" | "METADATA_CHANGED" | "SYMLINK_CHANGED" | "UNREADABLE" | undefined {
  if (before.readError !== undefined || after.readError !== undefined) return "UNREADABLE";
  if (
    before.entryType === "SYMLINK" &&
    (before.linkTarget !== after.linkTarget ||
      before.resolvedWithinRoot !== after.resolvedWithinRoot)
  ) {
    return "SYMLINK_CHANGED";
  }
  if (
    (before.contentDigest === undefined) !== (after.contentDigest === undefined) ||
    (before.contentDigest !== undefined &&
      after.contentDigest !== undefined &&
      !digestEquals(before.contentDigest, after.contentDigest))
  ) {
    return "CONTENT_CHANGED";
  }
  if (before.mode !== after.mode || before.byteLength !== after.byteLength) {
    return "METADATA_CHANGED";
  }
  return undefined;
}
