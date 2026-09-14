/**
 * 文件职责：验证插件选择 Web UI 的参数解析与最小 API 行为。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parsePluginUiArgs,
  startPluginUi,
  type PluginUiOptions,
} from "../../src/app/plugin-ui.js";

function postJson(url: string, body: unknown): Promise<{ readonly statusCode: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const bytes = Buffer.from(JSON.stringify(body), "utf8");
    const parsed = new URL(url);
    const outgoing = request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": bytes.byteLength,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    outgoing.on("error", reject);
    outgoing.end(bytes);
  });
}

test("MVP-UT-PLUGIN-UI parses defaults and safe overrides", () => {
  assert.deepEqual(parsePluginUiArgs([]), {
    target: "config/targets/real-dsh.json",
    datasets: "datasets",
    labels: "labels",
    trace: "trace/dsh-runtime.json",
    environment: "environments/macos.json",
    testProfile: "STANDARD",
    config: "config/macos-vm.json",
    host: "127.0.0.1",
    port: 4174,
  });
  assert.equal(parsePluginUiArgs(["--port", "5555"]).port, 5555);
  assert.throws(() => parsePluginUiArgs(["--host", "0.0.0.0"]), /127\.0\.0\.1 or ::1/u);
  assert.throws(() => parsePluginUiArgs(["--test-profile", "OTHER"]), /STANDARD/u);
});

test("MVP-UT-PLUGIN-UI resolves plugins and returns an equivalent CLI command", async () => {
  const originalFetch = globalThis.fetch;
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-plugin-ui-"));
  try {
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot, { recursive: true });
    await writeFile(
      path.join(root, "target.json"),
      JSON.stringify({
        schema: "dsheval.mvp.target-descriptor/v1",
        targetId: "fixture.plugin-ui",
        targetType: "FULL_AGENT",
        sourceRoot: "target",
        dshExecutable: "bin/dsh.js",
        dshHome: ".dsh",
        profile: "default",
        targetIdentity: "fixture-agent",
      }),
      "utf8",
    );
    globalThis.fetch = (async (url: string | URL) => {
      const body = String(url).endsWith("manifest.json")
        ? { datasets: { search: { url: "/search.json" } } }
        : {
            rankings: [{
              rank: 3,
              fullName: "owner/selected",
              name: "selected",
              install: {
                method: "pnpm-profile",
                packageName: "selected-package",
                commands: ["dsh plugin --profile default add selected-package"],
              },
            }],
          };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const options: PluginUiOptions = {
      ...parsePluginUiArgs(["--target", path.join(root, "target.json")]),
      port: 0,
    };
    const handle = await startPluginUi(options, root);
    try {
      const response = await postJson(`${handle.url}api/resolve`, {
        ...options,
        plugins: "selected",
      });
      assert.equal(response.statusCode, 200);
      const parsed = JSON.parse(response.body) as {
        readonly status: string;
        readonly target: { readonly ok: boolean };
        readonly plugins: Array<{ readonly packageName: string }>;
        readonly command: string;
      };
      assert.equal(parsed.status, "OK");
      assert.equal(parsed.target.ok, true);
      assert.equal(parsed.plugins[0]?.packageName, "selected-package");
      assert.match(parsed.command, /--plugin selected/u);
    } finally {
      await handle.close();
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});
