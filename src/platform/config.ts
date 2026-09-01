import { lstat, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  type ConfigSnapshot,
  type JsonObject,
  validateIsoDateTime,
  validateStableId,
  withContentDigest,
} from "../core/models.js";

export interface MvpConfigValues {
  targetRoot: string;
  runRoot: string;
  artifactRoot: string;
  reportRoot: string;
  workspaceRoot: string;
  runtimeDshHomeRoot: string;
  runDeadlineMs: number;
  caseDeadlineMs: number;
  stableWindowMs: number;
  stableMaxWaitMs: number;
  maxArtifactBytes: number;
  contentMode: string;
  allowedModelEndpoints: readonly string[];
  minimumIsolationLevel: "AGENT_SEPARATED";
  rendererVersion: string;
  secretRefNames: readonly string[];
}

export interface FreezeConfigOptions {
  cwd: string;
  configId: string;
  invocationId: string;
  createdAt: string;
  dshevalVersion: string;
  configFile?: string;
  environment?: NodeJS.ProcessEnv;
  cli?: Partial<MvpConfigValues>;
}

const ROOT_FIELDS = [
  "targetRoot",
  "runRoot",
  "artifactRoot",
  "reportRoot",
  "workspaceRoot",
  "runtimeDshHomeRoot",
] as const;

const CONFIG_FIELDS = new Set<keyof MvpConfigValues>([
  ...ROOT_FIELDS,
  "runDeadlineMs",
  "caseDeadlineMs",
  "stableWindowMs",
  "stableMaxWaitMs",
  "maxArtifactBytes",
  "contentMode",
  "allowedModelEndpoints",
  "minimumIsolationLevel",
  "rendererVersion",
  "secretRefNames",
]);

const ENVIRONMENT_FIELDS: Readonly<Record<string, keyof MvpConfigValues>> = {
  DSHEVAL_TARGET_ROOT: "targetRoot",
  DSHEVAL_RUN_ROOT: "runRoot",
  DSHEVAL_ARTIFACT_ROOT: "artifactRoot",
  DSHEVAL_REPORT_ROOT: "reportRoot",
  DSHEVAL_WORKSPACE_ROOT: "workspaceRoot",
  DSHEVAL_RUNTIME_DSH_HOME_ROOT: "runtimeDshHomeRoot",
  DSHEVAL_RUN_DEADLINE_MS: "runDeadlineMs",
  DSHEVAL_CASE_DEADLINE_MS: "caseDeadlineMs",
  DSHEVAL_STABLE_WINDOW_MS: "stableWindowMs",
  DSHEVAL_STABLE_MAX_WAIT_MS: "stableMaxWaitMs",
  DSHEVAL_MAX_ARTIFACT_BYTES: "maxArtifactBytes",
  DSHEVAL_CONTENT_MODE: "contentMode",
  DSHEVAL_ALLOWED_MODEL_ENDPOINTS: "allowedModelEndpoints",
  DSHEVAL_RENDERER_VERSION: "rendererVersion",
  DSHEVAL_SECRET_REF_NAMES: "secretRefNames",
};

// These names are owned by the harness or by process launch semantics.  A
// Secret reference must never be able to replace one of them when the frozen
// configuration is later materialized into the Target environment.
const RESERVED_SECRET_REF_NAMES = new Set([
  "HOME",
  "USERPROFILE",
  "NODE_OPTIONS",
  "BASH_ENV",
  "ENV",
  "CDPATH",
  "PATH",
  "LANG",
  "TMPDIR",
  "DSH_HOME",
]);

function defaults(cwd: string): Omit<MvpConfigValues, "targetRoot"> {
  const variableRoot = path.join(cwd, "var");
  return {
    runRoot: path.join(variableRoot, "records"),
    artifactRoot: path.join(variableRoot, "artifacts"),
    reportRoot: path.join(variableRoot, "reports"),
    workspaceRoot: path.join(variableRoot, "workspaces"),
    runtimeDshHomeRoot: path.join(variableRoot, "runtime-homes"),
    runDeadlineMs: 60_000,
    caseDeadlineMs: 30_000,
    stableWindowMs: 250,
    stableMaxWaitMs: 5_000,
    maxArtifactBytes: 1_048_576,
    contentMode: "DIGEST",
    allowedModelEndpoints: [],
    minimumIsolationLevel: "AGENT_SEPARATED",
    rendererVersion: "dsheval-static/v1",
    secretRefNames: [],
  };
}

function assertKnownFields(value: unknown, source: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter(
    (key) => !CONFIG_FIELDS.has(key as keyof MvpConfigValues),
  );
  if (unknown.length > 0) throw new Error(`${source} has unknown fields: ${unknown.sort().join(", ")}`);
  return record;
}

function environmentValues(environment: NodeJS.ProcessEnv): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [environmentName, field] of Object.entries(ENVIRONMENT_FIELDS)) {
    const raw = environment[environmentName];
    if (raw === undefined) continue;
    if (
      field === "runDeadlineMs" ||
      field === "caseDeadlineMs" ||
      field === "stableWindowMs" ||
      field === "stableMaxWaitMs" ||
      field === "maxArtifactBytes"
    ) {
      values[field] = Number(raw);
    } else if (field === "allowedModelEndpoints" || field === "secretRefNames") {
      values[field] = raw.length === 0 ? [] : raw.split(",").map((entry) => entry.trim());
    } else {
      values[field] = raw;
    }
  }
  return values;
}

function validatePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return Number(value);
}

function validateStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
    throw new Error(`${field} must be an array of non-empty strings`);
  }
  return [...new Set(value as string[])].sort();
}

async function validateRoot(root: string, cwd: string, field: string): Promise<string> {
  if (
    root.includes("\0") ||
    /[*?[\]{}$]/u.test(root) ||
    /%[^%]+%/u.test(root)
  ) {
    throw new Error(`${field} contains an unsafe or unresolved path expression`);
  }
  const absolute = path.resolve(cwd, root);
  const parsed = path.parse(absolute);
  const looksLikeUserHome =
    absolute === "/root" ||
    /^\/home\/[^/]+$/u.test(absolute) ||
    /^\/Users\/[^/]+$/u.test(absolute);
  if (absolute === parsed.root || absolute === os.homedir() || looksLikeUserHome) {
    throw new Error(`${field} cannot be a filesystem or user-home root`);
  }
  if (field !== "targetRoot" && absolute === path.resolve(cwd)) {
    throw new Error(`${field} cannot be the repository root`);
  }
  try {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`${field} cannot be a symlink root`);
    if (!metadata.isDirectory()) throw new Error(`${field} must be a directory when it exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return absolute;
}

function rootsOverlap(left: string, right: string): boolean {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative)) ||
    (!reverse.startsWith("..") && !path.isAbsolute(reverse))
  );
}

function fieldSources(
  file: Record<string, unknown>,
  environment: Record<string, unknown>,
  cli: Record<string, unknown>,
): JsonObject {
  return Object.fromEntries(
    [...CONFIG_FIELDS].sort().map((field) => [
      field,
      Object.prototype.hasOwnProperty.call(cli, field)
        ? "CLI"
        : Object.prototype.hasOwnProperty.call(environment, field)
          ? "ENVIRONMENT"
          : Object.prototype.hasOwnProperty.call(file, field)
            ? "FILE"
            : "DEFAULT",
    ]),
  ) as JsonObject;
}

export async function freezeConfig(options: FreezeConfigOptions): Promise<ConfigSnapshot> {
  const fileValues =
    options.configFile === undefined
      ? {}
      : assertKnownFields(
          JSON.parse(await readFile(path.resolve(options.cwd, options.configFile), "utf8")),
          "config file",
        );
  const fromEnvironment = environmentValues(options.environment ?? process.env);
  const cliValues = assertKnownFields(options.cli ?? {}, "CLI config");
  const merged = {
    ...defaults(options.cwd),
    ...fileValues,
    ...fromEnvironment,
    ...cliValues,
  } as Record<string, unknown>;
  if (typeof merged.targetRoot !== "string" || merged.targetRoot.length === 0) {
    throw new Error("targetRoot is required");
  }

  const roots: Record<(typeof ROOT_FIELDS)[number], string> = {} as Record<
    (typeof ROOT_FIELDS)[number],
    string
  >;
  for (const field of ROOT_FIELDS) {
    if (typeof merged[field] !== "string" || merged[field].length === 0) {
      throw new Error(`${field} must be a non-empty path`);
    }
    roots[field] = await validateRoot(merged[field], options.cwd, field);
  }
  for (let left = 0; left < ROOT_FIELDS.length; left += 1) {
    for (let right = left + 1; right < ROOT_FIELDS.length; right += 1) {
      const leftField = ROOT_FIELDS[left];
      const rightField = ROOT_FIELDS[right];
      if (leftField === undefined || rightField === undefined) continue;
      if (rootsOverlap(roots[leftField], roots[rightField])) {
        throw new Error(`${leftField} and ${rightField} must not overlap`);
      }
    }
  }

  const allowedModelEndpoints = validateStringArray(
    merged.allowedModelEndpoints,
    "allowedModelEndpoints",
  );
  for (const endpoint of allowedModelEndpoints) {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "https:") throw new Error("model endpoints must use HTTPS");
    if (parsed.username !== "" || parsed.password !== "") {
      throw new Error("model endpoint URLs cannot contain credentials");
    }
  }
  const secretRefNames = validateStringArray(merged.secretRefNames, "secretRefNames");
  if (secretRefNames.some((name) => !/^[A-Z][A-Z0-9_]{1,63}$/.test(name))) {
    throw new Error("secretRefNames must contain environment reference names, never values");
  }
  if (
    secretRefNames.some(
      (name) =>
        RESERVED_SECRET_REF_NAMES.has(name) ||
        name.startsWith("DSH_EVAL_") ||
        name.startsWith("DSHEVAL_"),
    )
  ) {
    throw new Error("secretRefNames cannot replace harness-owned environment variables");
  }
  if (merged.minimumIsolationLevel !== "AGENT_SEPARATED") {
    throw new Error("minimumIsolationLevel is fixed to AGENT_SEPARATED");
  }
  if (typeof merged.contentMode !== "string" || merged.contentMode.length === 0) {
    throw new Error("contentMode must be a non-empty string");
  }
  if (typeof merged.rendererVersion !== "string" || merged.rendererVersion.length === 0) {
    throw new Error("rendererVersion must be a non-empty string");
  }

  const sources = fieldSources(fileValues, fromEnvironment, cliValues);
  const record = {
    schema: "dsheval.mvp.config/v1" as const,
    configId: validateStableId<"ConfigId">(options.configId, "configId"),
    invocationId: validateStableId<"InvocationId">(options.invocationId, "invocationId"),
    ...roots,
    runDeadlineMs: validatePositiveInteger(merged.runDeadlineMs, "runDeadlineMs"),
    caseDeadlineMs: validatePositiveInteger(merged.caseDeadlineMs, "caseDeadlineMs"),
    stableWindowMs: validatePositiveInteger(merged.stableWindowMs, "stableWindowMs"),
    stableMaxWaitMs: validatePositiveInteger(merged.stableMaxWaitMs, "stableMaxWaitMs"),
    maxArtifactBytes: validatePositiveInteger(merged.maxArtifactBytes, "maxArtifactBytes"),
    contentMode: merged.contentMode,
    allowedModelEndpoints,
    minimumIsolationLevel: "AGENT_SEPARATED" as const,
    rendererVersion: merged.rendererVersion,
    fieldSources: sources,
    platform: `${process.platform}-${process.arch}`,
    nodeVersion: process.version,
    dshevalVersion: options.dshevalVersion,
    secretRefNames,
    createdAt: validateIsoDateTime(options.createdAt, "createdAt"),
  };
  return withContentDigest(record) as ConfigSnapshot;
}
