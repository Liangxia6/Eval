import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";
import { callJson, validateCommand, DshBridgeAdapter, CommandProposer, CommandTrajectoryJudge } from "../../src/dynamic/adapters.js";
import type { CommandConfig } from "../../src/dynamic/adapters.js";
import { sample } from "./helpers.js";

function command(source: string, overrides: Partial<CommandConfig> = {}): CommandConfig {
  return { executable: process.execPath, args: ["-e", source], envNames: [], timeoutMs: 5000, maxOutputBytes: 16384, id: "test-bridge", version: "1", ...overrides };
}
const echo = "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(JSON.parse(s))));";
test("JSON bridge preserves Unicode without a shell", async () => {
  const data = { task: "中文; $(not-a-command)", arguments: ["&&", "<script>"] };
  assert.deepEqual(await callJson(command(echo), data), data);
});
test("bridge failures are bounded and do not leak stderr", async () => {
  await assert.rejects(callJson(command("process.stdin.resume();process.stdin.on('end',()=>{process.stderr.write('secret-value');process.exit(2)});"), {}), /unsuccessfully/);
  await assert.rejects(callJson(command("process.stdin.resume();process.stdin.on('end',()=>console.log('bad-json'));"), {}), /one JSON/);
  await assert.rejects(callJson(command("process.stdin.resume();setInterval(()=>{},1000)", { timeoutMs: 150 }), {}), /BRIDGE_TIMEOUT/);
  await assert.rejects(callJson(command("process.stdin.resume();process.stdin.on('end',()=>console.log('x'.repeat(20000)));", { maxOutputBytes: 100 }), {}), /BRIDGE_OUTPUT_LIMIT/);
});
test("bridge cannot inherit arbitrary credential environment or loader settings", async () => {
  process.env.DSHEVAL_TEST_SECRET_CANARY = "do-not-leak";
  try {
    const result = await callJson(command("process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({secret:process.env.DSHEVAL_TEST_SECRET_CANARY??null})));"), {});
    assert.deepEqual(result, { secret: null });
  } finally { delete process.env.DSHEVAL_TEST_SECRET_CANARY; }
  assert.throws(() => validateCommand(command(echo, { envNames: ["NODE_OPTIONS"] })), /Unsafe/);
  assert.throws(() => validateCommand(command(echo, { executable: "node" })), /absolute/);
});
test("runner/judge/proposer use distinct versioned protocol envelopes", async () => {
  const r = await sample();
  assert.deepEqual(await new DshBridgeAdapter(command(echo)).run(r.request), r.request);
  const judged = await new CommandTrajectoryJudge(command(echo)).judge(r.request, r.evidence!) as { schema: string; rules: string };
  assert.equal(judged.schema, "dsheval.dynamic.judge-request/v1"); assert.match(judged.rules, /untrusted/);
  const proposed = await new CommandProposer(command(echo)).propose({ schema: "dsheval.dynamic.proposal-request/v1",
    case: r.request.case, payload: "test", reflection: { category: "unknown", instruction: "review" }, count: 2, maxPayloadBytes: 1000, runs: [r] }) as { schema: string };
  assert.equal(proposed.schema, "dsheval.dynamic.proposal-request/v1");
});
