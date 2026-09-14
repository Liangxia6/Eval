# Evaluation 重构：当前实现

更新：2026-09-12。项目修改和验证均在 VMmac `/Users/dsheval/Projects/dsheval` 中进行。

## 一条清晰的评分链路

```text
datasets/catalog.md → Planner 选择 Dataset/Case
                         ↓
datasets/loader.ts → question.json + 公开输入 + Case 私有评分参考
                         ↓
runtime/case-input.ts → 单独加载 Trace/Environment 配置，形成执行输入
                         ↓
Agent 执行 → Probe 解析 + 全部外部 Observer 观测 + 收集交付物
                         ↓
all-trace/assemble.ts → 同一份三层证据与采集状态
                         ↓
evaluation/llm-label-judge.ts
  每个标签均读取：
  ① labels/ 中本次冻结的维度评分标准
  ② Case 的任务、final.checks 和私有 reference
  ③ 同一份 all trace
                         ↓
数值分数 + 理由 + 引用证据 ID / 无法判断 / Judge 错误
                         ↓
evaluation/scoring.ts → 按标签汇总分数和覆盖数量
                         ↓
reporting/record.ts → report.json
reporting/html.ts   → 从同一记录生成 report.html
```

## 文件职责

```text
src/
├── datasets/
│   ├── catalog.ts          # 读 Dataset 描述目录
│   └── loader.ts           # 读题目、公开输入、题目评分参考；不读 labels/，不创建 Judge
├── labels/
│   └── catalog.ts          # labels/ 唯一加载入口，校验 ID、数值范围并深度冻结
├── runtime/
│   ├── case-input.ts       # Case + Trace/Environment 配置 → 执行输入
│   ├── source-requirement.ts # 校验采集组件的配置
│   └── evaluation-plan-compiler.ts # 冻结执行计划、任务、环境与采集计划；不创建证据契约
├── all-trace/
│   ├── types.ts            # 三层证据、真实内容、来源、附件、覆盖状态
│   └── assemble.ts         # 装配 all trace，不定义标签规则、不生成旧 Judge 派生事实
├── evaluation/
│   ├── types.ts            # JudgeInput、LabelScore、DimensionScore
│   ├── llm-label-judge.ts   # 组装两个评分参照与 all trace，调用模型、验证响应
│   └── scoring.ts          # 数值汇总，不转成通过/失败
├── reporting/
│   ├── types.ts            # 统一结果记录类型
│   ├── record.ts           # 记录保存格式、摘要与读取校验
│   ├── html.ts             # Case HTML，展示已有数据
│   └── batch-html.ts       # Parent Run HTML，展示已有维度汇总
└── app/workflow.ts         # 串联上述模块，保存阶段记录并处理运行与环境收尾
```

已经删除：独立 Evaluation Pack 加载入口、`--fixture-pack`、旧 Pack 测试资产、Metric/Check/EvidenceContract 组合、`closure.ts`、旧 `evidence.ts`、旧规则 Judge、Gate 判定和专用存储约束、旧报告投影/渲染路径、硬编码导入旧标签规则的脚本。

## Loader 现在怎样读题

题目格式继续使用现有 `question.json`，没有为这次重构重写实际题库。

- 读取任务、标签、环境要求、公开输入和 `final.checks`。
- 公开输入只复制指定文件；有作者摘要时验证摘要，没有时用实际内容参与 Case 摘要。
- 私有 reference JSON 全量保留在 `case.grading.reference`，包括各数据集不同的 answer、rubric、criteria、cases、judgePrompt 等字段，不再转成一堆 Check 参数。
- Case 数据和标签标准在执行前保存为受限的 `GRADING_CONTEXT`，Judge 使用内存中冻结的同一内容，评分时不重新读取标签文件。
- Setup 目前支持 none、copy-public-inputs、self-contained-dsheval-fixture、shuffle-options。未知执行机制仍明确报不支持，不能靠猜测执行。
- 当前 final 适配仍要求一个 llm check；多检查或独立程序判题尚未实现，不能声称已自动支持所有异构数据集。

## All trace 到底包含什么

Schema：`dsheval.all-trace/v1`。

| 字段 | 实际内容 |
|---|---|
| entries，AGENT 层 | Probe/Session 的真实事件正文，附原始观测记录和 JSONL 定位信息；高频紧凑索引会取得完整解析正文 |
| entries，ENVIRONMENT 层 | Observer 实际观测到的变化及其内容；无变化不生成评分证据 |
| entries，DELIVERY 层 | 最终回答、交付文件正文或有界二进制表示，以及原文件引用 |
| sources | 来源描述，明确是 Agent 自报还是外部采集 |
| coverage | 每个来源的采集状态，区分未变化、未配置、部分采集和失败 |
| integrity | 装配发现的完整性问题；不会按标签所需事实类型过滤证据 |
| contentDigest | 这份 all trace 的内容摘要，所有标签评分记录引用同一个摘要 |

Trace 转换属于 `agent-trace/`；环境变化采集属于外部 Observer；文件读取和交付物内容提取由执行收尾完成。all trace 装配只组合这些已经取得的内容，不再推导 FILE_AFTER、PROTOCOL_LIFECYCLE 等旧评分事实。

原始文件仍由 ArtifactStore 保存。正文捕获/内联存在上限时保留截断标记；未采集到的内容不会凭空补齐。受限或命中 Secret 保护的内容不作为普通可导出附件发布。

## Judge 的输入和输出

Judge 的两个参照各有职责：

- 标签标准回答“在这个能力维度上，0–4 分分别意味着什么”。
- Case 参考回答“这道题具体要求什么、什么结果才正确”。

例如受控 Attention Fixture 的 Case 参考包含 QKᵀ/√dk、softmax、权重乘 V；产物交付标签标准则要求评估最终文件能否交付、打开和使用。两个参照一起送给 Judge，而不是用文件是否存在代替评分。

每个标签都取得相同的 `all_trace`，不存在 requiredFactTypes、授权子集或评分前 Closure 门槛。Judge 选择相关证据，并引用 `entries[].id`。程序仅验证响应字段、分数范围和引用 ID 的存在性；这些是响应格式检查，不是评分前门槛。

输出记录：

```json
{
  "status": "SCORED",
  "score": 3,
  "scale": { "min": 0, "max": 4 },
  "reason": "结合该维度标准和题目参考的具体解释",
  "evidenceIds": ["all-trace.<attempt>.file.1"]
}
```

这里是格式示意，不是对真实 DSH 的评测结论。

- `SCORED`：有数值，包括有效的 0 分。
- `UNASSESSABLE`：模型执行后确实无法判断，score 为 null，必须解释原因。
- `ERROR`：模型请求或响应失败，score 为 null，是评测系统错误。

汇总按标签对有效分数取均值，同时保留已评分、无法判断和错误 Case 数量。后两者不作为 0 分。同一维度不同标准摘要不能混算。没有 PASS/FAIL 阈值，也没有综合 Gate。

## 最终交付与运行记录

每个 Case 的可审阅交付目录：

```text
cases/<case-id>/
├── report.json             # 唯一结构化结果：输入、执行、all trace、标签评分、维度汇总、异常
├── report.html             # 只展示 report.json 的内容
└── attachments/            # 允许导出的原始附件，保留 ArtifactRef.portablePath
```

不再另生成 task.json、plan.json、execution.json、逐标签 evidence.json、judge.json 等重复结果。内部阶段记录和内容寻址 Artifact 继续保留，供定位错误；它们不是另一套评分结论。Parent Run 保存 run.json 和其 HTML，汇总各 Case 的数值维度。

本次没有实现渐进式证据目录检索，也没有调整 Parent Run 并发与 Target 冻结策略。当前 Judge 仍一次接收全量已收集内容；超出模型上下文限制会记录 Judge 错误，不会偷偷过滤或截断成另一个标签专属证据集。

## 验证

测试使用生产格式的 Dataset Fixture；实际运行本地 Fixture 进程、全部外部 Observer、all trace 装配、Judge 请求/响应解析、数值结果与 HTML 导出。模型 HTTP 响应被明确替换为测试响应，不能当成真实模型评分质量验收。

回归覆盖同一 all trace 输入、两个参照、0 分/null 区分、无效引用、模型错误、Trace 不完整仍进入 Judge、Reset 失败不改分，以及报告摘要/转义/不可覆盖。

日志位于 `var/reviews/evaluation-refactor-20260912/`。实施前备份为该目录中的 `before.tgz`。

### 本次实际验收结果

- 完整回归：124 项，124 通过，0 失败。
- 最终标签规则补充两个参照的边界后，5 项针对性测试通过，类型检查通过，重新保留了一份端到端样例。
- 保留样例：/Users/dsheval/Projects/dsheval/var/reviews/evaluation-refactor-20260912/final-smoke/results/agents/fixture-agent/runs/evaluation-refactor-final-smoke/cases/evaluation-refactor-final-smoke.case/report.json
- 样例包含 Agent 事件 9 条、环境变化 15 条、交付记录 2 条，以及 11 个来源的覆盖状态。
- 两个标签评分均引用同一 all trace 摘要：acf5f405e6eb882bc6a17eca84e86ca98a618d134e12e1bfd6fc08053cfc13a7。
- 样例分数 3/4 是显式测试响应，仅证明评分内容按新接口传递、保存和展示，不能用于评价真实 DSH 能力。
