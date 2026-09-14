import type { BatchWorkflowSummary } from "../app/batch.js";
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 一个父 Run 的全部 Case 汇总到同一份静态报告；每个 Case 保留详细报告入口。 */
export function renderRunReport(summary: BatchWorkflowSummary): string {
  const rows = summary.caseResults.map((result) => {
    const detail = result.reportHtml === undefined
      ? "—"
      : `<a href="${escapeHtml(`cases/${result.caseId}/report.html`)}">查看 Case 报告</a>`;
    return `<tr><td>${result.caseIndex + 1}</td><td><code>${escapeHtml(result.caseId)}</code></td><td><code>${escapeHtml(result.datasetId)}</code></td><td>${escapeHtml(result.status)}</td><td>${escapeHtml(result.scores.map(score=>score.labelId+": "+(score.score??score.status)).join(", "))}</td><td>${escapeHtml(result.dshSessionIds.join(", ") || "—")}</td><td>${detail}</td></tr>`;
  }).join("\n");
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DSHEval Run ${escapeHtml(summary.runId)}</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:32px;color:#172033}h1{margin-bottom:8px}.summary{display:flex;gap:24px;margin:20px 0;padding:16px;background:#f4f7fb;border-radius:10px}table{width:100%;border-collapse:collapse}th,td{padding:12px;border:1px solid #dbe2ea;text-align:left}th{background:#eef3f8}code{font-size:.92em}a{color:#175cd3}
</style></head><body><h1>DSHEval 完整 Run 报告</h1><p><code>${escapeHtml(summary.runId)}</code></p><div class="summary"><span>Case：<strong>${summary.caseResults.length}</strong></span><span>维度评分：<strong>${escapeHtml(summary.dimensions?.map(item=>item.labelId+": "+(item.score??"未评分")).join(", "))}</strong></span><span>状态：<strong>${escapeHtml(summary.status)}</strong></span><span>并发：<strong>${summary.caseConcurrency}</strong></span></div><table><thead><tr><th>#</th><th>Case</th><th>Dataset</th><th>状态</th><th>标签分数</th><th>DSH Session</th><th>详情</th></tr></thead><tbody>${rows}</tbody></table></body></html>\n`;
}

