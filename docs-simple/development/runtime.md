# Runtime：MVP 开发规格

> 本文直接约束 MVP 代码生成，不是完整版 Runtime 文档的摘要。未写入“必须实现”的能力不得提前建设。

## 1. 固定范围

Runtime 只负责把一个已经冻结的完整 DSH Agent 跑完，并安全准备、复位文件环境。固定约束如下：

| 项目 | MVP 决策 |
|---|---|
| 被测对象 | `FULL_AGENT`；不安装、替换或追加单插件 |
| 容量 | 单 VM、单活动 Run、单 Case、单 Attempt |
| 重试 | `maxAttempts=1`，不自动 Retry |
| Agent 入口 | DSH Headless 子进程 + Runtime Probe |
| 环境 | 一个隔离文件 Workspace |
| 调度 | 同步串行；不实现队列、并发和远程执行 |

Runtime 不选 Check、Case、Judge 或 Sensor，不生成 Evidence、分数和 Verdict，也不能修改冻结的 Target、Plan 或任务。

## 2. 文件职责

| 文件 | 唯一职责 |
|---|---|
| `src/runtime/target.ts` | 校验并启动 DSH Headless、管理进程组、超时与停止、记录终止事实 |
| `src/runtime/runner.ts` | 驱动唯一 Run/Case/Attempt 的顺序和状态；调用由 App 提供的观测、评测完成凭据 |
| `src/runtime/environment.ts` | 创建文件 Workspace、Seed 输入、Reset、输出环境控制事实 |

三个文件可以共享 `core` 类型，但不得再拆 Driver 工厂、重试策略层、调度层或插件适配层。

## 3. 最小输入与输出

Runtime 输入：

- 已冻结且摘要复核通过的 `TargetSnapshot`、`EvaluationPlan`、`CasePlan`、`ConfigSnapshot`。
- `targetKind=FULL_AGENT`、DSH 可执行文件、Profile、工作目录、Probe Schema 与 Probe 暂存位置。
- 固定文件环境定义、Seed 文件、任务文本、执行 Deadline。
- 当前 Run/Case/Attempt ID，以及 Observation 和 Evaluation 返回的已提交凭据。

Runtime 必须持久化以下事实：

```text
ExecutionAttempt
  attemptId, caseId, ordinal=1, state, revision
  workspacePath, runtimeDshHomePath, sourceRunId
  startedAt?, endedAt?, terminationKind?
  stdoutArtifactRef?, stderrArtifactRef?, failureRefs[]

EnvironmentInstance
  environmentInstanceId, attemptId, environmentId, state, revision
  workspaceBinding, resetGeneration
  seedManifestRef?, baselineSnapshotRef?, failureRefs[]

ControlEvent
  controlEventId, scope
  operation(TARGET_START|TARGET_STOP|ENV_PREPARE|ENV_SEED|ENV_RESET|ENV_CLEANUP)
  startedAt, endedAt, result, failureRefs[]
```

`workspaceRoot` 是平台解析后的内部绝对路径，不得来自 Agent 输入，也不得进入 Agent 可控制的命令片段。

## 4. 最小状态机

只实现下列状态，不为未来状态预留空处理器：

```text
Run:     CREATED → PREFLIGHTING → RUNNING → FINALIZING → FINISHED
         FINALIZING → FAILED | CANCELLED

Case:    PENDING → RUNNING → EVALUATING → FINISHED
         RUNNING/EVALUATING → ERRORED | ABORTED

Attempt: PENDING → RUNNING → SUCCEEDED
                       ├── TARGET_FAILED
                       ├── TIMED_OUT
                       ├── HARNESS_ERROR
                       ├── ENVIRONMENT_ERROR
                       └── CANCELLED

Environment:
         CREATED → PREPARED → SEEDED → IN_USE → RESETTING → VERIFIED → CLEANED
         活动阶段 → QUARANTINED | CLEANUP_FAILED
```

每次迁移先校验当前 Revision，再把事件写入 Storage，成功后才能执行下一阶段。失败先保存 Failure 并尽力完成第 9 步，Run 只在第 10 步进入 `FINISHED/FAILED/CANCELLED`，不得提前把内存状态当终态。

## 5. 在全链十步中的位置

```text
1. Freeze Target
2. Inspect
3. Plan
4. Compile Case
5. Prepare/Seed/Baseline
6. Execute/Observe
7. Drain/Seal/Closure
8. Judge/CheckResult
9. Reset + Independent Verification + Cleanup
10. Single Gate + Run terminal + Report
```

Runtime 只参与第 5、6、9 步：第 5 步创建 Workspace/Seed，并等待 Observation Baseline；第 6 步运行 DSH；第 9 步在收到第 8 步已提交凭据后执行 Reset/Cleanup。第 10 步由 App/Evaluation 完成，Runtime 不生成 Gate 或 Report。

关键门禁：

- `ObservationSession=ACTIVE` 的已提交凭据早于 Agent 进程创建。
- `ObservationSession=SEALED` 的已提交凭据早于 Evidence Closure。
- 正常执行时，Raw Observation、Closure、每个 Check 的 Judgement/CheckResult 都已保存后才允许 Reset；Judge ERROR 还要保存 Judge Failure，并产生 UNEVALUABLE CheckResult。
- Reset Controller 只能声明“执行了复位”；是否干净由独立 File Verification 决定。
- 第 9 步完成并保存 Verification/Cleanup 事实后，App 才能执行唯一一次 Gate、Run 终态和 Report。

若 Prepare、Seed 或 Baseline 在 Agent 启动前失败，不创建伪 Session、Closure 或 Judgement；先保存全部可得 Artifact、ControlEvent、Failure 和“评测未运行”的原因，再执行适用的 Reset/Verification/Cleanup。

## 6. DSH Headless 执行

- 使用平台冻结的可执行文件和 Profile，以参数数组启动，`shell=false`，显式 `cwd`。
- 子进程必须以低权限 `dshagent` 身份运行；DSHEval 主进程使用 `dsheval`。
- 仅注入允许列表环境变量、短期模型凭据、当前 Attempt 的 Workspace 与 Probe 暂存位置。
- 每次运行创建新进程、新 Runtime Home 和新 Workspace；MVP 没有第二 Attempt，但仍禁止复用历史 Session/Home。
- Probe 暂存目录只能由当前 `dshagent` 写，由 `dsheval` 在进程停止后复制并密封。
- stdout、stderr、退出码、信号、开始/结束时间都作为执行事实保存；退出码 0 不代表任务正确。
- 超时时先停止进程组，超过固定宽限期再强杀；之后仍必须 Drain 和保存可得证据。
- 用户取消是终止事实，不伪装成 Agent、System 或 Judge 错误。

## 7. 文件环境与路径安全

Workspace 只能位于冻结的 `workspaceRoot/<runId>/<caseId>/<attemptId>/`。Seed 创建只读输入和可写输出，所有输入必须来自冻结 Case 资产并生成稳定排序、带 SHA-256 的 `SeedManifest`。

所有创建、复制和删除必须：

1. 使用经过校验的绝对根和规范化相对路径。
2. 拒绝 `..`、空路径、绝对子路径、NUL、未解析变量和宽泛 Glob。
3. 使用 `lstat` 检查路径，不跟随根外符号链接。
4. 拒绝 `/`、用户 Home、仓库根、数据根或 Workspace 上级目录作为递归目标。
5. Seed 部分失败时保留已产生的 Manifest 前缀、ControlEvent 和 Failure，且绝不启动 Agent。

MVP Reset 的冻结期望是：清空当前 Attempt Workspace 并重建为空目录，其稳定 Manifest 摘要作为 `expectedCleanDigest`；不得触碰其他路径。Controller 完成后，由 Observation 以全新 Verification ID 重新采集 `POST_RESET` Snapshot 并比较摘要。`MATCH` 后进入 `VERIFIED`，随后 Cleanup 删除该空 Workspace 并进入 `CLEANED`；`MISMATCH/UNAVAILABLE` 进入 `QUARANTINED`。

## 8. 错误归因

统一使用 Core 的 `FailureRecord`：`failureId、scope、category、origin、actor、phase、severity、retryable=false、messageRedacted、reasonCode、evidenceRefs、artifactRefs、occurredAt、contentDigest`。

| 情况 | origin | 结果 |
|---|---|---|
| DSH 已启动后非零退出、拒绝结束、执行超时 | `origin=TARGET, category=TARGET_EXECUTION/TIMEOUT` | Attempt 为 `TARGET_FAILED/TIMED_OUT`；仍采集并由 Judge 判断可判部分 |
| spawn、路径或观测前置故障 | `origin=DSHEVAL, actor=RUNTIME` | Attempt=`HARNESS_ERROR`；不得伪造 Agent FAIL |
| Seed、Reset、Cleanup 故障 | `origin=ENVIRONMENT, category=ENVIRONMENT_FAILURE/CLEANUP_FAILURE` | Attempt/Environment/Run 记录操作失败；不得伪造 Agent FAIL |
| Judge 崩溃或输出无效 | `origin=DSHEVAL, actor=JUDGE, category=JUDGE_FAILURE` | Runtime 只接收 Failure Ref；不得产生分数 |
| 文件内容不正确但执行链正常 | 不创建运行错误 | Evaluation 产生确定性 `FAIL` |

任何失败都先保存已获得的 stdout/stderr、Probe 前缀、文件快照和 ControlEvent，再收尾；后来的系统故障不得覆盖更早事实。

## 9. 强制要求与验收

| ID | 要求 |
|---|---|
| `MVP-RUN-REQ-001` | 只接受 `FULL_AGENT`，并固定单 Run/Case/Attempt、`maxAttempts=1`、无自动重试 |
| `MVP-RUN-REQ-002` | 只执行冻结 Plan；Runtime 不选测试、不修改 Target、不评分 |
| `MVP-RUN-REQ-003` | Observation ACTIVE 已提交后才能启动 Agent，Seal 已提交后才能 Closure |
| `MVP-RUN-REQ-004` | 使用参数数组、明确 cwd、允许列表 env 和 `dshagent` 低权限身份 |
| `MVP-RUN-REQ-005` | Seed/Reset 的所有路径都受根边界、规范化和 symlink 检查保护 |
| `MVP-RUN-REQ-006` | 超时、取消和进程失败仍保存部分证据，退出码不直接决定 Verdict |
| `MVP-RUN-REQ-007` | 正常路径在 Evidence、Judgement、CheckResult 及可选 Judge Failure 提交后 Reset；早停路径先保存可得事实与未运行原因；Reset 后均独立验证 |
| `MVP-RUN-REQ-008` | Agent、System、Judge 错误保持不同归因，且旧失败不被覆盖 |

| ID | 验收条件 |
|---|---|
| `MVP-RUN-AC-001` | 第二 Run/Case/Attempt 或 `maxAttempts>1` 在 Preflight 被明确拒绝 |
| `MVP-RUN-AC-002` | 真实 DSH Headless 在隔离 Workspace 完成冻结文件任务，Runtime 未执行评分逻辑 |
| `MVP-RUN-AC-003` | 未提交 ACTIVE 时 Driver 的 spawn 未被调用；未 Seal 时 Closure 被拒绝 |
| `MVP-RUN-AC-004` | 测试证明命令不经 Shell，`dshagent` 读不到 Evidence/Result 根 |
| `MVP-RUN-AC-005` | `..`、根外 symlink、绝对子路径和宽递归删除目标全部被拒绝 |
| `MVP-RUN-AC-006` | 非零退出、超时、取消、强杀分别保留终止事实和可得 Artifact |
| `MVP-RUN-AC-007` | Reset 早于 Evidence 时被拒绝；Reset MISMATCH 使环境隔离且证据仍可读 |
| `MVP-RUN-AC-008` | Agent 进程失败、Seed 故障、Judge 崩溃可由 origin+actor+category 明确区分 |

## 10. DEFERRED 扩展点

插件级 Target 安装/append/replace、多 Case、多 Attempt、Retry、并行/远程调度、多 VM、PostgreSQL/HTTP/Browser 环境、故障注入和长驻 Agent 均为后续版本。MVP 只需对这些请求返回明确 `UNSUPPORTED`，不实现适配器、工厂或占位流程。
