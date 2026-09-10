/**
 * 文件职责：把密封观测会话中的原始观测、文件状态和已验证 Artifact 标准化为可审计 EvidenceBundle。
 * 核心流程：校验会话及成员引用，验证 Artifact/文件派生关系，生成标准化与聚合事实，最后计算 Bundle 内容摘要和语义封印。
 * 真实交互：上游接收 observation 模块与 ArtifactStore 产生的记录；下游由 closure.ts 验证封印并按 EvidenceContract 授权给 Judge。
 * 公开接口：VerifiedArtifactInput、BuildEvidenceInput、EvidenceBuildIssue、EvidenceBuildResult、evidenceBundleSealDigest、verifyEvidenceBundleSeal、buildEvidenceBundle。
 */
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
  type ProcessDiff,
  type RawObservation,
  type Ref,
  type SeedManifest,
  type ScopeRef,
  type SourceDescriptor,
  type StableId,
} from "../core/models.js";
import type { FailureDraft, FailureRecord } from "../core/errors.js";

/** ArtifactStore.readVerified 的验证结果与对应引用，防止未经读取校验的字节进入证据链。 */
export interface VerifiedArtifactInput {
  readonly artifactRef: Ref<ArtifactRef>;
  /** Must be produced by ArtifactStore.readVerified, never by the Agent. */
  readonly verified: boolean;
}

/** 构建 EvidenceBundle 所需的完整观测图、可选文件派生记录及生成元数据。 */
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
  readonly processDiff?: ProcessDiff;
  readonly processDiffRef?: Ref<ProcessDiff>;
  readonly seedManifest?: SeedManifest;
  readonly seedManifestRef?: Ref<SeedManifest>;
  readonly verifiedArtifacts: readonly VerifiedArtifactInput[];
  readonly failureRefs?: readonly Ref<FailureRecord>[];
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly makeEvidenceId?: (factType: string, ordinal: number) => string;
}

/** 证据构建期间发现的可审计完整性问题；问题会使 Bundle 以 INVALID 状态密封。 */
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

/** EvidenceBundle、其中的 EvidenceRecord，以及可选的持久化失败草稿。 */
export interface EvidenceBuildResult {
  readonly bundle: EvidenceBundle;
  readonly evidence: readonly EvidenceRecord[];
  readonly issues: readonly EvidenceBuildIssue[];
  readonly failureDraft?: FailureDraft;
}

/** 计算语义封印时包含的 Bundle 字段集合，排除两个自引用摘要字段。 */
type EvidenceBundleSealFields = Omit<EvidenceBundle, "contentDigest" | "sealDigest">;

/** buildEvidenceBundle 用它独立绑定每个持久化字段；closure.ts 也用同一算法复验封印。 */
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

/** 供 closure.ts 和其他读取方同时复验 Bundle 内容摘要与语义封印。 */
export function verifyEvidenceBundleSeal(bundle: EvidenceBundle): boolean {
  return (
    digestEquals(bundle.contentDigest, digestValue(bundle, ["contentDigest"])) &&
    digestEquals(bundle.sealDigest, evidenceBundleSealDigest(bundle))
  );
}

/**
 * 应用编排层调用的证据构建入口：把不可变观测转换为标准化/派生事实，并保留每条事实的原始引用链。
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
  if (input.sources.length === 0 || sourceById.size !== input.sources.length) {
    issues.push({
      code: "SOURCE_IDENTITY_MISMATCH",
      detail: "Evidence requires one or more uniquely identified Sources",
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

/** 由 buildEvidenceBundle 调用，按稳定顺序生成单条观测事实、协议聚合事实和文件派生事实。 */
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

  ordinal = appendAgentSemanticEvidence({
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

  if (input.processDiff !== undefined && input.processDiffRef !== undefined) {
    const source = input.sources.find((candidate) => candidate.sourceType === "PROCESS");
    if (source !== undefined) {
      const processRaw = input.rawObservations.filter((raw) => raw.sourceRef.id === source.sourceId);
      records.push(
        makeEvidenceRecord(input, scope, {
          evidenceId: evidenceId(input, "ENVIRONMENT_DIFF", ordinal++),
          factType: "ENVIRONMENT_DIFF",
          factValue: {
            component: "PROCESS",
            diffRef: refJson(input.processDiffRef),
            started: input.processDiff.started as unknown as JsonValue,
            exited: input.processDiff.exited as unknown as JsonValue,
            persisted: input.processDiff.persisted as unknown as JsonValue,
          },
          sourceRefs: [refForImmutable(source, source.sourceId)],
          observationRefs: refsForRaw(processRaw, rawRefById),
          artifactRefs: artifactRefsForRawSet(processRaw, input.verifiedArtifacts),
          authority: "ENVIRONMENT_STATE",
          derivationRuleId: validateStableId<"DerivationRuleId">("derive.process.diff-v1"),
          timeRange: {},
          completeness: statusBySource.get(String(source.sourceId))?.completeness ?? "PARTIAL",
          validity: "VALID",
          trust: source.trust,
        }),
      );
    }
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

/** appendProtocolAggregateEvidence 的内部上下文，复用记录数组、序号和观测索引。 */
interface AppendProtocolInput {
  readonly input: BuildEvidenceInput;
  readonly scope: ScopeRef;
  readonly records: EvidenceRecord[];
  readonly ordinal: number;
  readonly rawRefById: ReadonlyMap<string, Ref<RawObservation>>;
  readonly statusBySource: ReadonlyMap<string, CollectionStatus>;
}

/** 从 DSH_PROBE 原始事件派生边界、序列、Scope 和生命周期事实，并返回下一个证据序号。 */
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

/**
 * 为全部 Agent Trace 建立一次无遗漏索引，并派生 Label 使用的紧凑语义事实。
 * 原始事件只在 raw Probe Artifact 中保存一份，避免分类时复制数百 MB JSON。
 */
function appendAgentSemanticEvidence(options: AppendProtocolInput): number {
  let ordinal = options.ordinal;
  const source = options.input.sources.find((candidate) => candidate.sourceType === "DSH_PROBE");
  if (source === undefined) return ordinal;
  const traceRaw = options.input.rawObservations
    .filter((raw) => raw.sourceRef.id === source.sourceId && raw.payloadInline !== undefined)
    .sort(compareRawObservation);
  if (traceRaw.length === 0) return ordinal;
  const status = options.statusBySource.get(String(source.sourceId));
  const completeness = status?.completeness ?? "PARTIAL";
  const sourceRef = refForImmutable(source, source.sourceId);
  options.records.push(makeEvidenceRecord(options.input, options.scope, {
    evidenceId: evidenceId(options.input, "AGENT_TRACE", ordinal++),
    factType: "AGENT_TRACE",
    factValue: {
      capturedRecordCount: status?.recordCount ?? traceRaw.length,
      materializedEventCount: traceRaw.length,
      events: traceRaw.map(traceIndexEntry) as JsonValue,
      storage: "Full payloads are stored once in the verified raw Probe Artifact; each index entry points to its RawObservation and exact byte digest.",
    },
    sourceRefs: [sourceRef],
    observationRefs: refsForRaw(traceRaw, options.rawRefById),
    artifactRefs: artifactRefsForRawSet(traceRaw, options.input.verifiedArtifacts),
    authority: "COMMITTED",
    timeRange: sourceTimeRange(traceRaw),
    completeness,
    validity: traceRaw.some((raw) => readAssociation(raw.captureMetadata) === "UNRESOLVED")
      ? "INVALID"
      : "VALID",
    trust: source.trust,
    derivationRuleId: validateStableId<"DerivationRuleId">("derive.agent-trace.index-v1"),
  }));
  const definitions: readonly {
    readonly factType: string;
    readonly select: (raw: RawObservation) => boolean;
    readonly summarize?: true;
  }[] = [
    {
      factType: "RUNTIME_EVENT",
      select: () => true,
      summarize: true,
    },
    {
      factType: "ACTION_SEQUENCE",
      select: (raw) => traceMatches(raw, /^(?:turn|step|agent\/inbox|agent\/(?:pre-step|request|status|created|session-start))(?:[/.]|$)/iu),
    },
    {
      factType: "TOOL_CALL",
      select: (raw) => traceMatches(raw, /^(?:tool\/call|tools?\/(?:pre-execute|execute)|pipeline\.tools\.(?:pre|execute)\.input)$/iu),
    },
    {
      factType: "TOOL_RESULT",
      select: (raw) => traceMatches(raw, /^(?:tool\/result|tool\.final-result|tools?\/(?:result|post-execute)|pipeline\.tools\.(?:execute|post)\.(?:output|error))$/iu),
    },
    {
      factType: "MEMORY_PROBE",
      select: (raw) => traceMatches(raw, /^(?:request\/context|compaction(?:[/.]|$)|memory(?:[/.]|$)|persistence(?:[/.]|$)|session\.flush)$/iu),
    },
    {
      factType: "RETRIEVED_SOURCE",
      select: (raw) => traceMatches(raw, /(?:retriev|search|web|browser|fetch|citation|source)/iu),
    },
    {
      factType: "COLLABORATION_EVENT",
      select: (raw) => traceMatches(raw, /(?:subagent|agent\/inbox|delegat|collaborat)/iu),
    },
    {
      factType: "MULTIMODAL_INPUT",
      select: (raw) => traceMatches(raw, /(?:multimodal|image|audio|video|vision|image_url)/iu),
    },
    {
      factType: "DOCUMENT_ACCESS",
      select: (raw) => traceMatches(raw, /(?:document|pdf|docx|xlsx|spreadsheet|slides?|pptx)/iu),
    },
    {
      factType: "WEB_ACCESS",
      select: (raw) => traceMatches(raw, /(?:web[_./-]|browser|search|fetch|https?:)/iu),
    },
    {
      factType: "DATA_STATE",
      select: (raw) => traceMatches(raw, /(?:database|\bsql\b|dataframe|dataset|table[_./-]|query[_./-])/iu),
    },
    {
      factType: "EXTERNAL_STATE",
      select: (raw) => traceMatches(raw, /(?:external|connector|api|http)/iu),
    },
  ];
  for (const definition of definitions) {
    const selected = traceRaw.filter(definition.select);
    if (selected.length === 0) continue;
    options.records.push(makeEvidenceRecord(options.input, options.scope, {
      evidenceId: evidenceId(options.input, definition.factType, ordinal++),
      factType: definition.factType,
      factValue: definition.summarize === true
        ? traceSummary(selected)
        : { eventCount: selected.length, events: selected.map(semanticTraceEvent) as JsonValue },
      sourceRefs: [sourceRef],
      observationRefs: refsForRaw(selected, options.rawRefById),
      artifactRefs: artifactRefsForRawSet(selected, options.input.verifiedArtifacts),
      authority: "COMMITTED",
      timeRange: sourceTimeRange(selected),
      completeness,
      validity: selected.some((raw) => readAssociation(raw.captureMetadata) === "UNRESOLVED")
        ? "INVALID"
        : "VALID",
      trust: source.trust,
      derivationRuleId: validateStableId<"DerivationRuleId">(
        `derive.agent-trace.${definition.factType.toLowerCase().replaceAll("_", "-")}-v1`,
      ),
    }));
  }
  return ordinal;
}

/** 匹配结构化 Envelope 的显式事件类型/名称/工具名，不扫描整份重复 payload。 */
function traceMatches(raw: RawObservation, pattern: RegExp): boolean {
  return traceNames(raw).some((name) => pattern.test(name));
}

function traceEnvelope(raw: RawObservation): JsonObject | undefined {
  return isJsonObject(raw.payloadInline) ? raw.payloadInline : undefined;
}

function traceData(raw: RawObservation): JsonObject | undefined {
  const data = traceEnvelope(raw)?.data;
  return isJsonObject(data) ? data : undefined;
}

function traceNames(raw: RawObservation): string[] {
  const envelope = traceEnvelope(raw);
  const data = traceData(raw);
  const payload = isJsonObject(data?.payload) ? data.payload : undefined;
  const event = isJsonObject(data?.event)
    ? data.event
    : isJsonObject(payload?.event) ? payload.event : undefined;
  const eventData = isJsonObject(event?.data) ? event.data : undefined;
  const native = isJsonObject(data?.native) ? data.native : undefined;
  return [
    envelope?.kind,
    data?.eventName,
    payload?.eventName,
    event?.type,
    eventData?.name,
    native?.kind,
  ].filter((value): value is string => typeof value === "string");
}

/** 每条 Trace 都有稳定索引；大 payload 通过 RawObservation/Artifact 摘要可审计回溯。 */
function traceIndexEntry(raw: RawObservation): JsonObject {
  const names = traceNames(raw);
  return {
    observationId: String(raw.observationId),
    ...(raw.sourceTime.sourceSeq === undefined ? {} : { sourceSeq: raw.sourceTime.sourceSeq }),
    ...(raw.sourceTime.wallTime === undefined ? {} : { at: raw.sourceTime.wallTime }),
    externalEventType: raw.externalEventType,
    names,
    rawDigest: {
      algorithm: raw.rawDigest.algorithm,
      value: raw.rawDigest.value,
      byteLength: raw.rawDigest.byteLength,
    },
  };
}

/** Judge 需要的语义事件保留 Session 正式事件；内部 dispatch 只保留名称和关联。 */
function semanticTraceEvent(raw: RawObservation): JsonObject {
  const envelope = traceEnvelope(raw);
  const data = traceData(raw);
  const native = isJsonObject(data?.native) ? data.native : undefined;
  const event = isJsonObject(data?.event) ? data.event : undefined;
  return {
    ...traceIndexEntry(raw),
    ...(typeof data?.sessionId === "string" ? { sessionId: data.sessionId } : {}),
    ...(event === undefined ? {} : { event }),
    ...(isJsonObject(native?.correlation) ? { correlation: native.correlation } : {}),
    ...(envelope?.kind === "runtime/log" ? { log: data ?? {} } : {}),
  };
}

/** 效率标签使用全量事件计数而非复制所有 payload。 */
function traceSummary(selected: readonly RawObservation[]): JsonObject {
  const counts: Record<string, number> = {};
  for (const raw of selected) {
    const name = traceNames(raw)[0] ?? raw.externalEventType;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return {
    eventCount: selected.length,
    eventTypeCounts: Object.fromEntries(Object.entries(counts).sort(([left], [right]) =>
      left.localeCompare(right, "en"))),
  };
}

/** makeEvidenceRecord 接收的标准字段，集中约束所有 EvidenceRecord 的共同形状。 */
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

/** 被各事实构建分支调用，统一稳定化引用并补齐 Scope、时间和 contentDigest。 */
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

/** 将单条 RawObservation 映射为标准事实类型与权威级别，供 buildEvidenceRecords 使用。 */
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
  if (raw.externalEventType === "environment/change") {
    return { factType: "ENVIRONMENT_DIFF", factValue: payload, authority: "ENVIRONMENT_STATE" };
  }
  return { factType: "PROBE_EVENT_UNKNOWN", factValue: payload, authority: "DIAGNOSTIC" };
}

/** 校验 ObservationSession 的摘要、Ref 版本、Attempt Scope 和密封水位，并累积问题。 */
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

/** 核对密封会话声明的 Source/CollectionStatus 集合与本次输入是否完全一致。 */
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

/** 验证 RawObservation 的唯一性、摘要、Scope 和 Ref 后建立按 observationId 查询的索引。 */
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

/** 确认每条原始观测声明的 Artifact 都有唯一且成功的 ArtifactStore 验证结果。 */
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

/** 验证快照、Diff、SeedManifest 及其 Ref/原始观测之间的确定性派生关系。 */
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

/** 通用不可变记录摘要校验；各输入验证器调用并把失败写入 issues。 */
function validateImmutableDigest(
  record: { readonly contentDigest: ReturnType<typeof digestValue> },
  label: string,
  issues: EvidenceBuildIssue[],
): void {
  if (!digestEquals(record.contentDigest, digestValue(record, ["contentDigest"]))) {
    issues.push({ code: "DIGEST_MISMATCH", detail: `${label} contentDigest is invalid` });
  }
}

/** 从原始观测中选出指定 BEFORE/AFTER 文件快照事件。 */
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

/** 安全读取 captureMetadata 中的 Attempt 关联标记。 */
function readAssociation(metadata: JsonObject): string | undefined {
  return typeof metadata.association === "string" ? metadata.association : undefined;
}

/** 把一组原始观测解析为去重且稳定排序的已提交 Ref。 */
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

/** 汇总观测的首尾墙钟时间与源序号范围，供聚合 EvidenceRecord 使用。 */
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

/** 在协议 Scope 派生时收窄内联 JSON 值为普通对象。 */
function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 使用可注入工厂或默认规则生成并校验稳定 EvidenceId。 */
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

/** 按源序号、再按 observationId 排序，保证证据生成可复现。 */
function compareRawObservation(left: RawObservation, right: RawObservation): number {
  const leftSeq = left.sourceTime.sourceSeq ?? Number.MAX_SAFE_INTEGER;
  const rightSeq = right.sourceTime.sourceSeq ?? Number.MAX_SAFE_INTEGER;
  return leftSeq - rightSeq || String(left.observationId).localeCompare(String(right.observationId), "en");
}

/** 将 Ref 转成可嵌入 factValue 的 JSON 对象，避免携带非 JSON 结构。 */
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

/** 按 Ref 身份去重并稳定排序，供 EvidenceRecord 与 Bundle 生成确定性摘要。 */
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

/** 读取 RawObservation 显式声明的 Artifact 引用，并拒绝非法或非 Artifact schema。 */
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

/** 校验 captureMetadata 指定字段是否精确引用预期记录。 */
function metadataRefMatches(raw: RawObservation, field: string, expected: Ref): boolean {
  const candidate = raw.captureMetadata[field];
  if (candidate === undefined) return false;
  try {
    return sameRef(validateRef(candidate, { fieldName: `captureMetadata.${field}` }), expected);
  } catch {
    return false;
  }
}

/** 仅保留已由 ArtifactStore 验证的单条观测 Artifact 引用。 */
function artifactRefsForRaw(
  raw: RawObservation,
  verified: readonly VerifiedArtifactInput[],
): readonly Ref<ArtifactRef>[] {
  const verifiedKeys = new Set(
    verified.filter((entry) => entry.verified).map((entry) => refKey(entry.artifactRef)),
  );
  return artifactRefsDeclaredByRaw(raw).filter((ref) => verifiedKeys.has(refKey(ref)));
}

/** 汇总多条观测的已验证 Artifact 引用，并稳定去重。 */
function artifactRefsForRawSet(
  observations: readonly RawObservation[],
  verified: readonly VerifiedArtifactInput[],
): readonly Ref<ArtifactRef>[] {
  return stableRefs(observations.flatMap((raw) => artifactRefsForRaw(raw, verified)));
}

/** 编码 Ref 的 schema、ID、版本和摘要，作为严格集合比较键。 */
function refKey(ref: Ref): string {
  return `${ref.schema}\u0000${ref.id}\u0000${ref.revision ?? ""}\u0000${ref.digest.value}\u0000${ref.digest.byteLength}`;
}

/** 比较两个 Ref 的完整身份；文件输入关联校验会调用。 */
function sameRef(left: Ref, right: Ref): boolean {
  return refKey(left) === refKey(right);
}

/** 忽略输入顺序比较两个 Ref 集合，供会话成员一致性校验使用。 */
function sameRefSet(left: readonly Ref[], right: readonly Ref[]): boolean {
  const leftKeys = left.map(refKey).sort();
  const rightKeys = right.map(refKey).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index]);
}

/** 从 BEFORE/AFTER FileEntry 重算规范化 Diff 摘要，用于验证外部提交的 FileDiff。 */
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

/** 比较同一路径前后条目，给 deriveFileDiffDigest 返回确定性的变化分类。 */
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
