import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main } from "../../src/dynamic/cli.js";
import { DirectoryRecorder } from "../../src/dynamic/storage.js";

test("CLI demo, verify and report regenerate deliverables; overwrite refused", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-dynamic-test-"));
  const output = path.join(root, "demo");
  assert.equal(await main(["demo", "--out", output]), 0);
  const suite = path.join(output, "construction", "suite", "frozen.json");
  assert.equal(await main(["verify", "--suite", suite]), 0);
  assert.equal(await main(["demo", "--out", output]), 4);
  assert.equal((await readdir(path.join(output, "evaluation", "runs"))).length, 360);
  assert.equal(await main(["report", "--suite", suite, "--records", path.join(output, "evaluation"), "--out", path.join(root, "report")]), 0);
  const html = await readFile(path.join(root, "report", "report.html"), "utf8");
  assert.match(html, /模拟验证/); assert.doesNotMatch(html, /<script/i);
});
test("CLI rejects unknown/duplicate options and requires real execution opt-in", async () => {
  assert.equal(await main(["demo", "--unexpected", "x"]), 4);
  assert.equal(await main(["demo", "--out", "one", "--out", "two"]), 4);
  assert.equal(await main(["construct"]), 4);
});
test("artifact writer refuses directory traversal and existing records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-artifacts-test-"));
  const recorder = await DirectoryRecorder.create(path.join(root, "records"));
  await assert.rejects(recorder.write("runs", "../escape", {}), /stable ID/);
  await recorder.write("runs", "one", { value: 1 });
  await assert.rejects(recorder.write("runs", "one", { value: 2 }), /EEXIST/);
});
