#!/usr/bin/env node

/**
 * 文件职责：为插件选择提供一个最小本地 Web UI。
 *
 * 核心流程：启动只监听回环地址的 HTTP 服务，页面收集 Target、插件名和评测参数，
 * 调用现有插件解析逻辑校验 dsheval.ai 安装源，并生成等价 CLI 命令。
 *
 * 与其他文件的交互：复用 `app/bootstrap.ts` 读取 TargetDescriptor；复用
 * `app/plugins.ts` 的 resolvePlugins；package.json 的 `plugin-ui` 脚本指向本文件。
 *
 * 公开接口：PluginUiOptions、parsePluginUiArgs、startPluginUi 和 main。
 */
import { lstat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadTargetDescriptor } from "./bootstrap.js";
import { resolvePlugins, searchPlugins } from "./plugins.js";
import { runCli } from "./cli.js";

/** UI 默认只监听本机回环，避免把本地评测入口暴露到网络。 */
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4174;
const MAX_REQUEST_BYTES = 64 * 1024;

/** 插件 UI 支持的命令行选项。 */
const VALUE_OPTIONS = new Set([
  "--target",
  "--datasets",
  "--labels",
  "--trace",
  "--environment",
  "--test-profile",
  "--config",
  "--host",
  "--port",
]);

/** 插件 UI 当前接受的监听地址。 */
export type PluginUiHost = "127.0.0.1" | "::1";

/** 启动 UI 时可预填的评测参数。 */
export interface PluginUiOptions {
  readonly target: string;
  readonly datasets: string;
  readonly labels: string;
  readonly trace: string;
  readonly environment: string;
  readonly testProfile: "STANDARD";
  readonly config: string;
  readonly host: PluginUiHost;
  readonly port: number;
}

/** 已启动 UI 的监听信息和关闭函数。 */
export interface PluginUiHandle {
  readonly host: PluginUiHost;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

interface ResolveRequest {
  readonly target: string;
  readonly datasets: string;
  readonly labels: string;
  readonly trace: string;
  readonly environment: string;
  readonly testProfile: "STANDARD";
  readonly config: string;
  readonly plugins: readonly string[];
}

/** 参数错误会被 main 映射为稳定退出码。 */
export class PluginUiUsageError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PluginUiUsageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseOptions(argv: readonly string[]): ReadonlyMap<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === undefined || !VALUE_OPTIONS.has(name)) {
      throw new PluginUiUsageError("unknown or misplaced plugin UI option");
    }
    if (options.has(name)) throw new PluginUiUsageError("plugin UI options may be supplied only once");
    const value = argv[index + 1];
    if (
      value === undefined ||
      value.length === 0 ||
      value.startsWith("--") ||
      value.includes("\0") ||
      /[\r\n]/u.test(value)
    ) {
      throw new PluginUiUsageError(`${name} requires one safe value`);
    }
    options.set(name, value);
    index += 1;
  }
  return options;
}

function positivePort(value: string): number {
  if (!/^[1-9][0-9]*$/u.test(value)) throw new PluginUiUsageError("--port must be a positive integer");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 65_535) {
    throw new PluginUiUsageError("--port exceeds its allowed range");
  }
  return parsed;
}

function host(value: string): PluginUiHost {
  if (value !== "127.0.0.1" && value !== "::1") {
    throw new PluginUiUsageError("--host must be exactly 127.0.0.1 or ::1");
  }
  return value;
}

/** 解析 plugin-ui 自身的启动参数；全部字段都有安全默认值。 */
export function parsePluginUiArgs(argv: readonly string[]): PluginUiOptions {
  const normalized = argv[0] === "--" ? argv.slice(1) : argv;
  const options = parseOptions(normalized);
  const testProfile = options.get("--test-profile") ?? "STANDARD";
  if (testProfile !== "STANDARD") throw new PluginUiUsageError("--test-profile only supports STANDARD");
  return {
    target: options.get("--target") ?? "config/targets/real-dsh.json",
    datasets: options.get("--datasets") ?? "datasets",
    labels: options.get("--labels") ?? "labels",
    trace: options.get("--trace") ?? "trace/dsh-runtime.json",
    environment: options.get("--environment") ?? "environments/macos.json",
    testProfile,
    config: options.get("--config") ?? "config/macos-vm.json",
    host: host(options.get("--host") ?? DEFAULT_HOST),
    port: options.get("--port") === undefined ? DEFAULT_PORT : positivePort(options.get("--port")!),
  };
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function sendHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    "Cache-Control": "no-store, max-age=0",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    "Content-Type": "text/html; charset=utf-8",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  });
  response.end(html);
}

async function readRequestJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_REQUEST_BYTES) throw new Error("request body is too large");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0") ? value : fallback;
}

function pluginNames(value: unknown): readonly string[] {
  const raw = Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" ? item.split(",") : [])
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Object.freeze(raw.map((item) => item.trim()).filter(Boolean));
}

function resolveRequest(value: unknown, defaults: PluginUiOptions): ResolveRequest {
  if (!isRecord(value)) throw new Error("request body must be a JSON object");
  const testProfile = safeString(value.testProfile, defaults.testProfile);
  if (testProfile !== "STANDARD") throw new Error("testProfile only supports STANDARD");
  return {
    target: safeString(value.target, defaults.target),
    datasets: safeString(value.datasets, defaults.datasets),
    labels: safeString(value.labels, defaults.labels),
    trace: safeString(value.trace, defaults.trace),
    environment: safeString(value.environment, defaults.environment),
    testProfile,
    config: safeString(value.config, defaults.config),
    plugins: pluginNames(value.plugins),
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/u.test(value)) return value;
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildCliCommand(request: ResolveRequest): string {
  const lines = [
    "pnpm --silent cli -- run \\",
    `  --target ${shellQuote(request.target)} \\`,
  ];
  if (request.plugins.length > 0) {
    lines.push(`  --plugin ${shellQuote(request.plugins.join(","))} \\`);
  }
  lines.push(
    `  --datasets ${shellQuote(request.datasets)} \\`,
    `  --labels ${shellQuote(request.labels)} \\`,
    `  --trace ${shellQuote(request.trace)} \\`,
    `  --environment ${shellQuote(request.environment)} \\`,
    `  --test-profile ${shellQuote(request.testProfile)} \\`,
    `  --config ${shellQuote(request.config)}`,
  );
  return lines.join("\n");
}

async function targetStatus(targetFile: string, cwd: string): Promise<Record<string, unknown>> {
  const descriptor = await loadTargetDescriptor(path.resolve(cwd, targetFile));
  try {
    const metadata = await lstat(descriptor.sourceRoot);
    return {
      ok: metadata.isDirectory() && !metadata.isSymbolicLink(),
      targetId: String(descriptor.targetId),
      sourceRoot: descriptor.sourceRoot,
      profile: descriptor.profile,
      dshExecutable: descriptor.dshExecutable,
      dshHome: descriptor.dshHome,
    };
  } catch (error) {
    return {
      ok: false,
      targetId: String(descriptor.targetId),
      sourceRoot: descriptor.sourceRoot,
      profile: descriptor.profile,
      dshExecutable: descriptor.dshExecutable,
      dshHome: descriptor.dshHome,
      error: error instanceof Error ? error.message : "target sourceRoot is not accessible",
    };
  }
}

async function handleResolve(
  request: IncomingMessage,
  response: ServerResponse,
  defaults: PluginUiOptions,
  cwd: string,
): Promise<void> {
  const body = resolveRequest(await readRequestJson(request), defaults);
  const [selection, target] = await Promise.all([
    resolvePlugins(body.plugins),
    targetStatus(body.target, cwd).catch((error: unknown) => ({
      ok: false,
      error: error instanceof Error ? error.message : "target descriptor could not be read",
    })),
  ]);
  sendJson(response, 200, {
    schema: "dsheval.plugin-ui.resolve/v1",
    status: "OK",
    target,
    plugins: selection.plugins,
    installCommands: selection.installCommands,
    command: buildCliCommand(body),
  });
}

function notFound(response: ServerResponse): void {
  sendJson(response, 404, {
    schema: "dsheval.plugin-ui.error/v1",
    status: "FAILED",
    error: "not found",
  });
}

async function handleSearch(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readRequestJson(request);
  const query = isRecord(body) && typeof body.query === "string" ? body.query : "";
  sendJson(response, 200, { schema: "dsheval.plugin-ui.search/v1", status: "OK", plugins: await searchPlugins(query) });
}

async function handleRun(request: IncomingMessage, response: ServerResponse, defaults: PluginUiOptions, cwd: string): Promise<void> {
  const body = resolveRequest(await readRequestJson(request), defaults);
  const argv = [
    "run", "--target", body.target,
    ...(body.plugins.length === 0 ? [] : ["--plugin", body.plugins.join(",")]),
    "--datasets", body.datasets, "--labels", body.labels, "--trace", body.trace,
    "--environment", body.environment, "--test-profile", body.testProfile, "--config", body.config,
  ];
  const diagnostics: string[] = [];
  const result = await runCli(argv, cwd, (message) => diagnostics.push(message));
  sendJson(response, 200, { schema: "dsheval.plugin-ui.run/v1", status: result.exitCode === 0 ? "COMPLETED" : "FAILED", result, diagnostics });
}

function html(defaults: PluginUiOptions): string {
  const defaultsJson = JSON.stringify(defaults).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>DSHEval Plugin UI</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: light-dark(#f4f7ff, #10131b);
      --panel: light-dark(#ffffff, #1d222c);
      --panel-2: light-dark(#f0f3f8, #282f3b);
      --text: light-dark(#151923, #eef2f7);
      --muted: light-dark(#667085, #a7b0c0);
      --border: light-dark(#d9dee8, #3a4351);
      --primary: light-dark(#4f46e5, #a5b4fc);
      --primary-text: light-dark(#ffffff, #10131a);
      --success: light-dark(#087443, #6bd69a);
      --warning: light-dark(#b54708, #ffbe6b);
      --danger: light-dark(#b42318, #ff8a80);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: radial-gradient(circle at 10% 0%, light-dark(#e8edff, #20264a), transparent 36%), var(--bg);
      color: var(--text);
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 28px max(24px, calc((100vw - 1120px) / 2));
      border-bottom: 1px solid var(--border);
      background: linear-gradient(120deg, color-mix(in srgb, var(--primary) 12%, var(--panel)), color-mix(in srgb, var(--panel) 92%, transparent));
      backdrop-filter: blur(18px);
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px;
      display: grid;
      gap: 18px;
    }
    h1 { margin: 0; font-size: 25px; letter-spacing: -.04em; }
    h2 { margin: 0 0 10px; font-size: 16px; letter-spacing: -.01em; }
    p { margin: 0; color: var(--muted); line-height: 1.45; }
    .subtle { color: var(--muted); font-size: 13px; }
    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-mark { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 13px; background: linear-gradient(135deg, var(--primary), #8b5cf6); color: white; font-size: 21px; font-weight: 800; box-shadow: 0 9px 22px color-mix(in srgb, var(--primary) 28%, transparent); }
    .header-badge { padding: 8px 12px; border: 1px solid color-mix(in srgb, var(--primary) 22%, var(--border)); border-radius: 999px; color: var(--primary); background: color-mix(in srgb, var(--primary) 8%, transparent); font-size: 12px; font-weight: 700; }
    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(320px, .75fr);
      gap: 18px;
    }
    .card {
      background: color-mix(in srgb, var(--panel) 94%, transparent);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 14px 40px color-mix(in srgb, var(--text) 7%, transparent);
    }
    .card.hero { padding: 24px; }
    .card-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
    .card-title h2 { margin: 0; }
    .eyebrow { color: var(--primary); font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
    label {
      display: grid;
      gap: 7px;
      margin: 12px 0;
      color: var(--muted);
      font-size: 13px;
    }
    input, textarea {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      background: var(--panel-2);
      color: var(--text);
      font: inherit;
      font-size: 14px;
      transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
    }
    input:focus, textarea:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--primary) 18%, transparent); background: var(--panel); }
    textarea {
      min-height: 86px;
      resize: vertical;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    }
    .two {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .fixed-inputs { display: none; }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-top: 14px;
    }
    button {
      border: 0;
      border-radius: 10px;
      padding: 10px 14px;
      background: var(--primary);
      color: var(--primary-text);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
    }
    button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 7px 16px color-mix(in srgb, var(--primary) 22%, transparent); }
    button.secondary {
      background: var(--panel-2);
      color: var(--text);
      border: 1px solid var(--border);
    }
    button:disabled {
      cursor: wait;
      opacity: .7;
    }
    .status {
      padding: 10px 12px;
      border-radius: 10px;
      background: var(--panel-2);
      color: var(--muted);
      font-size: 13px;
    }
    .status.ok { color: var(--success); }
    .status.warn { color: var(--warning); }
    .status.err { color: var(--danger); }
    .results {
      display: grid;
      gap: 10px;
    }
    .plugin {
      position: relative;
      display: grid;
      gap: 4px;
      padding: 12px;
      border-radius: 12px;
      background: var(--panel-2);
      border: 1px solid transparent;
      transition: border-color .15s ease, background .15s ease, transform .15s ease;
    }
    .plugin:hover { border-color: color-mix(in srgb, var(--primary) 45%, var(--border)); transform: translateY(-1px); }
    button.plugin { width: 100%; text-align: left; color: var(--text); }
    button.plugin .meta { display: block; font-weight: 400; }
    .selected-plugin { background: color-mix(in srgb, var(--primary) 9%, var(--panel-2)); }
    #suggestions:has(.plugin) { max-height: 310px; overflow: auto; padding: 4px; border: 1px solid var(--border); border-radius: 14px; background: color-mix(in srgb, var(--panel-2) 65%, transparent); }
    #selected { margin-top: 10px; }
    .selection-label { margin-top: 18px; color: var(--muted); font-size: 12px; font-weight: 700; }
    .plugin.selected-plugin { padding-right: 42px; }
    .remove-plugin {
      position: absolute;
      top: 7px;
      right: 7px;
      width: 26px;
      height: 26px;
      padding: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--muted);
      font-size: 20px;
      line-height: 24px;
      opacity: 0;
      transition: opacity .12s ease, background .12s ease, color .12s ease;
    }
    .selected-plugin:hover .remove-plugin,
    .selected-plugin:focus-within .remove-plugin { opacity: 1; }
    .remove-plugin:hover { background: var(--danger); color: var(--primary-text); }
    .plugin strong {
      font-weight: 600;
    }
    .meta {
      color: var(--muted);
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    pre {
      margin: 0;
      padding: 14px;
      border-radius: 12px;
      background: var(--panel-2);
      color: var(--text);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
      font-size: 13px;
      line-height: 1.45;
    }
    .empty {
      color: var(--muted);
      font-size: 14px;
    }
    @media (max-width: 820px) {
      header, .grid, .two { grid-template-columns: 1fr; }
      header { align-items: stretch; }
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="brand-mark">D</div>
      <div>
      <h1>DSHEval Plugin UI</h1>
      <p class="subtle">选择插件 → 校验安装源 → 生成等价 CLI 命令</p>
      </div>
    </div>
    <div class="header-badge">本地安全模式</div>
  </header>
  <main>
    <section class="grid">
      <form class="card hero" id="form">
        <div class="card-title"><div><h2>选择要评测的插件</h2></div></div>
        <div class="fixed-inputs">
        <label>Target descriptor
          <input id="target" name="target" autocomplete="off">
        </label>
        </div>
        <label>搜索并选择插件
          <input id="pluginSearch" autocomplete="off" placeholder="输入插件名或关键词，例如 market">
          <div id="suggestions" class="results"><div class="empty">输入关键词开始搜索。</div></div>
          <div class="selection-label">已选择插件</div>
          <div id="selected" class="results"></div>
          <input id="plugins" type="hidden" value="">
        </label>
        <div class="fixed-inputs two">
          <label>Datasets
            <input id="datasets" name="datasets" autocomplete="off">
          </label>
          <label>Labels
            <input id="labels" name="labels" autocomplete="off">
          </label>
        </div>
        <div class="fixed-inputs two">
          <label>Trace
            <input id="trace" name="trace" autocomplete="off">
          </label>
          <label>Environment
            <input id="environment" name="environment" autocomplete="off">
          </label>
        </div>
        <div class="fixed-inputs two">
          <label>Test profile
            <input id="testProfile" name="testProfile" autocomplete="off">
          </label>
          <label>Config
            <input id="config" name="config" autocomplete="off">
          </label>
        </div>
        <div class="actions">
          <button id="resolve" type="submit">解析插件并生成命令</button>
          <button id="run" type="button">开始评测</button>
          <button class="secondary" id="copy" type="button" disabled>复制命令</button>
          <span class="status" id="status">等待输入</span>
        </div>
      </form>
      <aside class="card">
        <div class="card-title"><div><h2>评测对象</h2></div></div>
        <div id="targetBox" class="empty">尚未解析。</div>
      </aside>
    </section>
    <section class="card">
      <h2>插件解析结果</h2>
      <div id="results" class="results"><div class="empty">尚未解析。</div></div>
    </section>
    <section class="card">
      <h2>等价 CLI 命令</h2>
      <pre id="command">尚未生成。</pre>
    </section>
  </main>
  <script>
    const defaults = ${defaultsJson};
    const state = { command: "" };
    const fields = ["target", "datasets", "labels", "trace", "environment", "testProfile", "config"];
    for (const field of fields) document.getElementById(field).value = defaults[field];
    const form = document.getElementById("form");
    const status = document.getElementById("status");
    const results = document.getElementById("results");
    const targetBox = document.getElementById("targetBox");
    const command = document.getElementById("command");
    const resolveButton = document.getElementById("resolve");
    const copyButton = document.getElementById("copy");
    const runButton = document.getElementById("run");
    const searchInput = document.getElementById("pluginSearch");
    const suggestions = document.getElementById("suggestions");
    const selectedBox = document.getElementById("selected");
    const selected = [];

    function splitPlugins(value) {
      return value.split(/[,\\n]/).map((item) => item.trim()).filter(Boolean);
    }
    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[char]);
    }
    function setStatus(text, kind) {
      status.textContent = text;
      status.className = "status" + (kind ? " " + kind : "");
    }
    function renderSelected() {
      document.getElementById("plugins").value = selected.map((p) => p.name).join(",");
      selectedBox.innerHTML = selected.length ? selected.map((p, i) => '<div class="plugin selected-plugin"><strong>' + escapeHtml(p.name) + '</strong><span class="meta">已选择 · #' + escapeHtml(p.rank) + '</span><button type="button" class="remove-plugin" aria-label="删除 ' + escapeHtml(p.name) + '" title="删除" data-remove="' + i + '">×</button></div>').join("") : '<div class="empty">尚未选择插件。</div>';
      selectedBox.querySelectorAll("[data-remove]").forEach((button) => button.addEventListener("click", () => { selected.splice(Number(button.dataset.remove), 1); renderSelected(); }));
    }
    function renderSuggestions(items) {
      suggestions.innerHTML = items.length ? items.map((p) => '<button type="button" class="plugin secondary" data-plugin="' + escapeHtml(p.name) + '"><strong>' + escapeHtml(p.name) + ' <span class="meta">#' + escapeHtml(p.rank) + '</span></strong><span class="meta">' + escapeHtml(p.fullName) + (p.packageName ? ' · ' + escapeHtml(p.packageName) : ' · 未识别安装源') + '</span></button>').join("") : '<div class="empty">没有匹配的插件。</div>';
      suggestions.querySelectorAll("[data-plugin]").forEach((button, index) => button.addEventListener("click", () => { const item = items[index]; if (item && item.packageName && !selected.some((p) => p.name === item.name)) selected.push(item); renderSelected(); searchInput.value = ""; suggestions.innerHTML = '<div class="empty">输入关键词开始搜索。</div>'; }));
    }
    let searchTimer;
    searchInput.addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(async () => { try { const r = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: searchInput.value }) }); renderSuggestions((await r.json()).plugins || []); } catch { suggestions.innerHTML = '<div class="empty">搜索失败，请检查网络。</div>'; } }, 250); });
    renderSelected();
    function renderTarget(target) {
      if (!target || !target.ok) {
        targetBox.innerHTML = '<div class="status warn">Target 路径暂不可访问</div><p class="meta">' + escapeHtml(target?.error || "未读取到 Target") + '</p>';
        return;
      }
      targetBox.innerHTML =
        '<div class="status ok">Target 可访问</div>' +
        '<p class="meta">targetId: ' + escapeHtml(target.targetId) + '</p>' +
        '<p class="meta">sourceRoot: ' + escapeHtml(target.sourceRoot) + '</p>' +
        '<p class="meta">profile: ' + escapeHtml(target.profile) + '</p>';
    }
    function renderPlugins(plugins) {
      if (!plugins.length) {
        results.innerHTML = '<div class="empty">没有选择插件；命令会按普通评测运行。</div>';
        return;
      }
      results.innerHTML = plugins.map((plugin) =>
        '<div class="plugin">' +
          '<strong>' + escapeHtml(plugin.name) + ' <span class="meta">#' + escapeHtml(plugin.rank) + '</span></strong>' +
          '<div class="meta">输入：' + escapeHtml(plugin.input) + '</div>' +
          '<div class="meta">仓库：' + escapeHtml(plugin.fullName) + '</div>' +
          '<div class="meta">安装目标：' + escapeHtml(plugin.packageName) + '</div>' +
        '</div>'
      ).join("");
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      resolveButton.disabled = true;
      copyButton.disabled = true;
      setStatus("正在解析 dsheval.ai 插件目录…", "");
      try {
        const body = {};
        for (const field of fields) body[field] = document.getElementById(field).value.trim();
        body.plugins = splitPlugins(document.getElementById("plugins").value);
        const response = await fetch("/api/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const data = await response.json();
        if (!response.ok || data.status !== "OK") throw new Error(data.error || "解析失败");
        renderTarget(data.target);
        renderPlugins(data.plugins || []);
        state.command = data.command || "";
        command.textContent = state.command || "尚未生成。";
        copyButton.disabled = state.command.length === 0;
        setStatus("解析完成", data.target?.ok ? "ok" : "warn");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "解析失败", "err");
        results.innerHTML = '<div class="empty">解析失败。请检查插件名称或网络。</div>';
      } finally {
        resolveButton.disabled = false;
      }
    });
    runButton.addEventListener("click", async () => {
      runButton.disabled = true;
      resolveButton.disabled = true;
      setStatus("评测运行中，请等待 CLI 返回结果…", "");
      try {
        const body = {};
        for (const field of fields) body[field] = document.getElementById(field).value.trim();
        body.plugins = splitPlugins(document.getElementById("plugins").value);
        const response = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "评测启动失败");
        renderTarget(data.result?.targetSnapshotId ? { ok: true, targetId: data.result.targetSnapshotId } : data.result?.target);
        command.textContent = JSON.stringify(data.result, null, 2);
        setStatus(data.status === "COMPLETED" ? "评测完成" : "评测失败", data.status === "COMPLETED" ? "ok" : "err");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "评测失败", "err");
      } finally { runButton.disabled = false; resolveButton.disabled = false; }
    });
    copyButton.addEventListener("click", async () => {
      await navigator.clipboard.writeText(state.command);
      setStatus("命令已复制", "ok");
    });
  </script>
</body>
</html>`;
}

/** 启动最小插件选择 UI。 */
export async function startPluginUi(options: PluginUiOptions, cwd = process.cwd()): Promise<PluginUiHandle> {
  const server = createServer((request, response) => {
    void (async () => {
      const url = request.url ?? "/";
      if (request.method === "GET" && (url === "/" || url === "/index.html")) {
        sendHtml(response, html(options));
        return;
      }
      if (request.method === "GET" && url === "/api/defaults") {
        sendJson(response, 200, {
          schema: "dsheval.plugin-ui.defaults/v1",
          status: "OK",
          defaults: options,
        });
        return;
      }
      if (request.method === "POST" && url === "/api/search") {
        await handleSearch(request, response);
        return;
      }
      if (request.method === "POST" && url === "/api/run") {
        await handleRun(request, response, options, cwd);
        return;
      }
      if (request.method === "POST" && url === "/api/resolve") {
        await handleResolve(request, response, options, cwd);
        return;
      }
      notFound(response);
    })().catch((error: unknown) => {
      sendJson(response, 400, {
        schema: "dsheval.plugin-ui.error/v1",
        status: "FAILED",
        error: error instanceof Error ? error.message : "plugin UI request failed",
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  const urlHost = options.host === "::1" ? "[::1]" : options.host;
  return {
    host: options.host,
    port,
    url: `http://${urlHost}:${port}/`,
    close: () => closeServer(server),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) reject(error);
      else resolve();
    });
  });
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

/** CLI 入口：启动服务、输出 URL，直到收到终止信号。 */
export async function main(argv = process.argv.slice(2), cwd = process.cwd()): Promise<number> {
  let handle: PluginUiHandle | undefined;
  try {
    const options = parsePluginUiArgs(argv);
    handle = await startPluginUi(options, cwd);
    process.stdout.write(
      `${JSON.stringify({
        schema: "dsheval.plugin-ui.listen/v1",
        status: "LISTENING",
        url: handle.url,
        host: handle.host,
        port: handle.port,
      })}\n`,
    );
    await waitForShutdownSignal();
    await handle.close();
    return 0;
  } catch (error) {
    if (handle !== undefined) await handle.close();
    const message = error instanceof Error ? `${error.name}: ${error.message}` : "Plugin UI failed";
    process.stderr.write(`[dsheval-plugin-ui] ${message.replaceAll(/[\r\n\t]+/gu, " ").slice(0, 512)}\n`);
    return error instanceof PluginUiUsageError ? 2 : 4;
  }
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(path.resolve(entrypoint)).href) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
