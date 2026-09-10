# DSHEval 代码阅读大纲

> 这份文档用于审查代码职责和真实完成度。建议先看主链路，再按模块下钻；不要从 `core/models.ts` 顺序通读。

## 1. 当前实现结论

当前真正跑通的是：

```text
FULL_AGENT Fixture
→ 冻结与静态检查
→ 按 Label 选择 Attention + PyTorch Dataset
→ 单 Case / 单 Attempt
→ Agent Trace + 环境文件 Before/After
→ Evidence / Closure
→ Artifact、Response、Tool Judge
→ CheckResult → 单次 Gate
→ Reset 独立验证
→ JSON / JSONL / Artifact / HTML / Viewer
```

唯一主链是：静态检查 → 动态读取 Dataset 描述与既有标签 → 统一 LLM Planner 一次选择 Dataset 和题量 → 从 Dataset、Label、Agent Trace、Environment 配置组合执行资产 → 确定性编译运行期计划 → Agent 执行 → 每个标签调用一次 LLM Judge。多 Dataset 可先完成选择，执行阶段仍是单 Case MVP；进程、浏览器、数据库 Observer 目前只有配置声明，尚无实现。

## 2. 推荐阅读顺序

1. [`app/cli.ts`](../src/app/cli.ts)：命令如何进入系统。
2. [`app/bootstrap.ts`](../src/app/bootstrap.ts)：具体服务在哪里组装。
3. [`app/workflow.ts`](../src/app/workflow.ts)：唯一十步主链路和失败收尾。
4. [`planning/target.ts`](../src/planning/target.ts)：Agent 如何冻结、检查能力并复核完整性。
5. [`planning/planner.ts`](../src/planning/planner.ts) 与 [`datasets/catalog.ts`](../src/datasets/catalog.ts)：一次 LLM 如何根据静态信息和 Dataset 描述选集。
6. [`runtime/environment.ts`](../src/runtime/environment.ts) 与 [`runtime/target.ts`](../src/runtime/target.ts)：环境和 Agent 如何真正启动。
7. [`observation/`](../src/observation)：执行信息和环境变化如何独立采集。
8. [`evaluation/`](../src/evaluation)：证据如何闭合、判定和汇总。
9. [`storage/`](../src/storage) 与 [`platform/`](../src/platform)：事实如何保存、安全交付和展示。
10. 最后查 [`core/models.ts`](../src/core/models.ts) 和 [`core/contracts.ts`](../src/core/contracts.ts) 中对应的数据定义。

## 3. 主链路与文件

| 阶段 | 主文件 | 关键输出 |
|---|---|---|
| CLI 入口 | `app/cli.ts` | CliCommand / WorkflowSummary |
| 服务组装 | `app/bootstrap.ts`、`platform/config.ts` | ApplicationServices / ConfigSnapshot |
| Agent 静态信息 | `planning/target.ts` | TargetSnapshot / InspectionSnapshot |
| Dataset 选择 | `planning/planner.ts`、`datasets/catalog.ts` | DatasetSelectionPlan |
| 运行期计划编译 | `runtime/evaluation-plan-compiler.ts` | EvaluationPlan / AgentTracePlan / ObservationPlan / EvidenceContract |
| 环境与安全 | `runtime/environment.ts`、`platform/security.ts` | EnvironmentInstance / SecurityPreflight |
| Agent 执行 | `runtime/target.ts` | TargetExecutionResult |
| Trace 与环境观测 | `observation/runtime.ts`、`observation/environment.ts` | RawObservation / CollectionStatus |
| 文件事实 | `observation/sensors/file.ts` | FileSnapshot / FileDiff / ResetVerification |
| 证据闭合 | `evaluation/evidence.ts`、`evaluation/closure.ts` | EvidenceBundle / EvidenceClosure |
| 独立判定 | `evaluation/judging.ts` | JudgementRecord / CheckResult |
| 总体结论 | `evaluation/scoring.ts` | GateDecision |
| 保存与报告 | `storage/*`、`evaluation/report*.ts`、`platform/export.ts` | JSON / JSONL / Artifact / HTML |
| 本机查看 | `platform/viewer.ts`、`app/viewer-cli.ts` | 回环 HTTP Viewer |

## 4. 每个生产文件的职责

### `core`

| 文件 | 职责 |
|---|---|
| `models.ts` | 定义系统中的数据：Agent、计划、Case、Attempt、证据、判定结果，以及这些数据的 ID、状态和摘要规则。 |
| `contracts.ts` | 定义模块怎样合作：调用时携带什么信息，以及成功、条件不满足、失败和取消分别怎样返回。 |
| `errors.ts` | 定义失败怎样表达：问题来自哪里、发生在哪一步，以及报告中归为 Agent、采集、Judge 还是基础设施失败。 |

### `planning`

| 文件 | 职责 |
|---|---|
| `target.ts` | 冻结 Agent，提取 DSH/Profile/Probe/工具能力，并在执行前复核 Agent 是否被修改。 |
| `agent-static.ts` | 把已有 DSH Inspection 纯投影成统一 Planner 的非敏感静态输入，不调用模型。 |
| `planner.ts` | 动态注入 Agent 静态信息和全部 Dataset 描述，只调用一次 API，并校验选集与题量。 |

### `datasets`

| 文件 | 职责 |
|---|---|
| `catalog.ts` | 只读取 `datasets/catalog.md` 中的描述、既有标签和题量。 |
| `evaluation-asset.ts` | 读取选中题目，并把 Dataset、Label、Environment 组合为执行内核输入。 |

### `runtime`

| 文件 | 职责 |
|---|---|
| `runner.ts` | 创建 Run/Case/Attempt/Environment/ObservationSession 初始 Projection，并验证状态迁移。 |
| `environment.ts` | 创建隔离目录、Seed 文件、暂存 Target、Reset 和精确 Cleanup。 |
| `target.ts` | 用固定 argv/env/cwd 启动一个 DSH Headless 子进程，处理超时、取消和进程组终止。 |
| `evaluation-plan-compiler.ts` | 不调用 LLM；分别冻结 AgentTracePlan、Environment ObservationPlan 与 Label EvidenceContract。 |

### `observation`

| 文件 | 职责 |
|---|---|
| `coordinator.ts` | 协调 Agent Trace 与 Environment Observer 两条采集通道，并生成完成账本。 |
| `runtime.ts` | 采集 Agent Trace：有界读取和解析 Probe JSONL，保留原始字节、序号缺口与采集状态。 |
| `environment.ts` | File Sensor 的执行接口、Binding 校验，以及文件观测/采集状态物化。 |
| `sensors/file.ts` | 扫描文件树，构造 Before/After/POST_RESET Snapshot、Diff 和 ResetVerification。 |

### `evaluation`

| 文件 | 职责 |
|---|---|
| `evidence.ts` | 从 Probe 与文件事实生成原始、标准化、推断 Evidence，并密封 Bundle。 |
| `closure.ts` | 按每个 EvidenceContract 独立计算 CLOSED/INCOMPLETE/INVALID。 |
| `judging.ts` | 定义 JudgeImplementation，并实现 Artifact、Response、Tool 与 Protocol 规则 Judge。 |
| `llm-label-judge.ts` | 逐标签加载 `labels/*.json`，每个标签只调用一次 LLM Judge。 |
| `evaluation-asset.ts` | 兼容执行内核的数据校验器；手写 Pack 仅供测试 Fixture。 |
| `scoring.ts` | 只读取已提交 CheckResult，按固定优先级计算一次 Gate。 |
| `report.ts` | 验证并投影已保存事实，生成权威 report.json、运行状态页和最终 HTML 结构。 |
| `report-types.ts` | 集中定义报告输入和页面视图的数据结构。 |
| `report-html.ts` | 把报告视图渲染为无脚本的实时状态页或最终审计页，包含各版本内联样式。 |

### `storage`

| 文件 | 职责 |
|---|---|
| `repositories.ts` | 保存不可变 JSON、生命周期 revision、事件 JSONL 和 status.html，复核摘要与 Scope。 |
| `artifacts.ts` | 内容寻址 Artifact 的 staging、seal、commit、验证读取和恢复检查。 |

### `platform`

| 文件 | 职责 |
|---|---|
| `config.ts` | 合并配置来源，验证 Root/Deadline/Secret 引用并冻结 ConfigSnapshot。 |
| `security.ts` | 验证 OS 身份、setpriv、路径和网络，签发只读 Observer Binding，扫描 Secret。 |
| `services.ts` | 管理单 VM Lease，检查持久化 Root 和未完成 Run。 |
| `export.ts` | 原子提交报告文件并生成带 SHA-256 的导出 Manifest。 |
| `case-bundle.ts` | 将已提交事实导出为按 Agent/Run/Case 分组的自包含结果包。 |
| `viewer.ts` | 仅在回环地址安全读取 status/report HTML，供 SSH 隧道实时查看。 |

### `app`

| 文件 | 职责 |
|---|---|
| `bootstrap.ts` | 唯一服务组合根，实例化 Storage、Sensor、Planner 并完成启动健康检查。 |
| `workflow.ts` | 唯一端到端状态机，驱动十步主链路和所有失败收尾。 |
| `cli.ts` | inspect/plan/run/report 参数解析、退出码和单条 JSON 输出。 |
| `viewer-cli.ts` | Viewer 参数解析、启动和信号关闭。 |

## 5. 真实接口与当前实现

| 接口 | 定义位置 | 当前实现 | 调用方 |
|---|---|---|---|
| `EvaluationCatalogPort` | `evaluation/evaluation-asset.ts` | `JsonEvaluationCatalog`（Fixture 兼容） | Bootstrap / Workflow |
| `EvaluationAssetMatchingPort` | `core/contracts.ts` | `ExecutionPlanCompiler` | Bootstrap / Workflow |
| `JudgeImplementation` | `evaluation/judging.ts` | 内置 Fixture Judge + 外部 Label LLM Judge | Bootstrap / Workflow |
| `EnvironmentSensor` | `observation/environment.ts` | `FileEnvironmentSensor` | Workflow |
| `RepositoryPort` | `core/contracts.ts` | `FileRepository` | Workflow 持久化函数 |
| `ArtifactStorePort` | `core/contracts.ts` | `FileArtifactStore` | Target 冻结、Workflow、报告 |
| `PreparedObserverBinding` | `core/models.ts` | `issueObserverBinding` 签发 | Observation |

新增或删除 Dataset 只改 `datasets/`；修改证据要求或评分只改 `labels/`；组件到 Observer 的绑定只改 `environments/`。只有新增 Observer 实现时才修改源码。

## 6. 建议重点审查

- `app/workflow.ts`：最大文件；检查十步顺序、catch/finally 和 Reset 后 Gate 是否保持独立。
- `core/models.ts`：类型集中；检查字段是否都被真实链路使用，避免重复领域对象。
- `evaluation/report.ts`：把已提交事实投影为审计页，直接展示任务、stdout/stderr、Trace、文件摘要和标签判定；旧 rendererVersion 仅用于历史报告重建。
- `storage/repositories.ts`：检查不可变记录、Projection CAS、JSONL 和 status 页面是否值得放在同一具体存储实现中。
- `datasets/evaluation-asset.ts`：确认它只组合外部配置，没有重新定义标签或 Observer 规则。

判断代码是否过度生成，可以逐项问：这个导出是否有生产调用方、这个接口是否至少有一个真实实现、这个记录是否被持久化或判定消费、删除它是否会破坏现有 85 个测试中的真实行为。
