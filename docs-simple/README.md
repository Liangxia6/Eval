# DSHEval 开发总览

## 项目概述

### 是什么

DSHEval 是一套面向完整 DSH Agent 的评测系统。它根据 Agent 的能力选择评测内容，让 Agent 在真实环境中自主执行任务，同时采集 Agent 行为和环境变化，再依据证据给出结果。

一次评测需要回答四个问题：Agent 是什么、接到了什么任务、执行和环境实际发生了什么、最终结论依据什么。

### 解决什么问题

- 不只相信 Agent 的最终回答，而是验证真实执行结果；
- 用统一标签衡量不同 Agent 和数据集；
- 区分 Agent 失败、证据不足、Judge 失败和基础设施故障；
- 保存可复查、可校验、可离线重判的证据与报告。

### 当前范围

MVP 保持一个活动 Run、一个 Dataset、一个 Case、一个 Attempt。当前 Attention + PyTorch Dataset Pack 和 Fixture 已用于回归完整链路；真实 DSH 的 VM 验收仍需单独执行。

多数据集调度、自动重试、复杂加权总分和自动修改 Agent 不进入 MVP。

## 核心概念（接口）

```text
Agent + 目标 Label
→ Planner 选择 Dataset
→ Dataset 提供 Case、环境和 Metric 参数
→ Observer 采集执行事实
→ Metric/Judge 消费密封 Evidence
→ 每个 Label 产生一个结果
```

### 被测 Agent

进入 DSHEval 的完整 DSH Agent。评测前冻结插件树、工具能力、运行配置和安全身份。Agent 的 Label 表示待评测范围，不表示已经通过。

### Dataset

Dataset 包含任务、Case、输入材料、Label、Metric 参数、环境和观测要求。一个 Dataset 可以有多个 Label，同一 Label 可以被多个 Dataset 复用。

### Label

Label 是稳定的 Agent 能力维度，例如记忆、Loop、工具（代码）、工具（文档/PDF）。Agent 和 Dataset 都可以拥有多个 Label。

### Metric

每个 Label 唯一对应一个 Metric。Metric 定义所需证据、判定方法和输出；Dataset 只能提供题目参数，不能替换评分方法。

```text
一个 Label → 一个 Metric → 一个 LabelResult
```

### Environment 与 Observer

Environment 是 Agent 实际操作的文件、进程、数据库或浏览器资源。Agent 自主决定如何操作；Observer 与环境绑定，按访问、变更或进程事件独立采集事实，不替 Agent 编排任务。

## 核心组件

| 组件 | 职责 | 输出 |
|---|---|---|
| Agent 静态能力获取 | 获取插件树、工具、配置并验证身份与权限 | 冻结 Agent 快照 |
| Planner | 选择 Label、Dataset 和观测要求，并通过确定性校验冻结 | EvaluationPlan、ObservationPlan |
| Runtime Probe | 采集生命周期、工具调用、错误和最终回答 | Runtime Trace |
| Environment Observer | 独立采集文件、进程或外部状态变化 | Environment Observations |
| Evidence Builder | 区分原始、标准化和推断事实并密封 | Evidence Closure |
| Judge | 按 Label 对应 Metric 读取密封证据 | PASS / FAIL / UNEVALUABLE |
| Gate | 只根据已保存结果计算一次总体结论 | GateDecision |
| Reset Verifier | Reset 后使用独立观测确认环境状态 | CLEANED / QUARANTINED |
| Storage / Viewer | 保存 JSON、JSONL、Artifact 并生成页面 | status.html、report.html |

## 主链路

```text
Agent 进入
→ 获取静态能力与安全认证
→ Planner 选择 Label、Dataset 和 Observer
→ Agent 自主执行 Case
→ 同步采集 Runtime Trace 和环境变化
→ 整理并密封 Evidence
→ Judge 按 Label 评测
→ Gate 汇总结果
→ Reset 并独立验证
→ 保存证据和生成报告
```

判定规则：证据充分且满足标准为 `PASS`；证据充分且明确不满足为 `FAIL`；证据缺失、损坏或不可信为 `UNEVALUABLE`。Reset 失败单独报告，不修改已经形成的 Agent 结果。

## 文档入口

- [ARCHITECTURE.md](./ARCHITECTURE.md)：模块、组件、边界和主链路；
- [CODE_GUIDE.md](./CODE_GUIDE.md)：按主链路阅读每个源码文件并核对真实完成度；
- [CONTRACTS.md](./CONTRACTS.md)：公共记录、接口和失败语义；
- [TESTING.md](./TESTING.md)：自动化验收和真实 VM 验证。
