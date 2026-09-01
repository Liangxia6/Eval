import { constants as fsConstants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import path from "node:path";

import { validateStableId } from "../core/models.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;
const DEFAULT_MAX_HTML_BYTES = 8 * 1024 * 1024;
const MAX_HTML_BYTES = 64 * 1024 * 1024;
const REFRESH_SECONDS = 2;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
const VIEWER_OPTION_KEYS = new Set([
  "runRoot",
  "reportRoot",
  "runId",
  "host",
  "port",
  "maxHtmlBytes",
]);

const RESPONSE_HEADERS = Object.freeze({
  "Cache-Control": "no-store, max-age=0",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'; object-src 'none'",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
});

export type ViewerHost = "127.0.0.1" | "::1";

export interface ViewerOptions {
  readonly runRoot: string;
  readonly reportRoot: string;
  readonly runId: string;
  readonly host?: ViewerHost;
  /** Port zero is accepted by the API for an OS-assigned test port. */
  readonly port?: number;
  readonly maxHtmlBytes?: number;
}

export interface ViewerHandle {
  readonly host: ViewerHost;
  readonly port: number;
  readonly runId: string;
  readonly url: string;
  close(): Promise<void>;
}

interface RootBoundary {
  readonly absolutePath: string;
  readonly canonicalPath: string;
  readonly device: number;
  readonly inode: number;
}

interface ViewerContext {
  readonly runRoot: RootBoundary;
  readonly reportRoot: RootBoundary;
  readonly runId: string;
  readonly maxHtmlBytes: number;
}

class UnsafeViewerPathError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UnsafeViewerPathError";
  }
}

class ViewerFileChangedError extends Error {
  public constructor() {
    super("viewer input changed while it was being read");
    this.name = "ViewerFileChangedError";
  }
}

class ViewerFileTooLargeError extends Error {
  public constructor() {
    super("viewer input exceeds the configured byte limit");
    this.name = "ViewerFileTooLargeError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOptions(value: unknown): asserts value is ViewerOptions {
  if (!isRecord(value)) throw new TypeError("viewer options must be an object");
  const unknown = Object.keys(value).filter((key) => !VIEWER_OPTION_KEYS.has(key));
  if (unknown.length > 0) {
    throw new TypeError(`unknown viewer option: ${unknown.sort().join(", ")}`);
  }
}

function validateRootArgument(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty absolute path`);
  }
  if (!path.isAbsolute(value) || path.normalize(value) !== value || value === path.parse(value).root) {
    throw new TypeError(`${name} must be a normalized absolute non-root path`);
  }
  return value;
}

function validateInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new TypeError(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

async function establishRoot(value: unknown, name: string): Promise<RootBoundary> {
  const absolutePath = validateRootArgument(value, name);
  let metadata: Stats;
  try {
    metadata = await lstat(absolutePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new TypeError(`${name} must already exist`);
    }
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new TypeError(`${name} must be a real directory, not a symlink`);
  }
  return {
    absolutePath,
    canonicalPath: await realpath(absolutePath),
    device: metadata.dev,
    inode: metadata.ino,
  };
}

async function verifyRoot(root: RootBoundary): Promise<void> {
  let metadata: Stats;
  try {
    metadata = await lstat(root.absolutePath);
  } catch (error) {
    throw new UnsafeViewerPathError("viewer root disappeared after startup");
  }
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    metadata.dev !== root.device ||
    metadata.ino !== root.inode ||
    (await realpath(root.absolutePath)) !== root.canonicalPath
  ) {
    throw new UnsafeViewerPathError("viewer root changed after startup");
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function readFixedSizeFile(file: string, expected: Stats, maxBytes: number): Promise<Buffer> {
  if (expected.size > maxBytes) throw new ViewerFileTooLargeError();
  const handle = await open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== expected.dev ||
      opened.ino !== expected.ino ||
      opened.size !== expected.size ||
      opened.mtimeMs !== expected.mtimeMs
    ) {
      throw new ViewerFileChangedError();
    }
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (result.bytesRead === 0) throw new ViewerFileChangedError();
      offset += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== opened.size ||
      after.mtimeMs !== opened.mtimeMs
    ) {
      throw new ViewerFileChangedError();
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new UnsafeViewerPathError("viewer input is not valid UTF-8");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readViewerHtmlOnce(
  root: RootBoundary,
  runId: string,
  fileName: "status.html" | "report.html",
  maxBytes: number,
): Promise<Buffer | undefined> {
  await verifyRoot(root);
  const runDirectory = path.join(root.absolutePath, runId);
  const canonicalRunDirectory = path.join(root.canonicalPath, runId);
  let runMetadata: Stats;
  try {
    runMetadata = await lstat(runDirectory);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (runMetadata.isSymbolicLink() || !runMetadata.isDirectory()) {
    throw new UnsafeViewerPathError("viewer run directory is not a real directory");
  }
  if ((await realpath(runDirectory)) !== canonicalRunDirectory) {
    throw new UnsafeViewerPathError("viewer run directory escapes its configured root");
  }

  const file = path.join(runDirectory, fileName);
  let before: Stats;
  try {
    before = await lstat(file);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new UnsafeViewerPathError("viewer input is not a regular non-symlink file");
  }
  if ((await realpath(file)) !== path.join(canonicalRunDirectory, fileName)) {
    throw new UnsafeViewerPathError("viewer input escapes its configured run directory");
  }

  const bytes = await readFixedSizeFile(file, before, maxBytes);
  let after: Stats;
  try {
    after = await lstat(file);
  } catch (error) {
    throw new ViewerFileChangedError();
  }
  if (
    after.isSymbolicLink() ||
    !after.isFile() ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs ||
    (await realpath(file)) !== path.join(canonicalRunDirectory, fileName)
  ) {
    throw new ViewerFileChangedError();
  }
  return bytes;
}

async function readViewerHtml(
  root: RootBoundary,
  runId: string,
  fileName: "status.html" | "report.html",
  maxBytes: number,
): Promise<Buffer | undefined> {
  try {
    return await readViewerHtmlOnce(root, runId, fileName, maxBytes);
  } catch (error) {
    if (!(error instanceof ViewerFileChangedError)) throw error;
    return await readViewerHtmlOnce(root, runId, fileName, maxBytes);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function viewerShell(runId: string, state: "WAITING" | "RUNNING"): string {
  const running = state === "RUNNING";
  const label = running ? "LIVE RUN" : "WAITING FOR RUN";
  const detail = running
    ? `正在同步 VM 中的 status.html，每 ${REFRESH_SECONDS} 秒刷新。`
    : `Run 目录尚未创建；连接保持等待，每 ${REFRESH_SECONDS} 秒重试。`;
  const frame = running
    ? '<iframe src="/status" title="DSHEval 实时状态"></iframe>'
    : '<main class="waiting"><span class="pulse" aria-hidden="true"></span><h2>等待 VM 开始评测</h2><p>状态文件出现后会自动切换到实时流程页。</p></main>';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${REFRESH_SECONDS}"><title>DSHEval · ${label}</title><style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--bg:#070b14;--ink:#e5e7eb;--muted:#94a3b8;--line:#263247;--accent:#818cf8}*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;grid-template-rows:auto 1fr;background:radial-gradient(circle at 8% -15%,#312e81 0,transparent 34rem),var(--bg);color:var(--ink)}header{display:flex;align-items:center;gap:12px;min-height:44px;padding:7px 16px;border-bottom:1px solid var(--line);background:#0b1120ed}header strong{font-size:13px;letter-spacing:.02em}.brand{display:grid;place-items:center;width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#8b5cf6);font-size:12px;font-weight:900}.state{padding:4px 8px;border:1px solid #818cf855;border-radius:999px;color:#c4b5fd;font:750 10px/1 ui-monospace,SFMono-Regular,monospace;letter-spacing:.09em}.meta{display:flex;align-items:center;gap:12px;min-width:0;margin-left:auto;text-align:right}.meta code{display:block;max-width:36vw;overflow:hidden;color:#cbd5e1;text-overflow:ellipsis;white-space:nowrap}.meta small{color:var(--muted)}iframe{width:100%;height:100%;border:0;background:#f2f5fb}.waiting{display:grid;place-content:center;justify-items:center;padding:24px;text-align:center}.waiting h2{margin:18px 0 5px}.waiting p{margin:0;color:var(--muted)}.pulse{width:44px;height:44px;border:4px solid #818cf833;border-top-color:var(--accent);border-radius:50%;animation:spin 1.1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.pulse{animation:none;border-color:var(--accent)}}@media(max-width:720px){header{align-items:flex-start;flex-wrap:wrap}.meta{width:100%;margin-left:38px;align-items:flex-start;flex-direction:column;gap:2px;text-align:left}.meta code{max-width:80vw}}
</style></head><body><header><span class="brand">D</span><strong>DSHEval Observatory</strong><span class="state">${label}</span><span class="meta"><code>${escapeHtml(runId)}</code><small>${detail}</small></span></header>${frame}</body></html>\n`;
}

function messagePage(title: string, detail: string, refresh: boolean): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? `<meta http-equiv="refresh" content="${REFRESH_SECONDS}">` : ""}<title>${escapeHtml(title)}</title><style>:root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{display:grid;min-height:90vh;place-content:center;margin:0;padding:24px;background:#0b1120;color:#e5e7eb;text-align:center}p{color:#94a3b8}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p></main></body></html>\n`;
}

function sendHtml(
  response: ServerResponse,
  statusCode: number,
  bytes: string | Buffer,
  headOnly: boolean,
): void {
  const body = typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes;
  response.writeHead(statusCode, {
    ...RESPONSE_HEADERS,
    "Content-Length": String(body.byteLength),
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(headOnly ? undefined : body);
}

function validHostHeader(value: string | undefined): boolean {
  return value !== undefined && /^(?:127\.0\.0\.1|localhost|\[::1\])(?::[0-9]{1,5})?$/u.test(value);
}

async function serveRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: ViewerContext,
): Promise<void> {
  const method = request.method ?? "";
  if (method !== "GET" && method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    sendHtml(response, 405, messagePage("Method not allowed", "Viewer 仅支持只读请求。", false), method === "HEAD");
    return;
  }
  const headOnly = method === "HEAD";
  if (!validHostHeader(request.headers.host)) {
    sendHtml(response, 421, messagePage("Misdirected request", "仅接受本机回环地址。", false), headOnly);
    return;
  }
  const target = request.url ?? "";
  if (target !== "/" && target !== "/status" && target !== "/report") {
    sendHtml(response, 404, messagePage("Not found", "该只读 Viewer 不公开此资源。", false), headOnly);
    return;
  }

  try {
    if (target === "/") {
      const report = await readViewerHtml(
        context.reportRoot,
        context.runId,
        "report.html",
        context.maxHtmlBytes,
      );
      if (report !== undefined) {
        sendHtml(response, 200, report, headOnly);
        return;
      }
      const status = await readViewerHtml(
        context.runRoot,
        context.runId,
        "status.html",
        context.maxHtmlBytes,
      );
      sendHtml(response, 200, viewerShell(context.runId, status === undefined ? "WAITING" : "RUNNING"), headOnly);
      return;
    }
    const file = target === "/status"
      ? await readViewerHtml(context.runRoot, context.runId, "status.html", context.maxHtmlBytes)
      : await readViewerHtml(context.reportRoot, context.runId, "report.html", context.maxHtmlBytes);
    if (file === undefined) {
      const waitingForStatus = target === "/status";
      sendHtml(
        response,
        waitingForStatus ? 200 : 404,
        messagePage(
          waitingForStatus ? "等待评测开始" : "最终报告尚未生成",
          waitingForStatus ? "status.html 出现后会自动加载。" : "请先查看实时状态页。",
          waitingForStatus,
        ),
        headOnly,
      );
      return;
    }
    sendHtml(response, 200, file, headOnly);
  } catch (error) {
    if (error instanceof UnsafeViewerPathError) {
      sendHtml(response, 403, messagePage("Access denied", "检测到不安全的文件路径。", false), headOnly);
      return;
    }
    if (error instanceof ViewerFileTooLargeError) {
      sendHtml(response, 413, messagePage("File too large", "HTML 超过 Viewer 的读取上限。", false), headOnly);
      return;
    }
    if (error instanceof ViewerFileChangedError) {
      sendHtml(response, 503, messagePage("Snapshot changing", "状态正在原子更新，请稍后刷新。", true), headOnly);
      return;
    }
    sendHtml(response, 500, messagePage("Viewer unavailable", "读取实时状态失败。", true), headOnly);
  }
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
    server.closeAllConnections();
  });
}

/** Starts a read-only loopback viewer intended to be reached through an SSH tunnel. */
export async function startViewer(options: ViewerOptions): Promise<ViewerHandle> {
  assertOptions(options);
  const host = options.host ?? DEFAULT_HOST;
  if (typeof host !== "string" || !LOOPBACK_HOSTS.has(host)) {
    throw new TypeError("viewer host must be exactly 127.0.0.1 or ::1");
  }
  const port = validateInteger(options.port ?? DEFAULT_PORT, "viewer port", 0, 65_535);
  const maxHtmlBytes = validateInteger(
    options.maxHtmlBytes ?? DEFAULT_MAX_HTML_BYTES,
    "maxHtmlBytes",
    1,
    MAX_HTML_BYTES,
  );
  const runId = String(validateStableId(options.runId, "runId"));
  const [runRoot, reportRoot] = await Promise.all([
    establishRoot(options.runRoot, "runRoot"),
    establishRoot(options.reportRoot, "reportRoot"),
  ]);
  const context: ViewerContext = { runRoot, reportRoot, runId, maxHtmlBytes };
  const server = createServer((request, response) => {
    void serveRequest(request, response, context);
  });
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => {
        server.off("listening", listening);
        reject(error);
      };
      const listening = (): void => {
        server.off("error", failed);
        resolve();
      };
      server.once("error", failed);
      server.once("listening", listening);
      server.listen({ host, port, exclusive: true });
    });
  } catch (error) {
    await closeServer(server);
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("viewer did not receive a TCP address");
  }
  const actualHost = host as ViewerHost;
  const urlHost = actualHost === "::1" ? "[::1]" : actualHost;
  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await closeServer(server);
  };
  return Object.freeze({
    host: actualHost,
    port: address.port,
    runId,
    url: `http://${urlHost}:${address.port}/`,
    close,
  });
}

export async function closeViewer(viewer: ViewerHandle): Promise<void> {
  await viewer.close();
}
