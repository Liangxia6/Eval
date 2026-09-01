import {
  ContractViolation,
  assertSameAttemptScope,
  digestEquals,
  digestValue,
  refForImmutable,
  validateScope,
  validateStableId,
  withContentDigest,
  type EvidenceBundle,
  type EvidenceClosure,
  type EvidenceContract,
  type EvidenceRecord,
  type JsonObject,
  type Ref,
  type ScopeRef,
  type SourceDescriptor,
  type SourceTrust,
} from "../core/models.js";
import { verifyEvidenceBundleSeal } from "./evidence.js";

export interface BuildClosuresInput {
  readonly scope: ScopeRef;
  readonly bundle: EvidenceBundle;
  readonly bundleRef: Ref<EvidenceBundle>;
  readonly evidenceContracts: readonly EvidenceContract[];
  readonly evidenceContractRefs: readonly Ref<EvidenceContract>[];
  readonly evidence: readonly EvidenceRecord[];
  readonly evidenceRefs: readonly Ref<EvidenceRecord>[];
  readonly sources: readonly SourceDescriptor[];
  readonly createdAt: string;
  readonly producerVersion: string;
  readonly makeClosureId?: (checkId: string) => string;
}

export interface ClosureBuildResult {
  readonly closures: readonly EvidenceClosure[];
  readonly closureRefs: readonly Ref<EvidenceClosure>[];
}

/** Each Check is closed independently; one missing source cannot erase another hard fact. */
export function buildEvidenceClosures(input: BuildClosuresInput): ClosureBuildResult {
  const scope = validateScope(input.scope);
  if (scope.attemptId === undefined || input.bundle.attemptId !== scope.attemptId) {
    throw new ContractViolation("SCOPE_MISMATCH", "EvidenceBundle and Closure Scope differ");
  }
  if (input.evidenceContracts.length !== 3 || input.evidenceContractRefs.length !== 3) {
    throw new ContractViolation(
      "INVALID_EVIDENCE_CONTRACT_SET",
      "MVP requires exactly three EvidenceContracts",
    );
  }
  const contractRefById = new Map(
    input.evidenceContractRefs.map((ref) => [String(ref.id), ref] as const),
  );
  const evidenceRefById = new Map(input.evidenceRefs.map((ref) => [String(ref.id), ref] as const));
  const sourceById = new Map(input.sources.map((source) => [String(source.sourceId), source] as const));

  const evidenceSetValid = validateEvidenceSet(input, evidenceRefById, sourceById, scope);

  const bundleIntegrityValid =
    input.bundle.status === "SEALED" &&
    input.bundleRef.id === input.bundle.bundleId &&
    input.bundleRef.revision === undefined &&
    digestEquals(input.bundle.contentDigest, input.bundleRef.digest) &&
    verifyEvidenceBundleSeal(input.bundle) &&
    evidenceSetValid;

  const closures = [...input.evidenceContracts]
    .sort((left, right) => String(left.checkId).localeCompare(String(right.checkId), "en"))
    .map((contract) => {
      const contractRef = contractRefById.get(String(contract.evidenceContractId));
      if (contractRef === undefined || !digestEquals(contractRef.digest, contract.contentDigest)) {
        throw new ContractViolation(
          "EVIDENCE_CONTRACT_REF_MISMATCH",
          `EvidenceContract ${contract.evidenceContractId} has no matching committed Ref`,
        );
      }
      return closeOneCheck({
        input,
        scope,
        contract,
        contractRef,
        bundleIntegrityValid,
        evidenceRefById,
        sourceById,
      });
    });
  return {
    closures,
    closureRefs: closures.map((closure) => refForImmutable(closure, closure.closureId)),
  };
}

interface CloseOneInput {
  readonly input: BuildClosuresInput;
  readonly scope: ScopeRef;
  readonly contract: EvidenceContract;
  readonly contractRef: Ref<EvidenceContract>;
  readonly bundleIntegrityValid: boolean;
  readonly evidenceRefById: ReadonlyMap<string, Ref<EvidenceRecord>>;
  readonly sourceById: ReadonlyMap<string, SourceDescriptor>;
}

function closeOneCheck(options: CloseOneInput): EvidenceClosure {
  const { input, scope, contract, contractRef, evidenceRefById, sourceById } = options;
  const gaps: JsonObject[] = [];
  const satisfiedRequirements: string[] = [];
  const authorized = new Map<string, Ref<EvidenceRecord>>();
  let invalid = !options.bundleIntegrityValid;

  if (!options.bundleIntegrityValid) {
    gaps.push({ requirement: "BUNDLE_INTEGRITY", reasonCode: "EVIDENCE_BUNDLE_INVALID" });
  }
  if (!digestEquals(contract.contentDigest, digestValue(contract, ["contentDigest"]))) {
    invalid = true;
    gaps.push({ requirement: "CONTRACT_INTEGRITY", reasonCode: "EVIDENCE_CONTRACT_INVALID" });
  }

  for (const factType of [...contract.requiredFactTypes].sort()) {
    const candidates = input.evidence.filter((record) => record.factType === factType);
    if (candidates.length === 0) {
      gaps.push({ requirement: factType, reasonCode: "REQUIRED_FACT_MISSING" });
      continue;
    }

    let requirementSatisfied = false;
    let sawIncomplete = false;
    let sawInvalid = false;
    let sawDisallowedSource = false;
    let sawInsufficientTrust = false;
    for (const evidence of candidates) {
      const ref = evidenceRefById.get(String(evidence.evidenceId));
      const digestValid =
        ref !== undefined &&
        digestEquals(ref.digest, evidence.contentDigest) &&
        digestEquals(evidence.contentDigest, digestValue(evidence, ["contentDigest"]));
      if (!digestValid || evidence.validity !== "VALID") {
        sawInvalid = true;
        continue;
      }
      const sources = evidence.sourceRefs
        .map((sourceRef) => sourceById.get(String(sourceRef.id)))
        .filter((source): source is SourceDescriptor => source !== undefined);
      if (
        sources.length !== evidence.sourceRefs.length ||
        sources.some((source) => !contract.allowedSourceTypes.includes(source.sourceType))
      ) {
        sawDisallowedSource = true;
        continue;
      }
      if (
        !trustMeets(evidence.trust, contract.minimumTrust) ||
        sources.some((source) => !trustMeets(source.trust, contract.minimumTrust))
      ) {
        sawInsufficientTrust = true;
        continue;
      }
      if (
        evidence.completeness !== "COMPLETE" &&
        contract.minimumCompleteness === "COMPLETE"
      ) {
        sawIncomplete = true;
        continue;
      }
      requirementSatisfied = true;
      authorized.set(String(ref!.id), ref!);
    }

    if (requirementSatisfied) {
      satisfiedRequirements.push(factType);
    } else if (sawInvalid && contract.validityRequired) {
      invalid = true;
      gaps.push({ requirement: factType, reasonCode: "REQUIRED_FACT_INVALID" });
    } else if (sawInsufficientTrust) {
      gaps.push({ requirement: factType, reasonCode: "SOURCE_TRUST_INSUFFICIENT" });
    } else if (sawDisallowedSource) {
      gaps.push({ requirement: factType, reasonCode: "SOURCE_TYPE_NOT_AUTHORIZED" });
    } else if (sawIncomplete) {
      gaps.push({ requirement: factType, reasonCode: "REQUIRED_FACT_PARTIAL" });
    } else {
      gaps.push({ requirement: factType, reasonCode: "REQUIRED_FACT_UNAVAILABLE" });
    }
  }

  const complete = gaps.length === 0;
  const state = invalid ? "INVALID" : complete ? "CLOSED" : "INCOMPLETE";
  return withContentDigest({
    schema: "dsheval.mvp.evidence-closure/v1" as const,
    closureId: validateStableId<"EvidenceClosureId">(
      input.makeClosureId?.(String(contract.checkId)) ?? `closure.${contract.checkId}`,
      "closureId",
    ),
    scope,
    checkId: contract.checkId,
    bundleRef: input.bundleRef,
    evidenceContractRef: contractRef,
    completeness: complete ? ("COMPLETE" as const) : ("PARTIAL" as const),
    validity: invalid ? ("INVALID" as const) : ("VALID" as const),
    state,
    satisfiedRequirements: satisfiedRequirements.sort(),
    gaps,
    authorizedEvidenceRefs: invalid ? [] : [...authorized.values()].sort(compareRefs),
    createdAt: input.createdAt,
    producerVersion: input.producerVersion,
  });
}

function validateEvidenceSet(
  input: BuildClosuresInput,
  evidenceRefById: ReadonlyMap<string, Ref<EvidenceRecord>>,
  sourceById: ReadonlyMap<string, SourceDescriptor>,
  scope: ScopeRef,
): boolean {
  if (
    evidenceRefById.size !== input.evidenceRefs.length ||
    sourceById.size !== input.sources.length
  ) {
    return false;
  }
  const bundleKeys = input.bundle.evidenceRefs.map(refKey).sort();
  const suppliedKeys = input.evidenceRefs.map(refKey).sort();
  if (
    bundleKeys.length !== suppliedKeys.length ||
    !bundleKeys.every((key, index) => key === suppliedKeys[index]) ||
    input.evidence.length !== input.evidenceRefs.length
  ) {
    return false;
  }
  for (const source of input.sources) {
    if (!digestEquals(source.contentDigest, digestValue(source, ["contentDigest"]))) return false;
    try {
      assertSameAttemptScope(scope, source.scope);
    } catch {
      return false;
    }
  }
  const seenEvidence = new Set<string>();
  for (const record of input.evidence) {
    if (seenEvidence.has(String(record.evidenceId))) return false;
    seenEvidence.add(String(record.evidenceId));
    const ref = evidenceRefById.get(String(record.evidenceId));
    if (
      ref === undefined ||
      ref.id !== record.evidenceId ||
      !digestEquals(ref.digest, record.contentDigest) ||
      !digestEquals(record.contentDigest, digestValue(record, ["contentDigest"])) ||
      record.attemptId !== scope.attemptId ||
      record.sourceRefs.length === 0
    ) {
      return false;
    }
    try {
      assertSameAttemptScope(scope, record.scope);
    } catch {
      return false;
    }
    for (const sourceRef of record.sourceRefs) {
      const source = sourceById.get(String(sourceRef.id));
      if (
        source === undefined ||
        sourceRef.id !== source.sourceId ||
        !digestEquals(sourceRef.digest, source.contentDigest)
      ) {
        return false;
      }
    }
  }
  return true;
}

function trustMeets(actual: SourceTrust, minimum: SourceTrust): boolean {
  if (minimum === "UNVERIFIED") return true;
  if (minimum === "COOPERATIVE") return actual === "COOPERATIVE" || actual === "INDEPENDENT";
  return actual === "INDEPENDENT";
}

function compareRefs(left: Ref, right: Ref): number {
  return `${left.schema}\u0000${left.id}\u0000${left.revision ?? ""}`.localeCompare(
    `${right.schema}\u0000${right.id}\u0000${right.revision ?? ""}`,
    "en",
  );
}

function refKey(ref: Ref): string {
  return `${ref.schema}\u0000${ref.id}\u0000${ref.revision ?? ""}\u0000${ref.digest.value}\u0000${ref.digest.byteLength}`;
}
