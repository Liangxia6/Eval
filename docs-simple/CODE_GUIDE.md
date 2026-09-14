> **2026-09-12 评分链路更新：** 当前接口以 [Evaluation 重构说明](EVALUATION-REFACTOR-20260912.md) 为准。下文出现的 Pack、EvidenceContract、Closure、Gate 和旧评分报告字段均已移除；历史说明保留用于追溯。

# DSHEval 代码阅读大纲

> 用于按真实端到端链路审查代码。当前实现基线是 VMmac 中的真实 DSH Demo，不再以 Attention Fixture 代表生产流程。

## 1. 推荐阅读顺序

1. [`src/app/cli.ts`](../src/app/cli.ts)：`inspect / plan / run / report` 怎样进入系统。
2. [`src/app/batch.ts`](../src/app/batch.ts)：一次 Planner 结果怎样展开为多个不重复 Case。
3. [`src/app/workflow.ts`](../src/app/workflow.ts)：单个 Case 的完整状态机。
4. [`src/planning/target.ts`](../src/planning/target.ts) 和 [`src/planning/agent-static.ts`](../src/planning/agent-static.ts)：真实 DSH 静态信息怎样形成 Planner 输入。
5. [`src/planning/planner.ts`](../src/planning/planner.ts)：动态注入 Prompt、一次 API 调用和结果校验。
6. [`src/datasets/catalog.ts`](../src/datasets/catalog.ts) 和 [`src/datasets/loader.ts`](../src/datasets/loader.ts)：如何从 Dataset 目录识别真实题目，而不是固化旧 Case。
7. [`src/runtime/target.ts`](../src/runtime/target.ts) 和 [`src/runtime/dsh-session-trace.ts`](../src/runtime/dsh-session-trace.ts)：新 DSH Session 如何启动以及 Session Trace 如何恢复。
8. [`src/agent-trace/`](../src/agent-trace) 与 [`src/observation/`](../src/observation)：Agent 内部 Trace 和外部环境 Observer 的边界。
9. [`src/evaluation/`](../src/evaluation)：Evidence、逐 Label LLM Judge、CheckResult 和 Gate。
10. [`src/platform/case-bundle.ts`](../src/platform/case-bundle.ts)：最终 Agent/Run/Case 产物如何收敛。

## 2. 主链路与关键文件

| 阶段 | 文件 | 当前输出 |
|---|---|---|
| CLI | `app/cli.ts` | 参数、退出码、单行 JSON Summary |
| 静态观测 | `planning/target.ts`、`planning/agent-static.ts` | TargetSnapshot、InspectionSnapshot、Planner 注入数据 |
| Dataset 选择 | `planning/planner.ts` | 一次 LLM 生成 DatasetSelectionPlan |
| 批量展开 | `app/batch.ts` | Parent Run 下的不重复 Case 队列和聚合报告 |
| 题目加载 | `datasets/catalog.ts`、`datasets/loader.ts` | 从选中 Dataset 读取指定 `caseIndex` 的真实题目 |
| 计划编译 | `runtime/evaluation-plan-compiler.ts` | EvaluationPlan、AgentTracePlan、ObservationPlan、EvidenceContract |
| Agent 执行 | `runtime/target.ts` | 一个 Case 的新 DSH Session 和最终输出 |
| Agent Trace | `agent-trace/native-probe-adapter.ts`、`runtime/dsh-session-trace.ts`、`agent-trace/reader.ts` | 关键模型、工具、生命周期和回答事件 |
| 外部观测 | `observer-lab/adapters/filesystem/binding.ts`、`observer-lab/adapters/process/binding.ts`、`observation/collection.ts` | 文件、进程和其他环境组件变化 |
| Evidence | `evaluation/evidence.ts`、`evaluation/closure.ts` | 标签可消费的证据索引与闭合状态 |
| Judge | `evaluation/llm-label-judge.ts`、`evaluation/judging.ts` | 每 Label 一次 API、Judgement、CheckResult |
| 汇总 | `evaluation/scoring.ts`、`evaluation/report*.ts` | Case Gate、JSON/HTML |
| 最终产物 | `platform/case-bundle.ts` | 精简 Case Bundle 与 Run Report |

## 3. 外部配置职责

```text
planning/
├── policies.json                 # STANDARD 的 Dataset/Case 数量边界
└── prompts/standard.json         # 完整 Planner 提示词；运行时注入动态数据

datasets/
├── catalog.md                    # 全部 Dataset 的 ID、描述、标签、题量和运行条件
└── <dataset>/<case>/             # prompt/question、公开 assets、checks/private 材料

labels/
└── <label>.json                  # 证据层级、组件需求、评分标准和 Judge Prompt

environments/
└── macos.json                    # macOS 环境组件、Observer 和能力要求

trace/
└── dsh-runtime.json              # Agent Trace 来源与采集约束

config/
├── macos-vm.json                 # VMmac 运行根目录、时限和结果目录
└── targets/real-dsh.json         # 真实 DSH 可执行文件、Profile 和 DSH_HOME
```

新增 Dataset 不应修改 Workflow；修改标签判定只改 `labels/`；修改环境实例或启用组件只改 `environments/`；只有新增一种采集能力或解释规则时才修改源码。

## 4. 关键源码职责

### Planning 与 Batch

| 文件 | 职责 |
|---|---|
| `planning/planner.ts` | 加载 `standard.json` 和 `policies.json`，注入静态快照、Ledger、Eligibility 和 Dataset 列表，调用一次 Planner API，严格校验返回。 |
| `datasets/loader.ts` | 兼容不同 Dataset 目录结构，提取真正给 DSH 的题目，加载 Label/Environment/Trace 配置。 |
| `app/batch.ts` | 复用一次 Planner 结果，按 Dataset 的 `caseCount` 生成队列；每个 Case 调用一次单 Case Workflow；当前串行。 |
| `app/workflow.ts` | 一个 Case 内从计划、执行、采集、Judge、Reset 到导出的唯一主链。 |

### Agent Trace

| 文件 | 职责 |
|---|---|
| `agent-trace/native-probe/` | 随 DSH 运行捕获内部事件；只保留评分需要的关键类别。 |
| `agent-trace/native-probe-adapter.ts` | 把 Native Probe 输出接入 DSHEval 的 Source/Observation 契约。 |
| `runtime/dsh-session-trace.ts` | 从 DSH Session Archive 恢复模型、工具和最终回答；需要系统 `zstd`。 |
| `agent-trace/reader.ts` | 去除 `assistant/chunk` 等噪声，标准化 Trace，保留参数、返回正文、错误和最终回答。 |

### Environment Observer

| 文件 | 职责 |
|---|---|
| `observer-lab/adapters/filesystem/binding.ts` | 接入文件阶段快照并整理记录；实际采集位于 observer-lab/adapters/filesystem/sensor.ts。 |
| `observer-lab/adapters/process/binding.ts` | 接入进程快照采集；实际采集位于 observer-lab/adapters/process/sensor.ts。 |
| `observation/collection.ts` | 启停 `observer-lab` 的 Browser、Database、External API、Network 等 Adapter，并把变化物化为标准 Observation。 |
| `observer-lab/adapters/*.mjs` | 各 macOS 组件的具体只读采样逻辑；轮询仅用于发现变化，落盘是触发式事件。 |

### Evaluation 与结果

| 文件 | 职责 |
|---|---|
| `evaluation/evidence.ts` | 把最终回答、关键 Trace、交付物和外部环境事实组织为可检索证据。 |
| `evaluation/closure.ts` | 判断每个 Label 所需证据是否完整、有效、可信。 |
| `evaluation/llm-label-judge.ts` | 读取对应 `labels/*.json`，构造完整 Judge Prompt，每个 Label 调用一次 LLM。 |
| `evaluation/scoring.ts` | 只根据已提交的 CheckResult 计算 Case Gate。 |
| `platform/case-bundle.ts` | 把内部细粒度 records 收敛为 `task/plan/execution/trace/observers/evidence/judge/artifacts/report`。 |

## 5. 当前必须重点审查的四处

1. `planning/planner.ts` 与 Dataset Loader：在调用 LLM 前应排除缺少 Environment Adapter 或 Upstream Evaluator 的 Dataset，不能只依靠 Prompt 自觉。
2. `runtime/target.ts` 与安全边界：目前只是新 Session，Agent 仍可能读取 DSHEval 源码和 Dataset 私有评分材料。
3. `observation/collection.ts` 到 `case-bundle.ts`：即使没有变化事件，也要保留 Observer 的 `COMPLETE/PARTIAL/UNAVAILABLE/IDLE` 状态，避免“文件不存在”被误解。
4. `agent-trace/reader.ts` 与 Case Bundle：Raw Trace 要继续减量和渐进式披露，但不能丢失 SQL、命令参数、工具返回正文、错误、最终回答和交付物内容。

## 6. 不应再出现的旧表述

- “先给 Agent 选择 3 个左右标签，再按标签选 Dataset”；
- “当前只支持 Attention + PyTorch”；
- “每个 Run 只有一个 Case”；
- “Process/Browser/Database 只有配置声明”；
- “LLM Judge 尚未实现”；
- “新 DSH Session 等于完整安全隔离”；
- “`--max-cases 2` 表示每个 Dataset 两题”。
