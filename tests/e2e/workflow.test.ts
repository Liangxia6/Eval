import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestValue, withContentDigest, type TargetDescriptor } from "../../src/core/models.js";
import {
  rebuildCommittedReportHtml,
  runEvaluationWorkflow,
  type FixtureHooks,
  type WorkflowSummary,
} from "../../src/app/workflow.js";
import { cleanupRuntimeDshHome } from "../../src/runtime/environment.js";
import type { MvpConfigValues } from "../../src/platform/config.js";

const REPOSITORY_ROOT = path.resolve(process.cwd());
const TARGET_ROOT = path.join(REPOSITORY_ROOT, "tests", "fixtures", "agents", "fake-dsh");
const DEFAULT_PACK_ROOT = path.join(REPOSITORY_ROOT, "packs");

interface FixtureRun {
  readonly temporaryRoot: string;
  readonly runRoot: string;
  readonly artifactRoot: string;
  readonly reportRoot: string;
  readonly workspaceRoot: string;
  readonly runtimeDshHomeRoot: string;
  readonly summary: WorkflowSummary;
}

function fixtureDescriptor(): TargetDescriptor {
  return withContentDigest({
    schema: "dsheval.mvp.target-descriptor/v1" as const,
    targetId: "fixture-agent",
    targetType: "FULL_AGENT" as const,
    sourceRoot: TARGET_ROOT,
    dshExecutable: "fake-dsh.mjs",
    dshHome: ".dsh",
    profile: "fixture-filesystem",
    targetIdentity: "dshagent",
    requestedScope: "FILESYSTEM_MVP" as const,
  }) as TargetDescriptor;
}

async function executeFixture(input: {
  readonly runId: string;
  readonly behavior: string;
  readonly hooks?: Omit<FixtureHooks, "behavior">;
  readonly packRoot?: string;
  readonly deadlines?: { readonly runDeadlineMs: number; readonly caseDeadlineMs: number };
  readonly configOverrides?: Partial<MvpConfigValues>;
  readonly signal?: AbortSignal;
  readonly formalPreflight?: boolean;
  readonly onTargetStartedStatus?: (html: string) => void | Promise<void>;
}): Promise<FixtureRun> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "dsheval-workflow-"));
  const runRoot = path.join(temporaryRoot, "records");
  const artifactRoot = path.join(temporaryRoot, "artifacts");
  const reportRoot = path.join(temporaryRoot, "reports");
  const workspaceRoot = path.join(temporaryRoot, "workspaces");
  const runtimeDshHomeRoot = path.join(temporaryRoot, "runtime-homes");
  try {
    const summary = await runEvaluationWorkflow({
      cwd: REPOSITORY_ROOT,
      runId: input.runId,
      descriptor: fixtureDescriptor(),
      fixtureMode: input.formalPreflight !== true,
      ...(input.formalPreflight === true
        ? {}
        : {
            fixtureHooks: {
              behavior: input.behavior,
              ...input.hooks,
              ...(input.onTargetStartedStatus === undefined
                ? {}
                : {
                    onTargetStarted: async () => {
                      await input.hooks?.onTargetStarted?.();
                      await input.onTargetStartedStatus?.(
                        await readFile(path.join(runRoot, input.runId, "status.html"), "utf8"),
                      );
                    },
                  }),
            },
          }),
      packRoot: input.packRoot ?? DEFAULT_PACK_ROOT,
      configOverrides: {
        ...(input.configOverrides ?? {}),
        runRoot,
        artifactRoot,
        reportRoot,
        workspaceRoot,
        runtimeDshHomeRoot,
        ...(input.deadlines ?? {}),
      },
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    return {
      temporaryRoot,
      runRoot,
      artifactRoot,
      reportRoot,
      workspaceRoot,
      runtimeDshHomeRoot,
      summary,
    };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function regularFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const metadata = await lstat(candidate);
      assert.equal(metadata.isSymbolicLink(), false, `unexpected symlink in persisted tree: ${candidate}`);
      if (metadata.isDirectory()) await visit(candidate);
      else if (metadata.isFile()) files.push(candidate);
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right, "en"));
}

async function assertFilesDoNotContain(files: readonly string[], secret: string): Promise<void> {
  for (const file of files) {
    const bytes = await readFile(file);
    assert.equal(
      bytes.includes(Buffer.from(secret, "utf8")),
      false,
      `Secret canary escaped into ${file}`,
    );
  }
}

async function jsonFile(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

async function currentRecord(
  run: FixtureRun,
  type: string,
  id: string,
): Promise<Record<string, unknown>> {
  return await jsonFile(path.join(run.runRoot, run.summary.runId, "records", type, `${id}.json`));
}

async function reportDocument(run: FixtureRun): Promise<Record<string, unknown>> {
  return await jsonFile(path.join(run.reportRoot, run.summary.runId, "report.json"));
}

async function removeFixture(run: FixtureRun): Promise<void> {
  const canonicalRuntimeRoot = await realpath(run.runtimeDshHomeRoot);
  await cleanupRuntimeDshHome({
    runtimeDshHomeRoot: run.runtimeDshHomeRoot,
    runtimeDshHomePath: path.join(
      canonicalRuntimeRoot,
      run.summary.runId,
      `${run.summary.runId}.case`,
      `${run.summary.runId}.attempt`,
    ),
    runId: run.summary.runId,
    caseId: `${run.summary.runId}.case`,
    attemptId: `${run.summary.runId}.attempt`,
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await rm(run.temporaryRoot, { recursive: true, force: true });
}

test("MVP-E2E-001-FIXTURE: complete vertical slice produces three PASS checks, clean Reset and verified delivery", { timeout: 20_000 }, async () => {
  const run = await executeFixture({ runId: "fixture-e2e-001", behavior: "copy" });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FINISHED");
    assert.equal(run.summary.operationalHealth, "HEALTHY");
    assert.equal(run.summary.securityIsolation, "PROCESS_FIXTURE");
    assert.equal(run.summary.exitCode, 0);
    const report = await reportDocument(run);
    assert.equal(report.schema, "dsheval.mvp.report/v1");
    assert.deepEqual(report.contentDigest, digestValue(report, ["contentDigest"]));
    const view = report.view as {
      checks: Array<{ outcome: string; closureState: string }>;
      reset: { result: string; environmentState: string };
      fixture: boolean;
      securityIsolation: string;
    };
    assert.equal(view.checks.length, 3);
    assert.ok(view.checks.every((check) => check.outcome === "PASS" && check.closureState === "CLOSED"));
    assert.equal(view.reset.result, "MATCH");
    assert.equal(view.reset.environmentState, "CLEANED");
    assert.equal(view.fixture, true);
    assert.equal(view.securityIsolation, "PROCESS_FIXTURE");
    const preflight = await currentRecord(
      run,
      "security-preflight",
      `preflight.${run.summary.runId}`,
    );
    assert.equal(preflight.status, "FAILED");
    assert.equal(preflight.telemetryDisabled, false);
    const html = await readFile(path.join(run.reportRoot, run.summary.runId, "report.html"), "utf8");
    assert.match(html, /CheckResult[\s\S]*Closure[\s\S]*Authorized evidence/u);
    assert.match(html, /RawObservation 定位/u);
    assert.match(html, /JSONL line 1 bytes 0\.\./u);
    assert.match(html, /File Snapshot Entries/u);
    assert.match(html, /input\/source\.txt/u);
    assert.match(html, /output\/result\.txt/u);
    assert.match(html, /File Diff/u);
    assert.match(html, /Execution class<br><strong>FIXTURE<\/strong>/u);
    assert.match(html, /Security isolation<br><strong>PROCESS_FIXTURE<\/strong>/u);
    assert.match(html, /this Gate does not establish formal VM identity or network isolation/u);
    const lifecycle = (await readFile(
      path.join(run.runRoot, run.summary.runId, "events", "lifecycle.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { reasonCode: string });
    const reasonCodes = lifecycle.map((event) => event.reasonCode);
    const orderedReasons = [
      "ENVIRONMENT_SEEDED",
      "FILE_BASELINE_COMMITTED",
      "PROBE_ARMED",
      "TARGET_STARTING",
      "BOUNDED_DRAIN_STARTED",
      "OBSERVATION_SEALED",
      "RESET_COMPLETED_PENDING_VERIFICATION",
      "RESET_VERIFIED",
      "ENVIRONMENT_CLEANED",
      "FINALIZATION_FACTS_COMMITTED",
      "RUN_FINISHED",
    ];
    let priorIndex = -1;
    for (const reason of orderedReasons) {
      const currentIndex = reasonCodes.indexOf(reason);
      assert.ok(currentIndex > priorIndex, `${reason} must follow the prior committed phase`);
      priorIndex = currentIndex;
    }
    assert.equal(
      (await regularFiles(path.join(run.runRoot, run.summary.runId, "records", "gate"))).length,
      1,
    );
    const artifactIndex = (await readFile(
      path.join(run.artifactRoot, run.summary.runId, "index.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { artifactId: string });
    assert.equal(new Set(artifactIndex.map((entry) => entry.artifactId)).size, artifactIndex.length);
    await assert.rejects(lstat(path.join(run.runRoot, "locks", "active-run.lock")), {
      code: "ENOENT",
    });
  } catch (error) {
    throw error;
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-002: a complete success Trace cannot hide a missing target file", { timeout: 20_000 }, async () => {
  const run = await executeFixture({ runId: "fixture-e2e-002", behavior: "missing" });
  try {
    assert.equal(run.summary.gate, "FAIL");
    assert.equal(run.summary.exitCode, 1);
    const report = await reportDocument(run);
    const checks = (report.view as { checks: Array<{ checkId: string; outcome: string }> }).checks;
    assert.equal(checks.find((check) => check.checkId === "state.expected-file")?.outcome, "FAIL");
    const attempt = await currentRecord(run, "attempt", "fixture-e2e-002.attempt");
    assert.equal(attempt.ordinal, 1);
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-003: wrong output bytes deterministically fail File State and Gate", { timeout: 20_000 }, async () => {
  const run = await executeFixture({ runId: "fixture-e2e-003", behavior: "wrong" });
  try {
    assert.equal(run.summary.gate, "FAIL");
    const report = await reportDocument(run);
    const checks = (report.view as { checks: Array<{ checkId: string; outcome: string }> }).checks;
    assert.equal(checks.find((check) => check.checkId === "state.expected-file")?.outcome, "FAIL");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-004: extra output and protected-input mutation are independently rejected", { timeout: 40_000 }, async () => {
  const extra = await executeFixture({ runId: "fixture-e2e-004-extra", behavior: "extra" });
  const modified = await executeFixture({
    runId: "fixture-e2e-004-input",
    behavior: "copy",
    hooks: {
      afterTargetBeforeDrain: async (workspacePath) => {
        const inputFile = path.join(workspacePath, "input", "source.txt");
        await chmod(inputFile, 0o600);
        await writeFile(inputFile, "fixture protected-input mutation\n", "utf8");
      },
    },
  });
  try {
    assert.equal(extra.summary.gate, "FAIL");
    assert.equal(modified.summary.gate, "FAIL");
    const modifiedReport = await reportDocument(modified);
    const checks = (modifiedReport.view as { checks: Array<{ checkId: string; outcome: string }> }).checks;
    assert.equal(checks.find((check) => check.checkId === "security.path-boundary")?.outcome, "FAIL");
  } finally {
    await Promise.all([removeFixture(extra), removeFixture(modified)]);
  }
});

test("MVP-E2E-005: a root-escaping symlink is a trusted Path Security FAIL", { timeout: 20_000 }, async () => {
  const run = await executeFixture({ runId: "fixture-e2e-005", behavior: "symlink" });
  try {
    assert.equal(run.summary.gate, "FAIL");
    const report = await reportDocument(run);
    const checks = (report.view as { checks: Array<{ checkId: string; outcome: string }> }).checks;
    assert.equal(checks.find((check) => check.checkId === "security.path-boundary")?.outcome, "FAIL");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-006: missing Probe stop is collector_error and UNEVALUABLE, never PASS", { timeout: 20_000 }, async () => {
  const run = await executeFixture({ runId: "fixture-e2e-006", behavior: "missing-probe-stop" });
  try {
    assert.equal(run.summary.gate, "UNEVALUABLE");
    assert.equal(run.summary.exitCode, 3);
    assert.ok(run.summary.failureGroups.includes("collector_error"));
    assert.ok(run.summary.reasonCodes.includes("PROBE_STOP_MISSING"));
    const report = await reportDocument(run);
    const checks = (report.view as { checks: Array<{ checkId: string; outcome: string }> }).checks;
    assert.equal(checks.find((check) => check.checkId === "protocol.integrity")?.outcome, "UNEVALUABLE");
    assert.equal(checks.find((check) => check.checkId === "state.expected-file")?.outcome, "PASS");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-007: unreadable File After makes dependent checks UNEVALUABLE", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-e2e-007",
    behavior: "copy",
    hooks: {
      afterTargetBeforeDrain: async (workspacePath) => {
        await chmod(path.join(workspacePath, "output", "result.txt"), 0o000);
      },
    },
  });
  try {
    assert.equal(run.summary.gate, "UNEVALUABLE");
    assert.ok(run.summary.failureGroups.includes("collector_error"));
    const report = await reportDocument(run);
    const checks = (report.view as { checks: Array<{ checkId: string; outcome: string }> }).checks;
    assert.equal(checks.find((check) => check.checkId === "state.expected-file")?.outcome, "UNEVALUABLE");
    assert.equal(checks.find((check) => check.checkId === "security.path-boundary")?.outcome, "UNEVALUABLE");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-008: foreign Probe facts invalidate the persisted Bundle and block normal judging", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-e2e-008",
    behavior: "foreign-probe-run",
  });
  try {
    assert.equal(run.summary.gate, "UNEVALUABLE");
    assert.equal(run.summary.exitCode, 3);
    assert.ok(run.summary.failureGroups.includes("collector_error"));
    assert.ok(run.summary.reasonCodes.includes("EVIDENCE_BUNDLE_INVALID"));
    const bundle = await currentRecord(
      run,
      "evidence-bundle",
      "bundle.fixture-e2e-008.attempt",
    );
    assert.equal(bundle.status, "INVALID");
    const report = await reportDocument(run);
    const checks = (report.view as {
      checks: Array<{ outcome: string; closureState: string }>;
    }).checks;
    assert.equal(checks.length, 3);
    assert.ok(
      checks.every(
        (check) => check.outcome === "UNEVALUABLE" && check.closureState === "INVALID",
      ),
    );
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-009: timeout keeps one Attempt, seals partial facts, resets, then Gate FAILs", { timeout: 20_000 }, async () => {
  const temporaryPackRoot = await mkdtemp(path.join(os.tmpdir(), "dsheval-timeout-pack-"));
  await cp(DEFAULT_PACK_ROOT, temporaryPackRoot, { recursive: true });
  const scenarioFile = path.join(temporaryPackRoot, "scenarios", "filesystem-copy-exact-v1.json");
  const scenario = await jsonFile(scenarioFile);
  (scenario.execution as { deadlineMs: number }).deadlineMs = 500;
  scenario.contentDigest = digestValue(scenario, ["contentDigest"]);
  await writeFile(scenarioFile, `${JSON.stringify(scenario, null, 2)}\n`, "utf8");
  const run = await executeFixture({
    runId: "fixture-e2e-009",
    behavior: "timeout",
    packRoot: temporaryPackRoot,
    deadlines: { runDeadlineMs: 10_000, caseDeadlineMs: 500 },
  });
  try {
    assert.equal(run.summary.gate, "FAIL");
    const attempt = await currentRecord(run, "attempt", "fixture-e2e-009.attempt");
    assert.equal(attempt.state, "TIMED_OUT");
    assert.equal(attempt.ordinal, 1);
    const environment = await currentRecord(run, "environment", "fixture-e2e-009.environment");
    assert.equal(environment.state, "CLEANED");
  } finally {
    await Promise.all([
      removeFixture(run),
      rm(temporaryPackRoot, { recursive: true, force: true }),
    ]);
  }
});

test("MVP-FI-TARGET-001: non-zero Target exit remains an Agent failure while trusted evidence is still judged", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-target-nonzero",
    behavior: "nonzero-exit",
  });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.exitCode, 0);
    assert.equal(run.summary.runState, "FINISHED");
    assert.equal(run.summary.operationalHealth, "HEALTHY");
    assert.ok(run.summary.failureGroups.includes("agent_failure"));
    assert.equal(run.summary.failureGroups.includes("infrastructure_error"), false);
    assert.ok(run.summary.reasonCodes.includes("TARGET_TARGET_FAILED"));
    const attempt = await currentRecord(
      run,
      "attempt",
      "fixture-target-nonzero.attempt",
    );
    assert.equal(attempt.state, "TARGET_FAILED");
    assert.equal(attempt.terminationKind, "TARGET_FAILED");
    const environment = await currentRecord(
      run,
      "environment",
      "fixture-target-nonzero.environment",
    );
    assert.equal(environment.state, "CLEANED");
    const report = await reportDocument(run);
    const checks = (report.view as {
      checks: Array<{ outcome: string; closureState: string }>;
    }).checks;
    assert.ok(
      checks.every(
        (check) => check.outcome === "PASS" && check.closureState === "CLOSED",
      ),
      "a Target exit code cannot override complete Probe and independent filesystem facts",
    );
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-010: Reset mismatch leaves Agent Gate PASS but Run operationally FAILED", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-e2e-010",
    behavior: "copy",
    hooks: {
      afterReset: async (workspacePath) => {
        await writeFile(path.join(workspacePath, "fixture-residue.txt"), "residue\n", "utf8");
      },
    },
  });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FAILED");
    assert.equal(run.summary.operationalHealth, "FAILED");
    assert.equal(run.summary.exitCode, 4);
    const environment = await currentRecord(run, "environment", "fixture-e2e-010.environment");
    assert.equal(environment.state, "QUARANTINED");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-FI-RESET-001: Reset operation failure preserves the saved Agent Gate without inventing a verification", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-reset-operation-failure",
    behavior: "copy",
    hooks: {
      beforeReset: () => {
        throw new Error("fixture Reset operation failure");
      },
    },
  });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FAILED");
    assert.equal(run.summary.operationalHealth, "FAILED");
    assert.equal(run.summary.exitCode, 4);
    assert.ok(run.summary.reasonCodes.includes("ENVIRONMENT_RESET_FAILED"));
    const environment = await currentRecord(
      run,
      "environment",
      "fixture-reset-operation-failure.environment",
    );
    assert.equal(environment.state, "QUARANTINED");
    assert.equal(environment.resetGeneration, 0);
    await assert.rejects(
      currentRecord(
        run,
        "reset-verification",
        "reset-verification.fixture-reset-operation-failure.attempt",
      ),
      { code: "ENOENT" },
    );
    const gate = await currentRecord(run, "gate", "gate.fixture-reset-operation-failure");
    assert.equal(gate.verdict, "PASS");
    const report = await reportDocument(run);
    assert.equal((report.view as { gate?: string }).gate, "PASS");
    assert.equal(
      (report.view as { reset: { result: string } }).reset.result,
      "尚未产生",
    );
  } finally {
    const quarantinedWorkspace = path.join(
      run.workspaceRoot,
      run.summary.runId,
      `${run.summary.runId}.case`,
      `${run.summary.runId}.attempt`,
    );
    await chmod(path.join(quarantinedWorkspace, "input"), 0o700).catch(() => undefined);
    await chmod(path.join(quarantinedWorkspace, "input", "source.txt"), 0o600).catch(
      () => undefined,
    );
    await removeFixture(run);
  }
});

test("MVP-FI-RESET-002: POST_RESET collection failure preserves Gate without fabricating raw facts", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-reset-collection-failure",
    behavior: "copy",
    hooks: {
      afterReset: () => {
        throw new Error("fixture POST_RESET collection failure");
      },
    },
  });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FAILED");
    assert.equal(run.summary.operationalHealth, "FAILED");
    assert.equal(run.summary.exitCode, 4);
    assert.ok(run.summary.reasonCodes.includes("RESET_VERIFICATION_COLLECTION_FAILED"));
    const environment = await currentRecord(
      run,
      "environment",
      "fixture-reset-collection-failure.environment",
    );
    assert.equal(environment.state, "QUARANTINED");
    assert.equal(environment.resetGeneration, 1);
    await assert.rejects(
      currentRecord(
        run,
        "reset-verification",
        "reset-verification.fixture-reset-collection-failure.attempt",
      ),
      { code: "ENOENT" },
    );
    const report = await reportDocument(run);
    assert.equal((report.view as { gate?: string }).gate, "PASS");
    assert.equal((report.view as { reset: { result: string } }).reset.result, "尚未产生");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-E2E-011: HTML failure preserves committed Gate/Run and report JSON can be rebuilt", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-e2e-011",
    behavior: "copy",
    hooks: {
      beforeReportHtml: async () => {
        throw new Error("fixture HTML delivery failure");
      },
    },
  });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FINISHED");
    assert.equal(run.summary.exitCode, 4);
    assert.ok(run.summary.failureGroups.includes("infrastructure_error"));
    assert.ok(run.summary.reasonCodes.includes("HTML_DELIVERY_FAILED"));
    const gate = await currentRecord(run, "gate", "gate.fixture-e2e-011");
    assert.equal(gate.verdict, "PASS");
    const rebuilt = await rebuildCommittedReportHtml({
      reportRoot: run.reportRoot,
      runId: run.summary.runId,
      maxBytes: 1_048_576,
    });
    assert.equal(rebuilt.htmlStatus, "CREATED");
    assert.equal((await readFile(rebuilt.reportHtml, "utf8")).startsWith("<!doctype html>"), true);
    const status = await readFile(path.join(run.runRoot, run.summary.runId, "status.html"), "utf8");
    assert.match(
      status,
      /aria-label="10\. Single Gate \/ terminal Run \/ Report \/ Export: FAILED"/u,
    );
  } finally {
    await removeFixture(run);
  }
});

test("MVP delivery manifest hashes exactly the two immutable report files", { timeout: 20_000 }, async () => {
  const run = await executeFixture({ runId: "fixture-e2e-delivery", behavior: "copy" });
  try {
    const delivery = run.summary.delivery;
    assert.ok(delivery !== undefined);
    const manifest = await jsonFile(path.join(delivery, "manifest.json"));
    const files = manifest.files as Array<{ portablePath: string; sha256: string; byteLength: number }>;
    assert.deepEqual(files.map((entry) => entry.portablePath).sort(), ["report.html", "report.json"]);
    for (const entry of files) {
      const bytes: Buffer = await readFile(path.join(delivery, entry.portablePath));
      assert.equal(bytes.byteLength, entry.byteLength);
      assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256);
    }
    await readFile(path.join(run.runRoot, run.summary.runId, "status.html"), "utf8");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-SEC-SECRET-001: a configured Secret ref is injected only at Target start and never persisted", { timeout: 20_000 }, async () => {
  const canary = "fixture-canary-secret-4e18d9";
  const prior = process.env.MODEL_TEST_API_KEY;
  process.env.MODEL_TEST_API_KEY = canary;
  let run: FixtureRun | undefined;
  try {
    run = await executeFixture({
      runId: "fixture-secret-injection",
      behavior: "require-secret",
      configOverrides: { secretRefNames: ["MODEL_TEST_API_KEY"] },
    });
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FINISHED");
    await assertFilesDoNotContain(await regularFiles(run.temporaryRoot), canary);
  } finally {
    if (prior === undefined) delete process.env.MODEL_TEST_API_KEY;
    else process.env.MODEL_TEST_API_KEY = prior;
    if (run !== undefined) await removeFixture(run);
  }
});

test("MVP-SEC-SECRET-002: an unresolved Secret ref blocks Target start and Gate", { timeout: 20_000 }, async () => {
  const prior = process.env.MODEL_TEST_API_KEY;
  delete process.env.MODEL_TEST_API_KEY;
  let run: FixtureRun | undefined;
  try {
    run = await executeFixture({
      runId: "fixture-secret-missing",
      behavior: "require-secret",
      configOverrides: { secretRefNames: ["MODEL_TEST_API_KEY"] },
    });
    assert.equal(run.summary.exitCode, 4);
    assert.equal(run.summary.status, "FAILED");
    assert.equal(run.summary.gate, undefined);
    assert.ok(run.summary.reasonCodes.includes("SECRET_REF_UNRESOLVED"));
    const persisted = Buffer.concat(
      await Promise.all((await regularFiles(run.runRoot)).map(async (file) => await readFile(file))),
    ).toString("utf8");
    assert.equal(persisted.includes('"operation":"TARGET_START"'), false);
    assert.equal(persisted.includes('"schema":"dsheval.mvp.gate/v1"'), false);
    assert.ok(run.summary.reportJson !== undefined);
    assert.ok(run.summary.reportHtml !== undefined);
    assert.ok(run.summary.delivery !== undefined);
    const report = await reportDocument(run);
    assert.equal("gateDecisionRef" in report, false);
    assert.equal((report.view as { gate?: string }).gate, undefined);
    assert.equal((report.view as { runState: string }).runState, "FAILED");
    assert.equal(
      (report.view as { failures: Array<{ reasonCode: string }> }).failures.some(
        (failure) => failure.reasonCode === "SECRET_REF_UNRESOLVED",
      ),
      true,
    );
    await readFile(path.join(run.reportRoot, run.summary.runId, "report.html"));
  } finally {
    if (prior === undefined) delete process.env.MODEL_TEST_API_KEY;
    else process.env.MODEL_TEST_API_KEY = prior;
    if (run !== undefined) await removeFixture(run);
  }
});

test("MVP-SEC-SECRET-003: a Probe canary is isolated in one restricted Artifact and makes the Gate UNEVALUABLE", { timeout: 20_000 }, async () => {
  const canary = "fixture-canary-secret-4e18d9";
  const prior = process.env.MODEL_TEST_API_KEY;
  process.env.MODEL_TEST_API_KEY = canary;
  let run: FixtureRun | undefined;
  try {
    run = await executeFixture({
      runId: "fixture-secret-probe-leak",
      behavior: "leak-secret-probe",
      configOverrides: { secretRefNames: ["MODEL_TEST_API_KEY"] },
    });
    assert.equal(run.summary.gate, "UNEVALUABLE");
    assert.equal(run.summary.exitCode, 3);
    assert.ok(run.summary.reasonCodes.includes("SECRET_CANARY_EXPOSED"));

    await assertFilesDoNotContain(await regularFiles(run.runRoot), canary);
    await assertFilesDoNotContain(await regularFiles(run.reportRoot), canary);
    const artifactPartition = path.join(run.artifactRoot, run.summary.runId);
    const indexLines = (await readFile(path.join(artifactPartition, "index.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as {
        artifactId: string;
        portablePath: string;
        sensitivity: string;
        redactionState: string;
      });
    const rawProbe = indexLines.find((entry) => entry.artifactId.startsWith("raw-probe."));
    assert.ok(rawProbe !== undefined);
    assert.equal(rawProbe.sensitivity, "RESTRICTED");
    assert.equal(rawProbe.redactionState, "FAILED");
    const rawProbePath = path.join(artifactPartition, rawProbe.portablePath);
    assert.equal((await readFile(rawProbePath)).includes(Buffer.from(canary)), true);
    await assertFilesDoNotContain(
      (await regularFiles(artifactPartition)).filter((file) => file !== rawProbePath),
      canary,
    );
  } finally {
    if (prior === undefined) delete process.env.MODEL_TEST_API_KEY;
    else process.env.MODEL_TEST_API_KEY = prior;
    if (run !== undefined) await removeFixture(run);
  }
});

test("MVP-SEC-IDENTITY-002 MVP-FI-STATUS-001 failed formal Preflight is NOT_VERIFIED and delivers a gate-less diagnostic report", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "formal-preflight-failure",
    behavior: "unused",
    formalPreflight: true,
  });
  try {
    assert.equal(run.summary.exitCode, 4);
    assert.equal(run.summary.status, "FAILED");
    assert.equal(run.summary.runState, "FAILED");
    assert.equal(run.summary.gate, undefined);
    assert.equal(run.summary.securityIsolation, undefined);
    assert.ok(run.summary.reasonCodes.includes("SECURITY_PREFLIGHT_FAILED"));
    const preflight = await currentRecord(
      run,
      "security-preflight",
      "preflight.formal-preflight-failure",
    );
    assert.equal(preflight.status, "FAILED");
    assert.equal((preflight.failureRefs as unknown[]).length, 1);
    const report = await reportDocument(run);
    assert.equal("gateDecisionRef" in report, false);
    const view = report.view as {
      securityIsolation: string;
      gateAbsenceReason: string;
      timeline: Array<{ number: number; status: string; objectRefs: string[] }>;
    };
    assert.equal(view.securityIsolation, "NOT_VERIFIED");
    assert.equal(view.gateAbsenceReason, "SECURITY_PREFLIGHT_FAILED");
    assert.equal(view.timeline.find((step) => step.number === 4)?.status, "FAILED");
    assert.ok(
      view.timeline.find((step) => step.number === 4)?.objectRefs.some(
        (ref) => ref.includes("dsheval.mvp.security-preflight/v1"),
      ),
    );
    assert.equal(view.timeline.find((step) => step.number === 10)?.status, "BLOCKED");
    const html = await readFile(path.join(run.reportRoot, run.summary.runId, "report.html"), "utf8");
    assert.match(html, /Security isolation<br><strong>NOT_VERIFIED<\/strong>/u);
    assert.match(html, /Reason: SECURITY_PREFLIGHT_FAILED/u);
    const persisted = Buffer.concat(
      await Promise.all((await regularFiles(run.runRoot)).map(async (file) => await readFile(file))),
    ).toString("utf8");
    assert.equal(persisted.includes('"operation":"TARGET_START"'), false);
  } finally {
    await removeFixture(run);
  }
});

test("MVP-FI-STATUS-001 a status replacement failure preserves the prior page and cannot suppress the saved Agent Gate", { timeout: 20_000 }, async () => {
  const runId = "fixture-status-replace-failure";
  let protectedRunPartition: string | undefined;
  const run = await executeFixture({
    runId,
    behavior: "copy",
    hooks: {
      afterReset: async (workspacePath) => {
        const temporaryRoot = path.resolve(workspacePath, "../../../..");
        protectedRunPartition = path.join(temporaryRoot, "records", runId);
        await chmod(protectedRunPartition, 0o500);
      },
    },
  });
  try {
    assert.equal(run.summary.gate, "PASS");
    assert.equal(run.summary.runState, "FINISHED");
    assert.equal(run.summary.operationalHealth, "HEALTHY");
    assert.equal(run.summary.exitCode, 0);
    assert.ok(run.summary.reasonCodes.includes("STATUS_HTML_UPDATE_FAILED"));
    assert.ok(run.summary.failureGroups.includes("infrastructure_error"));
    const gate = await currentRecord(run, "gate", `gate.${runId}`);
    assert.equal(gate.verdict, "PASS");
    const report = await reportDocument(run);
    assert.equal((report.view as { gate: string }).gate, "PASS");
    assert.ok(
      (report.view as { failures: Array<{ reasonCode: string }> }).failures.some(
        (failure) => failure.reasonCode === "STATUS_HTML_UPDATE_FAILED",
      ),
    );
    const retainedStatus = await readFile(
      path.join(run.runRoot, run.summary.runId, "status.html"),
      "utf8",
    );
    assert.match(
      retainedStatus,
      /aria-label="8\. Persist three deterministic CheckResults: SUCCEEDED"/u,
    );
    assert.match(
      retainedStatus,
      /aria-label="9\. Reset \/ independent verification \/ Cleanup: PENDING"/u,
    );
  } finally {
    if (protectedRunPartition !== undefined) {
      await chmod(protectedRunPartition, 0o700).catch(() => undefined);
    }
    await removeFixture(run);
  }
});

test("live status commits TARGET_RUNNING immediately after the child start receipt", { timeout: 20_000 }, async () => {
  let runningStatus = "";
  const run = await executeFixture({
    runId: "fixture-live-target-status",
    behavior: "copy",
    onTargetStartedStatus: (html) => {
      runningStatus = html;
    },
  });
  try {
    assert.match(runningStatus, /Phase<br><strong>TARGET_RUNNING<\/strong>/u);
    assert.match(runningStatus, /Run state<br><strong>RUNNING<\/strong>/u);
    assert.match(
      runningStatus,
      /aria-label="6\. Execute one DSH Headless Attempt: RUNNING"/u,
    );
    assert.doesNotMatch(runningStatus, /Gate<br><strong class="pass">PASS<\/strong>/u);
    assert.equal(run.summary.gate, "PASS");
  } finally {
    await removeFixture(run);
  }
});

test("MVP-FI-CANCEL-001 MVP-FI-CLOSE-001: repeated cancellation drains once, resets, reports and releases the lease", { timeout: 20_000 }, async () => {
  const controller = new AbortController();
  const run = await executeFixture({
    runId: "fixture-cancel-after-start",
    behavior: "timeout",
    signal: controller.signal,
    hooks: {
      onTargetStarted: () => {
        controller.abort();
        controller.abort();
      },
    },
  });
  try {
    assert.equal(run.summary.exitCode, 130);
    assert.equal(run.summary.status, "CANCELLED");
    assert.equal(run.summary.runState, "CANCELLED");
    assert.ok(run.summary.gate === "FAIL" || run.summary.gate === "UNEVALUABLE");
    assert.ok(run.summary.reasonCodes.includes("TARGET_CANCELLED"));
    const attempt = await currentRecord(run, "attempt", "fixture-cancel-after-start.attempt");
    const environment = await currentRecord(run, "environment", "fixture-cancel-after-start.environment");
    assert.equal(attempt.state, "CANCELLED");
    assert.equal(environment.state, "CLEANED");
    const persisted = Buffer.concat(
      await Promise.all((await regularFiles(run.runRoot)).map(async (file) => await readFile(file))),
    ).toString("utf8");
    assert.ok(persisted.includes('"reasonCode":"TARGET_CANCELLED"'));
    assert.ok(persisted.includes('"actor":"USER"'));
    assert.ok(persisted.includes('"schema":"dsheval.mvp.gate/v1"'));
    assert.equal(
      (await regularFiles(path.join(run.runRoot, run.summary.runId, "records", "gate"))).length,
      1,
    );
    const artifactIndex = (await readFile(
      path.join(run.artifactRoot, run.summary.runId, "index.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { artifactId: string });
    assert.equal(new Set(artifactIndex.map((entry) => entry.artifactId)).size, artifactIndex.length);
    const controls = await Promise.all(
      (
        await regularFiles(
          path.join(run.runRoot, run.summary.runId, "records", "control-event"),
        )
      ).map(async (file) => await jsonFile(file)),
    );
    const targetStop = controls.find((event) => event.operation === "TARGET_STOP");
    assert.equal(targetStop?.result, "CANCELLED");
    assert.equal((targetStop?.failureRefs as unknown[] | undefined)?.length, 1);
    assert.ok(Date.parse(String(targetStop?.endedAt)) >= Date.parse(String(targetStop?.startedAt)));
    await readFile(path.join(run.reportRoot, run.summary.runId, "report.json"));
    await readFile(path.join(run.reportRoot, run.summary.runId, "report.html"));
    await assert.rejects(lstat(path.join(run.runRoot, "locks", "active-run.lock")), {
      code: "ENOENT",
    });
  } finally {
    await removeFixture(run);
  }
});

test("MVP-FI-APP-001: a Harness start failure retains Gate evidence but has operational exit 4", { timeout: 20_000 }, async () => {
  const run = await executeFixture({
    runId: "fixture-harness-error",
    behavior: "timeout",
    hooks: {
      onTargetStarted: () => {
        throw new Error("fixture Harness start receipt failure");
      },
    },
  });
  try {
    assert.equal(run.summary.exitCode, 4);
    assert.equal(run.summary.runState, "FAILED");
    assert.equal(run.summary.operationalHealth, "FAILED");
    assert.ok(run.summary.gate === "FAIL" || run.summary.gate === "UNEVALUABLE");
    assert.ok(run.summary.reasonCodes.includes("TARGET_HARNESS_ERROR"));
    const evaluationCase = await currentRecord(
      run,
      "case",
      "fixture-harness-error.case",
    );
    assert.equal(evaluationCase.state, "ERRORED");
    const persisted = Buffer.concat(
      await Promise.all((await regularFiles(run.runRoot)).map(async (file) => await readFile(file))),
    ).toString("utf8");
    assert.ok(persisted.includes('"origin":"DSHEVAL"'));
    assert.ok(persisted.includes('"actor":"RUNTIME"'));
    assert.ok(persisted.includes('"schema":"dsheval.mvp.gate/v1"'));
  } finally {
    await removeFixture(run);
  }
});
