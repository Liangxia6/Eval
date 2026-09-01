# DSHEval MVP 总体架构

> 部署：单台 Evaluation Appliance VM｜形态：模块化单体｜执行：单 Run、单 Case、单 Attempt

## 1. 架构目标

MVP 用最短但可信的纵向链路回答三个问题：

1. 被测完整 DSH Agent 是什么？
2. 它在一次确定性任务中做了什么，环境实际发生了什么？
3. 证据是否足以给出 `PASS`、`FAIL` 或 `UNEVALUABLE`？

设计重点不是组件数量，而是证据边界、故障归因和端到端可运行性。

## 2. 部署与信任边界

```text
Mac mini
└── Appliance VM
    ├── DSHEval 模块化单体
    ├── 被测 DSH 0.1.1-rc.2 Agent（Headless）
    │   └── Runtime Probe（协作式来源）
    ├── 隔离文件工作区（Agent 可按任务权限访问）
    ├── File Sensor（独立只读来源）
    └── 本地记录、Artifact 与静态 HTML
```

Mac mini 只负责 VM 生命周期和接收导出结果。MVP 的应用、Agent、环境和观测都在 VM 内，但必须使用不同的逻辑权限：

- Agent 看不到评测资产、Ground Truth、原始证据、Judge 和输出目录；
- Runtime Probe 与 DSH 同进程，信任等级为 `COOPERATIVE`；
- File Sensor 使用 DSHEval 签发的只读 Binding，信任等级为 `INDEPENDENT`；
- Environment Controller 可以 Seed/Reset，但不能代替 Agent 完成任务；
- Judge 只读密封 Evidence，不持有 Agent 或环境控制权限。

MVP 报告必须如实说明这是单 VM 内的逻辑隔离，不声称达到物理主机隔离或抗恶意内核攻击。

## 3. 模块关系

```text
                         ┌──────── core ────────┐
                         │  模型、契约、错误语义 │
                         └──────────────────────┘
                                      │
planning ──冻结目标/选择资产──► app workflow ◄──配置/安全── platform
                                      │
                                      ▼
                                  runtime
                              执行 Agent 与环境
                                      │
                                      ▼
                                observation
                           Probe + File Before/After
                                      │
                                      ▼
                                evaluation
                       Evidence/Closure/Judge/Report
                                      │
                                      ▼
                                  storage
                           JSON/JSONL/Artifact
```

`app` 是唯一组合根；业务模块之间通过 `core` 契约协作，不互相读取内部状态。模块化单体不等于所有职责混在一个 Workflow 中。

## 4. 一次 Run 的固定十步

| 步骤 | 行为 | 门禁/产物 |
|---:|---|---|
| 1 | 冻结 Agent、配置和资产摘要 | TargetSnapshot、ConfigSnapshot、FilesystemPack Ref 与摘要 |
| 2 | Inspector 读取 DSH/Profile/插件/权限事实 | InspectionSnapshot；关键未知则停止 |
| 3 | Planner 从 filesystem pack 选择 Case 与 Checks | 冻结 EvaluationPlan/ObservationPlan/EvidenceContract |
| 4 | 机械校验冻结 CasePlan → 获取 Lease → 一次创建 Run/Case/Attempt → Security Preflight | 初始对象 Ref 与 SecurityPreflight；不创建第二套 Case，不重新匹配 |
| 5 | 创建隔离工作区、Seed、打开观测并采 Before | SeedManifest、Baseline；失败不启动 Agent |
| 6 | 启动 DSH Headless 并提交任务 | 一个 Attempt；Probe 持续写 JSONL |
| 7 | Agent 结束后 Drain，采 After/Diff 并密封 | RawObservation、CollectionStatus、EvidenceClosure |
| 8 | 执行 Protocol、File State、Path Security Judge | 三个已提交 CheckResult；此时尚不创建 Gate |
| 9 | Reset，并用独立只读 File Verification 检查 | Verified 或 Quarantined；不改 Agent Verdict |
| 10 | 从已保存 CheckResult 计算一次 Gate，提交 Run 终态并交付 | JSON/JSONL/Artifact、status.html、report.html |

每一步都有门禁。当前步骤失败后先保存可用现场、分类故障并进入安全收尾，不能带着无效输入继续评分。

## 5. 两大核心接口

### 5.1 Evaluation Asset Matching Port

职责是把“这个 Agent 在 MVP 中测什么”变为一个确定性、可编译的选择。

```text
输入：FULL_AGENT TargetSnapshot + InspectionSnapshot
    + 固定 Scope + filesystem pack + 当前 Probe/File Sensor 能力
输出：PlanBuildResult
    FROZEN = EvaluationPlan + ObservationPlan + 三个 EvidenceContract
    UNSATISFIABLE = 结构化缺口 + FailureDraft
```

约束：

- Catalog 只加载、校验和解析资产；
- Planner 独占选择权，并记录为何选择或不能选择；
- Case Compiler 只按选择结果组装，不得重新规划；
- MVP 只允许 filesystem environment/scenario/domain/judge；收到其他资产类型时明确 `REJECTED(UNSUPPORTED)`，不产生部分 Plan；
- 匹配阶段不读取运行中的环境。

该 Port 保留未来多环境、多 Check 的形状，但当前不实现通用规则引擎、插件工厂或动态优化器。

### 5.2 Environment Observation Port

职责是按冻结计划取得真实环境证据，而不是决定测什么。

```text
输入：ObservationPlan + EnvironmentInstance/Generation
    + 冻结 File Sensor 描述 + 只读 PreparedObserverBinding
输出：Before/After/Diff RawObservation
    + CollectionStatus + 水位/完整度/Failure
```

约束：

- File Sensor 在 Agent 启动前完成 Before，在 Agent 结束和稳定窗口后完成 After；
- Sensor 实现 ID、版本、能力摘要与 Binding 必须和计划一致；
- 未扫描、读取失败或越出声明范围不能解释为“没有变化”；
- Controller 的写权限不能交给 Sensor，Agent 的凭据不能交给 Observer；
- Reset 后 Verification 使用新的只读观测上下文，不写回已密封的 Agent Evidence。

## 6. 证据与判定

```text
Probe JSONL ───────┐
                   ├─► 标准 Evidence ─► Closure ─► Judges ─► CheckResults
File Before/After ─┘                                      │
                                         Reset/Verification 完成后
                                                         ▼
                                                   Gate / Verdict
```

三个 Judge 的职责：

| Judge | 判定内容 | 主要来源 |
|---|---|---|
| Protocol | Probe 边界、序号、作用域和任务生命周期是否有效 | Runtime Probe |
| File State | 目标文件内容、摘要、输入不变和无额外最终副作用 | File Sensor |
| Path Security | 最终变化是否只出现在允许路径，是否出现链接/根边界违规 | 独立 File Sensor + 冻结策略 |

Verdict 规则：

- 任一确定性硬错误：`FAIL`；
- 无硬错误，但任一强制 Check 因缺失、损坏、作用域错误或信任不足不能判定：`UNEVALUABLE`；
- 三个强制 Check 均可判且通过：`PASS`。

Tool/Agent 声称成功不能替代 File State；文件正确也不能修复无效 Protocol。Judge 崩溃不产生分数，记录 `judge_error` 并使总体不可判。

## 7. 状态、故障与收尾

Run、Case、Attempt、Observation 和 Environment 分别维护自己的单向生命周期，精确枚举只在[公共契约](./development/CONTRACT_CATALOG.md)定义。Observation 明确经过 `PLANNED→BASELINING→BASELINED→ACTIVE→DRAINING→SEALED`；采集完整度另行记录，不伪装成生命周期状态。任何状态都必须由已提交事实驱动，不能跳过 Before、Seal、Judge 或 Reset 门禁。

报告把公共 FailureRecord 按确定性映射归入 `plan_conflict`、`infrastructure_error`、`collector_error`、`agent_failure` 或 `judge_error`；这五项是只读展示分组，不是第二套持久化枚举。Run 状态描述流程健康，Verdict 描述 Agent 的评测结论，二者不能互相覆盖。

MVP `maxAttempts=1`，任何故障都不自动重试。Agent 结束、超时或取消后，尽可能 Drain、保存部分证据并执行 Reset。Reset 验证失败时隔离环境、阻止后续 Run，但 Gate 仍只依据步骤 8 已保存的 CheckResult 计算；环境故障可以令 Run 操作状态失败，不能改写 Agent Verdict。

## 8. 权威数据与可视化

- JSON/JSONL 与带摘要的 Artifact 是权威事实；
- `status.html` 展示十步进度、当前门禁和故障提示，只显示已提交状态；
- `report.html` 从最终 EvaluationReport JSON 渲染，不运行 Judge；
- 页面不得包含凭据、原始 Secret 或可执行的 Agent 内容；
- 同一密封 Evidence 离线重判必须得到相同结果。

## 9. DEFERRED 扩展边界

PostgreSQL、HTTP、Browser、插件 Target、多 Case、Retry、Gap、Repair、Multi-Agent 和语义 Judge 均不在 MVP 主流程中。未来只能通过：

1. 新的版本化评测资产；
2. 新的 Environment/Sensor 实现；
3. 新的 Judge；
4. 新 Plan 和新 Run；

来扩展，不能改变已密封证据或复用旧 Run 得出新成绩。
