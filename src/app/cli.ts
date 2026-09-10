#!/usr/bin/env node

/**
 * 文件职责：DSHEval 主命令行入口。
 *
 * 核心流程：把 argv 严格解析为 inspect、plan、run 或 report 命令，读取 Target，
 * 调用 Workflow 或报告重建流程，并保证 stdout 只输出一条机器可读 JSON 摘要。
 *
 * 与其他文件的交互：使用 `app/bootstrap.ts` 读取 TargetDescriptor；调用
 * `app/workflow.ts` 执行或重建报告；package.json 的 `dsheval` 命令指向本文件。
 *
 * 公开接口：CliCommand、parseCliArgs、runCli 和 main。
 */
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
import { runEvaluationBatch } from "./batch.js";

/** report 命令没有显式限制时使用的最大读取字节数。 */
const DEFAULT_MAX_ARTIFACT_BYTES = 1_048_576;

/** 需要 TargetDescriptor 的三种命令。 */
type TargetCommandName = "inspect" | "plan" | "run";

/** 严格解析后的 CLI 判别联合；后续执行不再读取原始 argv。 */
export type CliCommand =
  | {
      readonly command: TargetCommandName;
      readonly target: string;
      readonly fixture: boolean;
      /** 只供 DSHEval 自测 Fixture 使用；真实运行从 datasets/labels/environments 组合。 */
      readonly fixturePackRoot?: string;
      readonly datasetCatalogPath?: string;
      readonly datasetsRoot?: string;
      readonly labelsRoot?: string;
      readonly traceFile?: string;
      readonly environmentFile?: string;
      readonly testProfile?: "STANDARD";
      readonly configFile?: string;
      readonly runId?: string;
      readonly fixtureBehavior?: string;
      readonly selectedCaseId?: string;
      readonly maxCases?: number;
      readonly stopAfterCase?: boolean;
    }
  | {
      readonly command: "report";
      readonly runId: string;
      readonly reportRoot?: string;
      readonly maxBytes?: number;
    };

/** CLI 用法或基础操作失败时输出的稳定摘要。 */
interface CliFailureSummary {
  readonly schema: "dsheval.mvp.cli-summary/v1";
  readonly command: "inspect" | "plan" | "run" | "report" | "unknown";
  readonly status: "FAILED";
  readonly failureGroups: readonly ["plan_conflict" | "infrastructure_error"];
  readonly reasonCodes: readonly ["CLI_USAGE" | "CLI_OPERATION_FAILED"];
  readonly exitCode: 4;
}

/** 非 FULL_AGENT Target 在创建 Run 前返回的规划失败摘要。 */
interface CliUnsupportedTargetSummary {
  readonly schema: "dsheval.mvp.cli-summary/v1";
  readonly command: TargetCommandName;
  readonly status: "PLAN_UNSATISFIABLE";
  readonly failureGroups: readonly ["plan_conflict"];
  readonly reasonCodes: readonly ["UNSUPPORTED_TARGET_KIND"];
  readonly exitCode: 2;
}

/** 参数形状、位置或组合不合法时由解析函数抛出的错误。 */
class CliUsageError extends Error {
  /** 保存安全、无原始 Secret 的用法错误消息。 */
  public constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

/** 后面必须紧跟一个值的命令行选项。 */
const VALUE_OPTIONS = new Set([
  "--target",
  "--fixture-pack",
  "--dataset-catalog",
  "--datasets",
  "--labels",
  "--trace",
  "--environment",
  "--test-profile",
  "--config",
  "--run-id",
  "--fixture-behavior",
  "--run",
  "--report-root",
  "--max-bytes",
  "--case",
  "--max-cases",
]);

/** 不消费后续 argv 的布尔开关。 */
const BOOLEAN_OPTIONS = new Set(["--fixture", "--stop-after-case"]);

/** 将选项序列解析为唯一键值表，并拒绝未知、重复或危险值。 */
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

/** 确认当前命令只使用它允许的选项集合；parseCliArgs 调用。 */
function assertOnly(
  options: ReadonlyMap<string, string | true>,
  allowed: ReadonlySet<string>,
): void {
  if ([...options.keys()].some((name) => !allowed.has(name))) {
    throw new CliUsageError("an option is not valid for this command");
  }
}

/** 读取必填字符串选项，缺失时转换为 CliUsageError。 */
function required(options: ReadonlyMap<string, string | true>, name: string): string {
  const value = options.get(name);
  if (typeof value !== "string") throw new CliUsageError("a required CLI option is missing");
  return value;
}

/** 读取可选字符串选项；布尔项和缺失项都返回 undefined。 */
function optional(options: ReadonlyMap<string, string | true>, name: string): string | undefined {
  const value = options.get(name);
  return typeof value === "string" ? value : undefined;
}

/** 解析 report 字节上限等正整数，并防止超出 JavaScript 安全整数范围。 */
function positiveInteger(value: string, label: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new CliUsageError(`${label} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CliUsageError(`${label} exceeds the safe integer range`);
  return parsed;
}

/**
 * 把 argv 编译为 CliCommand。runCli 调用它，并在此完成命令专属选项组合校验。
 */
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
  if (command === "plan" || command === "run") {
    allowed.add("--fixture-pack");
    allowed.add("--dataset-catalog");
    allowed.add("--datasets");
    allowed.add("--labels");
    allowed.add("--trace");
    allowed.add("--environment");
    allowed.add("--test-profile");
  }
  if (command === "run") {
    allowed.add("--fixture-behavior");
    allowed.add("--case");
    allowed.add("--max-cases");
    allowed.add("--stop-after-case");
  }
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
  const fixturePackRoot = optional(options, "--fixture-pack");
  const datasetCatalogPath = optional(options, "--dataset-catalog");
  const datasetsRoot = optional(options, "--datasets");
  const labelsRoot = optional(options, "--labels");
  const traceFile = optional(options, "--trace");
  const environmentFile = optional(options, "--environment");
  const profileText = optional(options, "--test-profile");
  if (profileText !== undefined && profileText !== "STANDARD") {
    throw new CliUsageError("--test-profile only supports STANDARD");
  }
  const configFile = optional(options, "--config");
  const runId = optional(options, "--run-id");
  const selectedCaseId = optional(options, "--case");
  const maxCasesText = optional(options, "--max-cases");
  const stopAfterCase = options.get("--stop-after-case") === true;
  if (fixturePackRoot !== undefined && !fixture) {
    throw new CliUsageError("--fixture-pack is only available with --fixture");
  }
  if (fixture && (selectedCaseId !== undefined || maxCasesText !== undefined || stopAfterCase)) {
    throw new CliUsageError("batch Case controls are only available for a real run");
  }
  return {
    command,
    target: required(options, "--target"),
    fixture,
    ...(fixturePackRoot === undefined ? {} : { fixturePackRoot }),
    ...(datasetCatalogPath === undefined ? {} : { datasetCatalogPath }),
    ...(datasetsRoot === undefined ? {} : { datasetsRoot }),
    ...(labelsRoot === undefined ? {} : { labelsRoot }),
    ...(traceFile === undefined ? {} : { traceFile }),
    ...(environmentFile === undefined ? {} : { environmentFile }),
    ...(profileText === undefined ? {} : { testProfile: profileText }),
    ...(configFile === undefined ? {} : { configFile }),
    ...(runId === undefined ? {} : { runId }),
    ...(fixtureBehavior === undefined ? {} : { fixtureBehavior }),
    ...(selectedCaseId === undefined ? {} : { selectedCaseId }),
    ...(maxCasesText === undefined ? {} : { maxCases: positiveInteger(maxCasesText, "--max-cases") }),
    ...(stopAfterCase ? { stopAfterCase: true } : {}),
  };
}

/** 执行 inspect/plan/run；负责加载 Target 并把 SIGINT 转成 Workflow AbortSignal。 */
async function executeTargetCommand(
  command: Extract<CliCommand, { readonly command: TargetCommandName }>,
  cwd: string,
): Promise<WorkflowSummary> {
  const descriptor = await loadTargetDescriptor(path.resolve(cwd, command.target));
  const controller = new AbortController();
  /** 将一次 SIGINT 转换为当前 Workflow 的取消请求。 */
  const cancel = (): void => controller.abort();
  process.once("SIGINT", cancel);
  try {
    const workflowInput = {
      cwd,
      descriptor,
      fixtureMode: command.fixture,
      signal: controller.signal,
      ...(command.fixturePackRoot === undefined ? {} : { packRoot: command.fixturePackRoot }),
      ...(command.datasetCatalogPath === undefined ? {} : { datasetCatalogPath: command.datasetCatalogPath }),
      ...(command.datasetsRoot === undefined ? {} : { datasetsRoot: command.datasetsRoot }),
      ...(command.labelsRoot === undefined ? {} : { labelsRoot: command.labelsRoot }),
      ...(command.traceFile === undefined ? {} : { traceFile: command.traceFile }),
      ...(command.environmentFile === undefined ? {} : { environmentFile: command.environmentFile }),
      ...(command.testProfile === undefined ? {} : { testProfile: command.testProfile }),
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
    };
    if (command.command === "run" && !command.fixture) {
      return await runEvaluationBatch({
        ...workflowInput,
        ...(command.selectedCaseId === undefined ? {} : { selectedCaseId: command.selectedCaseId }),
        ...(command.maxCases === undefined ? {} : { maxCases: command.maxCases }),
        ...(command.stopAfterCase === undefined ? {} : { stopAfterCase: command.stopAfterCase }),
        onProgress: (message) => process.stderr.write(`[dsheval:batch] ${message}\n`),
      });
    }
    return await runEvaluationWorkflow(workflowInput);
  } finally {
    process.off("SIGINT", cancel);
  }
}

/** 执行 report 命令，从已提交 report.json 确定性重建 HTML。 */
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

/** 从原始 argv 提取可安全写入失败摘要的命令名。 */
function commandName(argv: readonly string[]): CliFailureSummary["command"] {
  const value = argv[0] === "--" ? argv[1] : argv[0];
  return value === "inspect" || value === "plan" || value === "run" || value === "report"
    ? value
    : "unknown";
}

/** 将 CLI 用法或运行异常映射为固定退出码 4 的失败摘要。 */
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

/** 将 UnsupportedTargetKindError 映射为退出码 2 的规划失败摘要。 */
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

/** 清理换行并替换已知 Secret 值，生成长度受限的 stderr 诊断。 */
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

/**
 * 执行一条命令并返回结构化摘要。main 调用它；测试也直接注入 diagnostic 检查错误路径。
 */
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

/** 进程入口：stderr 接收诊断，stdout 恰好写一条 JSON，并返回约定退出码。 */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const result = await runCli(argv, process.cwd(), (message) => {
    process.stderr.write(`[dsheval] ${message}\n`);
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.exitCode;
}

// 只有直接执行本文件时才启动 CLI；被测试或其他模块 import 时没有副作用。
const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
