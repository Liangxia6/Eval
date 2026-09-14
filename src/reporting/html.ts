/** 纯展示：读取统一结果，不判断证据是否充分、不计算分数。 */
import type { EvaluationResult, ResultData } from "./types.js";
const e=(value:unknown)=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const json=(value:unknown)=>"<pre>"+e(JSON.stringify(value,null,2))+"</pre>";
const detail=(title:string,value:unknown)=>"<details><summary>"+e(title)+"</summary>"+json(value)+"</details>";
export function renderReportHtml(data:EvaluationResult|ResultData):string {
  const dimensions=data.dimensions.map(item=>{
    const width=item.score===null?0:Math.max(0,Math.min(100,100*(item.score-item.min)/(item.max-item.min)));
    const title=data.labels.find(label=>label.labelId===item.labelId)?.title??item.labelId;
    return '<div class="dimension"><strong>'+e(title)+'</strong><span>'+e(item.score===null?"未评分":item.score.toFixed(2)+" / "+item.max)+'</span><div class="track"><i style="width:'+width+'%"></i></div><small>已评分 '+item.scoredCases+' · 无法判断 '+item.unassessableCases+' · Judge 错误 '+item.errorCases+'</small></div>';
  }).join("");
  const outputs=(data.allTrace?.entries??[]).flatMap(entry=>{
    const file=entry.content as Record<string, import("../core/models.js").JsonValue> | null;
    if(entry.layer!=="DELIVERY" || !file || typeof file!=="object" || Array.isArray(file) ||
      typeof file.portablePath!=="string" || !file.portablePath.startsWith("output/") || file.contentRestricted) return [];
    const href=file.portablePath.split("/").map(encodeURIComponent).join("/");
    return ['<li><a href="'+e(href)+'">'+e(file.portablePath)+'</a></li>'];
  }).join("");
  const scores=data.scores.map(score=>'<article><h3>'+e(data.labels.find(label=>label.labelId===score.labelId)?.title??score.labelId)+' · '+e(score.score===null?score.status:score.score+" / "+score.scale.max)+'</h3><p>'+e(score.reason)+'</p>'+detail("引用的真实证据",data.allTrace?.entries.filter(entry=>score.evidenceIds.includes(entry.id))??[])+detail("评分记录",score)+'</article>').join("");
  return '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DSHEval '+e(data.runId)+'</title><style>body{font:16px system-ui;margin:32px auto;padding:0 24px;max-width:1200px;color:#263342;background:#f6f8fa}section,article{background:white;border:1px solid #dce2e8;padding:20px;margin:18px 0;border-radius:10px}h1{font-size:26px}h2{font-size:21px}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:600px;overflow:auto;background:#f4f6f8;padding:14px}summary{cursor:pointer;padding:10px 0}.dimension{margin:18px 0}.dimension span{float:right}.track{background:#e5ebf1;height:12px;border-radius:8px;margin:8px 0}.track i{display:block;height:100%;background:#267dba;border-radius:8px}small{color:#677685}li{margin:8px 0}</style><h1>DSHEval · '+e(data.runId)+'</h1><p>运行：'+e(data.runState)+' · '+e(data.currentPhase)+' · 环境：'+e(data.environmentState)+(data.fixture?' · FIXTURE':'')+'</p><section><h2>标签维度评分</h2>'+ (dimensions||'<p>尚未形成评分</p>')+'</section><section><h2>静态观测与 Planner</h2>'+detail("DSH、插件与工具",data.inspection??data.target)+detail("执行计划",data.plan)+detail("Case 及题目评分参考",data.case)+detail("本次冻结的标签标准",data.labels)+'</section><section><h2>运行过程</h2><ol>'+data.timeline.map(step=>'<li>'+e(step.label)+' · '+e(step.status)+'</li>').join("")+'</ol>'+detail("Agent 实际任务与执行结果",data.execution)+detail("运行异常",data.failures)+'</section><section><h2>All trace</h2><p>Agent 记录 '+(data.allTrace?.entries.filter(entry=>entry.layer==="AGENT").length??0)+' · 环境变化 '+(data.allTrace?.entries.filter(entry=>entry.layer==="ENVIRONMENT").length??0)+' · 交付记录 '+(data.allTrace?.entries.filter(entry=>entry.layer==="DELIVERY").length??0)+'</p>'+detail("采集覆盖状态（不是评分门槛）",data.allTrace?.coverage)+detail("来源和完整性记录",{sources:data.allTrace?.sources,integrity:data.allTrace?.integrity})+detail("全部证据实际内容",data.allTrace?.entries)+'</section><section><h2>逐标签评价</h2>'+scores+'</section><section><h2>交付文件</h2><ul>'+outputs+'</ul></section>'+detail("环境收尾",data.reset)+detail("附件索引",data.artifacts)+'</html>';
}
export const renderStatusHtml=renderReportHtml;
