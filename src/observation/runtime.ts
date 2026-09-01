import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import {
  ContractViolation,
  assertSameAttemptScope,
  digestBytes,
  digestEquals,
  validateIsoDateTime,
  validateScope,
  validateStableId,
  withContentDigest,
  type ArtifactRef,
  type CollectionStatus,
  type ContentDigest,
  type EvidenceCompleteness,
  type JsonObject,
  type JsonValue,
  type RawObservation,
  type Ref,
  type ScopeRef,
  type SourceDescriptor,
  type SourceTime,
} from "../core/models.js";
import type { FailureDraft, FailureRecord } from "../core/errors.js";

/** The externally owned wire format emitted by the DSH runtime probe. */
export interface ProbeEnvelope {
  readonly schema: "dsh-eval.probe/v1";
  readonly runId: string;
  readonly probeSeq: number;
  readonly at: string;
  readonly monotonicNs: number | string;
  readonly pid: number;
  readonly kind: string;
  readonly data: Readonly<Record<string, unknown>>;
  /** Unknown external fields are deliberately retained. */
  readonly [field: string]: unknown;
}

export type ProbeAssociation = "MATCHED" | "UNRESOLVED";

export type ProbeIssueCode =
  | "BAD_JSON"
  | "INVALID_ENVELOPE"
  | "RUN_ID_MISMATCH"
  | "PID_MISMATCH"
  | "SEQUENCE_GAP"
  | "SEQUENCE_DUPLICATE"
  | "SEQUENCE_OUT_OF_ORDER"
  | "PROBE_START_MISSING"
  | "PROBE_START_DUPLICATE"
  | "PROBE_START_LATE"
  | "COMMITTED_TURN_MISSING"
  | "PROBE_STOP_MISSING"
  | "PROBE_STOP_DUPLICATE"
  | "PROBE_STOP_EARLY"
  | "PROBE_TRUNCATED"
  | "PROBE_CONTENT_RESTRICTED";

export interface ProbeIssue {
  readonly code: ProbeIssueCode;
  readonly lineNumber?: number;
  readonly probeSeq?: number;
  readonly detail: string;
}

export interface ProbeSequenceGap {
  readonly kind: "GAP";
  readonly firstMissing: number;
  readonly lastMissing: number;
  readonly observedNext: number;
  readonly lineNumber: number;
}

export interface ProbeLineLocation {
  readonly lineNumber: number;
  /** Inclusive byte offset in the committed JSONL artifact. */
  readonly byteStart: number;
  /** Exclusive byte offset, excluding the JSONL newline. */
  readonly byteEnd: number;
  readonly lineDigest: ContentDigest;
}

export interface ParsedProbeRecord {
  readonly envelope: ProbeEnvelope;
  readonly association: ProbeAssociation;
  readonly location: ProbeLineLocation;
}

/**
 * An observation draft is completed with common immutable-record metadata by
 * the repository. Keeping it as a draft prevents the collector from claiming
 * that bytes have already been committed.
 */
export interface ProbeRawObservationDraft {
  readonly observationId: string;
  readonly attemptId: string;
  readonly sourceRef: Ref<SourceDescriptor>;
  readonly externalEventType: string;
  readonly sourceTime: SourceTime;
  readonly payloadInline: ProbeEnvelope;
  readonly captureMetadata: {
    readonly lineNumber: number;
    readonly byteStart: number;
    readonly byteEnd: number;
    readonly association: ProbeAssociation;
    readonly rawArtifactRef?: Ref<ArtifactRef>;
  };
  readonly rawDigest: ContentDigest;
}

export interface ProbeCollectionStatusDraft {
  readonly collectionStatusId: string;
  readonly sourceRef: Ref<SourceDescriptor>;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly recordCount: number;
  readonly firstSourceSeq?: number;
  readonly lastSourceSeq?: number;
  readonly finalWatermark?: string;
  readonly gaps: readonly ProbeCollectionGapDraft[];
  readonly truncated: boolean;
  readonly health: "HEALTHY" | "DEGRADED" | "FAILED";
  readonly completeness: EvidenceCompleteness;
  readonly failureRefs: readonly Ref<FailureRecord>[];
}

export interface ProbeCollectionGapDraft {
  readonly kind: string;
  readonly firstMissingSeq?: number;
  readonly lastMissingSeq?: number;
  readonly reasonCode: string;
  readonly detail: JsonValue;
}

export interface ProbeParseOptions {
  readonly expectedRunId: string;
  /** PID from the committed Target-start receipt, when available. */
  readonly expectedPid?: number;
  readonly attemptId: string;
  readonly sourceRef: Ref<SourceDescriptor>;
  readonly collectionStatusId: string;
  readonly openedAt: string;
  readonly closedAt: string;
  readonly observedAt: string;
  readonly clockDomain?: string;
  readonly rawArtifactRef?: Ref<ArtifactRef>;
  readonly failureRefs?: readonly Ref<FailureRecord>[];
  readonly makeObservationId?: (lineNumber: number, probeSeq: number) => string;
  /** The collector stopped at its frozen byte/time bound. */
  readonly inputTruncated?: boolean;
  /** Raw bytes were sealed as Restricted and must not be copied into ordinary JSON records. */
  readonly contentRestricted?: boolean;
}

export interface BoundedProbeRead {
  readonly bytes: Uint8Array;
  readonly truncated: boolean;
  readonly timedOut: boolean;
}

/** Reads at most the frozen SourceRequirement bound without following a Target-created symlink. */
export async function readProbeFileBounded(input: {
  readonly path: string;
  readonly maxBytes: number;
  readonly timeoutMs: number;
}): Promise<BoundedProbeRead> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes <= 0) {
    throw new ContractViolation("INVALID_INPUT", "Probe maxBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new ContractViolation("INVALID_INPUT", "Probe timeoutMs must be a positive safe integer");
  }
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(input.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bytes: Buffer.alloc(0), truncated: false, timedOut: false };
    }
    throw error;
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new ContractViolation("PATH_ESCAPE", "Probe output must be a regular non-symlink file");
  }
  const handle = await open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const startedAt = Date.now();
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino) {
      throw new ContractViolation("PATH_ESCAPE", "Probe output changed identity before bounded read");
    }
    const targetLength = Math.min(opened.size, input.maxBytes);
    const buffer = Buffer.alloc(targetLength);
    let offset = 0;
    let timedOut = false;
    while (offset < targetLength) {
      if (Date.now() - startedAt >= input.timeoutMs) {
        timedOut = true;
        break;
      }
      const result = await handle.read(buffer, offset, targetLength - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    const closed = await handle.stat();
    const identityChanged = closed.dev !== opened.dev || closed.ino !== opened.ino;
    if (identityChanged) {
      throw new ContractViolation("PATH_ESCAPE", "Probe output changed identity during bounded read");
    }
    return {
      bytes: buffer.subarray(0, offset),
      truncated: timedOut || closed.size > offset,
      timedOut,
    };
  } finally {
    await handle.close();
  }
}

export interface ProbeParseResult {
  /** Exact bytes supplied by the collector. These are never normalized. */
  readonly rawArtifactBytes: Uint8Array;
  /** Longest trustworthy JSONL prefix; a malformed line stops parsing. */
  readonly validPrefixByteLength: number;
  readonly records: readonly ParsedProbeRecord[];
  readonly observations: readonly ProbeRawObservationDraft[];
  readonly collectionStatus: ProbeCollectionStatusDraft;
  readonly issues: readonly ProbeIssue[];
}

export interface MaterializeProbeCollectionInput {
  readonly scope: ScopeRef;
  readonly parseResult: ProbeParseResult;
  readonly rawArtifact: ArtifactRef;
  readonly rawArtifactRef: Ref<ArtifactRef>;
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly failureRefs?: readonly Ref<FailureRecord>[];
}

export interface MaterializedProbeCollection {
  readonly observations: readonly RawObservation[];
  readonly collectionStatus: CollectionStatus;
}

const PROBE_SCHEMA = "dsh-eval.probe/v1";

export const PROBE_IMPLEMENTATION_ID = "dsh-runtime-probe";
export const PROBE_IMPLEMENTATION_VERSION = "1.0.0";
export const PROBE_CAPABILITIES = [
  "CONTENT_MODE_STRUCTURED",
  "CONTIGUOUS_SEQUENCE",
  "ONE_SHOT",
  "PROBE_START_STOP",
  "SESSION_LIFECYCLE",
  "SOURCE_RUN_ID",
  "TOOL_LIFECYCLE",
] as const;
export const PROBE_CAPABILITY_DIGEST: ContentDigest = {
  algorithm: "sha256",
  byteLength: 132,
  value: "11ab0f3b91fd3b28943640d97465e81d06d5baaa3af1eb1668014306e0506418",
};

export function digestRawBytes(bytes: Uint8Array): ContentDigest {
  return digestBytes(bytes);
}

/**
 * Parses a frozen Probe JSONL byte stream. The exact input bytes are returned
 * for ArtifactStore commit; malformed tails never erase the valid prefix.
 */
export function parseProbeJsonl(
  input: Uint8Array | string,
  options: ProbeParseOptions,
): ProbeParseResult {
  const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  const records: ParsedProbeRecord[] = [];
  const observations: ProbeRawObservationDraft[] = [];
  const issues: ProbeIssue[] = [];
  const gaps: ProbeSequenceGap[] = [];
  const seenSequences = new Set<number>();
  let expectedSequence = 0;
  let offset = 0;
  let lineNumber = 1;
  let validPrefixByteLength = 0;
  let malformed = false;

  if (options.contentRestricted === true) {
    issues.push({
      code: "PROBE_CONTENT_RESTRICTED",
      detail: "Probe content matched a configured Secret canary and was withheld from ordinary records",
    });
    offset = bytes.byteLength;
  }

  while (offset < bytes.byteLength) {
    const newlineIndex = bytes.indexOf(0x0a, offset);
    const hasNewline = newlineIndex !== -1;
    const rawEnd = hasNewline ? newlineIndex : bytes.byteLength;
    const contentEnd = rawEnd > offset && bytes[rawEnd - 1] === 0x0d ? rawEnd - 1 : rawEnd;
    const lineBytes = bytes.subarray(offset, contentEnd);

    let parsed: unknown;
    try {
      if (lineBytes.byteLength === 0) {
        throw new SyntaxError("empty JSONL line");
      }
      parsed = JSON.parse(lineBytes.toString("utf8"));
    } catch (error) {
      issues.push({
        code: "BAD_JSON",
        lineNumber,
        detail: error instanceof Error ? error.message : "Probe line is not valid JSON",
      });
      malformed = true;
      break;
    }

    if (!isProbeEnvelope(parsed)) {
      issues.push({
        code: "INVALID_ENVELOPE",
        lineNumber,
        detail: "Probe line does not satisfy dsh-eval.probe/v1 required fields",
      });
      malformed = true;
      break;
    }

    const location: ProbeLineLocation = {
      lineNumber,
      byteStart: offset,
      byteEnd: contentEnd,
      lineDigest: digestRawBytes(lineBytes),
    };
    const runMatches = parsed.runId === options.expectedRunId;
    const pidMatches = options.expectedPid === undefined || parsed.pid === options.expectedPid;
    const association: ProbeAssociation = runMatches && pidMatches ? "MATCHED" : "UNRESOLVED";
    if (!runMatches) {
      issues.push({
        code: "RUN_ID_MISMATCH",
        lineNumber,
        probeSeq: parsed.probeSeq,
        detail: `Expected frozen SourceRunId ${options.expectedRunId}; received ${parsed.runId}`,
      });
    }
    if (!pidMatches) {
      issues.push({
        code: "PID_MISMATCH",
        lineNumber,
        probeSeq: parsed.probeSeq,
        detail: `Expected committed Target PID ${options.expectedPid}; received ${parsed.pid}`,
      });
    }

    if (seenSequences.has(parsed.probeSeq)) {
      issues.push({
        code: "SEQUENCE_DUPLICATE",
        lineNumber,
        probeSeq: parsed.probeSeq,
        detail: `probeSeq ${parsed.probeSeq} was already observed`,
      });
    } else if (parsed.probeSeq < expectedSequence) {
      issues.push({
        code: "SEQUENCE_OUT_OF_ORDER",
        lineNumber,
        probeSeq: parsed.probeSeq,
        detail: `probeSeq ${parsed.probeSeq} arrived after sequence watermark ${expectedSequence - 1}`,
      });
    } else if (parsed.probeSeq > expectedSequence) {
      const gap: ProbeSequenceGap = {
        kind: "GAP",
        firstMissing: expectedSequence,
        lastMissing: parsed.probeSeq - 1,
        observedNext: parsed.probeSeq,
        lineNumber,
      };
      gaps.push(gap);
      issues.push({
        code: "SEQUENCE_GAP",
        lineNumber,
        probeSeq: parsed.probeSeq,
        detail: `Missing probeSeq ${gap.firstMissing}..${gap.lastMissing}`,
      });
      expectedSequence = parsed.probeSeq + 1;
    } else {
      expectedSequence += 1;
    }
    seenSequences.add(parsed.probeSeq);

    records.push({ envelope: parsed, association, location });
    observations.push({
      observationId:
        options.makeObservationId?.(lineNumber, parsed.probeSeq) ??
        `probe.${options.attemptId}.${lineNumber}`,
      attemptId: options.attemptId,
      sourceRef: options.sourceRef,
      externalEventType: parsed.kind,
      sourceTime: {
        wallTime: parsed.at,
        ...(toSafeInteger(parsed.monotonicNs) === undefined
          ? {}
          : { monotonicNs: toSafeInteger(parsed.monotonicNs) }),
        sourceSeq: parsed.probeSeq,
        observedAt: options.observedAt,
        clockDomain: options.clockDomain ?? "dsh-runtime-probe",
      },
      payloadInline: parsed,
      captureMetadata: {
        lineNumber,
        byteStart: offset,
        byteEnd: contentEnd,
        association,
        ...(options.rawArtifactRef === undefined ? {} : { rawArtifactRef: options.rawArtifactRef }),
      },
      rawDigest: location.lineDigest,
    });

    validPrefixByteLength = hasNewline ? rawEnd + 1 : rawEnd;
    offset = hasNewline ? rawEnd + 1 : rawEnd;
    lineNumber += 1;
  }

  validateProbeBoundaries(records, issues);
  if (options.inputTruncated === true) {
    issues.push({
      code: "PROBE_TRUNCATED",
      detail: "Probe collection reached its frozen byte or time bound",
    });
  }
  const sequences = records.map((record) => record.envelope.probeSeq);
  const stopRecords = records.filter((record) => record.envelope.kind === "probe/stop");
  const complete = issues.length === 0;
  const collectionGaps = issues.map((issue): ProbeCollectionGapDraft => {
    const sequenceGap =
      issue.code === "SEQUENCE_GAP"
        ? gaps.find(
            (gap) => gap.lineNumber === issue.lineNumber && gap.observedNext === issue.probeSeq,
          )
        : undefined;
    return {
      kind: issue.code,
      ...(sequenceGap === undefined
        ? {}
        : {
            firstMissingSeq: sequenceGap.firstMissing,
            lastMissingSeq: sequenceGap.lastMissing,
          }),
      reasonCode: probeIssueReasonCode(issue.code),
      detail: {
        ...(issue.lineNumber === undefined ? {} : { lineNumber: issue.lineNumber }),
        ...(issue.probeSeq === undefined ? {} : { probeSeq: issue.probeSeq }),
        message: issue.detail,
      },
    };
  });

  return {
    rawArtifactBytes: Uint8Array.from(bytes),
    validPrefixByteLength,
    records,
    observations,
    collectionStatus: {
      collectionStatusId: options.collectionStatusId,
      sourceRef: options.sourceRef,
      openedAt: options.openedAt,
      closedAt: options.closedAt,
      recordCount: records.length,
      ...(sequences.length === 0
        ? {}
        : {
            firstSourceSeq: sequences[0],
            lastSourceSeq: sequences[sequences.length - 1],
          }),
      ...(stopRecords.length === 1
        ? { finalWatermark: `probeSeq:${stopRecords[0]!.envelope.probeSeq}` }
        : {}),
      gaps: collectionGaps,
      truncated:
        malformed ||
        options.inputTruncated === true ||
        options.contentRestricted === true ||
        validPrefixByteLength < bytes.byteLength,
      health: complete ? "HEALTHY" : "DEGRADED",
      completeness: complete ? "COMPLETE" : "PARTIAL",
      failureRefs: options.failureRefs ?? [],
    },
    issues,
  };
}

/** Finalizes Probe drafts only after the exact JSONL bytes have been committed. */
export function materializeProbeCollection(
  input: MaterializeProbeCollectionInput,
): MaterializedProbeCollection {
  const scope = validateScope(input.scope);
  if (scope.attemptId === undefined) {
    throw new ContractViolation("INVALID_SCOPE", "Probe observations require Attempt Scope");
  }
  assertSameAttemptScope(scope, input.rawArtifact.scope);
  if (
    !digestEquals(digestRawBytes(input.parseResult.rawArtifactBytes), input.rawArtifact.artifactContentDigest) ||
    !digestEquals(input.rawArtifact.contentDigest, input.rawArtifactRef.digest) ||
    input.rawArtifact.artifactId !== input.rawArtifactRef.id
  ) {
    throw new ContractViolation(
      "EVIDENCE_INTEGRITY",
      "Committed Probe Artifact does not match the exact collected JSONL bytes",
    );
  }
  const observations = input.parseResult.observations.map((draft) => {
    if (draft.attemptId !== scope.attemptId) {
      throw new ContractViolation("SCOPE_MISMATCH", "Probe observation belongs to another Attempt");
    }
    const captureMetadata: JsonObject = {
      lineNumber: draft.captureMetadata.lineNumber,
      byteStart: draft.captureMetadata.byteStart,
      byteEnd: draft.captureMetadata.byteEnd,
      association: draft.captureMetadata.association,
      rawArtifactRef: refJson(input.rawArtifactRef),
    };
    return withContentDigest({
      schema: "dsheval.mvp.raw-observation/v1" as const,
      observationId: validateStableId<"ObservationId">(draft.observationId, "observationId"),
      scope,
      attemptId: scope.attemptId!,
      sourceRef: draft.sourceRef,
      externalEventType: draft.externalEventType,
      sourceTime: draft.sourceTime,
      payloadInline: draft.payloadInline as unknown as JsonValue,
      captureMetadata,
      rawDigest: draft.rawDigest,
      createdAt: input.createdAt,
      producerVersion: input.producerVersion,
    });
  });
  const draft = input.parseResult.collectionStatus;
  const finalWatermark = draft.finalWatermark?.startsWith("probeSeq:")
    ? { probeSeq: Number(draft.finalWatermark.slice("probeSeq:".length)) }
    : undefined;
  const collectionStatus = withContentDigest({
    schema: "dsheval.mvp.collection-status/v1" as const,
    collectionStatusId: validateStableId<"CollectionStatusId">(
      draft.collectionStatusId,
      "collectionStatusId",
    ),
    scope,
    sourceRef: draft.sourceRef,
    openedAt: draft.openedAt,
    closedAt: draft.closedAt,
    recordCount: draft.recordCount,
    ...(draft.firstSourceSeq === undefined ? {} : { firstSourceSeq: draft.firstSourceSeq }),
    ...(draft.lastSourceSeq === undefined ? {} : { lastSourceSeq: draft.lastSourceSeq }),
    ...(finalWatermark === undefined ? {} : { finalWatermark }),
    gaps: draft.gaps,
    truncated: draft.truncated,
    health: draft.health,
    completeness: draft.completeness,
    failureRefs: stableFailureRefs([...(draft.failureRefs ?? []), ...(input.failureRefs ?? [])]),
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
  return { observations, collectionStatus };
}

/** Converts collector completeness issues into persistable, non-Agent failures. */
export function probeIssueFailureDrafts(
  parseResult: ProbeParseResult,
  input: {
    readonly scope: ScopeRef;
    readonly occurredAt: string;
    readonly rawArtifactRef?: Ref<ArtifactRef>;
  },
): readonly FailureDraft[] {
  const scope = validateScope(input.scope);
  const uniqueCodes = [...new Set(parseResult.issues.map((issue) => issue.code))].sort();
  return uniqueCodes.map((code) => ({
    scope,
    category: "OBSERVATION_FAILURE" as const,
    origin: "DSHEVAL" as const,
    actor: "COLLECTOR" as const,
    phase: "PROBE_DRAIN",
    severity: "ERROR" as const,
    retryable: false as const,
    messageRedacted: `Runtime Probe collection is incomplete (${code})`,
    reasonCode: probeIssueReasonCode(code),
    evidenceRefs: [],
    artifactRefs: input.rawArtifactRef === undefined ? [] : [input.rawArtifactRef],
    occurredAt: validateIsoDateTime(input.occurredAt, "occurredAt"),
  }));
}

function refJson(ref: Ref): JsonObject {
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

function validateProbeBoundaries(
  records: readonly ParsedProbeRecord[],
  issues: ProbeIssue[],
): void {
  const starts = records.filter((record) => record.envelope.kind === "probe/start");
  const stops = records.filter((record) => record.envelope.kind === "probe/stop");
  const committedTurns = records.filter(
    (record) =>
      record.envelope.kind === "session/event" &&
      isRecord(record.envelope.data.event) &&
      (record.envelope.data.event.type === "turn/start" ||
        record.envelope.data.event.type === "turn/end"),
  );

  if (starts.length === 0) {
    issues.push({ code: "PROBE_START_MISSING", detail: "probe/start was not observed" });
  } else if (starts.length > 1) {
    issues.push({ code: "PROBE_START_DUPLICATE", detail: "More than one probe/start was observed" });
  }
  if (committedTurns.length === 0) {
    issues.push({
      code: "COMMITTED_TURN_MISSING",
      detail: "No committed session turn boundary was observed",
    });
  }
  if (
    starts.length > 0 &&
    committedTurns.length > 0 &&
    starts[0]!.location.lineNumber >= committedTurns[0]!.location.lineNumber
  ) {
    issues.push({
      code: "PROBE_START_LATE",
      lineNumber: starts[0]!.location.lineNumber,
      probeSeq: starts[0]!.envelope.probeSeq,
      detail: "probe/start did not precede the first committed turn",
    });
  }

  if (stops.length === 0) {
    issues.push({ code: "PROBE_STOP_MISSING", detail: "probe/stop was not observed" });
  } else if (stops.length > 1) {
    issues.push({ code: "PROBE_STOP_DUPLICATE", detail: "More than one probe/stop was observed" });
  }
  if (
    stops.length > 0 &&
    committedTurns.length > 0 &&
    stops[stops.length - 1]!.location.lineNumber <=
      committedTurns[committedTurns.length - 1]!.location.lineNumber
  ) {
    const stop = stops[stops.length - 1]!;
    issues.push({
      code: "PROBE_STOP_EARLY",
      lineNumber: stop.location.lineNumber,
      probeSeq: stop.envelope.probeSeq,
      detail: "probe/stop did not follow the last committed turn boundary",
    });
  }
}

function isProbeEnvelope(value: unknown): value is ProbeEnvelope {
  if (!isRecord(value)) return false;
  return (
    value.schema === PROBE_SCHEMA &&
    typeof value.runId === "string" &&
    Number.isSafeInteger(value.probeSeq) &&
    (value.probeSeq as number) >= 0 &&
    typeof value.at === "string" &&
    Number.isFinite(Date.parse(value.at)) &&
    isMonotonicNs(value.monotonicNs) &&
    Number.isSafeInteger(value.pid) &&
    (value.pid as number) > 0 &&
    typeof value.kind === "string" &&
    value.kind.length > 0 &&
    isRecord(value.data)
  );
}

function probeIssueReasonCode(code: ProbeIssueCode): string {
  return code.startsWith("PROBE_") ? code : `PROBE_${code}`;
}

function isMonotonicNs(value: unknown): value is number | string {
  return (
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (typeof value === "string" && /^\d+$/.test(value))
  );
}

function toSafeInteger(value: number | string): number | undefined {
  const converted = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(converted) && converted >= 0 ? converted : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableFailureRefs(refs: readonly Ref<FailureRecord>[]): readonly Ref<FailureRecord>[] {
  const unique = new Map(refs.map((ref) => [`${ref.id}\u0000${ref.digest.value}`, ref] as const));
  return [...unique.values()].sort((left, right) => String(left.id).localeCompare(String(right.id), "en"));
}
