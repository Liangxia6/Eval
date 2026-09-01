# App 模块 MVP 开发规格

> 源码：`src/app/`｜形态：单 CLI、单进程编排｜完整版扩展参考：[app.md](../../docs/development/app.md)

## 1. 目标与边界

App 是唯一组合根，按固定顺序调用七个业务模块，保证每一步门禁、失败归因和安全收尾。它只编排，不复制 Planner、Sensor、Judge、Storage 的规则。

| 文件 | MVP 职责 |
|---|---|
| `bootstrap.ts` | 装配配置、Repository、ArtifactStore 和各模块，检查启动健康并按逆序关闭 |
| `workflow.ts` | 执行单 Target、单 Case、单 Attempt 的完整评测流程 |
| `cli.ts` | `inspect`、`plan`、`run`、`report` 最小命令和稳定退出码 |

MVP 不提供 HTTP API、任务队列、后台 Worker、依赖注入框架、插件系统或多 Run 调度器。

## 2. 固定十步流程

```text
1. Freeze Target
2. Inspect
3. Plan
4. Compile Case
5. Prepare + Seed + Baseline
6. Execute + Observe
7. Drain + Evidence Closure
8. Judge（保存 CheckResult）
9. Reset + Independent Verification + Cleanup
10. Gate + Run 终态 + Report/HTML/Export
```

每一步只读取上一步已提交对象。失败必须停在当前门禁，保存 Failure，并执行当时仍安全可行的收尾；禁止带着坏环境、未密封证据或失败 Judge 继续制造分数。

## 3. Workflow

### 3.1 运行前

1. 加载并冻结 ConfigSnapshot。
2. 登记并冻结 FULL_AGENT Target；校验入口、Profile、锁文件和摘要。
3. Inspector 生成最小插件清单、文件能力与风险/未知项。
4. Planner 通过 filesystem pack 产生唯一 EvaluationPlan、ObservationPlan、EvidenceContract。
5. Case Compiler 只机械校验冻结 CasePlan；任何资产不兼容立即 `PLAN_UNSATISFIABLE`，不创建第二套 Case 对象。
6. 预分配 Run/Case/Attempt ID，获取单 Run Lease，一次性创建对应 Revision 0 对象，再以已提交 Run Ref 执行 Storage/磁盘/身份/DSH/File Sensor 健康与 Security Preflight。

### 3.2 执行边界

1. 复用步骤 4 已创建的 Run/Case/Attempt，创建唯一 EnvironmentInstance，并准备 Target 启动上下文。
2. Prepare/Seed 文件 Workspace，提交 Seed Manifest。
3. 打开 Observation，采集 Before；只有 Session=`BASELINED` 才允许 Target STARTING。
4. 激活 Observation，再启动 one-shot DSH Headless 进程。
5. 等 Target 退出/超时；无论成功与否都 Drain Probe、采集 After 并 Seal。
6. Evaluation 生成 Bundle、逐 Check Closure、三个 Judge 和 CheckResult。
7. 关键观察/证据/结果提交后才 Reset；独立 File Verification 必须确认干净，再 Cleanup 到 CLEANED。失败则 QUARANTINED/CLEANUP_FAILED。
8. Reset 尝试及环境终态已提交后，再原子生成一次 Gate；Gate 只表达 Agent 评测结果，Cleanup 故障不能改写它。Run 随后进入终态并生成权威 JSON/只读 HTML，最后释放 Lease。

MVP 不自动 Retry。任何重跑由用户创建新 Run，原运行保留。

### 3.3 证据闭合条件

进入 Evaluation 前至少满足或明确失败：Target 已终止、Probe 文件稳定、已观察 Tool Call 已配对或列为缺口、After Snapshot 完成、来源水位记录、稳定窗口结束。到期仍不完整则 Seal 合法前缀，相关 Check `UNEVALUABLE`。

## 4. 状态与失败

MVP Run 状态直接采用公共契约，不增加 `READY` 或 `CANCELLING`：

```text
CREATED → PREFLIGHTING → RUNNING → FINALIZING → FINISHED
任一活动状态在步骤 10 收口为 FAILED 或 CANCELLED
```

App 只保存公共契约的 `FailureRecord.category/origin/actor`。页面和 CLI 可以使用下列派生分组，但不得持久化第二套枚举：

| 分类 | 处理 |
|---|---|
| `plan_conflict` | Target/配置/资产/能力不兼容；不创建执行对象 |
| `infrastructure_error` | Platform/Environment/Storage/Report/Cleanup；不记 Agent FAIL |
| `collector_error` | Observation/Evidence 采集失败；保存部分证据，相关 Check UNEVALUABLE |
| `agent_failure` | TARGET 执行或已证实安全问题；由可信证据决定 FAIL/UNEVALUABLE |
| `judge_error` | Judge Failure；提交 ERROR Judgement 与 UNEVALUABLE CheckResult，不覆盖 Agent 事实 |

首个导致终止的 Failure 为 primary；Drain/Reset/Report 等后续故障为 secondary。所有关闭操作幂等，重复调用不能产生第二个 Gate、第二次删除或重复 Artifact。

## 5. CLI

| 命令 | 作用 |
|---|---|
| `inspect --target <descriptor>` | 冻结并检查 Target，输出 Snapshot/能力摘要 |
| `plan --target <snapshot>` | 生成并展示一个 filesystem EvaluationPlan |
| `run --target <descriptor> [--pack <filesystem-pack>]` | 让 Planner 使用默认或显式的唯一 filesystem pack，执行完整 MVP 流程 |
| `report --run <runId>` | 从已提交 Report JSON 重建/验证 HTML，不重跑 Judge |

stdout 只输出单个可解析 JSON 摘要；日志和诊断写 stderr；Secret 永不输出。

退出码：`0 PASS`、`1 FAIL`、`2 PLAN_UNSATISFIABLE`、`3 UNEVALUABLE`、`4 DSHEval/交付失败`、`130 用户取消`。操作性失败优先于已有 Verdict，但 JSON 同时保留原 Gate。

## 6. 可视化触发

Run 创建后生成 `status.html`，每个已提交阶段后原子替换；失败时保留上一完整版本。Run 终态后先提交 `report.json`，再由 Reporter 生成 `report.html`。App 只负责触发与提交，不拼接 HTML 业务结论。

## 7. 防止 MVP 变成屎山

- Workflow 只依赖模块 Port，不直接读模块内部文件或对象字段。
- 一个行为只在一个模块实现；App 不复制状态迁移、匹配或判定规则。
- 不为尚未实现的数据库、浏览器、多 Agent、Retry 写工厂和空实现。
- 不创建万能 `Manager/Service/Utils`；共享类型进入 `core`，纯工具靠近唯一消费者。
- 每完成一层必须通过单元测试和当前端到端文件 Case，再继续下一层。
- 新增抽象必须有至少两个真实消费者，或对应当前 MVP 的安全/可测试边界。

## 8. MVP 要求与验收

| ID | 要求 |
|---|---|
| `MVP-APP-REQ-001` | Bootstrap 是唯一组合根，业务模块不反向依赖 App |
| `MVP-APP-REQ-002` | Workflow 严格执行十步门禁，不复制领域规则 |
| `MVP-APP-REQ-003` | Baseline 前不启动 Target，Seal/证据提交前不 Reset |
| `MVP-APP-REQ-004` | 任一终态后尽力 Drain、保存、Reset/隔离并释放 Lease |
| `MVP-APP-REQ-005` | CLI 输出、退出码和 Failure 分类稳定且无 Secret |
| `MVP-APP-REQ-006` | 报告/HTML 失败不改变已提交 Gate |

| ID | 验收条件 |
|---|---|
| `MVP-APP-AC-001` | 一条命令完成文件任务从 Target 冻结到 report.html |
| `MVP-APP-AC-002` | Observation 未 BASELINED 时不存在 Target Start ControlEvent |
| `MVP-APP-AC-003` | 任意注入故障停在正确阶段并保留此前事实 |
| `MVP-APP-AC-004` | 重复取消/关闭不重复写 Gate、Artifact 或清理邻接目录 |
| `MVP-APP-AC-005` | stdout JSON、stderr、退出码与 Run/Gate 状态一致 |
| `MVP-APP-AC-006` | HTML 故障仅产生交付 Failure，原 Gate 可重新读取 |
| `MVP-APP-AC-007` | 依赖门禁证明 Bootstrap 是唯一组合根，七个业务模块均不反向导入 App |

## 9. 延后实现

多 Case/Attempt、自动 Retry、恢复执行、并行/远程调度、HTTP Control Plane、Progress Supervisor、Repair Agent。未来能力必须通过现有 Workflow Port 插入，不把 MVP 主流程重写成事件总线或微服务。
