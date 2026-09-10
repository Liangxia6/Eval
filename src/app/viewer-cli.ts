#!/usr/bin/env node

/**
 * 文件职责：只读评测 Viewer 的命令行入口。
 *
 * 核心流程：解析 Run、记录根、报告根和回环监听参数，启动 Viewer，输出监听信息，
 * 等待终止信号后关闭 HTTP Server。
 *
 * 与其他文件的交互：调用 `platform/viewer.ts` 的 startViewer/closeViewer；
 * package.json 的 `dsheval-viewer` 命令指向本文件。
 *
 * 公开接口：ViewerCliOptions、ViewerCliUsageError、parseViewerCliArgs 和 main。
 */
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

/** CLI 默认监听端口和单个 HTML 文件读取上限。 */
const DEFAULT_PORT = 4173;
const DEFAULT_MAX_HTML_BYTES = 8 * 1024 * 1024;
/** Viewer CLI 唯一接受的带值选项。 */
const VALUE_OPTIONS = new Set([
  "--run",
  "--run-root",
  "--report-root",
  "--host",
  "--port",
  "--max-bytes",
]);

/** 已校验并补齐默认值的 Viewer 启动参数。 */
export interface ViewerCliOptions extends ViewerOptions {
  readonly host: ViewerHost;
  readonly port: number;
  readonly maxHtmlBytes: number;
}

/** Viewer 参数非法时由解析层抛出，main 将其映射为退出码 2。 */
export class ViewerCliUsageError extends Error {
  /** 保存适合写入 stderr 的简短参数错误。 */
  public constructor(message: string) {
    super(message);
    this.name = "ViewerCliUsageError";
  }
}

/** 将原始 argv 解析为唯一字符串选项表，并拒绝未知、重复或危险值。 */
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

/** 读取必填 Viewer 选项；parseViewerCliArgs 调用。 */
function required(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined) throw new ViewerCliUsageError(`${name} is required`);
  return value;
}

/** 解析端口或字节上限，并校验安全整数范围。 */
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

/** 把 argv 和 cwd 编译为 platform Viewer 可直接使用的绝对路径配置。 */
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

/** 等待首个 SIGINT/SIGTERM/SIGHUP，并同步移除其余监听器。 */
function waitForShutdownSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    const signals: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
    /** 只处理第一个终止信号，并清理本函数注册的全部监听器。 */
    const received = (signal: NodeJS.Signals): void => {
      for (const candidate of signals) process.off(candidate, received);
      resolve(signal);
    };
    for (const signal of signals) process.once(signal, received);
  });
}

/** 启动 Viewer 进程、输出监听摘要，并保证正常或异常路径都关闭 Server。 */
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

// 直接执行时启动进程入口；被单元测试 import 时保持无副作用。
const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
