/**
 * 文件职责：把 ReportViewModel 确定性渲染为无脚本、无网络依赖的状态页或最终报告。
 * 交互：report.ts 在完成摘要和对象图校验后调用本文件；本文件只读视图，不参与 Judge 或 Gate。
 * 公开接口：renderReportViewHtml、escapeHtml。
 */
import { canonicalJson, type CheckOutcome } from "../core/models.js";
import type {
  LabelEvaluationView,
  ReportViewModel,
  WorkflowStepStatus,
} from "./report-types.js";

export function renderReportViewHtml(
  title: string,
  view: ReportViewModel,
  finalReport: boolean,
  rendererVersion: string,
): string {
  if (rendererVersion === "dsheval-static/v3") {
    return renderIntuitiveHtml(title, view, finalReport, rendererVersion);
  }
  const e = escapeHtml;
  const enhanced = rendererVersion === "dsheval-static/v2";
  const settledSteps = view.timeline.filter((step) =>
    step.status === "SUCCEEDED" || step.status === "FAILED" || step.status === "BLOCKED"
  ).length;
  /** 兼容旧版布局：仅增强模板为各内容区生成导航锚点。 */
  const sectionId = (id: string): string => enhanced ? ` id="${id}"` : "";
  /** 兼容旧版布局：增强模板使用语义状态胶囊，v1 只输出转义文本。 */
  const semanticPill = (value: string): string => enhanced
    ? `<span class="status-pill ${statusTone(value)}">${e(value)}</span>`
    : e(value);
  const gate = view.gate ?? "尚未产生";
  const gateReason = view.gate === undefined && view.gateAbsenceReason !== undefined
    ? `<br><small>Reason: ${e(view.gateAbsenceReason)}</small>`
    : "";
  const compactStepLabels = [
    "Target 冻结",
    "DSH 检查",
    "生成计划",
    "环境预检",
    "Before / Probe",
    "Agent 执行",
    "Evidence 闭合",
    "评测判定",
    "Reset 验证",
    "Gate / 报告",
  ] as const;
  const timeline = view.timeline
    .map((step) => {
      if (!enhanced) {
        return `<li class="step ${statusClass(step.status)}"><div><strong>${step.number}. ${e(step.label)}</strong> <span>${e(step.status)}</span></div><small>${e(step.startedAt ?? "尚未产生")} → ${e(step.endedAt ?? "尚未产生")}</small>${step.objectRefs.length === 0 ? "" : `<div>Refs: ${step.objectRefs.map(e).join(", ")}</div>`}${step.failureGroups.length === 0 ? "" : `<div>Failure: ${step.failureGroups.map(e).join(", ")}</div>`}${step.hintCode === undefined ? "" : `<div>Hint: ${e(troubleshootingHint(step.hintCode))}</div>`}</li>`;
      }
      const expanded = step.status === "RUNNING" || step.status === "FAILED" || step.status === "BLOCKED";
      return `<li class="step ${statusClass(step.status)}" aria-label="${e(`${step.number}. ${step.label}: ${step.status}`)}"><div class="step-head"><span class="step-number">${String(step.number).padStart(2, "0")}</span><span>${e(step.status)}</span></div><strong class="step-label">${e(compactStepLabels[step.number - 1] ?? step.label)}</strong><details${expanded ? " open" : ""}><summary>详情</summary><div class="step-full-label">${e(step.label)}</div><small>${e(step.startedAt ?? "尚未产生")} → ${e(step.endedAt ?? "尚未产生")}</small>${step.objectRefs.length === 0 ? "" : `<div>Refs: ${step.objectRefs.map(e).join(", ")}</div>`}${step.failureGroups.length === 0 ? "" : `<div>Failure: ${step.failureGroups.map(e).join(", ")}</div>`}${step.hintCode === undefined ? "" : `<div>Hint: ${e(troubleshootingHint(step.hintCode))}</div>`}</details></li>`;
    })
    .join("");
  const sources = view.sources
    .map(
      (source) => `<tr><td>${e(source.sourceId)}</td><td>${e(source.sourceType)}</td><td>${semanticPill(source.trust)}</td><td>${semanticPill(source.completeness)}</td><td>${semanticPill(source.health)}</td><td>${source.gaps.map(e).join(", ") || "—"}</td></tr>`,
    )
    .join("");
  const checks = view.checks
    .map((check) => {
      const findings = check.findings
        .map(
          (finding) => `<li><strong>${e(finding.code)}</strong> (${e(finding.severity)}): ${e(finding.message)}<div>Evidence: ${finding.evidenceIds.map((id) => `<a href="#evidence-${safeAnchor(id)}">${e(id)}</a>`).join(", ") || "—"}</div></li>`,
        )
        .join("");
      const evidence = check.evidenceIds
        .map(
          (id) => `<li><a href="#evidence-${safeAnchor(id)}"><code>${e(id)}</code></a></li>`,
        )
        .join("");
      const checkClass = enhanced ? ` check-${outcomeClass(check.outcome) || "pending"}` : "";
      return `<section class="check${checkClass}" id="check-${safeAnchor(check.checkResultId)}"><h3>${e(check.checkId)}: <span class="${outcomeClass(check.outcome)}">${e(check.outcome)}</span></h3><dl><dt>CheckResult</dt><dd><code>${e(check.checkResultId)}</code></dd><dt>Closure</dt><dd id="closure-${safeAnchor(check.closureId)}"><code>${e(check.closureId)}</code> · ${e(check.closureState)}</dd><dt>Judgement</dt><dd id="judgement-${safeAnchor(check.judgementId)}"><code>${e(check.judgementId)}</code> · ${e(check.judgementStatus)}</dd><dt>Reasons</dt><dd>${check.reasonCodes.map(e).join(", ") || "—"}</dd></dl><h4>Findings</h4><ul>${findings || "<li>None</li>"}</ul><h4>Authorized evidence</h4><ul>${evidence || "<li>None</li>"}</ul></section>`;
    })
    .join("");
  const evidenceDetails = view.evidence
    .map((item) => `<article class="drill" id="evidence-${safeAnchor(item.evidenceId)}"><h3>${e(item.evidenceId)}</h3><p><strong>${e(item.layer)}</strong> · ${e(item.factType)} · relation=${e(item.relationship)} · authority=${e(item.authority)} · trust=${e(item.trust)} · ${e(item.completeness)}/${e(item.validity)}</p>${item.derivationRuleId === undefined ? "" : `<p>Derivation: <code>${e(item.derivationRuleId)}</code></p>`}<p>Raw observations: ${item.observationIds.map((id) => `<a href="#raw-${safeAnchor(id)}">${e(id)}</a>`).join(", ") || "—"}</p><p>Artifacts: ${item.artifactIds.map((id) => `<code>${e(id)}</code>`).join(", ") || "—"}</p></article>`)
    .join("");
  const rawDetails = view.rawObservations
    .map((item) => {
      const probeLocation = item.lineNumber === undefined
        ? ""
        : ` · JSONL line ${e(item.lineNumber)} bytes ${e(item.byteStart ?? "?")}..${e(item.byteEnd ?? "?")}`;
      const snapshot = item.snapshotId === undefined
        ? ""
        : ` · Snapshot <a href="#snapshot-${safeAnchor(item.snapshotId)}">${e(item.snapshotId)}</a>${item.phase === undefined ? "" : ` (${e(item.phase)})`}`;
      return `<li id="raw-${safeAnchor(item.observationId)}"><code>${e(item.observationId)}</code> · ${e(item.sourceType)}/${e(item.trust)} · ${e(item.externalEventType)}${probeLocation}${snapshot}${item.artifactId === undefined ? "" : ` · Artifact <code>${e(item.artifactId)}</code>`}<br><small>raw sha256 ${e(item.rawDigest)}${item.association === undefined ? "" : ` · ${e(item.association)}`}</small></li>`;
    })
    .join("");
  const snapshotDetails = view.fileSnapshots
    .map((snapshot) => {
      const entries = snapshot.entries
        .map((entry) => `<tr><td>${e(entry.portablePath)}</td><td>${e(entry.entryType)}</td><td>${e(entry.contentDigest ?? "—")}</td><td>${e(entry.linkTarget ?? "—")}</td><td>${e(entry.resolvedWithinRoot)}</td><td>${e(entry.readError ?? "—")}</td></tr>`)
        .join("");
      return `<article class="drill" id="snapshot-${safeAnchor(snapshot.snapshotId)}"><h3>${e(snapshot.snapshotId)} · ${e(snapshot.phase)} · ${e(snapshot.completeness)}</h3><p>snapshot sha256 <code>${e(snapshot.digest)}</code></p><table><thead><tr><th>Portable path</th><th>Type</th><th>Content digest</th><th>Link target</th><th>Within root</th><th>Read error</th></tr></thead><tbody>${entries || '<tr><td colspan="6">Empty snapshot</td></tr>'}</tbody></table></article>`;
    })
    .join("");
  const diffDetails = view.fileDiffs
    .map((diff) => `<article class="drill"><h3>${e(diff.diffId)}</h3><p>diff sha256 <code>${e(diff.digest)}</code> · unchanged ${e(diff.unchangedCount)}</p><ul>${diff.changes.map((change) => `<li>${e(change.kind)} · ${e(change.portablePath)}</li>`).join("") || "<li>No changes</li>"}</ul></article>`)
    .join("");
  const failures = view.failures
    .map(
      (failure) => `<tr><td>${e(failure.group)}</td><td>${e(failure.category)}</td><td>${e(failure.actor)}</td><td>${e(failure.reasonCode)}</td><td>${e(failure.message)}</td></tr>`,
    )
    .join("");
  const artifacts = view.artifacts
    .map(
      (artifact) => `<li><strong>${e(artifact.logicalName)}</strong>: ${e(artifact.portablePath)} <code>${e(artifact.digest)}</code></li>`,
    )
    .join("");
  const resetDetails =
    view.reset.differenceSummary === undefined
      ? ""
      : `<pre>${e(canonicalJson(view.reset.differenceSummary))}</pre>`;

  const enhancedChrome = enhanced
    ? `<div class="topbar"><div class="brand"><span class="brand-mark">D</span><span>DSHEval <small>Observatory</small></span></div><nav aria-label="页面导航"><a href="#workflow">流程</a><a href="#execution">观测</a><a href="#judging">判定</a><a href="#evidence">证据</a><a href="#failures">故障</a></nav><span class="view-kind">${finalReport ? "SEALED REPORT" : "STATUS SNAPSHOT"}</span></div>`
    : "";
  const progress = enhanced
    ? `<div class="progress-block"><div><span>已结算流程步骤</span><strong>${settledSteps} / 10</strong></div><div class="progress-track" role="progressbar" aria-label="Workflow progress" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${settledSteps}"><span style="width:${settledSteps * 10}%"></span></div></div>`
    : "";
  const operationalStrip = enhanced
    ? `<section class="operational-strip" aria-label="Operational summary"><div><small>Reset verification</small>${semanticPill(view.reset.result)}</div><div><small>Environment</small>${semanticPill(view.reset.environmentState)}</div><div><small>Sources observed</small><strong>${view.sources.length}</strong></div><div><small>Recorded failures</small><strong class="${view.failures.length === 0 ? "pass" : "fail"}">${view.failures.length}</strong></div></section>`
    : "";
  const failureAlert = enhanced && view.failures.length > 0
    ? `<aside class="failure-alert"><div><strong>${view.failures.length} recorded failure${view.failures.length === 1 ? "" : "s"}</strong><span>Agent、Collector、Judge 与 Infrastructure 归因保持独立。</span></div><a href="#failures">查看故障事实 ↓</a></aside>`
    : "";
  const summary = enhanced
    ? `<div>Phase<br><strong>${e(view.currentPhase)}</strong></div><div>Run state<br><strong>${e(view.runState)}</strong></div><div>Gate<br><strong class="${outcomeClass(gate)}">${e(gate)}</strong>${gateReason}</div><div>Health<br><strong>${e(view.operationalHealth)}</strong></div><div>Run<br><strong>${e(view.runId)}</strong></div><div>Target<br><strong>${e(view.targetSummary)}</strong></div><div>Execution class<br><strong>${view.fixture ? "FIXTURE" : "FORMAL"}</strong></div><div>Security isolation<br><strong>${e(view.securityIsolation)}</strong></div>`
    : `<div>Run<br><strong>${e(view.runId)}</strong></div><div>Target<br><strong>${e(view.targetSummary)}</strong></div><div>Execution class<br><strong>${view.fixture ? "FIXTURE" : "FORMAL"}</strong></div><div>Security isolation<br><strong>${e(view.securityIsolation)}</strong></div><div>Phase<br><strong>${e(view.currentPhase)}</strong></div><div>Run state<br><strong>${e(view.runState)}</strong></div><div>Gate<br><strong class="${outcomeClass(gate)}">${e(gate)}</strong>${gateReason}</div><div>Health<br><strong>${e(view.operationalHealth)}</strong></div>`;

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
${rendererStyles(rendererVersion)}</style></head><body${enhanced ? ' class="dsheval-v2"' : ""}>${enhancedChrome === "" ? "" : `\n${enhancedChrome}`}
<header><h1>${e(title)}</h1><div class="summary">${summary}</div>${view.fixture ? `<p class="${enhanced ? "fixture-notice" : "unevaluable"}"><strong>Fixture result:</strong> this Gate does not establish formal VM identity or network isolation.</p>` : ""}<p>${e(view.startedAt)} → ${e(view.updatedAt)}</p></header>
${progress}${operationalStrip}${failureAlert}<section${sectionId("workflow")} class="panel"><h2>十步流程</h2><ol class="timeline">${timeline}</ol></section>
<section${sectionId("planning")} class="panel"><h2>规划</h2><p>Cases: 1 · Attempts: 1 · Checks: ${view.planSummary.checkIds.map(e).join(", ")}</p></section>
<section${sectionId("execution")} class="panel"><h2>执行与环境</h2><table><thead><tr><th>Source</th><th>Type</th><th>Trust</th><th>Completeness</th><th>Health</th><th>Gaps</th></tr></thead><tbody>${sources}</tbody></table><h3>Reset</h3><p>${semanticPill(view.reset.result)} / ${semanticPill(view.reset.environmentState)}</p>${resetDetails}</section>
<section${sectionId("judging")} class="panel"><h2>判定</h2>${checks || "<p>尚未产生 CheckResult</p>"}</section>
<section${sectionId("evidence")} class="panel"><h2>证据下钻</h2><h3>EvidenceRecord</h3>${evidenceDetails || "<p>尚未产生 Evidence</p>"}<h3>RawObservation 定位</h3><ul>${rawDetails || "<li>尚未产生 RawObservation</li>"}</ul><h3>File Snapshot Entries</h3>${snapshotDetails || "<p>尚未产生 File Snapshot</p>"}<h3>File Diff</h3>${diffDetails || "<p>尚未产生 File Diff</p>"}</section>
<section${sectionId("failures")} class="panel"><h2>Failures</h2><table><thead><tr><th>Group</th><th>Category</th><th>Actor</th><th>Reason</th><th>Message</th></tr></thead><tbody>${failures || '<tr><td colspan="5">None</td></tr>'}</tbody></table></section>
<section class="panel"><h2>Artifacts</h2><ul>${artifacts || "<li>None</li>"}</ul></section>
<footer><small>${finalReport ? "Authoritative report view" : "Non-authoritative status view"} · Renderer ${e(rendererVersion)} · No scripts or network dependencies</small></footer>
</body></html>\n`;
}

/** v3 页面为当前内置检查提供标题和问题文本，判定仍只来自 CheckResult。 */
interface FriendlyCheckCopy {
  readonly title: string;
  readonly question: string;
  readonly success: string;
  readonly pending: string;
}

/** 将已知 CheckId 映射为直观标题/问题/结果文案，未知检查回退为通用表述。 */
function friendlyCheckCopy(checkId: string): FriendlyCheckCopy {
  if (checkId.startsWith("artifact.")) {
    return {
      title: "产物交付",
      question: "是否交付了 Dataset 要求的产物？",
      success: "独立环境观测确认必需产物已经生成。",
      pending: "正在观察工作区中的必需产物。",
    };
  }
  if (checkId.startsWith("tool.")) {
    return {
      title: "工具执行",
      question: "Agent 是否实际完成了要求的工具调用？",
      success: "Trace 中存在符合 Dataset 规则的完整工具调用。",
      pending: "正在等待工具调用与完成记录。",
    };
  }
  if (checkId.startsWith("response.")) {
    return {
      title: "最终回答",
      question: "最终回答是否满足 Dataset 的基本要求？",
      success: "Agent 已提交符合规则的最终回答。",
      pending: "正在等待 Agent 的最终回答。",
    };
  }
  return {
    title: checkId,
    question: "该评分项满足要求吗？",
    success: "评分标准已满足。",
    pending: "尚未产生判定结果。",
  };
}

/** 将单检查三值结果转换为中文展示文本。 */
function friendlyOutcome(outcome: CheckOutcome | undefined): string {
  if (outcome === "PASS") return "通过";
  if (outcome === "FAIL") return "不通过";
  if (outcome === "UNEVALUABLE") return "证据不足";
  return "等待判定";
}

/** 将 Gate 三值结论转换为报告主标题。 */
function friendlyGate(gate: CheckOutcome | undefined): string {
  if (gate === "PASS") return "评测通过";
  if (gate === "FAIL") return "评测未通过";
  if (gate === "UNEVALUABLE") return "暂时无法判定";
  return "评测进行中";
}

/** 将工作流步骤状态转换为中文展示文本。 */
function friendlyStepStatus(status: WorkflowStepStatus): string {
  if (status === "SUCCEEDED") return "完成";
  if (status === "RUNNING") return "进行中";
  if (status === "FAILED") return "失败";
  if (status === "BLOCKED") return "已阻断";
  return "等待";
}

/** 将文件变化枚举转换为中文展示文本。 */
function friendlyChange(kind: string): string {
  if (kind === "ADDED") return "新增";
  if (kind === "REMOVED") return "删除";
  if (kind === "MODIFIED") return "修改";
  if (kind === "TYPE_CHANGED") return "类型变化";
  return kind;
}

/** 为已知 SourceType 提供用户可理解的标题和来源说明。 */
function friendlySource(type: string): { title: string; detail: string } {
  if (type === "FILESYSTEM") {
    return { title: "文件结果", detail: "由 DSHEval 独立读取执行前后的真实文件状态。" };
  }
  if (type === "DSH_PROBE") {
    return { title: "执行过程", detail: "由 DSH Runtime Probe 记录会话、工具调用和结束边界。" };
  }
  return { title: type, detail: "评测过程中采集的证据来源。" };
}

/** 将常见证据、来源及重置状态转换为中文展示文本。 */
function friendlyEvidenceState(value: string): string {
  if (value === "COMPLETE") return "完整";
  if (value === "PARTIAL") return "部分";
  if (value === "INVALID") return "无效";
  if (value === "HEALTHY") return "正常";
  if (value === "DEGRADED") return "降级";
  if (value === "MATCH") return "与干净状态一致";
  if (value === "CLEANED") return "环境已清理";
  return value;
}

/** 把 Metric 要求的事实类型归纳成用户可理解的打分输入。 */

/** 把证据输入模式显示成标签卡片上的中文方法名。 */
function friendlyEvaluationMode(mode: LabelEvaluationView["evaluationMode"]): string {
  if (mode === "TRACE") return "执行轨迹评分";
  if (mode === "OUTPUT_STATE") return "结果 / 产物评分";
  if (mode === "MIXED") return "轨迹 + 结果联合评分";
  return "输入 / 输出评分";
}

/** renderHtml 为 v3 调用的审计报告模板，直接展示输入、输出、Trace 和判定事实。 */
function renderIntuitiveHtml(
  title: string,
  view: ReportViewModel,
  finalReport: boolean,
  rendererVersion: string,
): string {
  const e = escapeHtml;
  const gateTone = outcomeClass(view.gate ?? "") || "pending";
  const profile = view.staticProfile;
  const planChecks = view.planSummary.checkIds.length > 0
    ? view.planSummary.checkIds
    : view.checks.map((check) => check.checkId);
  const checksById = new Map(view.checks.map((check) => [check.checkId, check] as const));
  const labelsByCheck = new Map((view.labelEvaluations ?? []).map((item) => [item.checkId, item] as const));
  const decisionEvidence = new Map(view.decisionEvidence.map((item) => [item.evidenceId, item] as const));
  const labelTitles = new Map([
    ["label.artifact-delivery/v1", "产物交付"],
    ["label.tool-code/v1", "工具（代码与终端）"],
  ]);
  const execution = view.execution;
  const planner = view.plannerMatch;
  const elapsed = execution?.durationMs === undefined ? "—" : `${execution.durationMs} ms`;
  const outputNotice = (capture?: boolean, report?: boolean): string =>
    capture === true ? "采集达到字节上限，Artifact 也被截断" : report === true ? "页面仅显示前 256 KiB，Artifact 保存完整采集值" : "完整显示";
  const task = execution?.task ?? "尚未进入 Target 执行阶段。";
  const stdout = execution?.stdout ?? "尚未产生 stdout。";
  const stderr = execution?.stderr === "" ? "（空）" : execution?.stderr ?? "尚未产生 stderr。";

  const labels = (planner?.evaluationLabelIds ?? planner?.selectedLabelIds ?? view.planSummary.labelIds ?? []).map((labelId) =>
    `<tr><td>${e(labelTitles.get(labelId) ?? labelId)}</td><td><code>${e(labelId)}</code></td><td>所选 Dataset 的既有标签</td></tr>`
  ).join("");
  const checks = planChecks.map((checkId) => {
    const check = checksById.get(checkId);
    const binding = labelsByCheck.get(checkId);
    const copy = friendlyCheckCopy(checkId);
    const evidenceBlocks = (check?.evidenceIds ?? []).map((evidenceId) => {
      const fact = decisionEvidence.get(evidenceId);
      if (fact === undefined) return `<li><code>${e(evidenceId)}</code>（记录尚未进入报告视图）</li>`;
      return `<li><details><summary><code>${e(fact.evidenceId)}</code> · ${e(fact.factType)} · ${e(fact.authority)}/${e(fact.trust)} · ${e(fact.completeness)}/${e(fact.validity)}</summary><pre>${e(canonicalJson(fact.factValue))}</pre><p>RawObservation: ${fact.observationIds.map((id) => `<code>${e(id)}</code>`).join(", ") || "—"}</p><p>Artifact: ${fact.artifactIds.map((id) => `<code>${e(id)}</code>`).join(", ") || "—"}</p></details></li>`;
    }).join("");
    const findings = check?.findings.map((item) => `${item.code}: ${item.message}`).join(" | ") || "—";
    return `<article class="judge-record ${outcomeClass(check?.outcome ?? "") || "pending"}" id="check-${safeAnchor(checkId)}">
      <header><div><small>${e(binding === undefined ? "未绑定标签" : labelTitles.get(binding.labelId) ?? binding.labelId)}</small><h3>${e(checkId)}</h3><p>${e(copy.question)}</p></div><strong>${e(friendlyOutcome(check?.outcome))}</strong></header>
      <table><tbody>
        <tr><th>Label</th><td><code>${e(binding?.labelId ?? "—")}</code></td><th>评分方法</th><td>${e(binding === undefined ? "—" : friendlyEvaluationMode(binding.evaluationMode))}</td></tr>
        <tr><th>Metric</th><td><code>${e(binding?.metricId ?? "—")}</code></td><th>Judge</th><td><code>${e(binding?.judgeId ?? "—")}</code></td></tr>
        <tr><th>要求的事实</th><td>${e(binding?.requiredEvidenceTypes.join(" + ") || "—")}</td><th>硬门禁</th><td>${e(binding?.hardGate ?? false)}</td></tr>
        <tr><th>Reason codes</th><td>${e(check?.reasonCodes.join(", ") || "—")}</td><th>Finding</th><td>${e(findings)}</td></tr>
        <tr><th>Closure</th><td><code>${e(check?.closureId ?? "—")}</code> · ${e(check?.closureState ?? "—")}</td><th>Judgement</th><td><code>${e(check?.judgementId ?? "—")}</code> · ${e(check?.judgementStatus ?? "—")}</td></tr>
      </tbody></table>
      <details class="evidence-list"><summary>Judge 实际获准使用的证据（${e(check?.evidenceIds.length ?? 0)}）</summary><ul>${evidenceBlocks || "<li>无</li>"}</ul></details>
    </article>`;
  }).join("");
  const tools = view.trace.toolCalls.map((call) => `<tr><td>${e(call.at)}</td><td><code>${e(call.callId)}</code></td><td>${e(call.toolName)}</td><td><code>${e(call.argumentsCaptured)}</code></td><td>${call.completed ? "COMPLETED" : "NO_RESULT"}</td></tr>`).join("");
  const eventCounts = view.trace.eventTypeCounts.map((item) => `<tr><td><code>${e(item.eventType)}</code></td><td>${e(item.count)}</td></tr>`).join("");
  const snapshots = view.fileSnapshots.map((snapshot) => {
    const rows = snapshot.entries.map((entry) => `<tr><td><code>${e(entry.portablePath)}</code></td><td>${e(entry.entryType)}</td><td>${e(entry.byteLength ?? "—")}</td><td><code>${e(entry.contentDigest ?? "—")}</code></td><td>${e(entry.mode.toString(8))}</td><td>${e(entry.resolvedWithinRoot)}</td><td>${e(entry.readError ?? "—")}</td></tr>`).join("");
    return `<details class="snapshot"><summary>${e(snapshot.phase)} · ${e(snapshot.completeness)} · <code>${e(snapshot.snapshotId)}</code></summary><p>snapshot sha256 <code>${e(snapshot.digest)}</code></p><table><thead><tr><th>路径</th><th>类型</th><th>字节</th><th>内容 SHA-256</th><th>mode</th><th>根内</th><th>读取错误</th></tr></thead><tbody>${rows || '<tr><td colspan="7">空快照</td></tr>'}</tbody></table></details>`;
  }).join("");
  const diffs = view.fileDiffs.flatMap((diff) => diff.changes.map((change) => `<tr><td><code>${e(diff.diffId)}</code></td><td>${e(friendlyChange(change.kind))}</td><td><code>${e(change.portablePath)}</code></td><td><code>${e(diff.digest)}</code></td></tr>`)).join("");
  const artifacts = view.artifacts.map((artifact) => `<tr><td><code>${e(artifact.artifactId)}</code></td><td>${e(artifact.logicalName)}</td><td>${e(artifact.artifactType)}</td><td>${e(artifact.byteLength)}</td><td><code>${e(artifact.portablePath)}</code></td><td><code>${e(artifact.digest)}</code></td></tr>`).join("");
  const sources = view.sources.map((source) => {
    const copy = friendlySource(source.sourceType);
    return `<tr><td><code>${e(source.sourceId)}</code></td><td>${e(copy.title)}</td><td>${e(source.trust)}</td><td>${e(friendlyEvidenceState(source.completeness))}</td><td>${e(friendlyEvidenceState(source.health))}</td><td>${e(source.gaps.join(", ") || "—")}</td></tr>`;
  }).join("");
  const timeline = view.timeline.map((step) => `<tr class="${statusClass(step.status)}"><td>${step.number}</td><td>${e(step.label)}</td><td>${e(friendlyStepStatus(step.status))}</td><td>${e(step.startedAt ?? "—")}</td><td>${e(step.endedAt ?? "—")}</td><td>${e(step.failureGroups.join(", ") || "—")}</td></tr>`).join("");
  const failures = view.failures.map((failure) => `<tr><td>${e(failure.group)}</td><td>${e(failure.actor)}</td><td><code>${e(failure.reasonCode)}</code></td><td>${e(failure.message)}</td></tr>`).join("");
  const reset = view.reset.differenceSummary === undefined ? "尚未产生" : canonicalJson(view.reset.differenceSummary);
  const fixture = view.fixture ? `<div class="warning"><strong>FIXTURE</strong>：这不是正式 VM 隔离结果。</div>` : "";

  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>${INTUITIVE_RENDERER_CSS}</style></head><body class="dsheval-v3">
<header class="topbar"><strong>DSHEval / 原始评测记录</strong><nav><a href="#input">输入与计划</a><a href="#output">Agent 输出</a><a href="#trace">Trace</a><a href="#judges">标签判定</a><a href="#files">文件环境</a><a href="#audit">审计索引</a></nav><span>${finalReport ? "SEALED" : "LIVE"}</span></header>
<main id="top">
  ${fixture}
  <section class="run-summary"><div><small>Gate</small><strong class="${gateTone}">${e(friendlyGate(view.gate))}</strong></div><dl><dt>Run</dt><dd><code>${e(view.runId)}</code></dd><dt>Target</dt><dd>${e(view.targetSummary)}</dd><dt>State / Phase</dt><dd>${e(view.runState)} / ${e(view.currentPhase)}</dd><dt>Health</dt><dd>${e(view.operationalHealth)}</dd><dt>Isolation</dt><dd>${e(view.securityIsolation)}</dd><dt>Checks</dt><dd>${view.checks.filter((item) => item.outcome === "PASS").length} / ${planChecks.length} PASS</dd><dt>Started / Updated</dt><dd>${e(view.startedAt)} / ${e(view.updatedAt)}</dd><dt>Gate reason</dt><dd>${e(view.gateAbsenceReason ?? "—")}</dd></dl></section>

  <section id="input"><h2>1. 输入与 Planner 的真实记录</h2><div class="split"><div><h3>Agent 收到的任务原文</h3><pre>${e(task)}</pre></div><div><h3>静态检查</h3><table><tbody><tr><th>DSH version</th><td>${e(profile?.dshVersion ?? "—")}</td></tr><tr><th>Probe</th><td>${e(profile?.probeStatus ?? "—")}</td></tr><tr><th>Driver</th><td>${e(profile?.driverStatus ?? "—")}</td></tr><tr><th>Tools</th><td>${e(profile?.toolNames.join(", ") || "—")}</td></tr><tr><th>Permission</th><td>${e(profile?.permissionPreset ?? "—")}</td></tr><tr><th>Sandbox</th><td>${e(profile?.sandboxMode ?? "—")}</td></tr><tr><th>Limitations</th><td>${e(profile?.limitationCount ?? 0)}</td></tr></tbody></table></div></div>
    <h3>标签来源</h3><table><thead><tr><th>标签</th><th>ID</th><th>来源</th></tr></thead><tbody>${labels || '<tr><td colspan="3">尚未产生</td></tr>'}</tbody></table>
    <h3>Planner 输出</h3><table><tbody><tr><th>evaluationLabelIds</th><td><code>${e(planner?.evaluationLabelIds?.join(", ") || "—")}</code></td></tr><tr><th>requestedLabelIds</th><td><code>${e(planner?.requestedLabelIds.join(", ") || "—")}</code></td></tr><tr><th>selectedLabelIds</th><td><code>${e(planner?.selectedLabelIds.join(", ") || "—")}</code></td></tr><tr><th>selectedDatasetIds</th><td><code>${e(planner?.selectedDatasetIds.join(", ") || "—")}</code></td></tr><tr><th>scenarioId</th><td><code>${e(planner?.scenarioId ?? "—")}</code></td></tr><tr><th>environmentId</th><td><code>${e(planner?.environmentId ?? "—")}</code></td></tr><tr><th>selectionRule</th><td><code>${e(planner?.selectionRule ?? "—")}</code></td></tr><tr><th>deadline</th><td>${e(view.planSummary.deadlineMs ?? "—")} ms</td></tr><tr><th>allowed / forbidden</th><td><code>${e(view.planSummary.allowedPaths?.join(", ") || "—")}</code> / <code>${e(view.planSummary.forbiddenPaths?.join(", ") || "—")}</code></td></tr></tbody></table>
  </section>

  <section id="output"><h2>2. Agent 的真实进程结果</h2><table><tbody><tr><th>terminationKind</th><td>${e(execution?.terminationKind ?? "—")}</td><th>exitCode / signal</th><td>${e(execution?.exitCode ?? "—")} / ${e(execution?.signal ?? "—")}</td></tr><tr><th>pid</th><td>${e(execution?.pid ?? "—")}</td><th>duration</th><td>${e(elapsed)}</td></tr><tr><th>startedAt</th><td>${e(execution?.startedAt ?? "—")}</td><th>endedAt</th><td>${e(execution?.endedAt ?? "—")}</td></tr><tr><th>DSH Web Session</th><td colspan="3"><code>${e(execution?.dshSessionIds?.join(", ") || "—")}</code></td></tr></tbody></table>
    <h3>stdout <small>${e(execution?.stdoutCapturedBytes ?? 0)} bytes · ${e(outputNotice(execution?.stdoutCaptureTruncated, execution?.stdoutReportTruncated))} · Artifact <code>${e(execution?.stdoutArtifactId ?? "—")}</code></small></h3><pre class="raw-output">${e(stdout)}</pre>
    <h3>stderr <small>${e(execution?.stderrCapturedBytes ?? 0)} bytes · ${e(outputNotice(execution?.stderrCaptureTruncated, execution?.stderrReportTruncated))} · Artifact <code>${e(execution?.stderrArtifactId ?? "—")}</code></small></h3><pre class="raw-output">${e(stderr)}</pre>
  </section>

  <section id="trace"><h2>3. Trace 中实际观察到的数据</h2><div class="facts"><span>事件 <strong>${e(view.trace.eventCount)}</strong></span><span>工具调用 <strong>${e(view.trace.toolCalls.length)}</strong></span><span>Session <strong>${e(view.trace.sessionIds.length)}</strong></span><span>Model <strong>${e(view.trace.model ?? "—")}</strong></span><span>Provider <strong>${e(view.trace.provider ?? "—")}</strong></span></div>
    <h3>Token usage</h3><table><tbody><tr><th>input</th><td>${e(view.trace.usage.inputTokens)}</td><th>output</th><td>${e(view.trace.usage.outputTokens)}</td><th>reasoning</th><td>${e(view.trace.usage.reasoningTokens)}</td><th>cache read</th><td>${e(view.trace.usage.cacheReadTokens)}</td></tr></tbody></table>
    <h3>工具调用</h3><p class="note">Probe 当前对工具参数保存 SHA-256 与字符数，而不是明文命令；下表按实际采集值展示。</p><table><thead><tr><th>时间</th><th>callId</th><th>工具</th><th>采集到的参数</th><th>结果事件</th></tr></thead><tbody>${tools || '<tr><td colspan="5">未观察到工具调用</td></tr>'}</tbody></table>
    <details><summary>全部事件类型计数</summary><table><thead><tr><th>event type</th><th>count</th></tr></thead><tbody>${eventCounts || '<tr><td colspan="2">尚未形成 PROTOCOL_LIFECYCLE</td></tr>'}</tbody></table></details>
  </section>

  <section id="judges"><h2>4. 每个标签的真实判定链</h2>${checks || "<p>尚未形成 CheckResult。</p>"}</section>

  <section id="files"><h2>5. 文件环境真实数据</h2><div class="warning"><strong>数据保留边界：</strong>当前 CONTENT_MODE=DIGEST。代码文件内容未复制到报告；报告只持有路径、字节数和 SHA-256。若页面没有源码，不代表前端隐藏，而是运行时没有保留源码 Artifact。</div>
    <h3>Before / After / Post-reset 快照</h3>${snapshots || "<p>尚未产生文件快照。</p>"}
    <h3>执行前后差异</h3><table><thead><tr><th>diffId</th><th>变化</th><th>路径</th><th>diff SHA-256</th></tr></thead><tbody>${diffs || '<tr><td colspan="4">无变化或尚未产生</td></tr>'}</tbody></table>
    <h3>Reset 独立验证</h3><table><tbody><tr><th>Result</th><td>${e(view.reset.result)}</td><th>Environment</th><td>${e(view.reset.environmentState)}</td></tr></tbody></table><pre>${e(reset)}</pre>
  </section>

  <section id="audit"><h2>6. 审计索引</h2><div class="facts"><span>RawObservation <strong>${e(view.rawObservations.length)}</strong></span><span>EvidenceRecord <strong>${e(view.evidence.length)}</strong></span><span>Judge 授权证据 <strong>${e(view.decisionEvidence.length)}</strong></span><span>Exportable Artifact <strong>${e(view.artifacts.length)}</strong></span></div>
    <h3>观测来源</h3><table><thead><tr><th>sourceId</th><th>类型</th><th>信任</th><th>完整性</th><th>健康</th><th>缺口</th></tr></thead><tbody>${sources || '<tr><td colspan="6">尚未产生</td></tr>'}</tbody></table>
    <h3>可导出 Artifact</h3><table><thead><tr><th>artifactId</th><th>名称</th><th>类型</th><th>字节</th><th>路径</th><th>内容 SHA-256</th></tr></thead><tbody>${artifacts || '<tr><td colspan="6">无</td></tr>'}</tbody></table>
    <h3>流程提交记录</h3><table><thead><tr><th>#</th><th>步骤</th><th>状态</th><th>开始</th><th>结束</th><th>故障组</th></tr></thead><tbody>${timeline}</tbody></table>
    <h3>故障记录（${e(view.failures.length)}）</h3><table><thead><tr><th>分组</th><th>Actor</th><th>Reason</th><th>消息</th></tr></thead><tbody>${failures || '<tr><td colspan="4">无故障记录</td></tr>'}</tbody></table>
  </section>
</main><footer>${finalReport ? "权威终态报告" : "非权威实时状态"} · <code>${e(view.runId)}</code> · Renderer ${e(rendererVersion)}</footer></body></html>\n`;
}


/** 序列化、解析和最终渲染前共同调用，严格验证字段白名单、身份关系与顶层摘要。 */


/** v3 审计报告模板的内联样式，不引入网络资源或脚本。 */
const INTUITIVE_RENDERER_CSS = `
:root {
  color-scheme: light;
  font-family: ui-sans-serif, system-ui, sans-serif;
  --line: #d5dae2;
  --muted: #687180;
  --good: #11633f;
  --bad: #a61e35;
  --warn: #875000;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body.dsheval-v3 { margin: 0; background: #f3f4f6; color: #16181d; font: 14px/1.5 ui-sans-serif, system-ui, sans-serif; }
.topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 24px; min-height: 50px; padding: 8px 20px; border-bottom: 1px solid #cfd4dc; background: #fff; }
.topbar > strong { white-space: nowrap; }
.topbar nav { display: flex; flex: 1; gap: 2px; overflow-x: auto; }
.topbar nav a { padding: 5px 8px; border-radius: 2px; color: #3f4754; font-size: 12px; text-decoration: none; white-space: nowrap; }
.topbar nav a:hover { background: #edf0f4; }
.topbar > span { padding: 2px 7px; border: 1px solid #aab2bf; color: #313844; font: 700 11px/1.4 ui-monospace, monospace; }
main { width: min(1480px, calc(100% - 28px)); margin: 14px auto 40px; }
section { margin: 12px 0; padding: 20px; overflow: hidden; scroll-margin-top: 62px; border: 1px solid var(--line); background: #fff; }
section h2 { margin: 0 0 16px; padding-bottom: 10px; border-bottom: 1px solid #d9dde4; font-size: 20px; letter-spacing: -.02em; }
section h3 { margin: 18px 0 7px; font-size: 14px; }
section h3 small { margin-left: 8px; color: var(--muted); font-weight: 400; }
.run-summary { display: grid; grid-template-columns: 180px 1fr; gap: 20px; align-items: stretch; }
.run-summary > div { display: grid; align-content: center; padding: 18px; border: 1px solid #b9c0cb; background: #f7f8fa; }
.run-summary > div small { color: var(--muted); text-transform: uppercase; }
.run-summary > div strong { margin-top: 4px; font-size: 30px; }
.run-summary dl { display: grid; grid-template-columns: 130px minmax(180px, 1fr) 130px minmax(180px, 1fr); margin: 0; border: 1px solid var(--line); }
.run-summary dt, .run-summary dd { min-width: 0; margin: 0; padding: 8px 10px; border-bottom: 1px solid #e0e3e8; overflow-wrap: anywhere; }
.run-summary dt { background: #f5f6f8; color: #596270; font-weight: 700; }
.split { display: grid; grid-template-columns: 1.25fr .75fr; gap: 14px; }
.split > div { min-width: 0; }
table { display: block; width: 100%; overflow-x: auto; border: 1px solid var(--line); border-collapse: collapse; background: #fff; }
th, td { min-width: 105px; padding: 7px 9px; border-right: 1px solid #e0e3e8; border-bottom: 1px solid #e0e3e8; text-align: left; vertical-align: top; font-size: 12px; overflow-wrap: anywhere; }
th { background: #f2f4f6; color: #4a5360; font-weight: 700; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
code { color: #24344c; overflow-wrap: anywhere; }
pre { max-height: 560px; margin: 7px 0; padding: 12px; overflow: auto; border: 1px solid #cfd4dc; background: #f7f8fa; color: #181b20; font-size: 12px; white-space: pre-wrap; }
.raw-output { min-height: 72px; max-height: 680px; }
.facts { display: flex; flex-wrap: wrap; margin: 8px 0 14px; border: 1px solid var(--line); }
.facts span { min-width: 155px; padding: 9px 12px; border-right: 1px solid var(--line); color: #596270; }
.facts strong { display: block; color: #171a1f; font: 700 17px/1.25 ui-monospace, monospace; overflow-wrap: anywhere; }
.note { margin: 6px 0; color: #596270; font-size: 12px; }
.warning { margin: 0 0 14px; padding: 10px 12px; border: 1px solid #d9b96b; background: #fff9e8; color: #5f4916; }
.judge-record { margin: 10px 0; padding: 14px; border: 1px solid var(--line); border-left: 5px solid #7a8492; background: #fff; }
.judge-record.pass { border-left-color: #167249; }
.judge-record.fail { border-left-color: #b4233b; }
.judge-record.unevaluable { border-left-color: #a05b00; }
.judge-record > header { display: flex; justify-content: space-between; gap: 16px; margin-bottom: 10px; }
.judge-record header h3 { margin: 1px 0 2px; }
.judge-record header p, .judge-record header small { margin: 0; color: var(--muted); }
.judge-record header > strong { align-self: flex-start; font: 800 16px/1.3 ui-monospace, monospace; }
.evidence-list { margin-top: 10px; }
.evidence-list ul { padding-left: 20px; }
.evidence-list li { margin: 8px 0; }
.evidence-list p { margin: 5px 0; font-size: 12px; }
.snapshot { margin: 8px 0; padding: 10px; border: 1px solid var(--line); }
details > summary { cursor: pointer; color: #303844; font-weight: 700; }
tr.ok td { background: #f0f8f4; }
tr.bad td { background: #fff1f3; }
tr.busy td { background: #eef4ff; }
.pass { color: var(--good); }
.fail { color: var(--bad); }
.unevaluable { color: var(--warn); }
.pending { color: #5f6875; }
footer { padding: 16px; color: var(--muted); font: 12px/1.4 ui-monospace, monospace; text-align: center; }
@media (max-width: 860px) {
  .run-summary, .split { grid-template-columns: 1fr; }
  .run-summary dl { grid-template-columns: 110px 1fr; }
  .topbar { align-items: flex-start; flex-wrap: wrap; }
  .topbar nav { order: 3; width: 100%; }
  main { width: min(100% - 16px, 1480px); }
  section { padding: 14px; }
}
@media print {
  .topbar { position: relative; }
  body.dsheval-v3 { background: #fff; }
  main { width: 100%; margin: 0; }
}
`;

/** v1 兼容渲染器的最小内联样式。 */
const LEGACY_RENDERER_CSS = ":root{color-scheme:light dark;font-family:ui-sans-serif,system-ui,sans-serif}body{max-width:1100px;margin:auto;padding:24px;line-height:1.5}header,.panel,.check{border:1px solid #8886;border-radius:10px;padding:16px;margin:12px 0}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px}.summary div{background:#8881;padding:8px;border-radius:6px}.timeline{padding-left:24px}.step{margin:8px 0;padding:8px;border-left:5px solid #888}.step.ok{border-color:#16803c}.step.bad{border-color:#b42318}.step.busy{border-color:#1769aa}.pass{color:#16803c}.fail{color:#b42318}.unevaluable{color:#a15c00}table{width:100%;border-collapse:collapse}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #8885;padding:7px}code,pre{overflow-wrap:anywhere}small{opacity:.75}a{color:inherit}dt{font-weight:700}dd{margin-bottom:5px}";

/** v2 增强兼容渲染器的内联样式。 */
const ENHANCED_RENDERER_CSS = `
:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
  --bg: #f2f5fb;
  --surface: #fff;
  --surface-2: #f7f9fd;
  --ink: #111827;
  --muted: #64748b;
  --line: #dce3ee;
  --accent: #5b5ce2;
  --accent-2: #7c3aed;
  --good: #087343;
  --good-bg: #e9f9f0;
  --good-chip: #c9f0da;
  --bad: #b4233b;
  --bad-bg: #fff0f2;
  --bad-chip: #ffd7dc;
  --warn: #9a5700;
  --warn-bg: #fff7df;
  --busy: #1d4ed8;
  --busy-bg: #eef4ff;
  --busy-chip: #dbeafe;
  --neutral-chip: #e2e8f0;
  --shadow: 0 18px 45px rgba(30, 41, 59, .08);
  --glow-a: #c7d2fe;
  --glow-b: #ddd6fe;
  --target: #eef2ff;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body.dsheval-v2 {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 32px 56px;
  background: radial-gradient(circle at 9% -8%, var(--glow-a) 0, transparent 27rem), radial-gradient(circle at 92% 4%, var(--glow-b) 0, transparent 23rem), var(--bg);
  color: var(--ink);
  line-height: 1.55;
}
.topbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: 56px;
  margin: 0 -32px 22px;
  padding: 8px 32px;
  background: rgba(15, 23, 42, .92);
  color: #fff;
  backdrop-filter: blur(14px);
  box-shadow: 0 8px 28px rgba(15, 23, 42, .18);
}
.brand { display: flex; align-items: center; gap: 10px; font-weight: 800; letter-spacing: -.02em; white-space: nowrap; }
.brand small { font-weight: 500; opacity: .65; }
.brand-mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 9px; background: linear-gradient(135deg, #818cf8, #a78bfa); font-size: 14px; }
.topbar nav { display: flex; gap: 4px; flex: 1; }
.topbar a { display: inline-flex; align-items: center; min-height: 40px; padding: 6px 11px; border-radius: 8px; color: #dbeafe; text-decoration: none; font-size: 13px; white-space: nowrap; }
.topbar a:hover { background: #ffffff18; color: #fff; }
.view-kind { padding: 5px 9px; border: 1px solid #ffffff2c; border-radius: 999px; color: #c4b5fd; font: 700 11px/1.2 ui-monospace, SFMono-Regular, monospace; letter-spacing: .08em; white-space: nowrap; }
header, .panel, .check, .progress-block { border: 1px solid var(--line); border-radius: 18px; background: var(--surface); background: color-mix(in srgb, var(--surface) 96%, transparent); box-shadow: var(--shadow); }
header { position: relative; overflow: hidden; padding: 28px; margin: 0 0 18px; background: linear-gradient(125deg, #111827 0%, #24234f 52%, #3730a3 100%); border: 0; color: #fff; }
header:after { content: ""; position: absolute; right: -70px; top: -100px; width: 280px; height: 280px; border: 55px solid #ffffff0b; border-radius: 50%; }
h1 { position: relative; z-index: 1; margin: 0 0 22px; font-size: clamp(26px, 4vw, 43px); letter-spacing: -.045em; line-height: 1.08; }
.summary { position: relative; z-index: 1; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
.summary > div { min-width: 0; padding: 12px 13px; border: 1px solid #ffffff18; border-radius: 12px; background: #ffffff0d; color: #cbd5e1; font-size: 11px; text-transform: uppercase; letter-spacing: .07em; }
.summary strong { display: inline-block; max-width: 100%; margin-top: 4px; color: #fff; font-size: 14px; text-transform: none; letter-spacing: 0; overflow-wrap: anywhere; }
.summary strong.pass { color: #a7f3d0; background: #064e3b; }
.summary strong.fail { color: #fecdd3; background: #881337; }
.summary strong.unevaluable { color: #fde68a; background: #78350f; }
header > p { position: relative; z-index: 1; margin: 14px 0 0; color: #cbd5e1; }
.fixture-notice { padding: 9px 12px; border-left: 4px solid #fbbf24; border-radius: 7px; background: #fbbf2418; }
.progress-block { display: grid; grid-template-columns: minmax(180px, 260px) 1fr; align-items: center; gap: 22px; padding: 16px 20px; margin: 0 0 12px; }
.progress-block > div:first-child { display: flex; justify-content: space-between; gap: 12px; color: var(--muted); font-size: 13px; }
.progress-block strong { color: var(--ink); }
.progress-track { height: 9px; overflow: hidden; border-radius: 999px; background: var(--neutral-chip); }
.progress-track span { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--accent), var(--accent-2)); }
.operational-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin: 0 0 12px; }
.operational-strip > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
.operational-strip small { color: var(--muted); }
.failure-alert { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 13px 16px; margin: 0 0 12px; border: 1px solid #fb718566; border-left: 5px solid var(--bad); border-radius: 12px; background: var(--bad-bg); }
.failure-alert div { display: flex; flex-direction: column; }
.failure-alert span { color: var(--muted); font-size: 12px; }
.failure-alert a { white-space: nowrap; }
.panel { padding: 22px; margin: 16px 0; scroll-margin-top: 74px; }
.panel > h2 { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; font-size: 20px; letter-spacing: -.025em; }
.panel > h2:before { content: ""; width: 4px; height: 20px; border-radius: 9px; background: linear-gradient(var(--accent), var(--accent-2)); }
.timeline { display: grid; grid-template-columns: repeat(10, minmax(98px, 1fr)); gap: 8px; padding: 0 0 6px; margin: 0; overflow-x: auto; list-style: none; }
.step { position: relative; min-width: 0; min-height: 126px; margin: 0; padding: 11px; border: 1px solid var(--line); border-top: 4px solid #94a3b8; border-radius: 12px; background: var(--surface-2); font-size: 12px; }
.step-head { display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-bottom: 11px; }
.step-head > span:last-child { flex: none; padding: 3px 5px; border-radius: 999px; background: var(--neutral-chip); color: #475569; font: 700 10px/1.2 ui-monospace, SFMono-Regular, monospace; letter-spacing: .02em; }
.step-number { color: var(--muted); font: 800 13px/1 ui-monospace, SFMono-Regular, monospace; }
.step-label { display: block; min-height: 40px; font-size: 13px; line-height: 1.28; overflow-wrap: anywhere; }
.step details { margin-top: 11px; color: var(--muted); overflow-wrap: anywhere; }
.step details[open] { max-height: 220px; overflow: auto; }
.step summary { cursor: pointer; color: var(--muted); font-size: 11px; }
.step-full-label { margin: 8px 0 5px; color: var(--ink); font-weight: 700; }
.step small { display: block; color: var(--muted); font-size: 11px; }
.step details > div:not(.step-full-label) { margin-top: 7px; }
.step.ok { border-top-color: var(--good); background: var(--good-bg); }
.step.ok .step-head > span:last-child { background: var(--good-chip); color: var(--good); }
.step.bad { border-top-color: var(--bad); background: var(--bad-bg); }
.step.bad .step-head > span:last-child { background: var(--bad-chip); color: var(--bad); }
.step.busy { border-top-color: var(--busy); background: var(--busy-bg); box-shadow: 0 0 0 2px #2563eb18; }
.step.busy .step-head > span:last-child { background: var(--busy-chip); color: var(--busy); }
#judging { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
#judging > h2, #judging > p { grid-column: 1 / -1; }
.check { min-width: 0; padding: 18px; margin: 0; box-shadow: none; }
.check.check-pass { border-left: 5px solid var(--good); }
.check.check-fail { border-left: 5px solid var(--bad); }
.check.check-unevaluable { border-left: 5px solid var(--warn); }
.check h3 { margin-top: 0; overflow-wrap: anywhere; }
.pass, .fail, .unevaluable, .status-pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-weight: 800; }
.pass, .tone-good { color: var(--good); background: var(--good-bg); }
.fail, .tone-bad { color: var(--bad); background: var(--bad-bg); }
.unevaluable, .tone-warn { color: var(--warn); background: var(--warn-bg); }
.tone-neutral { color: var(--muted); background: var(--surface-2); }
.status-pill { font-size: 11px; white-space: nowrap; }
table { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
thead { background: var(--surface-2); }
th, td { min-width: 110px; padding: 10px 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--line); font-size: 12px; }
th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
tr:last-child td { border-bottom: 0; }
.drill { padding: 14px 16px; margin: 10px 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-2); scroll-margin-top: 74px; }
.drill:target, [id^="raw-"]:target, [id^="snapshot-"]:target { outline: 3px solid #818cf866; background: var(--target); }
.drill h3 { margin-top: 0; font-size: 14px; }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap: anywhere; word-break: break-word; }
code { font-size: .9em; color: #4338ca; }
pre { padding: 13px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2); white-space: pre-wrap; }
a { color: #4f46e5; text-underline-offset: 3px; }
dt { font-weight: 750; }
dd { margin: 0 0 6px; color: var(--muted); }
small { opacity: .82; }
footer { padding: 18px 4px; color: var(--muted); }
@media (max-width: 1050px) {
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .timeline { grid-template-columns: repeat(10, minmax(112px, 1fr)); }
  #judging { grid-template-columns: 1fr; }
  .operational-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 680px) {
  body.dsheval-v2 { padding: 0 14px 36px; }
  .topbar { position: relative; align-items: flex-start; flex-wrap: wrap; margin: 0 -14px 16px; padding: 8px 14px; }
  .topbar nav { order: 3; width: 100%; overflow-x: auto; }
  .view-kind { margin-left: auto; }
  .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .summary > div:first-child { grid-column: 1 / -1; }
  .timeline { grid-template-columns: repeat(10, minmax(132px, 1fr)); }
  .progress-block { grid-template-columns: 1fr; gap: 10px; }
  .failure-alert { align-items: flex-start; flex-direction: column; }
  header, .panel { padding: 17px; border-radius: 14px; }
}
@media (max-width: 440px) {
  .operational-strip { grid-template-columns: 1fr; }
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #090d18; --surface: #111827; --surface-2: #172033; --ink: #e5e7eb; --muted: #94a3b8; --line: #293548; --good: #4ade80; --good-bg: #102b21; --good-chip: #17472f; --bad: #fb7185; --bad-bg: #33151b; --bad-chip: #52202a; --warn: #fbbf24; --warn-bg: #33260d; --busy: #60a5fa; --busy-bg: #13243f; --busy-chip: #18365f; --neutral-chip: #263246; --shadow: 0 18px 45px rgba(0, 0, 0, .22); --glow-a: #111934; --glow-b: #1b1437; --target: #1e2450; }
  code { color: #a5b4fc; }
  thead { background: #172033; }
  .topbar { background: rgba(5, 9, 18, .94); }
  .step-head > span:last-child { color: #cbd5e1; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
}
@media print {
  :root { --bg: #fff; --surface: #fff; --surface-2: #f8fafc; --ink: #111; --muted: #475569; --line: #cbd5e1; --good: #087343; --good-bg: #e9f9f0; --good-chip: #c9f0da; --bad: #b4233b; --bad-bg: #fff0f2; --bad-chip: #ffd7dc; --warn: #9a5700; --warn-bg: #fff7df; --busy: #1d4ed8; --busy-bg: #eef4ff; --busy-chip: #dbeafe; --neutral-chip: #e2e8f0; --target: #eef2ff; }
  body.dsheval-v2 { padding: 0; background: #fff; color: #111; }
  .topbar { position: relative; background: #111; }
  .panel, header, .check, .progress-block { box-shadow: none; break-inside: avoid; }
  .timeline { grid-template-columns: repeat(5, 1fr); }
}`;

/** 按文档绑定的 rendererVersion 选择对应内联样式。 */
function rendererStyles(rendererVersion: string): string {
  if (rendererVersion === "dsheval-static/v3") return INTUITIVE_RENDERER_CSS;
  if (rendererVersion === "dsheval-static/v2") return ENHANCED_RENDERER_CSS;
  return LEGACY_RENDERER_CSS;
}

/** 将常见 reasonCode 映射为报告中的中文排障建议。 */
function troubleshootingHint(reasonCode: string): string {
  const hints: Readonly<Record<string, string>> = {
    PLAN_UNSATISFIABLE: "检查缺失资产、Sensor 或 Judge 后重新规划。",
    BASELINE_FAILED: "检查 Workspace 路径、权限和 File Sensor；Agent 尚未启动。",
    PROBE_SEQUENCE_INCOMPLETE: "检查 Probe gap、最终 watermark 与 probe/stop。",
    PROBE_STOP_MISSING: "Probe 缺少 stop；Protocol Check 将不可评测。",
    TARGET_EXECUTION: "查看退出事实、stderr、Trace 与独立文件结果。",
    EVIDENCE_INCOMPLETE: "检查缺失的来源、watermark 或所需内容。",
    JUDGE_IMPLEMENTATION_ERROR: "这是 Judge 故障，不是 Agent FAIL。",
    RESET_MISMATCH: "环境有残留并已隔离；既有 Gate 不会改变。",
    REPORT_FAILURE: "Gate 已保存，可从权威 JSON 重新渲染。",
  };
  return hints[reasonCode] ?? reasonCode;
}

/** 所有模板插值共用的 HTML 转义函数，也公开供渲染相关测试复用。 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 把任意对象 ID 编码成安全且可复现的 HTML anchor。 */
function safeAnchor(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

/** 将时间线状态映射为兼容模板的 CSS class。 */
function statusClass(status: WorkflowStepStatus): string {
  if (status === "SUCCEEDED") return "ok";
  if (status === "FAILED" || status === "BLOCKED") return "bad";
  if (status === "RUNNING") return "busy";
  return "";
}

/** 将多种领域状态归并为 v2/v3 页面使用的四类语义色调。 */
function statusTone(value: string): "tone-good" | "tone-bad" | "tone-warn" | "tone-neutral" {
  const normalized = value.toUpperCase();
  if (
    [
      "INDEPENDENT",
      "COMPLETE",
      "HEALTHY",
      "VALID",
      "CLOSED",
      "COMPLETED",
      "MATCH",
      "CLEANED",
      "PASS",
    ].includes(normalized)
  ) {
    return "tone-good";
  }
  if (
    [
      "FAILED",
      "INVALID",
      "UNAVAILABLE",
      "ERROR",
      "MISMATCH",
      "QUARANTINED",
      "NOT_VERIFIED",
      "FAIL",
    ].includes(normalized)
  ) {
    return "tone-bad";
  }
  if (
    ["PARTIAL", "COOPERATIVE", "UNKNOWN", "UNEVALUABLE", "DEGRADED", "PENDING"].includes(
      normalized,
    )
  ) {
    return "tone-warn";
  }
  return "tone-neutral";
}

/** 将 CheckOutcome 映射为旧模板使用的结果 CSS class。 */
function outcomeClass(outcome: string): string {
  return outcome === "PASS" ? "pass" : outcome === "FAIL" ? "fail" : outcome === "UNEVALUABLE" ? "unevaluable" : "";
}

/** buildEvaluationReport 用于按身份去重并稳定排序对象 Ref。 */
