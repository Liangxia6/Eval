> **2026-09-12 评分链路更新：** 当前接口以 [Evaluation 重构说明](EVALUATION-REFACTOR-20260912.md) 为准。下文出现的 Pack、EvidenceContract、Closure、Gate 和旧评分报告字段均已移除；历史说明保留用于追溯。

# DSHEval 架构

> 当前形态：单台 macOS VM、模块化单体、一个 Parent Run 包含多个串行 Case、每个 Case 一个 Attempt 和一个新 DSH Session。

## 1. 总体结构

```text
Target Inspector ──► AgentStaticSnapshot
                           │
Dataset Catalog ───────────┼──► Unified Planner（一次 LLM）
STANDARD Policy ───────────┘              │
                                          ▼
                              Dataset + Case Count
                                          │
                    Dataset / Label / Environment / Trace 配置
                                          │
                                          ▼
                                    Batch Runner
                               ┌──────────┴──────────┐
                               ▼                     ▼
                         DSH Session Trace      Environment Observer
                               └──────────┬──────────┘
                                          ▼
                              Evidence → Label Judges
                                          ▼
                              Case Gate → Run Aggregate
                                          ▼
                         Agent / Run / Case JSON + HTML
```

## 2. 三类资产的职责

| 资产 | 可以声明 | 不应该声明 |
|---|---|---|
| Dataset | 描述、公开题目、输入资产、既有 Label、可用题量、上游答案或检查材料 | 新建 Label、覆盖通用评分语义、选择 Agent |
| Label | 能力语义、所需 L1/L2/L3 证据、可用环境组件、评分标准、LLM Judge 提示词 | 具体 Dataset 题目、Environment 实例地址 |
| Environment | 本次存在的组件、Adapter 配置、采集能力与开关 | Label 分数、Agent 内部 Trace |

Label 与环境组件是多对多关系：一个 Label 可以需要多个组件；一个组件也可以给多个 Label 提供证据。一个组件只使用稳定的组件事实类型，例如 Filesystem 统一为 `FILE`，具体新增、修改、删除保留在事件内容中，不拆成三个组件声明。

## 3. 模块职责

| 模块 | 职责 | 不负责 |
|---|---|---|
| `planning` | 冻结 Target 静态信息；读取 Catalog；一次 LLM 选择 Dataset 和题量 | 执行题目、生成标签、评分 |
| `datasets` | 解析 Dataset 描述和真实题目；组合执行所需外部资产 | 决定 Agent 能力 |
| `runtime` | 创建 Attempt、启动新的 DSH Session、超时/取消和环境复位 | 选择 Dataset、解释分数 |
| `agent-trace` | 在 DSH 内部或 Session 日志侧捕获关键模型、工具、生命周期和回答事件 | 观测外部环境状态 |
| `observation` | 运行文件、进程及其他外部环境 Observer，物化标准 Observation | 采集 Agent 思维或控制 Agent 行为 |
| `evaluation` | 组装 Evidence，逐 Label Judge，形成 CheckResult 和 Gate | 修改原始 Trace/Observer 事实 |
| `platform` | 配置、安全预检、结果 Bundle、Viewer | 定义 Dataset 或评分标准 |
| `storage` | 保存不可变记录与 Artifact | 重新计算业务结论 |
| `app` | CLI、单 Case Workflow 和多 Case Batch 编排 | 定义第二套平行业务规则 |

## 4. Planner

Planner 的动态输入是：

```text
Agent 静态快照
+ Capability Ledger
+ Dataset Catalog（ID、描述、Label、题量和运行条件）
+ Eligibility Index
+ STANDARD Policy
```

Planner 只调用一次 LLM，返回 1–4 个 Dataset，每个 Dataset 当前固定选择 2 个 Case，总数不超过 8。程序负责校验 ID、去重、题量边界和总量；所选 Dataset 的 Label 并集成为本次实际需要 Judge 的 Label。

`planning/prompts/standard.json` 是完整提示词结构，运行时注入上述动态数据；`planning/policies.json` 保存数量规则。数量不写死在业务流程里。

## 5. Case 执行与 Session

Parent Run 是一次完整评测；Case 是 Dataset 中的一道题；Attempt 是这道题的一次执行。当前关系是：

```text
1 Parent Run
  └─ N Cases
      └─ 1 Attempt
          └─ 1 new DSH Session
```

每题只执行一次，不复用上一题对话历史。当前不是新的 OS 进程级安全身份或全新 VM，只达到 Session 分离；因此“新 Session”不能等价为“安全隔离”。

## 6. Agent Trace 与 Environment Observer

### Agent Trace

Agent Trace 用于回答“Agent 在内部执行了什么”，包括：

- Session、模型请求与响应；
- 工具名称、完整关键参数、返回正文和错误；
- 命令、SQL 等实际执行内容；
- Agent 生命周期、步骤和最终回答；
- Agent 生成的可交付文件内容或索引。

Native Probe 是我们接入 DSH 的内部采集插件；当 Native Probe 不可用时，Session 日志适配器可以恢复部分同类事实。`assistant/chunk` 是流式输出碎片，不进入结构化索引，最终回答以聚合事件保存；原始流只在 Raw Trace 中按策略保留。

### Environment Observer

Environment Observer 用于回答“Agent 外部的环境实际发生了什么”。Observer 在 Agent 运行窗口内采样，但只在状态变化时写事件：

- Filesystem：文件创建、修改、删除及内容摘要；
- Process：环境进程、退出和端口变化；
- Browser：运行状态、活动 URL、标签页变化；
- Database：服务、Schema、查询摘要和状态变化；
- External API：请求日志、响应状态和外部副作用；
- Network、Clipboard、Application、System：对应外部组件变化。

Desktop Observer 因窗口权限、截图隐私和恢复复杂度暂时冻结。

## 7. Evidence 与 Judge

Evidence Builder 不替 Agent 补事实，它把 Agent Trace、最终回答、交付物和外部 Observer 记录组织成可索引证据。每个 Label Judge 只读取该 Label 允许的证据，但当前策略宁可提供完整相关 Trace 索引，也不能因过早裁剪丢掉评分需要的信息。

一次 Case 的调用关系：

```text
Planner：整个 Parent Run 1 次
Agent：每个 Case 1 次
Judge：该 Case 覆盖的每个 Label 各 1 次
```

结果为 `PASS`、`FAIL` 或 `UNEVALUABLE`。Agent 明确做错且证据充分为 `FAIL`；采集缺失、Judge 异常或运行条件不可确认应为 `UNEVALUABLE`，不能伪装为 Agent 失败。

## 8. 结果目录

```text
var/evaluation-results/
└── agents/<agent-id>/runs/<run-id>/
    ├── target.json
    ├── run.json
    ├── report.html
    └── cases/<case-id>/
        ├── task.json
        ├── plan.json
        ├── execution.json
        ├── trace/
        │   ├── index.json
        │   ├── status.json
        │   └── raw.jsonl.gz
        ├── observers/
        ├── evidence/
        ├── judge/
        ├── artifacts/
        ├── report.json
        ├── report.html
        └── manifest.json
```

`var/` 是运行产物，不提交 Git。内部 `var/batch-runtime/` 只在执行中使用；Case Bundle 成功发布后应清理临时 records、artifacts 和 runtime homes。

## 9. 当前真实边界

- 已跑通真实 DSH 的两题 Demo 和聚合 Run Report；
- 当前 Case 串行，`caseConcurrency=1`；
- `--max-cases` 是全局 Smoke 截断，不代表“每个 Dataset 的题量”；完整 STANDARD 不应使用它截断为 2；
- Planner 对不可执行 Dataset 的硬过滤仍需加强；
- Agent 仍可能读取 DSHEval 源码或私有评分材料，严格文件系统隔离尚未完成；
- Browser、Database、External API 等 Adapter 已接入运行窗口，但它们的空状态、PARTIAL 和证据导出仍需端到端验收；
- Raw Trace 的渐进式披露和体积控制尚未完成。
