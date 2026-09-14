> **团队协作约定：** [项目组开发与数据互通约定](TEAM-DEVELOPMENT-GUIDE.md) 汇总共享字段、现行接口与新项目接入建议。

> **2026-09-12 评分链路更新：** 当前接口以 [Evaluation 重构说明](EVALUATION-REFACTOR-20260912.md) 为准。下文出现的 Pack、EvidenceContract、Closure、Gate 和旧评分报告字段均已移除；历史说明保留用于追溯。

# DSHEval 开发总览

## 当前结论

DSHEval 已在 VMmac 中跑通真实 DSH 的端到端 Demo：读取 Agent 静态信息，一次调用统一 Planner 选择 Dataset 和题量，为每个 Case 新建 DSH Session，采集 Agent Trace 与外部环境变化，再按 Dataset 覆盖的每个 Label 分别调用一次 LLM Judge，最后生成 Case 报告和整个 Run 的汇总报告。

当前默认测试规模只保留 `STANDARD`：选择 1–4 个 Dataset，每个 Dataset 2 个 Case，最多 8 个 Case。Case 当前串行运行，每题只执行一次。

## 一次真实评测

```text
真实 DSH Target
  ↓ 静态观测
AgentStaticSnapshot + Dataset Catalog + STANDARD Policy
  ↓ 统一 Planner（1 次 LLM API）
DatasetSelection（Dataset + 每集题量）
  ↓ 程序读取每个 Dataset 的真实题目与既有 Label
Parent Run
  ├─ Case 1 → 新 DSH Session → Trace/Observer → 每标签 Judge
  ├─ Case 2 → 新 DSH Session → Trace/Observer → 每标签 Judge
  └─ ...
  ↓
Case Report + Run Report
```

这里有三条不可混淆的边界：

- Planner 只选 Dataset 和题量，不给 Agent 单独打标签；Agent 的评测标签是所选 Dataset 既有标签的并集。
- Agent Trace 来自 DSH 内部事件或 Session 日志，记录模型、工具、最终回答和执行顺序；Environment Observer 只记录 Agent 外部环境的实际变化。
- Dataset 提供题目和标签；Label 提供证据要求、评分标准和 Judge 提示词；Environment 提供组件及 Observer 配置。

## 当前目录职责

| 目录 | 职责 |
|---|---|
| `planning/` | `STANDARD` Planner 提示词与题量策略；静态快照和 Dataset 描述在运行时注入 |
| `datasets/` | Dataset 总目录、描述、公开题目、输入资产与上游评分材料 |
| `labels/` | 14 个 Label 的证据要求、评分标准和 LLM Judge 提示词 |
| `environments/` | macOS 环境组件及其 Observer 需求 |
| `trace/` | Agent Trace 来源和采集约束，不属于 Environment Observer |
| `observer-lab/` | Browser、Database、External API 等外部环境适配器 |
| `src/` | Planner、执行、采集、Evidence、Judge、报告和批处理主流程 |
| `var/evaluation-results/` | 真实评测产物；不提交 Git |

## 已经验证

- 真实 DSH `headless` Target 的静态检查；
- 一次 DeepSeek Planner API 调用；
- Planner 结果展开为多个不重复 Case；
- 每个 Case 创建独立的新 DSH Session；
- DSH Session/Native Probe Trace、文件和进程观测；
- 每个 Label 一次 LLM Judge；
- Agent/Run/Case 结果目录、Case HTML 和聚合 Run HTML；
- `assistant/chunk` 不进入结构化 Trace 索引。

## 当前未完成

- Planner 尚需在 LLM 选择前硬过滤缺少环境 Adapter 或上游 Evaluator 的 Dataset；
- 当前隔离等级是 `SESSION_SEPARATED`，尚未阻止 Agent 读取 DSHEval 源码和 Dataset 私有评分材料；
- Browser、Database、External API Observer 已有运行适配器，但 Case Bundle 中的状态和证据接入仍需完整验证；
- Raw Trace 仍偏大，后续需要渐进式披露，同时保留命令参数、SQL、工具返回正文和最终回答；
- Desktop Observer 暂时冻结；并行 Case、Retry 和分布式调度暂不启用。

## 文档入口

- [ARCHITECTURE.md](./ARCHITECTURE.md)：当前模块边界和真实主链路；
- [CODE_GUIDE.md](./CODE_GUIDE.md)：按流程阅读源码及重点审查位置；
- [CONTRACTS.md](./CONTRACTS.md)：跨模块记录、状态和接口约束；
- [TESTING.md](./TESTING.md)：自动测试、VMmac 单步调试和真实 Demo 验收；
- [AGENT_DATASETS.md](./AGENT_DATASETS.md)：Dataset 调研资料，不是运行时 Catalog 或数据格式规范。

> `docs-simple/assets/` 中的旧架构图保留作历史材料，但包含已废弃的“先给 Agent 打标签”和单 Case 表述，当前行为以本目录 Markdown 文档和实际代码为准。

- [Observer 全量观测与变化证据](OBSERVER-CHANGES-20260912.md)：当前目录、结果格式和实测情况。
