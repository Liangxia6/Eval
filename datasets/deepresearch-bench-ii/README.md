# DeepResearch Bench II（dataset.deepresearch-bench-ii/v1）

从固定提交 087c1b8d4a0e 选取无人机控制、温室控制、Kubernetes 调度、云扩缩容、开放科研数据任务。要求实际检索允许来源并综合报告，不以闭卷知识问答替代研究执行。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, retrieval-grounding, tool-document, tool-web
- 每题超时：3600–3600 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark workspace；task-specific pinned runtime；trusted upstream evaluator
- 公开输入：无
- 交付产物：output/report.md

## 上游环境与前置条件（environment.upstreamConstraints）

- blockedReferences: <varies>
- environmentReset: new research workspace and empty agent history per trial
- judgeApiRequired: true
- judgeSettingsMustBeRecorded: ["model snapshot", "temperature", "chunk_size", "max_paper_chars", "max_retries"]
- missingPrerequisiteResult: UNEVALUABLE
- nativeEvaluatorCommit: 087c1b8d4a0ed46fd3dd8615a0b5e93ce3acf6f8
- nativeEvaluatorModel: gpt-5.5
- networkPolicy: only permitted sources; no reference report or benchmark answers
- privateResourcesVisibility: controller-and-judge-only
- reportFormat: Markdown
- required: true
- requiredResearchTools: ["web search", "page/document access"]
- scoreScope: native rubric scores assess report quality, not the complete browsing trajectory

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配 retrieval-grounding、tool-web、tool-document 和 artifact-delivery；检索与工具标签须有真实过程证据，不能只凭文笔推断。

## 不适配情况

不适合没有搜索/文档工具的闭卷模型，也不适合允许直接读取参考报告或私有 rubric 的配置。不能当作完全确定性、无需 Judge API 的自动测试。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/imlrz/DeepResearch-Bench-II
- commit: 087c1b8d4a0ed46fd3dd8615a0b5e93ce3acf6f8

## 逐题清单

- deepresearch-bench-ii-035-quadrotor-control-zh：portable，3600s，输出 output/report.md
- deepresearch-bench-ii-038-greenhouse-control-en：portable，3600s，输出 output/report.md
- deepresearch-bench-ii-045-kubernetes-scheduling-zh：portable，3600s，输出 output/report.md
- deepresearch-bench-ii-046-cloud-autoscaling-en：portable，3600s，输出 output/report.md
- deepresearch-bench-ii-074-open-research-data-en：portable，3600s，输出 output/report.md

## 当前局限

仅为 5 题导入样本，不代表完整榜单；全部所选题标注 CC BY 4.0，已保留来源归属和许可。尚未运行研究 Agent 或调用 Judge；评分有模型与分块设置依赖，网络来源也可能变化。缺研究环境判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
