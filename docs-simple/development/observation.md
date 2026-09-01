# Observation：MVP 开发规格

> 本文直接约束 MVP 代码生成。目标是可靠采集“DSH 做了什么”和“文件环境最终怎样”，而不是提前建设通用观测平台。

## 1. 固定范围

MVP 只有两个来源：

1. `DSH Runtime Probe`：协作式记录 DSH 内部运行事实。
2. `File Sensor`：以独立于 Agent 的 `dsheval` 身份采集 Workspace Before/After，并在 Reset 后复验。

Observation 不启动/停止 Agent，不 Seed/Reset 环境，不选择 Check，不生成 Evidence、分数或 Verdict。PostgreSQL、HTTP、Browser 和实时 UI 观测不属于 MVP。

## 2. 文件职责

| 文件 | 唯一职责 |
|---|---|
| `src/observation/coordinator.ts` | 管理一个 ObservationSession 的 Baseline、Active、Drain、Seal 和完整度 |
| `src/observation/runtime.ts` | 读取并校验 `dsh-eval.probe/v1` JSONL，保留原始行和序列缺口 |
| `src/observation/environment.ts` | 定义一个窄 Sensor 接口并协调 Before/After/Post-Reset 调用 |
| `src/observation/sensors/file.ts` | 安全生成文件 Manifest、Diff 和 Reset Verification |

Bootstrap 直接构造一个 `FileSensor` 并注入 Coordinator。不得创建 Sensor 工厂、注册中心、插件发现层或多后端路由层。

## 3. 窄 Sensor 接口

MVP 接口只表达当前流程需要的三个动作：

```text
SensorAdapterDescriptor
  implementationId, implementationVersion, capabilityDigest
  sourceType=FILESYSTEM, capabilities

EnvironmentSensor
  captureBefore(context) -> Capture
  captureAfter(context) -> Capture
  verifyReset(context) -> ResetCapture
```

`context` 必须绑定 Run/Case/Attempt、Environment ID、`resetGeneration`、`sourceRequirementId`、冻结 `resourceBinding`、Sensor 的 ID/版本/能力摘要、静态 `sensorRegistryDigest`、内容策略和 `PreparedObserverBinding`。调用前逐项验证它们与 ObservationPlan 和当前 Environment 一致，且 Binding 只允许 `READ/SNAPSHOT/DRAIN`；不一致即拒绝，不能重选 Sensor 或借用 Controller 权限。

Bootstrap 只装配一个 File Sensor，并据此生成不可变的单项 Registry 描述与摘要。它用于冻结和复核实现身份，不是动态发现、工厂或多后端路由层。

## 4. 最小数据

```text
ObservationSession
  observationSessionId, attemptId, observationPlanRef
  state, revision, sourceRefs[]
  baselineStartedAt?, baselinedAt?, activeAt?
  targetTerminatedAt?, drainStartedAt?, sealedAt?
  collectionStatusRefs[], completionLedger?, failureRefs[]

RawObservation
  observationId, attemptId, sourceRef, externalEventType, sourceTime
  payloadInline? | payloadArtifactRef?
  captureMetadata, rawDigest

CollectionStatus
  collectionStatusId, sourceRef, openedAt, closedAt, recordCount
  firstSourceSeq?, lastSourceSeq?, finalWatermark?
  gaps[], truncated, health, completeness, failureRefs[]

FileEntry
  portablePath, entryType(FILE|DIRECTORY|SYMLINK|OTHER), mode
  byteLength?, contentDigest?, linkTarget?, resolvedWithinRoot, readError?
```

每个来源另有 `SourceDescriptor` 保存 Source 类型、外部 Schema、Collector 版本/摘要、资源绑定、序列模式、内容策略、盲区和 Trust。Probe Trust 固定为 `COOPERATIVE`；File Sensor 由 Agent 权限域外的 `dsheval` 读取，Trust 为 `INDEPENDENT`。来源不能互相覆盖或伪装为同一种事实。

## 5. ObservationSession 状态与顺序

```text
PLANNED → BASELINING → BASELINED → ACTIVE → DRAINING → SEALED
无法形成可信 Seal 的持久化或完整性灾难 → FAILED
```

唯一合法顺序：

1. 创建 `PLANNED` Session；复核 Plan、Environment Generation、SourceRequirement、Sensor 三元组、Registry 摘要和只读 Binding 后进入 `BASELINING`。
2. File Sensor 采集 Before；Snapshot Artifact、RawObservation 和基线事实全部提交后进入 `BASELINED`。
3. Workflow 明确激活 Session 后进入 `ACTIVE`；只有持久化后的 ACTIVE Receipt 才能授权 Runtime spawn Agent。
4. Agent 终止后进入 `DRAINING`：停止/读取 Probe，等待文件稳定窗口，采集 After 并计算 Diff。
5. 先提交原始 Artifact，再提交 RawObservation、各来源 CollectionStatus 和 Session Seal。
6. `SEALED` Receipt 交给 Evaluation；Closure 不得读取未 Seal 的 Session。

普通缺记录、缺 stop、稳定超时或单个 Sensor 失败都在 bounded drain 后保存有效前缀并以 `SEALED+PARTIAL` 收口。只有 Baseline 无法建立，或 Artifact/摘要/持久化故障使 Session 无法形成可信 Seal 时才进入 `FAILED`；FAILED Session 不进入 Closure。

## 6. Runtime Probe 规则

每行 JSONL 使用 `dsh-eval.probe/v1` 的 `schema、runId、probeSeq、at、monotonicNs、pid、kind、data`；`runId` 必须等于 Attempt 的 `sourceRunId`。MVP 必须：

- 保存原始 JSONL Artifact，并让每条解析记录回链原始行号/字节范围。
- 校验 `probeSeq` 从 0 单调连续，分别记录 gap、duplicate、out-of-order 和坏 JSON 尾部。
- 确认 `probe/start` 早于首个 Agent committed task/turn，`probe/stop` 晚于最后 committed turn；不能确认时为 PARTIAL。
- 区分已提交的 `session/event` 与仅表示尝试的 `runtime/event`。
- 未知 `kind` 原样保存，不因未知事件把完整来源判为失败。
- 使用冻结 Source Run ID 和进程信息关联当前 Attempt；无法唯一关联时明确 `UNRESOLVED`，不得按文本或时间猜测。

缺 `probe/stop`、序列缺口或晚接入是 `origin=DSHEVAL, actor=COLLECTOR, category=OBSERVATION_FAILURE` 的完整度问题，不能自动归因 Agent。

## 7. File Sensor 规则

### 7.1 Before 与 After

- 从冻结 Workspace 根开始，按 UTF-8 相对路径稳定排序。
- 使用 `lstat`；不跟随符号链接，不读取根外目标，不读取设备、Socket 或其他挂载。
- 普通文件记录字节数和 SHA-256；目录记录类型；符号链接记录链接文本。
- 记录权限拒绝、读取竞争、文件在扫描中变化和大小上限；这些情况使来源 `PARTIAL`，不能解释为“没有变化”。
- Diff 只由已提交的 Before/After 计算，至少区分 `ADDED、REMOVED、CONTENT_CHANGED、TYPE_CHANGED、METADATA_CHANGED、SYMLINK_CHANGED、UNREADABLE`。
- Before、After 和 Diff 分别保存并相互引用，不用 SeedManifest 代替 Before。

### 7.2 Drain 与 Seal

Seal 前必须有：Target 已终止；Probe 已停止或缺失已记录；文件在冻结稳定窗口内无变化或稳定超时已记录；After 完成或失败；所有 Artifact 已 Commit。稳定超时导致 `PARTIAL`，不能用瞬时快照强行证明最终状态。

Seal 后原 ObservationSession 永久只读。迟到数据只记录一条 `POST_SEAL_OBSERVATION` 系统 Failure 和诊断 Artifact，不修改 Session、Evidence 或 Verdict；MVP 不实现 LateArrival Reservation/Cutoff 恢复协议。

### 7.3 Reset 后独立验证

Runtime 完成 Reset 后，App 创建新的 `verificationId`，以全新 File Sensor 调用和只读句柄采集 `POST_RESET` Snapshot，并与冻结的空 Workspace `expectedCleanDigest` 比较：

- 不采信 Controller 的“Reset 成功”声明。
- 不复用 Before/After 的内存缓存。
- `MATCH`：空目录 Manifest 摘要一致；`MISMATCH`：存在残留或摘要不同；`UNAVAILABLE`：无法可靠读取。
- Verification 是运行环境收尾事实，不写回已 Seal 的 Agent Observation/Evidence。

## 8. 错误与安全边界

| 情况 | 处理 |
|---|---|
| Probe 缺失、晚接、Gap、坏尾 | 保存有效前缀，Probe PARTIAL，相关 Check 由 Closure 决定是否 `UNEVALUABLE` |
| File Before 失败 | 不启动 Agent；记录 Observation/System Failure |
| File After/稳定窗口失败 | Seal 为 PARTIAL；不得输出“无变化” |
| Artifact 摘要或 Scope 不符 | 来源 FAILED，`origin=DSHEVAL, category=EVIDENCE_INTEGRITY`；不进入可信 Evidence |
| Judge 消费正确 Seal 后自身崩溃 | `origin=DSHEVAL, actor=JUDGE, category=JUDGE_FAILURE`；Observation 不修改任何记录 |

Agent 只能写自己的 Workspace 和 Probe 协作暂存区，不能写可信 Snapshot/Raw Artifact。File Sensor 只能读，不得为了“验证”而创建、删除、修复或重命名文件。原 Payload 命中 Secret 规则时保存 Restricted/脱敏视图和安全 Failure，不把原值写入报告。

## 9. 强制要求与验收

| ID | 要求 |
|---|---|
| `MVP-OBS-REQ-001` | 只实现 Runtime Probe 和 File Sensor，且二者按独立 Source 保存 |
| `MVP-OBS-REQ-002` | File Before 与持久化 ACTIVE 必须早于 Agent spawn |
| `MVP-OBS-REQ-003` | Target 终止后完成 Drain/After/Artifact Commit，Session Seal 后才能 Closure |
| `MVP-OBS-REQ-004` | Probe 原始行、序列缺口、未知事件、坏尾和关联不确定性都不得丢失 |
| `MVP-OBS-REQ-005` | File Sensor 使用稳定相对路径、`lstat`、SHA-256，并拒绝根外链接 |
| `MVP-OBS-REQ-006` | Sensor 失败或稳定超时不能解释为环境无变化 |
| `MVP-OBS-REQ-007` | Seal 后不可修改；迟到事实仅作诊断，不重写 Evidence/Verdict |
| `MVP-OBS-REQ-008` | Reset Verification 使用新 ID、新读取过程且不采信 Controller 自证 |

| ID | 验收条件 |
|---|---|
| `MVP-OBS-AC-001` | 同一 Attempt 的 Probe 与 File 记录具有不同 Source/Trust，且均可回链原 Artifact |
| `MVP-OBS-AC-002` | 未完成 Before/ACTIVE 时模拟 Driver 永远没有收到启动调用 |
| `MVP-OBS-AC-003` | 未 Seal 的 Session 被 Closure 拒绝；CollectionStatus=PARTIAL 的 SEALED Session 可被 Closure 正确判为证据不足 |
| `MVP-OBS-AC-004` | 缺 stop、Gap、重复、乱序、未知 kind、坏尾产生可区分结果并保留有效前缀 |
| `MVP-OBS-AC-005` | File Diff 识别新增、删除、内容、类型、元数据、链接和不可读变化 |
| `MVP-OBS-AC-006` | After 失败不会生成空 Diff 或“无变化”结论 |
| `MVP-OBS-AC-007` | Agent 无法修改 committed Snapshot；Seal 后新增记录被拒绝且旧摘要不变 |
| `MVP-OBS-AC-008` | Reset 残留、路径不可读分别得到 `MISMATCH/UNAVAILABLE`，均不改旧 Evidence |

## 10. DEFERRED 扩展点

PostgreSQL、HTTP Mock、Browser、网络/进程 Sensor、Sensor 动态注册、流式 UI、独立 WAL/ACK Collector、复杂 LateArrival 恢复和多 Agent 关联全部延后。未来 Sensor 仅复用本文件的窄接口；MVP 不写这些实现的占位层级。
