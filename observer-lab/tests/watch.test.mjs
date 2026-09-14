import assert from "node:assert/strict";
import test from "node:test";
import { watchChanges } from "../lib/watch.mjs";
import { observation } from "../lib/core.mjs";

function sample(state) {
  const now = new Date().toISOString();
  return observation("filesystem", "ACTIVE", state, [], now, now, ["READ"]);
}
async function run(states, options = {}) {
  let index = 0, stop = false;
  const events = [];
  const result = await watchChanges({
    component: "filesystem", config: {}, intervalMs: 1, scope: { caseId: "case.a", attemptId: "attempt.a" },
    requiredCapabilities: ["READ"],
    adapter: { capabilities: ["READ"], capture: async () => {
      const state = states[index++];
      if (index >= states.length - 1) stop = true;
      if (state instanceof Error) throw state;
      return sample(state);
    }},
    shouldStop: () => stop, sleep: async () => {},
    onEvent: (event) => events.push(event), ...options,
  });
  return { result, events };
}
test("unchanged samples do not become evidence", async () => {
  const { result, events } = await run([{ entries: [] }, { entries: [] }, { entries: [] }]);
  assert.equal(events.length, 0);
  assert.equal(result.changeStatus, "UNCHANGED");
  assert.equal(result.runtimeStatus, "COMPLETE");
});
test("a create followed by deletion survives even if final state equals baseline", async () => {
  const { events } = await run([{ entries: [] }, { entries: ["temporary.txt"] }, { entries: [] }]);
  assert.equal(events.length, 2);
  assert.equal(events[0].changes[0].op, "ADD");
  assert.equal(events[1].changes[0].op, "REMOVE");
});
test("stop during polling delay still performs a final capture", async () => {
  let stopping = false, index = 0;
  const events = [];
  await watchChanges({
    component: "filesystem", config: {}, intervalMs: 1,
    adapter: { capabilities: ["READ"], capture: async () => sample({ value: index++ }) },
    shouldStop: () => stopping, sleep: async () => { stopping = true; },
    onEvent: (event) => events.push(event),
  });
  assert.equal(index, 2);
  assert.equal(events.length, 1);
});
test("failed sample is not deletion and successful final sample cannot hide the gap", async () => {
  const { result, events } = await run([
    { entries: ["a"] }, new Error("transient"), { entries: ["b"] }, { entries: ["b"] },
  ]);
  assert.equal(result.runtimeStatus, "PARTIAL");
  assert.equal(result.changeStatus, "UNKNOWN");
  assert.ok(result.reasonCodes.includes("OBSERVER_CAPTURE_FAILED"));
  assert.equal(events.length, 0);
});
test("disabled Observer reports unavailable coverage without reading the environment", async () => {
  const { result, events } = await run([], {
    config: { enabled: false }, shouldStop: () => true,
    adapter: { capabilities: ["READ"], capture: () => { throw new Error("must not run"); } },
  });
  assert.equal(result.runtimeStatus, "NOT_CONFIGURED");
  assert.equal(result.changeStatus, "UNKNOWN");
  assert.equal(events.length, 0);
});
