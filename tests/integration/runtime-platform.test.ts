import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  bootstrapApplication,
  loadTargetDescriptor,
} from "../../src/app/bootstrap.js";
import { freezeConfig } from "../../src/platform/config.js";
import {
  commitReportHtml,
  commitReportJson,
  exportReport,
  readCommittedReportJson,
} from "../../src/platform/export.js";
import {
  canonicalJson,
  digestBytes,
  withContentDigest,
  withProjectionDigest,
} from "../../src/core/models.js";
import {
  assertSafeAgentTask,
  findSecretLeaks,
  runSecurityPreflight,
} from "../../src/platform/security.js";
import {
  acquireLease,
  checkLocalServices,
  releaseLease,
} from "../../src/platform/services.js";
import {
  cleanupEnvironment,
  cleanupRuntimeDshHome,
  injectFixtureOnlyResetResidue,
  prepareEnvironment,
  resetEnvironment,
  seedEnvironment,
  stageTargetRuntime,
  validatePortablePath,
} from "../../src/runtime/environment.js";
import { executeTarget } from "../../src/runtime/target.js";

async function temporaryDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "dsheval-mvp-"));
}

function localServiceRoots(root: string) {
  return {
    run: path.join(root, "records"),
    artifact: path.join(root, "artifacts"),
    report: path.join(root, "reports"),
    workspace: path.join(root, "workspaces"),
    runtimeHome: path.join(root, "runtime-homes"),
  };
}

async function writeRunHistory(
  runRoot: string,
  runId: string,
  states: readonly string[],
): Promise<void> {
  const directory = path.join(runRoot, runId, "records", "run");
  await mkdir(directory, { recursive: true });
  let current: object | undefined;
  for (const [revision, state] of states.entries()) {
    const projection = withProjectionDigest({
      schema: "dsheval.mvp.run/v1" as const,
      aggregateId: runId,
      runId,
      scope: {
        targetId: "target-startup",
        targetSnapshotId: "snapshot-startup",
        runId,
      },
      state,
      revision,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: `2026-01-01T00:00:0${revision}.000Z`,
      failureRefs: [],
      targetSnapshotRef: {
        schema: "dsheval.mvp.target-snapshot/v1",
        id: "snapshot-startup",
        digest: digestBytes("target-startup"),
      },
      evaluationPlanRef: {
        schema: "dsheval.mvp.evaluation-plan/v1",
        id: "plan-startup",
        digest: digestBytes("plan-startup"),
      },
      observationPlanRef: {
        schema: "dsheval.mvp.observation-plan/v1",
        id: "observation-plan-startup",
        digest: digestBytes("observation-plan-startup"),
      },
      caseId: `${runId}.case`,
      operationalHealth: state === "FINISHED" ? "HEALTHY" : "FAILED",
    });
    await writeFile(path.join(directory, `${runId}.r${revision}.json`), canonicalJson(projection));
    current = projection;
  }
  assert.notEqual(current, undefined);
  await writeFile(path.join(directory, `${runId}.json`), canonicalJson(current));
}

test("MVP-IT-RUN-001: real fixture process runs only after a seeded workspace", async () => {
  const root = await temporaryDirectory();
  try {
    const prepared = await prepareEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      runId: "run-runtime-pass",
      caseId: "case-runtime-pass",
      attemptId: "attempt-runtime-pass",
    });
    assert.equal((await stat(prepared.workspacePath)).mode & 0o777, 0o770);
    assert.equal((await stat(prepared.runtimeDshHomePath)).mode & 0o777, 0o770);
    const resources = await seedEnvironment(prepared.workspacePath, [
      {
        portablePath: "input",
        entryType: "DIRECTORY",
        mode: "0555",
        readOnlyForTarget: true,
      },
      {
        portablePath: "input/source.txt",
        entryType: "FILE",
        mode: "0444",
        readOnlyForTarget: true,
        content: "DSHEval MVP ready\n",
        encoding: "utf8",
      },
      {
        portablePath: "output",
        entryType: "DIRECTORY",
        mode: "0755",
        readOnlyForTarget: false,
      },
    ]);
    assert.equal(resources.length, 3);
    const fixtureExecutable = path.join(
      process.cwd(),
      "tests/fixtures/agents/fake-dsh/fake-dsh.mjs",
    );
    let startReceipt = false;
    const result = await executeTarget({
      executablePath: fixtureExecutable,
      profile: "fixture-filesystem",
      task: "copy the public input",
      cwd: prepared.workspacePath,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      probeOutputPath: prepared.probeOutputPath,
      sourceRunId: "source-runtime-pass",
      deadlineMs: 5_000,
      maxOutputBytes: 64 * 1024,
      fixtureBehavior: "copy",
      onStarted: () => {
        startReceipt = true;
      },
    });
    assert.equal(startReceipt, true);
    assert.equal(result.terminationKind, "EXITED");
    assert.equal(
      await readFile(path.join(prepared.workspacePath, "output/result.txt"), "utf8"),
      "DSHEval MVP ready\n",
    );
    const probe = await readFile(prepared.probeOutputPath, "utf8");
    assert.match(probe, /"kind":"probe\/start"/);
    assert.match(probe, /"kind":"probe\/stop"/);
    await resetEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      workspacePath: prepared.workspacePath,
      resetGeneration: 0,
    });
    await cleanupEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      workspacePath: prepared.workspacePath,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-FI-TARGET-001: timeout keeps a Probe prefix and never retries", async () => {
  const root = await temporaryDirectory();
  let prepared: Awaited<ReturnType<typeof prepareEnvironment>> | undefined;
  try {
    prepared = await prepareEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      runId: "run-timeout",
      caseId: "case-timeout",
      attemptId: "attempt-timeout",
    });
    await seedEnvironment(prepared.workspacePath, [
      { portablePath: "input", entryType: "DIRECTORY", mode: "0555", readOnlyForTarget: true },
      {
        portablePath: "input/source.txt",
        entryType: "FILE",
        mode: "0444",
        readOnlyForTarget: true,
        content: "DSHEval MVP ready\n",
        encoding: "utf8",
      },
      { portablePath: "output", entryType: "DIRECTORY", mode: "0755", readOnlyForTarget: false },
    ]);
    const result = await executeTarget({
      executablePath: path.join(process.cwd(), "tests/fixtures/agents/fake-dsh/fake-dsh.mjs"),
      profile: "fixture-filesystem",
      task: "copy",
      cwd: prepared.workspacePath,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      probeOutputPath: prepared.probeOutputPath,
      sourceRunId: "source-timeout",
      deadlineMs: 500,
      maxOutputBytes: 64 * 1024,
      fixtureBehavior: "timeout",
    });
    assert.equal(result.terminationKind, "TIMED_OUT");
    assert.match(await readFile(prepared.probeOutputPath, "utf8"), /probe\/start/);
    await resetEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      workspacePath: prepared.workspacePath,
      resetGeneration: 0,
    });
    await cleanupEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      workspacePath: prepared.workspacePath,
    });
  } finally {
    if (prepared !== undefined) {
      await resetEnvironment({
        workspaceRoot: path.join(root, "workspaces"),
        workspacePath: prepared.workspacePath,
        resetGeneration: 0,
      }).then(() => cleanupEnvironment({
        workspaceRoot: path.join(root, "workspaces"),
        workspacePath: prepared!.workspacePath,
      })).catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-RUN-AC-006: a target that ignores SIGTERM is killed as one process group", async () => {
  const root = await temporaryDirectory();
  let prepared: Awaited<ReturnType<typeof prepareEnvironment>> | undefined;
  try {
    prepared = await prepareEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      runId: "run-force-kill",
      caseId: "case-force-kill",
      attemptId: "attempt-force-kill",
    });
    await seedEnvironment(prepared.workspacePath, [
      { portablePath: "input", entryType: "DIRECTORY", mode: "0555", readOnlyForTarget: true },
      {
        portablePath: "input/source.txt",
        entryType: "FILE",
        mode: "0444",
        readOnlyForTarget: true,
        content: "DSHEval MVP ready\n",
        encoding: "utf8",
      },
      { portablePath: "output", entryType: "DIRECTORY", mode: "0755", readOnlyForTarget: false },
    ]);
    const result = await executeTarget({
      executablePath: path.join(process.cwd(), "tests/fixtures/agents/fake-dsh/fake-dsh.mjs"),
      profile: "fixture-filesystem",
      task: "copy the public input",
      cwd: prepared.workspacePath,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      probeOutputPath: prepared.probeOutputPath,
      sourceRunId: "source-force-kill",
      deadlineMs: 500,
      maxOutputBytes: 64 * 1024,
      fixtureBehavior: "ignore-term-timeout",
    });
    assert.equal(result.terminationKind, "TIMED_OUT");
    assert.equal(result.signal, "SIGKILL");
    assert.match(await readFile(prepared.probeOutputPath, "utf8"), /probe\/start/);
    await resetEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      workspacePath: prepared.workspacePath,
      resetGeneration: 0,
    });
    await cleanupEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      workspacePath: prepared.workspacePath,
    });
  } finally {
    if (prepared !== undefined) {
      await resetEnvironment({
        workspaceRoot: path.join(root, "workspaces"),
        workspacePath: prepared.workspacePath,
        resetGeneration: 0,
      }).then(() => cleanupEnvironment({
        workspaceRoot: path.join(root, "workspaces"),
        workspacePath: prepared!.workspacePath,
      })).catch(() => undefined);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-RUN-AC-006: pre-cancelled execution never creates a child process", async () => {
  const root = await temporaryDirectory();
  try {
    const prepared = await prepareEnvironment({
      workspaceRoot: path.join(root, "workspaces"),
      runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      runId: "run-pre-cancel",
      caseId: "case-pre-cancel",
      attemptId: "attempt-pre-cancel",
    });
    const controller = new AbortController();
    controller.abort();
    let started = false;
    const result = await executeTarget({
      executablePath: path.join(process.cwd(), "tests/fixtures/agents/fake-dsh/fake-dsh.mjs"),
      profile: "fixture-filesystem",
      task: "copy the public input",
      cwd: prepared.workspacePath,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      probeOutputPath: prepared.probeOutputPath,
      sourceRunId: "source-pre-cancel",
      deadlineMs: 1_000,
      maxOutputBytes: 1024,
      fixtureBehavior: "copy",
      signal: controller.signal,
      onStarted: () => {
        started = true;
      },
    });
    assert.equal(result.terminationKind, "CANCELLED");
    assert.equal(started, false);
    await assert.rejects(access(prepared.probeOutputPath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-SEC-FILE-001: reset is bounded and cleanup requires an empty workspace", async () => {
  const root = await temporaryDirectory();
  try {
    const workspaceRoot = path.join(root, "workspaces");
    const prepared = await prepareEnvironment({
      workspaceRoot,
      runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      runId: "run-reset",
      caseId: "case-reset",
      attemptId: "attempt-reset",
    });
    const neighbor = path.join(workspaceRoot, "neighbor.txt");
    await writeFile(neighbor, "keep", "utf8");
    await writeFile(path.join(prepared.workspacePath, "residue.txt"), "remove", "utf8");
    await assert.rejects(
      cleanupEnvironment({ workspaceRoot, workspacePath: prepared.workspacePath }),
      /independently verified empty/,
    );
    await assert.rejects(
      resetEnvironment({
        workspaceRoot,
        workspacePath: path.join(workspaceRoot, "run-reset"),
        resetGeneration: 0,
      }),
      /exact root\/run\/case\/attempt/,
    );
    const reset = await resetEnvironment({
      workspaceRoot,
      workspacePath: prepared.workspacePath,
      resetGeneration: 0,
    });
    assert.equal(reset.resetGeneration, 1);
    await cleanupEnvironment({ workspaceRoot, workspacePath: prepared.workspacePath });
    assert.equal(await readFile(neighbor, "utf8"), "keep");
    assert.throws(() => validatePortablePath("../escape"), /unsafe portable path/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-RUN-REQ-005: prepare failure rolls back only its newly-created attempt directories", async () => {
  const root = await temporaryDirectory();
  try {
    const workspaceRoot = path.join(root, "workspaces");
    const runtimeDshHomeRoot = path.join(root, "runtime-homes");
    const sourceDshHome = path.join(root, "source-home");
    await mkdir(workspaceRoot, { recursive: true });
    await mkdir(runtimeDshHomeRoot, { recursive: true });
    await mkdir(sourceDshHome, { recursive: true });
    await writeFile(path.join(workspaceRoot, "neighbor.txt"), "workspace-neighbor", "utf8");
    await writeFile(path.join(runtimeDshHomeRoot, "neighbor.txt"), "runtime-neighbor", "utf8");
    await assert.rejects(
      prepareEnvironment({
        workspaceRoot,
        runtimeDshHomeRoot,
        runId: "run-prepare-failure",
        caseId: "case-prepare-failure",
        attemptId: "attempt-prepare-failure",
        sourceDshHome,
        profile: "missing-profile",
      }),
      /ENOENT|no such file/u,
    );
    await assert.rejects(
      access(path.join(workspaceRoot, "run-prepare-failure/case-prepare-failure/attempt-prepare-failure")),
    );
    await assert.rejects(
      access(path.join(runtimeDshHomeRoot, "run-prepare-failure/case-prepare-failure/attempt-prepare-failure")),
    );
    assert.equal(await readFile(path.join(workspaceRoot, "neighbor.txt"), "utf8"), "workspace-neighbor");
    assert.equal(await readFile(path.join(runtimeDshHomeRoot, "neighbor.txt"), "utf8"), "runtime-neighbor");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-RUN-AC-004: target entry is staged read-only and Runtime Home cleanup is exact", async () => {
  const root = await temporaryDirectory();
  try {
    const workspaceRoot = path.join(root, "workspaces");
    const runtimeDshHomeRoot = path.join(root, "runtime-homes");
    const prepared = await prepareEnvironment({
      workspaceRoot,
      runtimeDshHomeRoot,
      runId: "run-stage",
      caseId: "case-stage",
      attemptId: "attempt-stage",
    });
    const sourceRoot = path.join(process.cwd(), "tests/fixtures/agents/fake-dsh");
    const sourceExecutable = path.join(sourceRoot, "fake-dsh.mjs");
    const sourceBytes = await readFile(sourceExecutable);
    const staged = await stageTargetRuntime({
      sourceRoot,
      executablePath: sourceExecutable,
      expectedExecutableSha256: digestBytes(sourceBytes).value,
      runtimeDshHomeRoot,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      runId: "run-stage",
      caseId: "case-stage",
      attemptId: "attempt-stage",
    });
    assert.equal(await readFile(staged.stagedExecutablePath, "utf8"), sourceBytes.toString("utf8"));
    const neighbor = path.join(runtimeDshHomeRoot, "neighbor.txt");
    await writeFile(neighbor, "keep", "utf8");
    await cleanupRuntimeDshHome({
      runtimeDshHomeRoot,
      runtimeDshHomePath: prepared.runtimeDshHomePath,
      runId: "run-stage",
      caseId: "case-stage",
      attemptId: "attempt-stage",
    });
    await assert.rejects(access(prepared.runtimeDshHomePath));
    assert.equal(await readFile(neighbor, "utf8"), "keep");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-E2E-010 fixture reset residue is explicit and cannot target a production-named run", async () => {
  const root = await temporaryDirectory();
  try {
    const workspaceRoot = path.join(root, "workspaces");
    const prepared = await prepareEnvironment({
      workspaceRoot,
      runtimeDshHomeRoot: path.join(root, "runtime-homes"),
      runId: "fixture-reset-mismatch",
      caseId: "case-reset-mismatch",
      attemptId: "attempt-reset-mismatch",
    });
    await injectFixtureOnlyResetResidue({
      workspaceRoot,
      workspacePath: prepared.workspacePath,
      runId: "fixture-reset-mismatch",
      caseId: "case-reset-mismatch",
      attemptId: "attempt-reset-mismatch",
      fixtureBehavior: "reset-mismatch",
    });
    assert.equal(
      await readFile(path.join(prepared.workspacePath, "fixture-reset-residue.txt"), "utf8"),
      "fixture-only reset mismatch\n",
    );
    await assert.rejects(
      injectFixtureOnlyResetResidue({
        workspaceRoot,
        workspacePath: prepared.workspacePath,
        runId: "run-production",
        caseId: "case-reset-mismatch",
        attemptId: "attempt-reset-mismatch",
        fixtureBehavior: "reset-mismatch",
      }),
      /fixture-\*/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-UT-PLAT-001: config freezes safe disjoint roots and rejects unknown fields", async () => {
  const root = await temporaryDirectory();
  try {
    const targetRoot = path.join(root, "target");
    await mkdir(targetRoot);
    const config = await freezeConfig({
      cwd: root,
      configId: "config-test",
      invocationId: "invocation-test",
      createdAt: "2026-01-01T00:00:00.000Z",
      dshevalVersion: "0.1.0",
      environment: {},
      cli: { targetRoot },
    });
    assert.equal(config.minimumIsolationLevel, "AGENT_SEPARATED");
    assert.equal(config.runRoot, path.join(root, "var/records"));
    await assert.rejects(
      freezeConfig({
        cwd: root,
        configId: "config-bad",
        invocationId: "invocation-bad",
        createdAt: "2026-01-01T00:00:00.000Z",
        dshevalVersion: "0.1.0",
        environment: {},
        cli: { targetRoot, unknown: true } as never,
      }),
      /unknown fields/,
    );
    await assert.rejects(
      freezeConfig({
        cwd: root,
        configId: "config-repository-root",
        invocationId: "invocation-repository-root",
        createdAt: "2026-01-01T00:00:00.000Z",
        dshevalVersion: "0.1.0",
        environment: {},
        cli: { targetRoot, runRoot: root },
      }),
      /repository root/,
    );
    await assert.rejects(
      freezeConfig({
        cwd: root,
        configId: "config-unresolved-root",
        invocationId: "invocation-unresolved-root",
        createdAt: "2026-01-01T00:00:00.000Z",
        dshevalVersion: "0.1.0",
        environment: {},
        cli: { targetRoot, workspaceRoot: "${WORKSPACE_ROOT}" },
      }),
      /unresolved path expression/,
    );
    await assert.rejects(
      freezeConfig({
        cwd: root,
        configId: "config-reserved-secret",
        invocationId: "invocation-reserved-secret",
        createdAt: "2026-01-01T00:00:00.000Z",
        dshevalVersion: "0.1.0",
        environment: {},
        cli: { targetRoot, secretRefNames: ["DSH_HOME"] },
      }),
      /harness-owned/,
    );
    await assert.rejects(
      freezeConfig({
        cwd: root,
        configId: "config-overlapping-roots",
        invocationId: "invocation-overlapping-roots",
        createdAt: "2026-01-01T00:00:00.000Z",
        dshevalVersion: "0.1.0",
        environment: {},
        cli: {
          targetRoot,
          runRoot: path.join(root, "records"),
          artifactRoot: path.join(root, "records", "artifacts"),
        },
      }),
      /must not overlap/,
    );
    await assert.rejects(
      freezeConfig({
        cwd: root,
        configId: "config-secret-value",
        invocationId: "invocation-secret-value",
        createdAt: "2026-01-01T00:00:00.000Z",
        dshevalVersion: "0.1.0",
        environment: {},
        cli: { targetRoot, secretRefNames: ["sk-live-secret-value"] },
      }),
      /reference names, never values/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-PLAT-REQ-006: startup recovery permits planning/terminal partitions and blocks another active Run", async () => {
  const root = await temporaryDirectory();
  try {
    const roots = localServiceRoots(root);
    await mkdir(path.join(roots.run, "run-inspect", "records", "inspection"), {
      recursive: true,
    });
    await writeFile(
      path.join(roots.run, "run-inspect", "records", "inspection", "inspection.json"),
      "{}",
    );
    await writeRunHistory(roots.run, "run-terminal", [
      "CREATED",
      "PREFLIGHTING",
      "RUNNING",
      "FINALIZING",
      "FINISHED",
    ]);
    await writeRunHistory(roots.run, "run-current", ["CREATED"]);

    const healthy = await checkLocalServices(roots, { currentRunId: "run-current" });
    assert.equal(healthy.status, "HEALTHY");
    assert.equal(
      healthy.checks.find((check) => check.name === "startup-recovery")?.status,
      "PASS",
    );

    await writeRunHistory(roots.run, "run-unfinished", [
      "CREATED",
      "PREFLIGHTING",
      "RUNNING",
    ]);
    const blocked = await checkLocalServices(roots, { currentRunId: "run-current" });
    assert.equal(blocked.status, "FAILED");
    const recovery = blocked.checks.find((check) => check.name === "startup-recovery");
    assert.equal(recovery?.status, "FAIL");
    assert.match(recovery?.detail ?? "", /UNFINISHED_RUN: run-unfinished remains RUNNING/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-PLAT-REQ-006: startup recovery fails closed on a damaged or symlinked Run partition", async () => {
  const damagedRoot = await temporaryDirectory();
  const symlinkRoot = await temporaryDirectory();
  try {
    const damagedRoots = localServiceRoots(damagedRoot);
    await writeRunHistory(damagedRoots.run, "run-damaged", ["CREATED", "FAILED"]);
    const currentPath = path.join(
      damagedRoots.run,
      "run-damaged",
      "records",
      "run",
      "run-damaged.json",
    );
    const tampered = JSON.parse(await readFile(currentPath, "utf8")) as Record<string, unknown>;
    tampered.state = "RUNNING";
    await writeFile(currentPath, JSON.stringify(tampered));
    const damaged = await checkLocalServices(damagedRoots);
    assert.equal(damaged.status, "FAILED");
    assert.equal(
      damaged.checks.find((check) => check.name === "startup-recovery")?.status,
      "FAIL",
    );

    const symlinkRoots = localServiceRoots(symlinkRoot);
    await mkdir(symlinkRoots.run, { recursive: true });
    const outside = path.join(symlinkRoot, "outside-partition");
    await mkdir(outside);
    await symlink(outside, path.join(symlinkRoots.run, "run-linked"));
    const linked = await checkLocalServices(symlinkRoots);
    assert.equal(linked.status, "FAILED");
    assert.match(
      linked.checks.find((check) => check.name === "startup-recovery")?.detail ?? "",
      /not a real Run partition/u,
    );
  } finally {
    await rm(damagedRoot, { recursive: true, force: true });
    await rm(symlinkRoot, { recursive: true, force: true });
  }
});

test("MVP-PLAT-REQ-006: bootstrap refuses to allocate a new Run beside an unfinished prior Run", async () => {
  const root = await temporaryDirectory();
  try {
    const roots = localServiceRoots(root);
    await writeRunHistory(roots.run, "run-prior-active", ["CREATED", "PREFLIGHTING"]);
    const descriptor = await loadTargetDescriptor(
      path.join(process.cwd(), "examples", "fixture-target.json"),
    );
    await assert.rejects(
      bootstrapApplication({
        cwd: root,
        runId: "run-new",
        descriptor,
        createdAt: "2026-01-01T00:00:00.000Z",
        configOverrides: {
          runRoot: roots.run,
          artifactRoot: roots.artifact,
          reportRoot: roots.report,
          workspaceRoot: roots.workspace,
          runtimeDshHomeRoot: roots.runtimeHome,
        },
      }),
      /STARTUP_RECOVERY_REQUIRED.*UNFINISHED_RUN/u,
    );
    await assert.rejects(access(path.join(roots.run, "run-new")));
    await assert.rejects(
      bootstrapApplication({
        cwd: root,
        runId: "run-prior-active",
        descriptor,
        createdAt: "2026-01-01T00:00:00.000Z",
        configOverrides: {
          runRoot: roots.run,
          artifactRoot: roots.artifact,
          reportRoot: roots.report,
          workspaceRoot: roots.workspace,
          runtimeDshHomeRoot: roots.runtimeHome,
        },
      }),
      /STARTUP_RECOVERY_REQUIRED.*UNFINISHED_RUN/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-IT-LEASE-001: an active lease rejects a second run", async () => {
  const root = await temporaryDirectory();
  try {
    const lease = await acquireLease(root, "run-first");
    await assert.rejects(acquireLease(root, "run-second"), /LEASE_CONFLICT/);
    const released = await releaseLease(root, lease);
    assert.equal(released.state, "RELEASED");
    const realRoot = path.join(root, "real-lease-root");
    const linkedRoot = path.join(root, "linked-lease-root");
    await mkdir(realRoot);
    await symlink(realRoot, linkedRoot);
    await assert.rejects(acquireLease(linkedRoot, "run-linked"), /real directory/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-SEC-IDENTITY-002: fixture and production identity facts are never confused", async () => {
  const root = await temporaryDirectory();
  try {
    const fixture = await runSecurityPreflight({
      deniedRoots: [],
      allowedRoots: [],
      allowFixtureIdentity: true,
    });
    assert.equal(fixture.status, "FIXTURE_ONLY");
    assert.equal(fixture.isolationLevel, "PROCESS_FIXTURE");
    const production = await runSecurityPreflight({
      deniedRoots: [],
      allowedRoots: [],
      expectedTargetIdentity: "dsheval_missing_identity",
    });
    assert.equal(production.status, "FAILED");
    assert.equal(
      production.checks.find((check) => check.name === "target-privilege-drop")?.status,
      "FAIL",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MVP-SEC-TASK-001 and MVP-SEC-SECRET-001 reject hidden task and output material", () => {
  assert.doesNotThrow(() => assertSafeAgentTask("copy input/source.txt", ["hidden-digest"]));
  assert.throws(
    () => assertSafeAgentTask("copy hidden-digest", ["hidden-digest"]),
    /hidden or sensitive/,
  );
  assert.deepEqual(findSecretLeaks(Buffer.from("prefix canary-secret suffix"), ["canary-secret"]), [
    "canary-secret",
  ]);
});

test("MVP-PLAT-REQ-008: export contains only verified report files and a digest manifest", async () => {
  const root = await temporaryDirectory();
  try {
    const reportRoot = path.join(root, "reports");
    const refDigest = digestBytes("fixture-report-ref");
    const report = withContentDigest({
      schema: "dsheval.mvp.report/v1" as const,
      reportId: "report-export",
      scope: {
        targetId: "target-export",
        targetSnapshotId: "snapshot-export",
        runId: "run-export",
        caseId: "case-export",
        attemptId: "attempt-export",
      },
      createdAt: "2026-09-01T00:00:00.000Z",
      producerVersion: "0.1.0",
      runRef: { schema: "dsheval.mvp.run/v1", id: "run-export", revision: 1, digest: refDigest },
      targetSnapshotRef: { schema: "dsheval.mvp.target-snapshot/v1", id: "snapshot-export", digest: refDigest },
      planRefs: [],
      caseRef: { schema: "dsheval.mvp.case/v1", id: "case-export", revision: 1, digest: refDigest },
      attemptRef: { schema: "dsheval.mvp.attempt/v1", id: "attempt-export", revision: 1, digest: refDigest },
      sourceRefs: [],
      collectionStatusRefs: [],
      closureRefs: [],
      judgementRefs: [],
      checkResultRefs: [],
      failureRefs: [],
      operationalHealth: "HEALTHY" as const,
      artifactRefs: [],
    });
    const view = {
      runId: "run-export",
      targetSummary: "FULL_AGENT / fixture",
      currentPhase: "FINISHED",
      runState: "FINISHED",
      operationalHealth: "HEALTHY",
      startedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:01.000Z",
      timeline: Array.from({ length: 10 }, (_unused, index) => ({
        number: index + 1,
        label: `step-${index + 1}`,
        status: "SUCCEEDED",
        objectRefs: [],
        failureGroups: [],
      })),
      planSummary: { caseCount: 1, attemptCount: 1, checkIds: [] },
      sources: [],
      checks: [],
      reset: { result: "MATCH", environmentState: "CLEANED" },
      failures: [],
      artifacts: [],
    };
    const { contentDigest: _baseReportDigest, ...baseReport } = report;
    const document = withContentDigest({
      ...baseReport,
      view,
      rendererVersion: "dsheval-static/v1",
    });
    const reportJson = `${canonicalJson(document)}\n`;
    const committedJson = await commitReportJson({
      reportRoot,
      runId: "run-export",
      bytes: reportJson,
      maxBytes: 1_000_000,
    });
    assert.equal(committedJson.digest, digestBytes(reportJson).value);
    const verifiedJson = await readCommittedReportJson({
      reportRoot,
      runId: "run-export",
      maxBytes: 1_000_000,
    });
    assert.deepEqual(JSON.parse(verifiedJson.toString("utf8")), document);
    await commitReportHtml({
      reportRoot,
      runId: "run-export",
      bytes: "<!doctype html><p>PASS</p>\n",
      maxBytes: 1_000_000,
    });
    await assert.rejects(
      commitReportJson({
        reportRoot,
        runId: "run-export",
        bytes: reportJson,
        maxBytes: 1_000_000,
      }),
      /immutable/u,
    );
    const delivery = await exportReport({
      reportRoot,
      runId: "run-export",
      exportId: "export-one",
      maxBytes: 1_000_000,
    });
    assert.deepEqual(
      delivery.manifest.files.map((file) => file.portablePath),
      ["report.html", "report.json"],
    );
    await access(path.join(delivery.directory, "manifest.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
