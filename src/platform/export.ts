import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  assertDigestEquals,
  digestValue,
  validateContentDigest,
} from "../core/models.js";

export interface DeliveryManifestEntry {
  portablePath: "report.json" | "report.html";
  byteLength: number;
  sha256: string;
}

export interface DeliveryManifest {
  schema: "dsheval.mvp.delivery-manifest/v1";
  runId: string;
  exportId: string;
  files: readonly DeliveryManifestEntry[];
  manifestDigest: string;
}

function validateId(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`${label} must be a StableId`);
  }
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function errorCode(error: unknown): string | undefined {
  if (error !== null && typeof error === "object" && "code" in error) {
    const value = (error as { readonly code?: unknown }).code;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

function assertMaxBytes(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("maxBytes must be a positive safe integer");
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function reportRunDirectory(
  reportRootInput: string,
  runId: string,
  create: boolean,
): Promise<string> {
  validateId(runId, "runId");
  if (!path.isAbsolute(reportRootInput) || reportRootInput.includes("\0")) {
    throw new Error("reportRoot must be an absolute NUL-free path");
  }
  const reportRoot = path.resolve(reportRootInput);
  if (reportRoot === path.parse(reportRoot).root || reportRoot === os.homedir()) {
    throw new Error("reportRoot must not be a filesystem or user-home root");
  }
  try {
    const rootMetadata = await lstat(reportRoot);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new Error("reportRoot must be a real directory");
    }
  } catch (error) {
    if (!create || errorCode(error) !== "ENOENT") throw error;
    await mkdir(reportRoot, { recursive: true, mode: 0o700 });
  }
  const rootMetadata = await lstat(reportRoot);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error("reportRoot must be a real directory");
  }
  const canonicalRoot = await realpath(reportRoot);
  const candidate = path.join(canonicalRoot, runId);
  let candidateMetadata = await lstat(candidate).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (candidateMetadata === undefined) {
    if (!create) throw new Error("committed report run directory does not exist");
    await mkdir(candidate, { mode: 0o700 });
    candidateMetadata = await lstat(candidate);
  }
  if (!candidateMetadata.isDirectory() || candidateMetadata.isSymbolicLink()) {
    throw new Error("report run path must be a real directory");
  }
  const canonicalRun = await realpath(candidate);
  if (!isWithin(canonicalRoot, canonicalRun) || canonicalRun === canonicalRoot) {
    throw new Error("report run path escaped reportRoot");
  }
  return canonicalRun;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function commitImmutableFile(
  directory: string,
  name: "report.json" | "report.html",
  source: Uint8Array | string,
  maxBytes: number,
): Promise<{ path: string; digest: string; byteLength: number }> {
  assertMaxBytes(maxBytes);
  const unresolvedStages = (await readdir(directory, { withFileTypes: true })).filter((entry) =>
    entry.name.startsWith(".tmp-"),
  );
  if (unresolvedStages.length > 0) {
    throw new Error("report recovery is required before another immutable commit");
  }
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  if (bytes.byteLength > maxBytes) throw new Error(`${name} exceeds configured byte limit`);
  const target = path.join(directory, name);
  if ((await lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  })) !== undefined) {
    throw new Error(`${name} is immutable and already committed`);
  }
  const temporary = path.join(directory, `.tmp-${randomUUID()}`);
  const handle = await open(temporary, "wx", 0o600);
  let published = false;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    await chmod(temporary, 0o400);
    await link(temporary, target);
    published = true;
    await unlink(temporary);
    await syncDirectory(directory);
  } finally {
    await handle.close().catch(() => undefined);
    if (!published) await unlink(temporary).catch(() => undefined);
  }
  const verified = await readCommittedFile(target, maxBytes);
  if (verified.byteLength !== bytes.byteLength || digest(verified) !== digest(bytes)) {
    throw new Error(`${name} failed post-commit verification`);
  }
  return { path: target, digest: digest(bytes), byteLength: bytes.byteLength };
}

function parseAndVerifyReportJson(bytes: Uint8Array): Readonly<Record<string, unknown>> {
  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error("report.json must be valid UTF-8 JSON", { cause: error });
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("report.json must contain a JSON object");
  }
  const document = parsed as Record<string, unknown>;
  const allowedFields = new Set([
    "schema", "reportId", "scope", "runRef", "targetSnapshotRef", "planRefs", "caseRef",
    "attemptRef", "sourceRefs", "collectionStatusRefs", "closureRefs", "judgementRefs",
    "checkResultRefs", "gateDecisionRef", "resetVerificationRef", "failureRefs",
    "operationalHealth", "artifactRefs", "createdAt", "producerVersion", "view",
    "rendererVersion", "contentDigest",
  ]);
  if (Object.keys(document).some((field) => !allowedFields.has(field))) {
    throw new Error("report.json document contains unknown top-level fields");
  }
  if (
    document.view === null ||
    typeof document.view !== "object" ||
    Array.isArray(document.view) ||
    typeof document.rendererVersion !== "string" ||
    document.rendererVersion.length === 0
  ) {
    throw new Error("report.json document shape is invalid");
  }
  const view = document.view as Record<string, unknown>;
  if (
    document.schema !== "dsheval.mvp.report/v1" ||
    document.scope === null ||
    typeof document.scope !== "object" ||
    Array.isArray(document.scope) ||
    document.runRef === null ||
    typeof document.runRef !== "object" ||
    Array.isArray(document.runRef) ||
    typeof view.runId !== "string" ||
    view.runId !== (document.scope as Record<string, unknown>).runId ||
    view.runId !== (document.runRef as Record<string, unknown>).id ||
    !Array.isArray(view.timeline) ||
    view.timeline.length !== 10 ||
    view.timeline.some(
      (step, index) =>
        step === null ||
        typeof step !== "object" ||
        Array.isArray(step) ||
        (step as Record<string, unknown>).number !== index + 1,
    ) ||
    !Array.isArray(view.sources) ||
    !Array.isArray(view.checks) ||
    !Array.isArray(view.failures) ||
    !Array.isArray(view.artifacts)
  ) {
    throw new Error("report.json authoritative report/view binding is invalid");
  }
  const documentDigest = validateContentDigest(document.contentDigest, "report.contentDigest");
  assertDigestEquals(digestValue(document, ["contentDigest"]), documentDigest);
  return Object.freeze(document);
}

export async function commitReportJson(input: {
  reportRoot: string;
  runId: string;
  bytes: Uint8Array | string;
  maxBytes: number;
}): Promise<{ path: string; digest: string; byteLength: number }> {
  assertMaxBytes(input.maxBytes);
  const bytes = typeof input.bytes === "string" ? Buffer.from(input.bytes, "utf8") : Buffer.from(input.bytes);
  if (bytes.byteLength > input.maxBytes) throw new Error("report.json exceeds configured byte limit");
  parseAndVerifyReportJson(bytes);
  const directory = await reportRunDirectory(input.reportRoot, input.runId, true);
  return commitImmutableFile(directory, "report.json", bytes, input.maxBytes);
}

export async function readCommittedReportJson(input: {
  reportRoot: string;
  runId: string;
  maxBytes: number;
}): Promise<Buffer> {
  assertMaxBytes(input.maxBytes);
  const directory = await reportRunDirectory(input.reportRoot, input.runId, false);
  const bytes = await readCommittedFile(path.join(directory, "report.json"), input.maxBytes);
  parseAndVerifyReportJson(bytes);
  return Buffer.from(bytes);
}

export async function commitReportHtml(input: {
  reportRoot: string;
  runId: string;
  bytes: Uint8Array | string;
  maxBytes: number;
}): Promise<{ path: string; digest: string; byteLength: number }> {
  assertMaxBytes(input.maxBytes);
  const bytes = typeof input.bytes === "string" ? Buffer.from(input.bytes, "utf8") : Buffer.from(input.bytes);
  if (bytes.byteLength > input.maxBytes) throw new Error("report.html exceeds configured byte limit");
  await readCommittedReportJson({
    reportRoot: input.reportRoot,
    runId: input.runId,
    maxBytes: input.maxBytes,
  });
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("report.html must be valid UTF-8", { cause: error });
  }
  const directory = await reportRunDirectory(input.reportRoot, input.runId, false);
  return commitImmutableFile(directory, "report.html", bytes, input.maxBytes);
}

export async function readCommittedReportHtml(input: {
  reportRoot: string;
  runId: string;
  maxBytes: number;
}): Promise<Buffer> {
  await readCommittedReportJson(input);
  const directory = await reportRunDirectory(input.reportRoot, input.runId, false);
  const bytes = await readCommittedFile(path.join(directory, "report.html"), input.maxBytes);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("report.html must be valid UTF-8", { cause: error });
  }
  return Buffer.from(bytes);
}

async function readCommittedFile(file: string, maxBytes: number): Promise<Buffer> {
  assertMaxBytes(maxBytes);
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`delivery input is not a committed regular file: ${path.basename(file)}`);
  }
  if (before.size > maxBytes) throw new Error("delivery input exceeds configured byte limit");
  const bytes = await readFile(file);
  const after = await lstat(file);
  if (
    !after.isFile() ||
    after.isSymbolicLink() ||
    bytes.byteLength !== before.size ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error("delivery input changed while reading");
  }
  return bytes;
}

export async function exportReport(input: {
  reportRoot: string;
  runId: string;
  exportId: string;
  maxBytes: number;
}): Promise<{ directory: string; manifest: DeliveryManifest }> {
  validateId(input.runId, "runId");
  validateId(input.exportId, "exportId");
  assertMaxBytes(input.maxBytes);
  const runDirectory = await reportRunDirectory(input.reportRoot, input.runId, false);
  const reportJson = await readCommittedFile(path.join(runDirectory, "report.json"), input.maxBytes);
  parseAndVerifyReportJson(reportJson);
  const reportHtml = await readCommittedFile(path.join(runDirectory, "report.html"), input.maxBytes);
  const entries: DeliveryManifestEntry[] = [
    {
      portablePath: "report.html",
      byteLength: reportHtml.byteLength,
      sha256: digest(reportHtml),
    },
    {
      portablePath: "report.json",
      byteLength: reportJson.byteLength,
      sha256: digest(reportJson),
    },
  ];
  const manifestWithoutDigest = {
    schema: "dsheval.mvp.delivery-manifest/v1" as const,
    runId: input.runId,
    exportId: input.exportId,
    files: entries,
  };
  const manifestBytesWithoutDigest = Buffer.from(JSON.stringify(manifestWithoutDigest), "utf8");
  const manifest: DeliveryManifest = {
    ...manifestWithoutDigest,
    manifestDigest: digest(manifestBytesWithoutDigest),
  };
  const partialRoot = path.join(runDirectory, ".partial");
  const staged = path.join(partialRoot, input.exportId);
  const deliveryRoot = path.join(runDirectory, "delivery");
  const destination = path.join(deliveryRoot, input.exportId);
  for (const directory of [partialRoot, deliveryRoot]) {
    const existing = await lstat(directory).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (existing === undefined) await mkdir(directory, { mode: 0o700 });
    const metadata = await lstat(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("delivery staging path must be a real directory");
    }
    const resolved = await realpath(directory);
    if (!isWithin(runDirectory, resolved)) throw new Error("delivery path escaped report run root");
  }
  const unresolvedDeliveries = await readdir(partialRoot, { withFileTypes: true });
  if (unresolvedDeliveries.length > 0) {
    throw new Error("delivery recovery is required for an unconfirmed partial export");
  }
  if ((await lstat(destination).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  })) !== undefined) {
    throw new Error("delivery destination is immutable and already exists");
  }
  await mkdir(staged, { recursive: false, mode: 0o700 });
  try {
    await writeFile(path.join(staged, "report.json"), reportJson, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(staged, "report.html"), reportHtml, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(staged, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    for (const name of ["report.json", "report.html", "manifest.json"] as const) {
      const file = path.join(staged, name);
      const handle = await open(file, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await chmod(file, 0o400);
    }
    await syncDirectory(staged);
    await rename(staged, destination);
    await syncDirectory(deliveryRoot);
    return { directory: destination, manifest };
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
}
