#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  loadTargetDescriptor,
  UnsupportedTargetKindError,
} from "./bootstrap.js";
import {
  rebuildCommittedReportHtml,
  runEvaluationWorkflow,
  type ReportWorkflowSummary,
  type WorkflowSummary,
} from "./workflow.js";

const DEFAULT_MAX_ARTIFACT_BYTES = 1_048_576;

type TargetCommandName = "inspect" | "plan" | "run";

export type CliCommand =
  | {
      readonly command: TargetCommandName;
      readonly target: string;
      readonly fixture: boolean;
      readonly packRoot?: string;
      readonly configFile?: string;
      readonly runId?: string;
      readonly fixtureBehavior?: string;
    }
  | {
      readonly command: "report";
      readonly runId: string;
      readonly reportRoot?: string;
      readonly maxBytes?: number;
    };

interface CliFailureSummary {
  readonly schema: "dsheval.mvp.cli-summary/v1";
  readonly command: "inspect" | "plan" | "run" | "report" | "unknown";
  readonly status: "FAILED";
  readonly failureGroups: readonly ["plan_conflict" | "infrastructure_error"];
  readonly reasonCodes: readonly ["CLI_USAGE" | "CLI_OPERATION_FAILED"];
  readonly exitCode: 4;
}

interface CliUnsupportedTargetSummary {
  readonly schema: "dsheval.mvp.cli-summary/v1";
  readonly command: TargetCommandName;
  readonly status: "PLAN_UNSATISFIABLE";
  readonly failureGroups: readonly ["plan_conflict"];
  readonly reasonCodes: readonly ["UNSUPPORTED_TARGET_KIND"];
  readonly exitCode: 2;
}

class CliUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

const VALUE_OPTIONS = new Set([
  "--target",
  "--pack",
  "--config",
  "--run-id",
  "--fixture-behavior",
  "--run",
  "--report-root",
  "--max-bytes",
]);

const BOOLEAN_OPTIONS = new Set(["--fixture"]);

function parseOptions(argv: readonly string[]): ReadonlyMap<string, string | true> {
  const options = new Map<string, string | true>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === undefined || (!VALUE_OPTIONS.has(name) && !BOOLEAN_OPTIONS.has(name))) {
      throw new CliUsageError("unknown or misplaced CLI option");
    }
    if (options.has(name)) throw new CliUsageError("CLI options may be supplied only once");
    if (BOOLEAN_OPTIONS.has(name)) {
      options.set(name, true);
      continue;
    }
    const value = argv[index + 1];
    if (
      value === undefined ||
      value.startsWith("--") ||
      value.length === 0 ||
      value.includes("\0") ||
      /[\r\n]/u.test(value)
    ) {
      throw new CliUsageError("a CLI option is missing its value");
    }
    options.set(name, value);
    index += 1;
  }
  return options;
}

function assertOnly(
  options: ReadonlyMap<string, string | true>,
  allowed: ReadonlySet<string>,
): void {
  if ([...options.keys()].some((name) => !allowed.has(name))) {
    throw new CliUsageError("an option is not valid for this command");
  }
}

function required(options: ReadonlyMap<string, string | true>, name: string): string {
  const value = options.get(name);
  if (typeof value !== "string") throw new CliUsageError("a required CLI option is missing");
  return value;
}

function optional(options: ReadonlyMap<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

function positiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new CliUsageError(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CliUsageError(`${label} exceeds the safe integer range`);
  return parsed;
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const command = normalized[0];
  if (command !== "inspect" && command !== "plan" && command !== "run" && command !== "report") {
    throw new CliUsageError("expected one command: inspect, plan, run, or report");
  }
  const options = parseOptions(normalized.slice(1));
  if (command === "report") {
    assertOnly(options, new Set(["--run", "--report-root", "--max-bytes"]));
    const reportRoot = optional(options, "--report-root");
    const maxBytes = optional(options, "--max-bytes");
    return {
      command,
      runId: required(options, "--run"),
      ...(reportRoot === undefined ? {} : { reportRoot }),
      ...(maxBytes === undefined ? {} : { maxBytes: positiveInteger(maxBytes, "--max-bytes") }),
    };
  }

  const allowed = new Set([
    "--target",
    "--config",
    "--run-id",
    "--fixture",
  ]);
  if (command === "plan" || command === "run") allowed.add("--pack");
  if (command === "run") allowed.add("--fixture-behavior");
  assertOnly(options, allowed);
  const fixture = options.get("--fixture") === true;
  const fixtureBehavior = optional(options, "--fixture-behavior");
  if (fixtureBehavior !== undefined && !fixture) {
    throw new CliUsageError("--fixture-behavior requires the explicit --fixture marker");
  }
  if (command === "run" && fixture && fixtureBehavior === undefined) {
    throw new CliUsageError("--fixture requires an explicit --fixture-behavior");
  }
  if (fixtureBehavior !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(fixtureBehavior)) {
    throw new CliUsageError("--fixture-behavior must be a stable token");
  }
  const packRoot = optional(options, "--pack");
  const configFile = optional(options, "--config");
  const runId = optional(options, "--run-id");
  return {
    command,
    target: required(options, "--target"),
    fixture,
    ...(packRoot === undefined ? {} : { packRoot }),
    ...(configFile === undefined ? {} : { configFile }),
    ...(runId === undefined ? {} : { runId }),
    ...(fixtureBehavior === undefined ? {} : { fixtureBehavior }),
  };
}

async function executeTargetCommand(
  command: Extract<CliCommand, { readonly command: TargetCommandName }>,
  cwd: string,
): Promise<WorkflowSummary> {
  const descriptor = await loadTargetDescriptor(path.resolve(cwd, command.target));
  const controller = new AbortController();
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  try {
    return await runEvaluationWorkflow({
      cwd,
      descriptor,
      fixtureMode: command.fixture,
      signal: controller.signal,
      ...(command.packRoot === undefined ? {} : { packRoot: command.packRoot }),
      ...(command.configFile === undefined ? {} : { configFile: command.configFile }),
      ...(command.runId === undefined ? {} : { runId: command.runId }),
      ...(command.fixtureBehavior === undefined
        ? {}
        : { fixtureHooks: { behavior: command.fixtureBehavior } }),
      ...(command.command === "inspect"
        ? { stopAfter: "INSPECT" as const }
        : command.command === "plan"
          ? { stopAfter: "PLAN" as const }
          : {}),
    });
  } finally {
    process.off("SIGINT", cancel);
  }
}

async function executeReportCommand(
  command: Extract<CliCommand, { readonly command: "report" }>,
  cwd: string,
): Promise<ReportWorkflowSummary> {
  const configuredRoot = command.reportRoot ?? process.env.DSHEVAL_REPORT_ROOT;
  const reportRoot = path.resolve(cwd, configuredRoot ?? path.join("var", "reports"));
  const configuredMax = process.env.DSHEVAL_MAX_ARTIFACT_BYTES;
  const maxBytes =
    command.maxBytes ??
    (configuredMax === undefined
      ? DEFAULT_MAX_ARTIFACT_BYTES
      : positiveInteger(configuredMax, "DSHEVAL_MAX_ARTIFACT_BYTES"));
  return await rebuildCommittedReportHtml({ reportRoot, runId: command.runId, maxBytes });
}

function commandName(argv: readonly string[]): CliFailureSummary["command"] {
  const value = argv[0] === "--" ? argv[1] : argv[0];
  return value === "inspect" || value === "plan" || value === "run" || value === "report"
    ? value
    : "unknown";
}

function failureSummary(argv: readonly string[], usage: boolean): CliFailureSummary {
  return {
    schema: "dsheval.mvp.cli-summary/v1",
    command: commandName(argv),
    status: "FAILED",
    failureGroups: [usage ? "plan_conflict" : "infrastructure_error"],
    reasonCodes: [usage ? "CLI_USAGE" : "CLI_OPERATION_FAILED"],
    exitCode: 4,
  };
}

function unsupportedTargetSummary(argv: readonly string[]): CliUnsupportedTargetSummary {
  const command = commandName(argv);
  if (command !== "inspect" && command !== "plan" && command !== "run") {
    throw new Error("unsupported Target classification requires a Target command");
  }
  return {
    schema: "dsheval.mvp.cli-summary/v1",
    command,
    status: "PLAN_UNSATISFIABLE",
    failureGroups: ["plan_conflict"],
    reasonCodes: ["UNSUPPORTED_TARGET_KIND"],
    exitCode: 2,
  };
}

function redactedDiagnostic(error: unknown): string {
  const original =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : "CLI operation failed with a non-Error exception";
  let redacted = original.replaceAll(/[\r\n\t]+/gu, " ");
  const configuredNames = (process.env.DSHEVAL_SECRET_REF_NAMES ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const secretNames = new Set([
    ...configuredNames,
    ...Object.keys(process.env).filter((name) =>
      /(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_KEY)/u.test(name),
    ),
  ]);
  for (const name of secretNames) {
    const value = process.env[name];
    if (value !== undefined && value.length > 0) redacted = redacted.replaceAll(value, "[REDACTED]");
  }
  return redacted.slice(0, 512);
}

/** Executes one command without writing progress or domain objects to stdout. */
export async function runCli(
  argv: readonly string[],
  cwd: string,
  diagnostic: (message: string) => void,
): Promise<
  WorkflowSummary | ReportWorkflowSummary | CliFailureSummary | CliUnsupportedTargetSummary
> {
  try {
    const parsed = parseCliArgs(argv);
    const result = parsed.command === "report"
      ? await executeReportCommand(parsed, cwd)
      : await executeTargetCommand(parsed, cwd);
    if (result.exitCode !== 0) {
      const reason = result.reasonCodes.join(",");
      diagnostic(
        `${result.command} finished with exit code ${result.exitCode}${reason.length === 0 ? "" : ` (${reason})`}`,
      );
    }
    return result;
  } catch (error) {
    const usage = error instanceof CliUsageError;
    diagnostic(redactedDiagnostic(error));
    if (error instanceof UnsupportedTargetKindError) return unsupportedTargetSummary(argv);
    return failureSummary(argv, usage);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const result = await runCli(argv, process.cwd(), (message) => {
    process.stderr.write(`[dsheval] ${message}\n`);
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.exitCode;
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
