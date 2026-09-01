#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { validateStableId } from "../core/models.js";
import {
  closeViewer,
  startViewer,
  type ViewerHost,
  type ViewerOptions,
} from "../platform/viewer.js";

const DEFAULT_PORT = 4173;
const DEFAULT_MAX_HTML_BYTES = 8 * 1024 * 1024;
const VALUE_OPTIONS = new Set([
  "--run",
  "--run-root",
  "--report-root",
  "--host",
  "--port",
  "--max-bytes",
]);

export interface ViewerCliOptions extends ViewerOptions {
  readonly host: ViewerHost;
  readonly port: number;
  readonly maxHtmlBytes: number;
}

export class ViewerCliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ViewerCliUsageError";
  }
}

function parseOptions(argv: readonly string[]): ReadonlyMap<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === undefined || !VALUE_OPTIONS.has(name)) {
      throw new ViewerCliUsageError("unknown or misplaced Viewer option");
    }
    if (options.has(name)) {
      throw new ViewerCliUsageError("Viewer options may be supplied only once");
    }
    const value = argv[index + 1];
    if (
      value === undefined ||
      value.length === 0 ||
      value.startsWith("--") ||
      value.includes("\0") ||
      /[\r\n]/u.test(value)
    ) {
      throw new ViewerCliUsageError(`${name} requires one safe value`);
    }
    options.set(name, value);
    index += 1;
  }
  return options;
}

function required(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined) throw new ViewerCliUsageError(`${name} is required`);
  return value;
}

function parseInteger(value: string, name: string, maximum: number): number {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new ViewerCliUsageError(`${name} must be a positive decimal integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new ViewerCliUsageError(`${name} exceeds its allowed range`);
  }
  return parsed;
}

export function parseViewerCliArgs(
  argv: readonly string[],
  cwd = process.cwd(),
): ViewerCliOptions {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const options = parseOptions(normalized);
  const runId = String(validateStableId(required(options, "--run"), "runId"));
  const hostValue = options.get("--host") ?? "127.0.0.1";
  if (hostValue !== "127.0.0.1" && hostValue !== "::1") {
    throw new ViewerCliUsageError("--host must be exactly 127.0.0.1 or ::1");
  }
  const portValue = options.get("--port");
  const maxBytesValue = options.get("--max-bytes");
  return {
    runRoot: path.resolve(cwd, options.get("--run-root") ?? path.join("var", "records")),
    reportRoot: path.resolve(cwd, options.get("--report-root") ?? path.join("var", "reports")),
    runId,
    host: hostValue,
    port: portValue === undefined ? DEFAULT_PORT : parseInteger(portValue, "--port", 65_535),
    maxHtmlBytes:
      maxBytesValue === undefined
        ? DEFAULT_MAX_HTML_BYTES
        : parseInteger(maxBytesValue, "--max-bytes", 64 * 1024 * 1024),
  };
}

function waitForShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    const received = (signal: NodeJS.Signals): void => {
      for (const candidate of signals) process.off(candidate, received);
      resolve(signal);
    };
    for (const signal of signals) process.once(signal, received);
  });
}

export async function main(argv = process.argv.slice(2), cwd = process.cwd()): Promise<number> {
  let viewer;
  try {
    const options = parseViewerCliArgs(argv, cwd);
    viewer = await startViewer(options);
    process.stdout.write(
      `${JSON.stringify({
        schema: "dsheval.mvp.viewer/v1",
        status: "LISTENING",
        runId: viewer.runId,
        url: viewer.url,
        sshForwardTarget: `${viewer.host}:${viewer.port}`,
      })}\n`,
    );
    await waitForShutdownSignal();
    await closeViewer(viewer);
    return 0;
  } catch (error) {
    if (viewer !== undefined) await closeViewer(viewer);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "Viewer failed";
    process.stderr.write(`[dsheval-viewer] ${message.replaceAll(/[\r\n\t]+/gu, " ").slice(0, 512)}\n`);
    return error instanceof ViewerCliUsageError ? 2 : 4;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
