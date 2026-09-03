/**
 * 测试职责：启动真实回环 HTTP Viewer，验证等待、实时、最终报告切换以及 Host、
 * symlink、字节上限和关闭端口等只读安全边界。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseViewerCliArgs } from "../../src/app/viewer-cli.js";
import {
  closeViewer,
  startViewer,
  type ViewerOptions,
} from "../../src/platform/viewer.js";

interface ViewerFixture {
  readonly temporary: string;
  readonly runRoot: string;
  readonly reportRoot: string;
  readonly runId: string;
}

async function fixture(): Promise<ViewerFixture> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "dsheval-viewer-"));
  const runRoot = path.join(temporary, "records");
  const reportRoot = path.join(temporary, "reports");
  await Promise.all([
    mkdir(runRoot, { recursive: true }),
    mkdir(reportRoot, { recursive: true }),
  ]);
  return { temporary, runRoot, reportRoot, runId: "viewer-run-1" };
}

test("MVP-PLAT-VIEW-001 loopback Viewer follows status and settles on the final report", async () => {
  const local = await fixture();
  const viewer = await startViewer({
    runRoot: local.runRoot,
    reportRoot: local.reportRoot,
    runId: local.runId,
    port: 0,
  });
  try {
    assert.equal(viewer.host, "127.0.0.1");
    assert.ok(viewer.port > 0);
    assert.equal(viewer.url, `http://127.0.0.1:${viewer.port}/`);

    const waitingResponse = await fetch(viewer.url);
    const waiting = await waitingResponse.text();
    assert.equal(waitingResponse.status, 200);
    assert.match(waiting, /WAITING FOR RUN/u);
    assert.match(waiting, /http-equiv="refresh" content="2"/u);
    assert.doesNotMatch(waiting, /<script/iu);
    assert.match(waitingResponse.headers.get("cache-control") ?? "", /no-store/u);
    assert.match(waitingResponse.headers.get("content-security-policy") ?? "", /default-src 'none'/u);
    assert.equal(waitingResponse.headers.get("x-content-type-options"), "nosniff");
    assert.equal(waitingResponse.headers.get("access-control-allow-origin"), null);

    const statusBytes = "<!doctype html><html><body><h1>step 6 running</h1></body></html>\n";
    await mkdir(path.join(local.runRoot, local.runId));
    await writeFile(path.join(local.runRoot, local.runId, "status.html"), statusBytes, "utf8");

    const liveResponse = await fetch(viewer.url);
    const live = await liveResponse.text();
    assert.match(live, /LIVE RUN/u);
    assert.match(live, /http-equiv="refresh" content="2"/u);
    assert.match(live, /iframe src="\/status"/u);
    assert.equal(await (await fetch(`${viewer.url}status`)).text(), statusBytes);

    const head = await fetch(`${viewer.url}status`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal(head.headers.get("content-length"), String(Buffer.byteLength(statusBytes)));

    const reportBytes = "<!doctype html><html><body><h1>sealed PASS</h1></body></html>\n";
    await mkdir(path.join(local.reportRoot, local.runId));
    await writeFile(path.join(local.reportRoot, local.runId, "report.html"), reportBytes, "utf8");

    const finalResponse = await fetch(viewer.url);
    const final = await finalResponse.text();
    assert.equal(final, reportBytes);
    assert.doesNotMatch(final, /http-equiv="refresh"/u);
    assert.doesNotMatch(final, /iframe/iu);
    assert.equal(await (await fetch(`${viewer.url}report`)).text(), reportBytes);

    assert.equal((await fetch(`${viewer.url}report.json`)).status, 404);
    assert.equal((await fetch(`${viewer.url}artifacts`)).status, 404);
    assert.equal((await fetch(`${viewer.url}?download=report.json`)).status, 404);
    assert.equal((await fetch(viewer.url, { method: "POST" })).status, 405);
  } finally {
    await closeViewer(viewer);
    await closeViewer(viewer);
    await rm(local.temporary, { recursive: true, force: true });
  }
});

test("MVP-SEC-VIEW-001 Viewer rejects symlinks and never serves their target bytes", async () => {
  const local = await fixture();
  const outside = path.join(local.temporary, "outside.html");
  await writeFile(outside, "TOP-SECRET-OUTSIDE-VIEWER", "utf8");
  await mkdir(path.join(local.runRoot, local.runId));
  await symlink(outside, path.join(local.runRoot, local.runId, "status.html"));
  const viewer = await startViewer({
    runRoot: local.runRoot,
    reportRoot: local.reportRoot,
    runId: local.runId,
    port: 0,
  });
  try {
    const response = await fetch(`${viewer.url}status`);
    const body = await response.text();
    assert.equal(response.status, 403);
    assert.doesNotMatch(body, /TOP-SECRET-OUTSIDE-VIEWER/u);
  } finally {
    await viewer.close();
  }

  const linkedRun = path.join(local.temporary, "linked-report-run");
  await mkdir(linkedRun);
  await writeFile(path.join(linkedRun, "report.html"), "SECOND-SECRET", "utf8");
  await symlink(linkedRun, path.join(local.reportRoot, local.runId));
  const second = await startViewer({
    runRoot: local.runRoot,
    reportRoot: local.reportRoot,
    runId: local.runId,
    port: 0,
  });
  try {
    const response = await fetch(`${second.url}report`);
    const body = await response.text();
    assert.equal(response.status, 403);
    assert.doesNotMatch(body, /SECOND-SECRET/u);
  } finally {
    await second.close();
    await rm(local.temporary, { recursive: true, force: true });
  }
});

test("MVP-SEC-VIEW-002 Viewer API and CLI accept only strict loopback-safe parameters", async () => {
  const local = await fixture();
  try {
    const base = {
      runRoot: local.runRoot,
      reportRoot: local.reportRoot,
      runId: local.runId,
      port: 0,
    } as const;
    await assert.rejects(
      startViewer({ ...base, host: "0.0.0.0" as "127.0.0.1" }),
      /127\.0\.0\.1 or ::1/u,
    );
    await assert.rejects(
      startViewer({ ...base, runId: "../escape" }),
      /runId must contain/u,
    );
    await assert.rejects(
      startViewer({ ...base, runRoot: "relative/records" }),
      /normalized absolute/u,
    );
    await assert.rejects(
      startViewer({ ...base, port: -1 }),
      /between 0 and 65535/u,
    );
    await assert.rejects(
      startViewer({ ...base, extra: true } as ViewerOptions),
      /unknown viewer option/u,
    );

    const realRoot = path.join(local.temporary, "real-root");
    const linkedRoot = path.join(local.temporary, "linked-root");
    await mkdir(realRoot);
    await symlink(realRoot, linkedRoot);
    await assert.rejects(
      startViewer({ ...base, runRoot: linkedRoot }),
      /real directory, not a symlink/u,
    );

    assert.deepEqual(
      parseViewerCliArgs(
        [
          "--run",
          local.runId,
          "--run-root",
          "records",
          "--report-root",
          "reports",
          "--host",
          "::1",
          "--port",
          "4400",
          "--max-bytes",
          "1048576",
        ],
        local.temporary,
      ),
      {
        runRoot: path.join(local.temporary, "records"),
        reportRoot: path.join(local.temporary, "reports"),
        runId: local.runId,
        host: "::1",
        port: 4400,
        maxHtmlBytes: 1_048_576,
      },
    );
    assert.throws(
      () => parseViewerCliArgs(["--run", local.runId, "--host", "0.0.0.0"], local.temporary),
      /exactly 127\.0\.0\.1 or ::1/u,
    );
    assert.throws(
      () => parseViewerCliArgs(["--run", local.runId, "--port", "0"], local.temporary),
      /positive decimal integer/u,
    );
    assert.throws(
      () => parseViewerCliArgs(["--run", local.runId, "--unknown", "x"], local.temporary),
      /unknown or misplaced/u,
    );
    assert.throws(
      () => parseViewerCliArgs(["--run", local.runId, "--run", "again"], local.temporary),
      /only once/u,
    );
  } finally {
    await rm(local.temporary, { recursive: true, force: true });
  }
});

test("MVP-PLAT-VIEW-002 close releases the selected loopback port", async () => {
  const local = await fixture();
  try {
    const first = await startViewer({
      runRoot: local.runRoot,
      reportRoot: local.reportRoot,
      runId: local.runId,
      port: 0,
    });
    const selectedPort = first.port;
    await first.close();
    const second = await startViewer({
      runRoot: local.runRoot,
      reportRoot: local.reportRoot,
      runId: local.runId,
      port: selectedPort,
    });
    assert.equal(second.port, selectedPort);
    await second.close();
  } finally {
    await rm(local.temporary, { recursive: true, force: true });
  }
});
