/**
 * 测试职责：验证 report.json 摘要、确定性 HTML 渲染、危险内容转义，以及旧版
 * rendererVersion 的可重建兼容行为。
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { digestBytes, validateStableId } from "../../src/core/models.js";
import {
  buildEvaluationReport,
  buildReportDocument,
  parseVerifiedReportDocument,
  renderReportHtml,
  renderStatusHtml,
  serializeReportDocument,
  type ReportViewModel,
  type WorkflowStepView,
} from "../../src/evaluation/report.js";
import {
  commitReportJson,
  readCommittedReportJson,
} from "../../src/platform/export.js";

const scope = {
  targetId: validateStableId<"TargetId">("target-1"),
  targetSnapshotId: validateStableId<"TargetSnapshotId">("target-snapshot-1"),
  runId: validateStableId<"RunId">("run-1"),
  caseId: validateStableId<"CaseId">("case-1"),
  attemptId: validateStableId<"AttemptId">("attempt-1"),
};

test("MVP-UT-REPORT-001 verified top-level JSON commits and renders byte-identical, escaped HTML without rejudging", async () => {
  const report = buildEvaluationReport({
    reportId: "report.run-1",
    scope,
    runRef: lifecycleRef("dsheval.mvp.run/v1", "run-1", 8),
    targetSnapshotRef: immutableRef("dsheval.mvp.target-snapshot/v1", "target-snapshot-1"),
    planRefs: [immutableRef("dsheval.mvp.evaluation-plan/v1", "plan-1")],
    caseRef: lifecycleRef("dsheval.mvp.case/v1", "case-1", 3),
    attemptRef: lifecycleRef("dsheval.mvp.attempt/v1", "attempt-1", 2),
    sourceRefs: [],
    collectionStatusRefs: [],
    closureRefs: [],
    judgementRefs: [],
    checkResultRefs: [],
    gateDecisionRef: immutableRef("dsheval.mvp.gate/v1", "gate.run-1"),
    failureRefs: [],
    operationalHealth: "DEGRADED",
    artifactRefs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    producerVersion: "test-report/1.0.0",
  });
  const view = maliciousView();
  const document = buildReportDocument(report, view, "renderer/1.0.0");
  const json = serializeReportDocument(document);
  const topLevel = JSON.parse(json) as Record<string, unknown>;
  assert.equal(topLevel.schema, "dsheval.mvp.report/v1");
  assert.equal(typeof topLevel.contentDigest, "object");
  assert.equal(typeof topLevel.view, "object");
  assert.equal("report" in topLevel, false);
  assert.equal("reportJsonDigest" in topLevel, false);
  const parsed = parseVerifiedReportDocument(json);
  const first = renderReportHtml(parsed);
  const second = renderReportHtml(parseVerifiedReportDocument(json));

  assert.equal(first, second);
  assert.equal(parsed.view.gate, "PASS");
  assert.equal(parsed.view.checks[0]?.outcome, "FAIL");
  assert.match(first, /Gate<br><strong class="pass">PASS<\/strong>/);
  assert.match(first, /artifact\.attention-code: <span class="fail">FAIL<\/span>/);
  assert.doesNotMatch(first, /<script/i);
  assert.doesNotMatch(first, /<img/i);
  assert.doesNotMatch(first, /href=["']javascript:/i);
  assert.match(first, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;/);
  assert.match(first, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.equal(renderStatusHtml(view, "renderer/1.0.0"), renderStatusHtml(view, "renderer/1.0.0"));
  const enhanced = renderStatusHtml(view, "dsheval-static/v2");
  assert.match(enhanced, /class="dsheval-v2"/u);
  assert.match(enhanced, /DSHEval <small>Observatory<\/small>/u);
  assert.match(enhanced, /已结算流程步骤/u);
  assert.match(enhanced, /aria-valuenow="10"/u);
  assert.match(enhanced, /Target 冻结/u);
  assert.match(enhanced, /<summary>详情<\/summary>/u);
  assert.match(enhanced, /class="check check-fail"/u);
  assert.doesNotMatch(enhanced, /<script/iu);
  const intuitive = renderStatusHtml(view, "dsheval-static/v3");
  assert.match(intuitive, /class="dsheval-v3"/u);
  assert.match(intuitive, /这次到底测什么/u);
  assert.match(intuitive, /评测结果，一眼看懂/u);
  assert.match(intuitive, /产物交付/u);
  assert.match(intuitive, /技术证据与内部对象/u);
  assert.match(intuitive, /aria-label="1\.[^"]+: SUCCEEDED"/u);
  assert.doesNotMatch(intuitive, /<script/iu);
  assert.doesNotMatch(first, /class="topbar"/u);

  const temporary = await mkdtemp(path.join(os.tmpdir(), "dsheval-report-document-"));
  try {
    await commitReportJson({
      reportRoot: path.join(temporary, "reports"),
      runId: "run-1",
      bytes: json,
      maxBytes: 1_000_000,
    });
    const reread = await readCommittedReportJson({
      reportRoot: path.join(temporary, "reports"),
      runId: "run-1",
      maxBytes: 1_000_000,
    });
    assert.equal(reread.toString("utf8"), json);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("MVP-UT-REPORT-001 tampered or malformed report.json fails validation before HTML", () => {
  const report = buildEvaluationReport({
    reportId: "report.run-1",
    scope,
    runRef: lifecycleRef("dsheval.mvp.run/v1", "run-1", 8),
    targetSnapshotRef: immutableRef("dsheval.mvp.target-snapshot/v1", "target-snapshot-1"),
    planRefs: [],
    caseRef: lifecycleRef("dsheval.mvp.case/v1", "case-1", 3),
    attemptRef: lifecycleRef("dsheval.mvp.attempt/v1", "attempt-1", 2),
    sourceRefs: [],
    collectionStatusRefs: [],
    closureRefs: [],
    judgementRefs: [],
    checkResultRefs: [],
    failureRefs: [],
    operationalHealth: "HEALTHY",
    artifactRefs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    producerVersion: "test-report/1.0.0",
  });
  const json = serializeReportDocument(buildReportDocument(report, maliciousView(), "1.0.0"));
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const view = parsed.view as Record<string, unknown>;
  view.currentPhase = "tampered";
  assert.throws(() => parseVerifiedReportDocument(JSON.stringify(parsed)), /report\.json digest is invalid/);
  assert.throws(
    () =>
      parseVerifiedReportDocument(
        JSON.stringify({
          schema: "dsheval.mvp.report/v1",
          view: { timeline: [] },
          rendererVersion: "1",
          contentDigest: {},
        }),
      ),
    /Report document/,
  );
  assert.throws(
    () => parseVerifiedReportDocument("{not json"),
    /not valid JSON/,
  );
});

function maliciousView(): ReportViewModel {
  return {
    runId: "run-1",
    targetSummary: "<img src=x onerror=alert(1)>",
    fixture: true,
    securityIsolation: "PROCESS_FIXTURE",
    currentPhase: "<script>alert('x')</script>",
    runState: "FINISHED",
    gate: "PASS",
    operationalHealth: "DEGRADED",
    startedAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:10.000Z",
    timeline: timeline(),
    planSummary: {
      caseCount: 1,
      attemptCount: 1,
      checkIds: ["artifact.attention-code"],
    },
    sources: [
      {
        sourceId: "source.file",
        sourceType: "FILESYSTEM",
        trust: "INDEPENDENT",
        completeness: "COMPLETE",
        health: "HEALTHY",
        gaps: ["<img src=x>"],
      },
    ],
    checks: [
      {
        checkResultId: "check-result.artifact.attention-code",
        checkId: "artifact.attention-code",
        judgementId: "judgement.artifact.attention-code",
        closureId: "closure.artifact.attention-code",
        closureState: "CLOSED",
        judgementStatus: "COMPLETED",
        outcome: "FAIL",
        reasonCodes: ["EXPECTED_FILE_CONTENT_MISMATCH"],
        evidenceIds: ["evidence.file-after"],
        findings: [
          {
            code: "EXPECTED_FILE_CONTENT_MISMATCH",
            severity: "ERROR",
            message: "<script>alert('x')</script>",
            evidenceIds: ["evidence.file-after"],
          },
        ],
      },
    ],
    evidence: [
      {
        evidenceId: "evidence.file-after",
        factType: "FILE_AFTER_STATE",
        layer: "NORMALIZED",
        relationship: "DIRECT",
        authority: "ENVIRONMENT_STATE",
        trust: "INDEPENDENT",
        completeness: "COMPLETE",
        validity: "VALID",
        observationIds: ["raw.file.after"],
        artifactIds: ["artifact.file-after"],
      },
    ],
    rawObservations: [
      {
        observationId: "raw.file.after",
        sourceId: "source.file",
        sourceType: "FILESYSTEM",
        trust: "INDEPENDENT",
        externalEventType: "file/snapshot/AFTER",
        rawDigest: "1".repeat(64),
        artifactId: "artifact.file-after",
        snapshotId: "snapshot.after",
        phase: "<script>alert('raw')</script>",
      },
    ],
    fileSnapshots: [
      {
        snapshotId: "snapshot.after",
        phase: "AFTER",
        completeness: "COMPLETE",
        digest: "2".repeat(64),
        entries: [
          {
            portablePath: "<img src=x>",
            entryType: "FILE",
            resolvedWithinRoot: true,
          },
        ],
      },
    ],
    fileDiffs: [
      {
        diffId: "diff.attempt",
        digest: "3".repeat(64),
        changes: [{ portablePath: "javascript:alert(1)", kind: "ADDED" }],
        unchangedCount: 0,
      },
    ],
    reset: {
      result: "MATCH",
      environmentState: "CLEANED",
      differenceSummary: { note: "<img src=x onerror=alert(1)>" },
    },
    failures: [
      {
        category: "REPORT_FAILURE",
        group: "infrastructure_error",
        actor: "REPORTER",
        reasonCode: "DISPLAY_ONLY",
        message: "javascript:alert(1)",
      },
    ],
    artifacts: [
      {
        logicalName: "<img src=x>",
        portablePath: "reports/report.html",
        digest: "0".repeat(64),
      },
    ],
  };
}

function timeline(): readonly WorkflowStepView[] {
  return Array.from({ length: 10 }, (_, index) => ({
    number: (index + 1) as WorkflowStepView["number"],
    label: index === 0 ? "<script>alert('x')</script>" : `Step ${index + 1}`,
    status: "SUCCEEDED" as const,
    objectRefs: [],
    failureGroups: [],
  }));
}

function immutableRef(schema: string, id: string) {
  return {
    schema,
    id: validateStableId(id),
    digest: digestBytes(`${schema}:${id}`),
  };
}

function lifecycleRef(schema: string, id: string, revision: number) {
  return { ...immutableRef(schema, id), revision };
}
