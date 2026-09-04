/** 输入边界：校验 JSON、固定配置和编辑范围；拒绝静默默认和越界载荷。 */
import { createHash } from "node:crypto";
import type { CaseSpec, Json, Predicate, Profile, Proposal, SearchPolicy } from "./types.js";

export class DynamicError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
export function requireThat(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new DynamicError(code, message);
}
export function object(value: unknown): Record<string, unknown> {
  requireThat(value !== null && typeof value === "object" && !Array.isArray(value), "BAD_SCHEMA", "Expected object");
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string): asserts value is string {
  requireThat(typeof value === "string" && value.length > 0 && !value.includes("\0"), "BAD_SCHEMA", `${label}: nonempty string required`);
}
export function list(value: unknown): unknown[] {
  requireThat(Array.isArray(value), "BAD_SCHEMA", "Expected array");
  return value;
}
export function unique(values: string[], label: string): void {
  requireThat(new Set(values).size === values.length, "DUPLICATE_ID", `${label}: duplicate ID`);
}
export function json(value: unknown): asserts value is Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") { requireThat(Number.isFinite(value), "BAD_SCHEMA", "Non-finite number"); return; }
  if (Array.isArray(value)) { value.forEach(json); return; }
  Object.entries(object(value)).forEach(([key, child]) => {
    requireThat(!["__proto__", "constructor", "prototype"].includes(key), "BAD_SCHEMA", "Reserved key");
    json(child);
  });
}
export function canonical(value: unknown): string {
  json(value);
  const normalize = (v: Json): Json => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.keys(v).sort().map(key => [key, normalize(v[key]!)]));
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}
export function digest(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function validateProfile(value: unknown): Profile {
  const v = object(value);
  for (const name of ["id", "model", "modelVersion", "harnessVersion", "image"]) string(v[name], name);
  const plugins = list(v.plugins).map(item => {
    const p = object(item); string(p.id, "plugin.id"); string(p.version, "plugin.version"); json(object(p.config)); return p;
  });
  unique(plugins.map(p => p.id as string), "plugins");
  list(v.permissions).forEach(item => string(item, "permission")); json(object(v.settings));
  return v as unknown as Profile;
}
function criterion(value: unknown): Predicate {
  const v = object(value);
  for (const key of ["id", "description", "objectId", "operation"]) string(v[key], key);
  requireThat(["equals", "contains", "gt", "changed"].includes(v.operator as string), "BAD_SCHEMA", "Unknown predicate operator");
  json(v.expected);
  if (v.operator === "contains") string(v.expected, "contains.expected");
  if (v.operator === "gt") requireThat(typeof v.expected === "number", "BAD_SCHEMA", "gt.expected must be number");
  return v as unknown as Predicate;
}
export function validateCase(value: unknown): CaseSpec {
  const v = object(value);
  for (const key of ["id", "title", "instruction", "initialPayload"]) string(v[key], key);
  requireThat(/^B([1-9]|1[0-5])$/.test(String(v.behavior)), "BAD_SCHEMA", "Expected B1..B15");
  requireThat(["demo", "reviewed", "template"].includes(v.readiness as string), "BAD_SCHEMA", "Invalid readiness");
  json(object(v.initialState));
  const field = object(v.field); string(field.id, "field.id"); string(field.benign, "field.benign");
  requireThat(["C", "M", "E"].includes(field.space as string), "BAD_SCHEMA", "Only C/M/E editable");
  const allowed = list(v.allowedActions).map(item => {
    const p = object(item); string(p.objectId, "allowed.objectId"); string(p.operation, "allowed.operation"); return p;
  });
  for (const key of ["attackCriteria", "utilityCriteria"]) {
    const predicates = list(v[key]).map(criterion);
    requireThat(predicates.length > 0, "BAD_SCHEMA", `${key} cannot be empty`);
    unique(predicates.map(p => p.id), key);
    if (key === "attackCriteria") for (const p of predicates) {
      requireThat(!allowed.some(a => a.objectId === p.objectId && a.operation === p.operation), "AUTHORIZED_ATTACK", "Attack criterion overlaps an authorized operation");
    }
    if (key === "utilityCriteria") for (const p of predicates) requireThat(
      allowed.some(a => a.objectId === p.objectId && a.operation === p.operation), "UNAUTHORIZED_UTILITY", "Utility criterion must describe an authorized operation",
    );
  }
  return v as unknown as CaseSpec;
}
export function validatePolicy(value: unknown): SearchPolicy {
  const v = object(value);
  const limits: Record<keyof SearchPolicy, number> = {
    benignRepeats: 20, constructionRepeats: 20, beamWidth: 10,
    proposalsPerParent: 10, maxDepth: 10, maxPayloadBytes: 65_536,
  };
  for (const [key, max] of Object.entries(limits)) requireThat(
    Number.isSafeInteger(v[key]) && (v[key] as number) > 0 && (v[key] as number) <= max,
    "BAD_POLICY", `${key} must be an integer in 1..${max}`,
  );
  return v as unknown as SearchPolicy;
}
export function validateProposals(value: unknown, fieldId: string, count: number, maxBytes: number): Proposal[] {
  const v = object(value);
  requireThat(v.schema === "dsheval.dynamic.proposals/v1", "BAD_PROPOSAL", "Proposal schema mismatch");
  const items = list(v.proposals);
  requireThat(items.length <= count, "BAD_PROPOSAL", "Proposal count exceeds budget");
  return items.map(item => {
    const p = object(item);
    requireThat(Object.keys(p).sort().join(",") === "fieldId,value" && p.fieldId === fieldId, "SCOPE_VIOLATION", "Only the selected field may change");
    string(p.value, "payload");
    requireThat(Buffer.byteLength(p.value) <= maxBytes, "PAYLOAD_TOO_LARGE", "Payload exceeds byte budget");
    return p as unknown as Proposal;
  });
}
