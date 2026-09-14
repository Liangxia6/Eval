/** 唯一 all trace 装配入口：保留实际内容、来源和覆盖状态，不生成旧 Judge 的派生事实。 */
import { digestValue, digestEquals, type JsonValue, type ArtifactRef, type CollectionStatus, type RawObservation, type ScopeRef, type SourceDescriptor } from "../core/models.js";
import { freezeJson } from "../core/models.js";
import type { AllTrace, FinalResponse, SubmissionFile, TraceEntry } from "./types.js";

export function assembleAllTrace(input: {
  traceId: string; scope: ScopeRef; createdAt: string; producerVersion: string;
  agentObservations: readonly RawObservation[];
  agentContents?: ReadonlyMap<number,JsonValue>;
  environmentChanges: readonly RawObservation[];
  sources: readonly SourceDescriptor[]; coverage: readonly CollectionStatus[];
  artifacts: readonly ArtifactRef[];
  finalResponse: FinalResponse; files: readonly SubmissionFile[];
}): AllTrace {
  const integrity: {code:string; id:string}[] = [];
  const sourceIds = new Set(input.sources.map(source => String(source.sourceId)));
  const entries: TraceEntry[] = [];
  const ids = new Set<string>();
  for (const [layer, records] of [["AGENT",input.agentObservations],["ENVIRONMENT",input.environmentChanges]] as const) {
    for (const observation of records) {
      const id = String(observation.observationId);
      if (ids.has(id)) throw new Error(`Duplicate all trace entry: ${id}`);
      ids.add(id);
      if (!digestEquals(observation.contentDigest, digestValue(observation,["contentDigest"]))) integrity.push({code:"RECORD_DIGEST_MISMATCH",id});
      if (observation.scope.attemptId !== input.scope.attemptId) throw new Error(`Cross-attempt trace entry: ${id}`);
      if (!sourceIds.has(String(observation.sourceRef.id))) integrity.push({code:"UNKNOWN_SOURCE",id});
      entries.push({ id, layer, sourceId:String(observation.sourceRef.id), observation, content: layer==="AGENT" ? input.agentContents?.get(Number(observation.captureMetadata.lineNumber)) ?? observation.payloadInline ?? null : observation.payloadInline ?? null });
    }
  }
  entries.push({ id:`${input.traceId}.final-response`, layer:"DELIVERY", content:JSON.parse(JSON.stringify(input.finalResponse)) });
  for (const [index,file] of input.files.entries()) entries.push({ id:`${input.traceId}.file.${index+1}`, layer:"DELIVERY", content:JSON.parse(JSON.stringify(file)) });
  const record = {
    schema:"dsheval.all-trace/v1" as const, traceId:input.traceId, scope:input.scope,
    createdAt:input.createdAt, producerVersion:input.producerVersion,
    entries, sources:input.sources, coverage:input.coverage, artifacts:input.artifacts, integrity,
  };
  return freezeJson({...record, contentDigest:digestValue(record)});
}
