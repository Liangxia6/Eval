# DSHEval 代码阅读大纲

> 这份文档用于审查代码职责和真实完成度。建议先看主链路，再按模块下钻；不要从 `core/models.ts` 顺序通读。

## 1. 当前实现结论

当前真正跑通的是：

```text
FULL_AGENT Fixture
→ 冻结与静态检查
→ 按 Label 选择 Attention + PyTorch Dataset
→ 单 Case / 单 Attempt
→ Probe + 文件 Before/After
→ Evidence / Closure
→ Artifact、Response、Tool Judge
→ CheckResult → 单次 Gate
→ Reset 独立验证
→ JSON / JSONL / Artifact / HTML / Viewer
```

当前 Pack 使用“产物交付、指令遵循、代码工具”3 个 Label/Metric。尚未接入：LLM Planner、LLM Judge、PDF/进程 Observer，以及真实 DSH 的 VM 发布验收。

## 2. 推荐阅读顺序

1. [`app/cli.ts`](../src/app/cli.ts)：命令如何进入系统。
2. [`app/bootstrap.ts`](../src/app/bootstrap.ts)：具体服务在哪里组装。
3. [`app/workflow.ts`](../src/app/workflow.ts)：唯一十步主链路和失败收尾。
4. [`planning/target.ts`](../src/planning/target.ts)：Agent 如何冻结、检查能力并复核完整性。
5. [`planning/catalog.ts`](../src/planning/catalog.ts) 与 [`planning/planner.ts`](../src/planning/planner.ts)：Label 如何选择 Dataset，并冻结成计划。
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
| Dataset 选择 | `planning/catalog.ts` | CatalogResolution |
| 计划冻结 | `planning/planner.ts` | EvaluationPlan / ObservationPlan / EvidenceContract |
| 环境与安全 | `runtime/environment.ts`、`platform/security.ts` | EnvironmentInstance / SecurityPreflight |
| Agent 执行 | `runtime/target.ts` | TargetExecutionResult |
| 双通道观测 | `observation/runtime.ts`、`observation/environment.ts` | RawObservation / CollectionStatus |
| 文件事实 | `observation/sensors/file.ts` | FileSnapshot / FileDiff / ResetVerification |
| 证据闭合 | `evaluation/evidence.ts`、`evaluation/closure.ts` | EvidenceBundle / EvidenceClosure |
| 独立判定 | `evaluation/judging.ts` | JudgementRecord / CheckResult |
| 总体结论 | `evaluation/scoring.ts` | GateDecision |
| 保存与报告 | `storage/*`、`evaluation/report.ts`、`platform/export.ts` | JSON / JSONL / Artifact / HTML |
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
| `catalog.ts` | 定义 15 个 Label→Metric，校验 Pack，并按标签选择唯一且完整的 Dataset 执行包。 |
| `planner.ts` | 检查运行能力与 Pack 匹配，冻结 EvaluationPlan、ObservationPlan 和 EvidenceContract。 |

### `runtime`

| 文件 | 职责 |
|---|---|
| `runner.ts` | 创建 Run/Case/Attempt/Environment/ObservationSession 初始 Projection，并验证状态迁移。 |
| `environment.ts` | 创建隔离目录、Seed 文件、暂存 Target、Reset 和精确 Cleanup。 |
| `target.ts` | 用固定 argv/env/cwd 启动一个 DSH Headless 子进程，处理超时、取消和进程组终止。 |

### `observation`

| 文件 | 职责 |
|---|---|
| `coordinator.ts` | 创建 SourceDescriptor，推进 ObservationSession，并生成完成账本。 |
| `runtime.ts` | 有界读取和解析 Probe JSONL，保留原始字节、序号缺口与采集状态。 |
| `environment.ts` | File Sensor 的执行接口、Binding 校验，以及文件观测/采集状态物化。 |
| `sensors/file.ts` | 扫描文件树，构造 Before/After/POST_RESET Snapshot、Diff 和 ResetVerification。 |

### `evaluation`

| 文件 | 职责 |
|---|---|
| `evidence.ts` | 从 Probe 与文件事实生成原始、标准化、推断 Evidence，并密封 Bundle。 |
| `closure.ts` | 按每个 EvidenceContract 独立计算 CLOSED/INCOMPLETE/INVALID。 |
| `judging.ts` | 定义 JudgeImplementation，并实现 Artifact、Response、Tool 与 Protocol 规则 Judge。 |
| `scoring.ts` | 只读取已提交 CheckResult，按固定优先级计算一次 Gate。 |
| `report.ts` | 构造权威 report.json 视图和确定性、无脚本 HTML。 |

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
| `EvaluationCatalogPort` | `planning/catalog.ts` | `JsonEvaluationCatalog` | Bootstrap / Workflow |
| `EvaluationAssetMatchingPort` | `core/contracts.ts` | `EvaluationPlanner` | Bootstrap / Workflow |
| `JudgeImplementation` | `evaluation/judging.ts` | 内置规则 Judge 注册表 | Bootstrap / Workflow |
| `EnvironmentSensor` | `observation/environment.ts` | `FileEnvironmentSensor` | Workflow |
| `RepositoryPort` | `core/contracts.ts` | `FileRepository` | Workflow 持久化函数 |
| `ArtifactStorePort` | `core/contracts.ts` | `FileArtifactStore` | Target 冻结、Workflow、报告 |
| `PreparedObserverBinding` | `core/models.ts` | `issueObserverBinding` 签发 | Observation |

这些接口都有当前调用方。新增或删除复用现有能力的 Dataset 只改 `packs/`；只有出现新的真实环境事实或判定算法时，才增加并注册 Observer 或 Judge 实现。

## 6. 建议重点审查

- `app/workflow.ts`：最大文件；检查十步顺序、catch/finally 和 Reset 后 Gate 是否保持独立。
- `core/models.ts`：类型集中；检查字段是否都被真实链路使用，避免重复领域对象。
- `evaluation/report.ts`：同时包含数据视图和三个 rendererVersion 的兼容渲染，属于可继续收缩但会影响历史报告重建的区域。
- `storage/repositories.ts`：检查不可变记录、Projection CAS、JSONL 和 status 页面是否值得放在同一具体存储实现中。
- `planning/catalog.ts`：通用自包含 Dataset Pack 加载器；不识别 Attention 或具体 Judge ID。

判断代码是否过度生成，可以逐项问：这个导出是否有生产调用方、这个接口是否至少有一个真实实现、这个记录是否被持久化或判定消费、删除它是否会破坏现有 85 个测试中的真实行为。
