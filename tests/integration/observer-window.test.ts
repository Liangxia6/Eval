import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startLabObservers, createLabSourceDescriptor, materializeLabObservations } from "../../src/observation/collection.js";
import {
  digestValue, validateScope, validateStableId,
  type SourceRequirement, type Ref, type ArtifactRef,
} from "../../src/core/models.js";
import { createFileSourceDescriptor, createProcessSourceDescriptor } from "../../src/observation/coordinator.js";
import { assembleAllTrace } from "../../src/all-trace/assemble.js";

test("all ten Observers start; live filesystem captures create/delete and status-only components emit no evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-observer-window-"));
  const workspace = path.join(root, "workspace");
  const output = path.join(root, "events");
  await mkdir(workspace);
  const config = JSON.parse(await readFile("observer-lab/config/macos-worker.json", "utf8"));
  // External services are not test fixtures. Record their disabled status explicitly.
  for (const [name, value] of Object.entries(config.components)) {
    (value as { enabled: boolean }).enabled = name === "filesystem" || name === "process";
  }
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify(config));
  const environment = JSON.parse(await readFile("environments/macos.json", "utf8"));
  const requirements = Object.values(environment.components).map((value) =>
    (value as { sourceRequirement: SourceRequirement }).sourceRequirement);
  const run = await startLabObservers({
    cwd: process.cwd(), outputDirectory: output, caseId: "case.observer-window",
    agentId: "agent.observer-window", attemptId: "attempt.observer-window",
    requirements, workspacePath: workspace, observedUid: process.getuid!(),
    maxFileBytes: 1048576, configPath,
  });
  try {
    const eventFile = path.join(output, "filesystem.jsonl");
    async function awaitEvents(count: number) {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline) {
        const text = await readFile(eventFile, "utf8");
        if (text.trim().split("\n").filter(Boolean).length >= count) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.fail("filesystem watch did not observe the real workspace change");
    }
    await writeFile(path.join(workspace, "temporary.txt"), "real case content");
    await awaitEvents(1);
    await rm(path.join(workspace, "temporary.txt"));
    await awaitEvents(2);
    const captures = await run.stop();
    assert.equal(captures.length, 10);
    const file = captures.find((item) => item.component === "filesystem")!;
    assert.equal(file.runtimeStatus, "COMPLETE");
    assert.equal(file.changeStatus, "CHANGED");
    assert.equal(file.events.length, 2);
    assert.match(JSON.stringify(file.events), /temporary.txt/u);
    assert.match(JSON.stringify(file.events), /attempt.observer-window/u);
    const unused = captures.filter((item) => !["filesystem", "process"].includes(item.component));
    assert.equal(unused.length, 8);
    assert.ok(unused.every((item) => item.runtimeStatus === "NOT_CONFIGURED"));
    assert.ok(unused.every((item) => item.events.length === 0 && item.changeStatus === "UNKNOWN"));
    assert.deepEqual(await run.stop(), captures, "stop is idempotent");

    // Pass the real capture through observation records, evidence generation and Judge routing.
    const scope = validateScope({
      targetId: "target.observer", targetSnapshotId: "snapshot.observer",
      runId: "run.observer", caseId: "case.observer-window", attemptId: "attempt.observer-window",
    });
    const now = new Date().toISOString();
    const sources = requirements.map((requirement) => {
      const options = { sourceId: "source." + requirement.sourceType.toLowerCase().replaceAll("_", "-"),
        scope, resourceBinding: requirement.resourceBinding, contentMode: requirement.contentMode,
        watermarkDefinition: requirement.watermarkDefinition, createdAt: now, producerVersion: "test" };
      return requirement.sourceType === "FILESYSTEM" ? createFileSourceDescriptor(options)
        : requirement.sourceType === "PROCESS" ? createProcessSourceDescriptor(options)
        : createLabSourceDescriptor({ ...options, requirement });
    });
    const artifacts = captures.map((capture) => ({
      schema: "dsheval.mvp.artifact/v1",
      id: validateStableId("artifact." + capture.component),
      digest: digestValue(capture.events),
    } satisfies Ref<ArtifactRef>));
    const collections = captures.map((capture, index) => materializeLabObservations({
      capture, source: sources.find((source) => source.sourceType === capture.sourceType)!,
      scope, attemptId: "attempt.observer-window", producerVersion: "test",
      ...(capture.events.length === 0 ? {} : { rawArtifactRef: artifacts[index]! }),
    }));
    const built=assembleAllTrace({
      traceId:"all-trace.observer-window",scope,createdAt:now,producerVersion:"test",
      agentObservations:[],environmentChanges:collections.flatMap(collection=>collection.observations),
      sources,coverage:collections.map(collection=>collection.status),artifacts:[],
      finalResponse:{content:"",artifactRef:artifacts[0]!,capturedBytes:0,captureTruncated:false,contentTruncated:false,contentRestricted:false,completedAt:now},
      files:[],
    });
    assert.deepEqual(built.integrity,[]);
    assert.equal(built.entries.filter(entry=>entry.sourceId==="source.filesystem").length,2);
    assert.match(JSON.stringify(built.entries),/temporary.txt/);
    assert.equal(built.coverage.length,10);
    assert.ok(!built.entries.some(entry=>entry.sourceId==="source.database"));

  } finally {
    await run.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("a crashed Observer preserves its valid event prefix and reports missing coverage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsheval-observer-crash-"));
  const bin = path.join(root, "observer-lab/bin");
  await mkdir(bin, { recursive: true });
  const event = { schema: "dsheval.observer.event/v1", component: "filesystem",
    observedAt: new Date().toISOString(), changes: [{ op: "ADD", path: "/entries", value: "captured-before-crash" }] };
  const script = [
    'import { writeFile } from "node:fs/promises";',
    'const output = process.argv[process.argv.indexOf("--output") + 1];',
    'await writeFile(output, ' + JSON.stringify(JSON.stringify(event) + "\n{truncated") + ');',
    'console.log("WATCHING");',
    'process.exitCode = 1;',
  ].join("\n");
  await writeFile(path.join(bin, "observer-smoke.mjs"), script);
  const configPath = path.join(root, "config.json");
  await writeFile(configPath, JSON.stringify({ components: {} }));
  const environment = JSON.parse(await readFile("environments/macos.json", "utf8"));
  try {
    const run = await startLabObservers({
      cwd: root, outputDirectory: path.join(root, "events"), caseId: "case.crash",
      agentId: "agent.crash", attemptId: "attempt.crash",
      requirements: [environment.components.workspace.sourceRequirement],
      workspacePath: root, observedUid: process.getuid!(), maxFileBytes: 1048576, configPath,
    });
    // Let the fixture exit before asking it to stop.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [capture] = await run.stop();
    assert.equal(capture!.events.length, 1);
    assert.equal(capture!.changeStatus, "CHANGED");
    assert.equal(capture!.complete, false);
    assert.equal(capture!.runtimeStatus, "UNAVAILABLE");
    assert.match(JSON.stringify(capture!.events), /captured-before-crash/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
