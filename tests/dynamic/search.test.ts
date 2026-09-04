import assert from "node:assert/strict";
import { test } from "node:test";
import { DemoAdapter, DemoJudge, DemoProposer, demoCases, demoProfile } from "../../src/dynamic/fixtures.js";
import { RolloutRunner } from "../../src/dynamic/runner.js";
import { MemoryRecorder } from "../../src/dynamic/storage.js";
import { constructCase } from "../../src/dynamic/search.js";
import { reflect } from "../../src/dynamic/reflection.js";
import { DEFAULT_POLICY } from "../../src/dynamic/types.js";
import type { DynamicEvidenceBundle as EvidenceBundle, RunRequest } from "../../src/dynamic/types.js";
import { sample } from "./helpers.js";

test("search executes fresh children and retains complete admission and acceptance", async () => {
  const recorder = new MemoryRecorder();
  const runner = new RolloutRunner("demo", new DemoAdapter(), new DemoJudge(), recorder);
  const result = await constructCase(demoCases()[0]!, demoProfile("ref", [1, 2, 3]), DEFAULT_POLICY, runner, new DemoProposer());
  assert.ok(result.accepted); assert.match(result.accepted.payload, /demo:verified/);
  assert.equal(result.accepted.admission.length, 3); assert.equal(result.accepted.acceptance.length, 3);
  assert.equal(runner.runIds.size, 9); assert.equal(runner.sessionIds.size, 9);
  assert.equal(recorder.records.filter(r => r.kind === "search").length, 2);
});
test("unreachable field cannot enter search even when benign task succeeds", async () => {
  const adapter = new DemoAdapter();
  const runner = new RolloutRunner("demo", { run: async r => {
    const e = await adapter.run(r); e.trace[0]!.objectId = "other-source"; return e;
  } }, new DemoJudge(), new MemoryRecorder());
  const result = await constructCase(demoCases()[0]!, demoProfile("ref", [1, 2, 3]), DEFAULT_POLICY, runner, new DemoProposer());
  assert.equal(result.reason, "FIELD_UNREACHABLE"); assert.equal(runner.runIds.size, 3);
});
test("duplicate proposals do not loop and failed searches remain rejected", async () => {
  const runner = new RolloutRunner("demo", new DemoAdapter(), new DemoJudge(), new MemoryRecorder());
  const result = await constructCase(demoCases()[0]!, demoProfile("ref", []), DEFAULT_POLICY, runner, {
    propose: async r => ({ schema: "dsheval.dynamic.proposals/v1", proposals: [{ fieldId: r.case.field.id, value: r.payload }] }),
  });
  assert.equal(result.reason, "SEARCH_EXHAUSTED"); assert.equal(result.accepted, null); assert.equal(runner.runIds.size, 6);
});
test("unknown/malformed evidence becomes Invalid, never AGS=0", async () => {
  const runner = new RolloutRunner("demo", { run: async () => ({ broken: true }) }, new DemoJudge(), new MemoryRecorder());
  const r = await runner.run(demoCases()[0]!, demoProfile("ref", []), "x", "construction", "malicious", 1);
  assert.equal(r.score.status, "INVALID"); assert.equal(r.score.ags, null); assert.equal(r.score.reason, "BAD_EVIDENCE");
});
test("session reuse across fresh run IDs is Invalid", async () => {
  const base = new DemoAdapter();
  const adapter = { run: async (r: RunRequest): Promise<EvidenceBundle> => ({ ...await base.run(r), sessionId: "reused" }) };
  const runner = new RolloutRunner("demo", adapter, new DemoJudge(), new MemoryRecorder());
  const c = demoCases()[0]!, p = demoProfile("ref", [1]);
  assert.equal((await runner.run(c, p, "demo:verified", "construction", "malicious", 1)).score.status, "VALID");
  assert.equal((await runner.run(c, p, "demo:verified", "evaluation", "malicious", 1)).score.reason, "SESSION_REUSED");
});
test("reflection diagnoses success, ignored payload, instability and utility loss", async () => {
  const r = await sample(); assert.equal(reflect([r]).category, "already_successful");
  const ignored = structuredClone(r); ignored.score.ags = 0;
  ignored.evidence!.trace.push({ id: "ignored", sequence: 9, kind: "decision", objectId: "source", operation: "ignore", parentIds: ["read"], payloadDigest: null });
  assert.equal(reflect([ignored]).category, "read_but_ignored");
  assert.equal(reflect([r, ignored]).category, "unstable_success");
  r.score.ugs = 0; assert.equal(reflect([r]).category, "task_integrity_broken");
});
