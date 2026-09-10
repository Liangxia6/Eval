/**
 * 测试职责：验证 Core 的规范 JSON、SHA-256、StableId、PortablePath、Scope/Ref
 * 约束和五类生命周期状态迁移，作为所有上层模块的值语义门禁。
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  assertLegalTransition,
  assertSameAttemptScope,
  canonicalJson,
  ContractViolation,
  digestBytes,
  digestEquals,
  digestValue,
  validatePortablePath,
  validateRef,
  validateScope,
  validateStableId,
  validateVersionedAssetId,
  withContentDigest,
} from "../../src/core/models.js";
import {
  commitFailureDraft,
  failureDisplayGroup,
  type FailureDraft,
} from "../../src/core/errors.js";
import {
  DARWIN_SUDO_PATH,
  LINUX_SETPRIV_PATH,
  darwinSudoArguments,
  identityLaunchCommand,
  linuxSetprivArguments,
} from "../../src/core/contracts.js";

const time = "2026-09-01T00:00:00.000Z";

test("MVP-SEC-IDENTITY-001 builds the mandatory setpriv privilege-drop argv", () => {
  assert.equal(LINUX_SETPRIV_PATH, "/usr/bin/setpriv");
  assert.deepEqual(linuxSetprivArguments(1001, 1002, "/usr/bin/node", ["agent.mjs"]), [
    "--reuid=1001",
    "--regid=1002",
    "--clear-groups",
    "--inh-caps=-all",
    "--ambient-caps=-all",
    "--no-new-privs",
    "--",
    "/usr/bin/node",
    "agent.mjs",
  ]);
  assert.throws(() => linuxSetprivArguments(-1, 1002, "/usr/bin/node", []));
  assert.throws(() => linuxSetprivArguments(1001, 1002, "node", []));
  assert.throws(() => linuxSetprivArguments(1001, 1002, "/usr/bin/node", ["bad\0arg"]));
});

test("MVP-SEC-IDENTITY-001 builds the non-interactive macOS identity-launch argv", () => {
  assert.equal(DARWIN_SUDO_PATH, "/usr/bin/sudo");
  assert.deepEqual(darwinSudoArguments(501, 20, "/opt/homebrew/bin/dsh", ["task"]), [
    "-n",
    "-H",
    "-E",
    "-u",
    "#501",
    "-g",
    "#20",
    "--",
    "/opt/homebrew/bin/dsh",
    "task",
  ]);
  assert.equal(
    identityLaunchCommand("darwin", 501, 20, "/opt/homebrew/bin/dsh", []).executablePath,
    DARWIN_SUDO_PATH,
  );
  assert.equal(
    identityLaunchCommand("linux", 1001, 1002, "/usr/bin/node", []).executablePath,
    LINUX_SETPRIV_PATH,
  );
  assert.throws(() => darwinSudoArguments(-1, 20, "/usr/bin/node", []));
  assert.throws(() => darwinSudoArguments(501, 20, "node", []));
  assert.throws(() => identityLaunchCommand("win32", 501, 20, "/usr/bin/node", []));
});

function attemptScope(suffix = "one") {
  return validateScope({
    targetId: `target-${suffix}`,
    targetSnapshotId: `snapshot-${suffix}`,
    runId: `run-${suffix}`,
    caseId: `case-${suffix}`,
    attemptId: `attempt-${suffix}`,
  });
}

test("MVP-UT-CORE-001 canonical JSON and SHA-256 are stable", () => {
  const left = { z: [3, { beta: true, alpha: "值" }], a: -0 };
  const right = { a: 0, z: [3, { alpha: "值", beta: true }] };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.ok(digestEquals(digestValue(left), digestValue(right)));
  assert.notEqual(digestValue({ ...left, extra: 1 }).value, digestValue(left).value);

  const committed = withContentDigest({ schema: "dsheval.mvp.test/v1", value: left });
  assert.ok(digestEquals(committed.contentDigest, digestValue(committed, ["contentDigest"])));
  assert.throws(() => withContentDigest(committed), /without contentDigest/u);
});

test("MVP-UT-CORE-001 invalid JSON values never receive a digest", () => {
  assert.throws(() => canonicalJson({ missing: undefined }), ContractViolation);
  assert.throws(() => canonicalJson([1, , 3]), ContractViolation);
  assert.throws(() => canonicalJson({ infinity: Number.POSITIVE_INFINITY }), ContractViolation);
  assert.throws(() => canonicalJson({ bigint: 1n }), ContractViolation);
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), ContractViolation);
});

test("MVP-UT-CORE-002 StableId, Scope and PortablePath validation reject ambiguity", () => {
  assert.equal(validateStableId("run.valid-1"), "run.valid-1");
  assert.throws(() => validateStableId("../run"), /must contain/u);
  assert.throws(() => validateStableId("judge.protocol.integrity/v1"), ContractViolation);
  assert.equal(
    validateVersionedAssetId("judge.protocol.integrity/v1"),
    "judge.protocol.integrity/v1",
  );
  for (const invalid of [
    "judge.protocol.integrity",
    "judge.protocol.integrity/v0",
    "judge.protocol.integrity/v01",
    "judge/protocol/v1",
    "../judge/v1",
  ]) {
    assert.throws(() => validateVersionedAssetId(invalid), ContractViolation, invalid);
  }
  assert.throws(
    () => validateScope({ targetId: "target", runId: "run" }),
    /without every parent/u,
  );
  assert.throws(
    () => validateScope({ targetId: "target", unknown: "field" }),
    /unknown fields/u,
  );
  assert.equal(validatePortablePath("output/attention.py"), "output/attention.py");
  for (const path of ["/tmp/result", "../result", "output/../result", "output/*.txt", "C:\\x"]) {
    assert.throws(() => validatePortablePath(path), ContractViolation, path);
  }
});

test("MVP-UT-CORE-002 cross-attempt Scope is rejected", () => {
  const first = attemptScope("one");
  const same = validateScope({ ...first });
  assert.doesNotThrow(() => assertSameAttemptScope(first, same));
  assert.throws(
    () => assertSameAttemptScope(first, { ...same, attemptId: validateStableId("attempt-two") }),
    /attemptId does not match/u,
  );
  assert.throws(
    () => assertSameAttemptScope(first, validateScope({ targetId: "target-one" })),
    /must include target/u,
  );
});

test("MVP-UT-CORE-003 Ref revision rules and all MVP lifecycle arrows are explicit", () => {
  const digest = digestBytes("record");
  assert.doesNotThrow(() =>
    validateRef({ schema: "dsheval.mvp.evidence/v1", id: "evidence-1", digest }),
  );
  assert.throws(
    () =>
      validateRef({
        schema: "dsheval.mvp.evidence/v1",
        id: "judge.protocol.integrity/v1",
        digest,
      }),
    ContractViolation,
  );
  assert.throws(
    () => validateRef({ schema: "dsheval.mvp.run/v1", id: "run-1", digest }, { lifecycle: true }),
    /revision is required/u,
  );
  assert.throws(
    () => validateRef({ schema: "dsheval.mvp.evidence/v1", id: "evidence-1", digest, revision: 0 }),
    /only valid for lifecycle/u,
  );

  const valid = [
    ["dsheval.mvp.run/v1", "CREATED", "PREFLIGHTING"],
    ["dsheval.mvp.case/v1", "PENDING", "RUNNING"],
    ["dsheval.mvp.attempt/v1", "RUNNING", "SUCCEEDED"],
    ["dsheval.mvp.environment/v1", "RESETTING", "VERIFIED"],
    ["dsheval.mvp.observation-session/v1", "DRAINING", "SEALED"],
  ] as const;
  for (const [schema, from, to] of valid) {
    assert.doesNotThrow(() => assertLegalTransition(schema, from, to));
  }
  const invalid = [
    ["dsheval.mvp.run/v1", "CREATED", "FINISHED"],
    ["dsheval.mvp.case/v1", "PENDING", "FINISHED"],
    ["dsheval.mvp.attempt/v1", "PENDING", "SUCCEEDED"],
    ["dsheval.mvp.environment/v1", "CREATED", "CLEANED"],
    ["dsheval.mvp.observation-session/v1", "PLANNED", "SEALED"],
  ] as const;
  for (const [schema, from, to] of invalid) {
    assert.throws(() => assertLegalTransition(schema, from, to), /cannot transition/u);
  }
});

test("MVP-CORE-AC-005 failure attribution remains independent of verdicts", () => {
  const base: Omit<FailureDraft, "category" | "origin" | "actor"> = {
    scope: attemptScope(),
    phase: "JUDGE",
    severity: "ERROR",
    retryable: false,
    messageRedacted: "safe diagnostic",
    reasonCode: "FIXTURE",
    evidenceRefs: [],
    artifactRefs: [],
    occurredAt: time,
  };
  const judge: FailureDraft = {
    ...base,
    category: "JUDGE_FAILURE",
    origin: "DSHEVAL",
    actor: "JUDGE",
  };
  assert.equal(failureDisplayGroup(judge), "judge_error");
  const committed = commitFailureDraft(judge, "failure-1", "0.1.0");
  assert.equal(committed.retryable, false);
  assert.ok(digestEquals(committed.contentDigest, digestValue(committed, ["contentDigest"])));
});
