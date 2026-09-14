/** 保存和验证统一记录，不计算分数，也不生成展示字段。 */
import { digestValue, digestEquals } from "../core/models.js";
import type { EvaluationResult, ResultData } from "./types.js";
export function buildResult(data:ResultData,producerVersion:string):EvaluationResult {
  const record={schema:"dsheval.result/v1" as const,reportId:"report."+data.runId,
    createdAt:new Date().toISOString(),producerVersion,...data};
  return {...record,contentDigest:digestValue(record)};
}
export function parseVerifiedReportDocument(text:string):EvaluationResult {
  const data=JSON.parse(text);
  if(data.schema!=="dsheval.result/v1" || typeof data.runId!=="string" ||
    data.scope?.runId!==data.runId || !data.target || !Array.isArray(data.scores) ||
    !Array.isArray(data.dimensions) || !Array.isArray(data.timeline) || !Array.isArray(data.artifacts) ||
    !digestEquals(data.contentDigest,digestValue(data,["contentDigest"]))) throw new Error("Invalid evaluation result or digest");
  return data;
}
export function serializeReportDocument(data:EvaluationResult):string { return JSON.stringify(data,null,2)+"\n"; }
