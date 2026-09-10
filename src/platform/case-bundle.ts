/**
 * 文件职责：把一次 Case 的细粒度内部记录收敛为便于审查的 Agent/Run/Case 结果包。
 * 内部 records 仍可保持领域对象粒度；最终结果只保留聚合 JSON、压缩 Trace、交付物与报告。
 */
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { validateStableId } from "../core/models.js";

interface ArtifactIndexEntry {
  readonly artifactId?: string;
  readonly artifactType?: string;
  readonly logicalName?: string;
  readonly portablePath?: string;
  readonly sensitivity?: string;
}

interface ReportView {
  readonly [key: string]: unknown;
  readonly execution?: Record<string, unknown>;
  readonly trace?: unknown;
  readonly rawObservations?: readonly unknown[];
  readonly sources?: readonly Record<string, unknown>[];
  readonly failures?: readonly unknown[];
  readonly fileSnapshots?: readonly unknown[];
  readonly fileDiffs?: readonly unknown[];
  readonly reset?: unknown;
  readonly plannerMatch?: unknown;
  readonly planSummary?: unknown;
  readonly labelEvaluations?: readonly Record<string, unknown>[];
  readonly checks?: readonly Record<string, unknown>[];
  readonly decisionEvidence?: readonly Record<string, unknown>[];
}

export interface CaseBundleResult {
  readonly directory: string;
  readonly manifestPath: string;
  readonly reportJsonPath: string;
  readonly reportHtmlPath?: string;
}

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const value = (error as { readonly code?: unknown }).code;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function within(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function safeRoot(input: string): Promise<string> {
  if (!path.isAbsolute(input) || input.includes("\0")) throw new Error("resultRoot must be absolute");
  const resolved = path.resolve(input);
  if (resolved === path.parse(resolved).root || resolved === os.homedir()) {
    throw new Error("resultRoot must not be a filesystem or user-home root");
  }
  await mkdir(resolved, { recursive: true, mode: 0o700 });
  const metadata = await lstat(resolved);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("resultRoot must be a real directory");
  }
  return realpath(resolved);
}

async function childDirectory(parent: string, name: string): Promise<string> {
  validateStableId(name, "case bundle path segment");
  const target = path.join(parent, name);
  await mkdir(target, { mode: 0o700 }).catch((error) => {
    if (errorCode(error) !== "EEXIST") throw error;
  });
  const metadata = await lstat(target);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("case bundle path contains a non-directory or symlink");
  }
  const canonical = await realpath(target);
  if (!within(parent, canonical) || canonical === parent) throw new Error("case bundle path escaped root");
  return canonical;
}

async function writeBytes(destination: string, bytes: Uint8Array | string): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, bytes, { flag: "wx", mode: 0o600 });
  await chmod(destination, 0o400);
}

async function writeJson(destination: string, value: unknown): Promise<void> {
  await writeBytes(destination, `${JSON.stringify(value, null, 2)}\n`);
}

async function readJsonOptional(source: string, maxBytes: number): Promise<Record<string, unknown> | undefined> {
  const metadata = await lstat(source).catch((error) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (metadata === undefined) return undefined;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) {
    throw new Error("case bundle JSON source is invalid or exceeds configured byte limit");
  }
  const parsed = JSON.parse(await readFile(source, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("case bundle JSON source must contain an object");
  }
  return parsed as Record<string, unknown>;
}

async function readJsonDirectory(source: string, maxBytes: number): Promise<readonly Record<string, unknown>[]> {
  const metadata = await lstat(source).catch((error) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (metadata === undefined) return [];
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("record source must be a real directory");
  const records: Record<string, unknown>[] = [];
  for (const entry of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const record = await readJsonOptional(path.join(source, entry.name), maxBytes);
    if (record !== undefined) records.push(record);
  }
  return records;
}

async function readArtifactIndex(partition: string, maxBytes: number): Promise<readonly ArtifactIndexEntry[]> {
  const indexPath = path.join(partition, "index.jsonl");
  const metadata = await lstat(indexPath).catch((error) => {
    if (errorCode(error) === "ENOENT") return undefined;
    throw error;
  });
  if (metadata === undefined) return [];
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > maxBytes) {
    throw new Error("artifact index is invalid or exceeds configured byte limit");
  }
  return (await readFile(indexPath, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ArtifactIndexEntry);
}

function artifactPath(partition: string, artifact: ArtifactIndexEntry): string | undefined {
  if (typeof artifact.portablePath !== "string" || artifact.portablePath.includes("\0")) return undefined;
  const candidate = path.resolve(partition, artifact.portablePath);
  return within(partition, candidate) && candidate !== partition ? candidate : undefined;
}

async function readArtifact(
  partition: string,
  artifacts: readonly ArtifactIndexEntry[],
  predicate: (artifact: ArtifactIndexEntry) => boolean,
  maxBytes: number,
): Promise<{ readonly metadata: ArtifactIndexEntry; readonly bytes: Buffer } | undefined> {
  const metadata = [...artifacts].reverse().find(predicate);
  if (metadata === undefined) return undefined;
  const source = artifactPath(partition, metadata);
  if (source === undefined) throw new Error("artifact portablePath escaped its partition");
  const stat = await lstat(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) {
    throw new Error("artifact object is invalid or exceeds configured byte limit");
  }
  return { metadata, bytes: await readFile(source) };
}

function labelSlug(labelId: unknown, fallback: string): string {
  const raw = typeof labelId === "string"
    ? labelId.replace(/^label\./u, "").replace(/\/v\d+$/u, "")
    : fallback;
  return raw.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || fallback;
}

async function manifestEntries(root: string, current = root): Promise<Array<{
  readonly path: string;
  readonly byteLength: number;
  readonly sha256: string;
}>> {
  const entries = (await readdir(current, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const output: Array<{ path: string; byteLength: number; sha256: string }> = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw new Error("case bundle cannot contain symlinks");
    if (entry.isDirectory()) {
      output.push(...await manifestEntries(root, absolute));
    } else if (entry.isFile() && entry.name !== "manifest.json") {
      const bytes = await readFile(absolute);
      output.push({
        path: path.relative(root, absolute).split(path.sep).join("/"),
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return output;
}

async function writeRunFile(runDirectory: string, name: string, value: unknown): Promise<void> {
  const destination = path.join(runDirectory, name);
  await writeFile(destination, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o400 }).catch((error) => {
    if (errorCode(error) !== "EEXIST") throw error;
  });
}

/** Case 终态形成后调用；以临时目录组装并原子发布一个不可覆盖的精简结果包。 */
export async function exportCaseBundle(input: {
  readonly resultRoot: string;
  readonly runRoot: string;
  readonly artifactRoot: string;
  readonly reportRoot: string;
  readonly agentId: string;
  readonly runId: string;
  /** 内部单 Case Workflow 的存储键；Batch 下与最终父 Run ID 不同。 */
  readonly sourceRunId?: string;
  readonly caseId: string;
  readonly maxFileBytes: number;
}): Promise<CaseBundleResult> {
  const agentId = validateStableId(input.agentId, "agentId");
  const runId = validateStableId(input.runId, "runId");
  const sourceRunId = validateStableId(input.sourceRunId ?? input.runId, "sourceRunId");
  const caseId = validateStableId(input.caseId, "caseId");
  if (!Number.isSafeInteger(input.maxFileBytes) || input.maxFileBytes <= 0) {
    throw new Error("maxFileBytes must be a positive safe integer");
  }

  const root = await safeRoot(input.resultRoot);
  const agents = await childDirectory(root, "agents");
  const agent = await childDirectory(agents, agentId);
  const runs = await childDirectory(agent, "runs");
  const run = await childDirectory(runs, runId);
  const cases = await childDirectory(run, "cases");
  const destination = path.join(cases, caseId);
  if (await lstat(destination).catch((error) => errorCode(error) === "ENOENT" ? undefined : Promise.reject(error))) {
    throw new Error("case bundle is immutable and already exists");
  }

  const sourceReportPath = path.join(input.reportRoot, sourceRunId, "report.json");
  const report = await readJsonOptional(sourceReportPath, input.maxFileBytes);
  if (report === undefined) throw new Error("committed report.json is unavailable");
  const view = (report.view ?? {}) as ReportView;
  const recordRoot = path.join(input.runRoot, sourceRunId, "records");
  const artifactPartition = path.join(input.artifactRoot, sourceRunId);
  const artifacts = await readArtifactIndex(artifactPartition, input.maxFileBytes);

  await writeRunFile(run, "target.json", {
    schema: "dsheval.result-target/v1",
    agentId,
    targetSummary: view.targetSummary,
    staticProfile: view.staticProfile,
  });
  await writeRunFile(run, "run.json", {
    schema: "dsheval.result-run/v1",
    agentId,
    runId,
    state: view.runState,
    gate: view.gate,
    operationalHealth: view.operationalHealth,
    startedAt: view.startedAt,
    updatedAt: view.updatedAt,
  });

  const staging = await mkdtemp(path.join(cases, ".partial-"));
  try {
    await writeJson(path.join(staging, "task.json"), {
      schema: "dsheval.result-task/v1",
      caseId,
      task: view.execution?.task,
      datasetIds: (view.planSummary as Record<string, unknown> | undefined)?.datasetIds,
    });
    await writeJson(path.join(staging, "plan.json"), {
      schema: "dsheval.result-plan/v1",
      planner: view.plannerMatch,
      plan: view.planSummary,
      labels: view.labelEvaluations ?? [],
    });
    await writeJson(path.join(staging, "execution.json"), {
      schema: "dsheval.result-execution/v1",
      ...(view.execution ?? {}),
    });

    const rawTrace = await readArtifact(
      artifactPartition,
      artifacts,
      (artifact) => artifact.artifactType === "DSH_PROBE_JSONL",
      input.maxFileBytes,
    );
    if (rawTrace !== undefined) {
      await writeBytes(path.join(staging, "trace", "raw.jsonl.gz"), gzipSync(rawTrace.bytes, { level: 9 }));
    }
    await writeJson(path.join(staging, "trace", "index.json"), {
      schema: "dsheval.result-trace-index/v1",
      summary: view.trace ?? {},
      events: view.rawObservations ?? [],
    });
    await writeJson(path.join(staging, "trace", "status.json"), {
      schema: "dsheval.result-trace-status/v1",
      sources: (view.sources ?? []).filter((source) => source.sourceType === "DSH_PROBE"),
      rawArtifactId: rawTrace?.metadata.artifactId,
    });

    await writeJson(path.join(staging, "observers", "filesystem.json"), {
      schema: "dsheval.result-observer-filesystem/v1",
      source: (view.sources ?? []).find((source) => source.sourceType === "FILESYSTEM"),
      snapshots: view.fileSnapshots ?? [],
      diffs: view.fileDiffs ?? [],
      reset: view.reset,
    });
    const processSnapshots = await readJsonDirectory(path.join(recordRoot, "process-snapshot"), input.maxFileBytes);
    const processDiffs = await readJsonDirectory(path.join(recordRoot, "process-diff"), input.maxFileBytes);
    if (processSnapshots.length > 0 || processDiffs.length > 0) {
      await writeJson(path.join(staging, "observers", "process.json"), {
        schema: "dsheval.result-observer-process/v1",
        source: (view.sources ?? []).find((source) => source.sourceType === "PROCESS"),
        snapshots: processSnapshots,
        diffs: processDiffs,
      });
    }
    const environmentEvents = (view.rawObservations ?? []).filter((value): value is Record<string, unknown> =>
      value !== null && typeof value === "object" &&
      (value as Record<string, unknown>).externalEventType === "environment/change");
    const componentBySourceType: Readonly<Record<string, string>> = Object.freeze({
      APPLICATION: "application",
      BROWSER: "browser",
      CLIPBOARD: "clipboard",
      DATABASE: "database",
      DESKTOP: "desktop",
      EXTERNAL_API: "external-api",
      NETWORK: "network",
      SYSTEM: "system",
    });
    const eventsByComponent = new Map<string, Record<string, unknown>[]>();
    for (const event of environmentEvents) {
      const metadata = event.captureMetadata;
      const metadataComponent = metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).component
        : undefined;
      const component = typeof metadataComponent === "string"
        ? metadataComponent
        : typeof event.sourceType === "string"
          ? componentBySourceType[event.sourceType]
          : undefined;
      if (typeof component !== "string" || !/^[a-z][a-z0-9-]*$/u.test(component)) continue;
      const events = eventsByComponent.get(component) ?? [];
      events.push(event);
      eventsByComponent.set(component, events);
    }
    for (const [component, events] of [...eventsByComponent].sort(([left], [right]) => left.localeCompare(right, "en"))) {
      const sourceId = typeof events[0]?.sourceId === "string"
        ? events[0].sourceId
        : (events[0]?.sourceRef as Record<string, unknown> | undefined)?.id;
      await writeJson(path.join(staging, "observers", `${component}.json`), {
        schema: "dsheval.result-observer-events/v1",
        component,
        source: (view.sources ?? []).find((source) => source.sourceId === sourceId),
        events,
      });
    }

    const checks = view.checks ?? [];
    const decisionEvidence = view.decisionEvidence ?? [];
    const labelEvaluations = view.labelEvaluations ?? [];
    for (const [index, label] of labelEvaluations.entries()) {
      const checkId = label.checkId;
      const check = checks.find((candidate) => candidate.checkId === checkId);
      const evidenceIds = Array.isArray(check?.evidenceIds) ? check.evidenceIds : [];
      const authorizedEvidence = decisionEvidence.filter((candidate) => evidenceIds.includes(candidate.evidenceId));
      const slug = labelSlug(label.labelId, `label-${index + 1}`);
      await writeJson(path.join(staging, "evidence", `${slug}.json`), {
        schema: "dsheval.result-label-evidence/v1",
        labelId: label.labelId,
        checkId,
        requiredEvidenceTypes: label.requiredEvidenceTypes,
        authorizedEvidence,
      });
      await writeJson(path.join(staging, "judge", `${slug}.json`), {
        schema: "dsheval.result-label-judgement/v1",
        labelId: label.labelId,
        metricId: label.metricId,
        judgeId: label.judgeId,
        check,
      });
    }

    for (const logicalName of ["stdout.txt", "stderr.txt"] as const) {
      const output = await readArtifact(
        artifactPartition,
        artifacts,
        (artifact) => artifact.logicalName === logicalName && artifact.sensitivity === "EXPORTABLE",
        input.maxFileBytes,
      );
      if (output !== undefined) await writeBytes(path.join(staging, "artifacts", logicalName), output.bytes);
    }
    const deliverableManifest = await readArtifact(
      artifactPartition,
      artifacts,
      (artifact) => artifact.artifactType === "AGENT_DELIVERABLE_MANIFEST",
      input.maxFileBytes,
    );
    if (deliverableManifest !== undefined) {
      const manifest = JSON.parse(deliverableManifest.bytes.toString("utf8")) as {
        readonly files?: readonly { readonly portablePath?: string; readonly artifactId?: string }[];
      };
      for (const file of manifest.files ?? []) {
        if (typeof file.portablePath !== "string" || typeof file.artifactId !== "string") continue;
        const normalized = path.posix.normalize(file.portablePath);
        if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) continue;
        const deliverable = await readArtifact(
          artifactPartition,
          artifacts,
          (artifact) => artifact.artifactId === file.artifactId && artifact.sensitivity === "EXPORTABLE",
          input.maxFileBytes,
        );
        if (deliverable !== undefined) {
          await writeBytes(path.join(staging, "artifacts", "deliverables", ...normalized.split("/")), deliverable.bytes);
        }
      }
      await writeJson(path.join(staging, "artifacts", "deliverables.json"), manifest);
    }

    const compactReport = {
      schema: "dsheval.result-report/v1",
      runId,
      caseId,
      targetSummary: view.targetSummary,
      currentPhase: view.currentPhase,
      runState: view.runState,
      gate: view.gate,
      operationalHealth: view.operationalHealth,
      securityIsolation: view.securityIsolation,
      startedAt: view.startedAt,
      updatedAt: view.updatedAt,
      trace: view.trace,
      checks,
      reset: view.reset,
      failures: view.failures ?? [],
    };
    await writeJson(path.join(staging, "report.json"), compactReport);
    const sourceHtml = path.join(input.reportRoot, sourceRunId, "report.html");
    const htmlMetadata = await lstat(sourceHtml).catch((error) => {
      if (errorCode(error) === "ENOENT") return undefined;
      throw error;
    });
    if (htmlMetadata !== undefined) {
      if (!htmlMetadata.isFile() || htmlMetadata.isSymbolicLink() || htmlMetadata.size > input.maxFileBytes) {
        throw new Error("report.html is invalid or exceeds configured byte limit");
      }
      await writeBytes(path.join(staging, "report.html"), await readFile(sourceHtml));
    }

    const manifest = {
      schema: "dsheval.case-bundle/v2",
      agentId,
      runId,
      caseId,
      files: await manifestEntries(staging),
    };
    await writeJson(path.join(staging, "manifest.json"), manifest);
    await rename(staging, destination);
    const reportHtmlPath = path.join(destination, "report.html");
    return {
      directory: destination,
      manifestPath: path.join(destination, "manifest.json"),
      reportJsonPath: path.join(destination, "report.json"),
      ...(await lstat(reportHtmlPath).catch(() => undefined) === undefined ? {} : { reportHtmlPath }),
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}
