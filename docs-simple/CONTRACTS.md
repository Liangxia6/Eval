# DSHEval 公共契约

> 本文只定义跨模块共享的数据与接口；架构和流程见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 1. MVP 范围

MVP 只实现一条可重复运行的 Attention + PyTorch 任务纵向闭环：

```text
FULL_AGENT
→ 冻结 DSH Headless Target
→ 按标签匹配 Dataset Pack
→ 单 Run / 单 Case / 单 Attempt
→ Seed 工作区环境
→ Runtime Probe + File Sensor Before
→ 执行论文讲解与代码任务
→ Drain Probe + File Sensor After
→ Artifact / Response / Tool Judge
→ Reset + File Sensor 独立验证
→ PASS / FAIL / UNEVALUABLE Gate
→ JSON 报告 + 静态 HTML
```

固定约束：单 VM、全局最多一个活动 Run、每 Run 恰好一个 Case、每 Case 恰好一个 Attempt、`maxAttempts=1`、无自动 Retry。仅支持本地 JSON/JSONL/Artifact 存储，不依赖数据库或网络服务。

以下能力标记 `DEFERRED`：插件 Target、PostgreSQL/HTTP/Browser Sensor、多个 Case/Attempt、自动 Retry、Gap Planner、Repair Agent、Multi-Agent 专项、LLM Judge、分布式执行、Web API。MVP 只保留 Sensor/Check 注册接口，未来增加实现不改变主流程。

## 2. 表达与版本规则

| 写法 | 含义 |
|---|---|
| `T` / `T?` | 必填 / 可选；可选缺失时省略，不写 `null` |
| `List<T>` | 有序列表；无元素写 `[]` |
| `Ref<T>` | 对已提交对象的不可变引用 |
| `JsonValue` | 标准 JSON 值；禁止 `undefined`、非有限数、函数、隐式 BigInt |

- 自有 Schema 形式为 `dsheval.mvp.<name>/v1`。未知 Major 拒绝；未知正式字段拒绝；扩展只进入显式 `extensions`。
- 外部 `dsh-eval.probe/v1` 事件保留未知 kind、字段和值。
- 字段名、枚举值和 Schema ID 大小写固定。不得以自然语言字符串代替状态、失败类别或 Judge 结果。
- 所有列表按本文指定键稳定排序；对象序列化与摘要不得依赖文件系统遍历顺序。

## 3. 基础值对象

### 3.1 标识、Scope 与时间

`StableId`：1–128 个 `[A-Za-z0-9._-]`，首字符为字母或数字；在对象类型内唯一且不可复用。业务不得解析 ID 内部格式。

`SourceRunId` 是 StableId 的独立名义类型，由 App 在 Attempt Revision 0 前预分配；TargetDriver 与 Probe 只能原样接收和回显。

`ScopeRef` 精确字段：

| 字段 | 规则 |
|---|---|
| `targetId` | 始终存在 |
| `targetSnapshotId` | Target 冻结后存在；Run 级及以下必填 |
| `runId` | Run 及以下存在 |
| `caseId` | Case 及以下存在 |
| `attemptId` | 执行、环境、观测、证据、Judge 必填 |
| `sessionId?` | Probe 可靠给出时保存；未知时省略，不猜测 |

子级字段存在时全部父级字段必须存在且一致。MVP 不允许跨 Run/Case/Attempt 引用。

`SourceTime={wallTime?,monotonicNs?,sourceSeq?,observedAt,clockDomain}`。同 Source 优先按 sourceSeq，其次 monotonicNs；不同 Source 不以墙钟接近强建因果。

### 3.2 Digest 与 Ref

`ContentDigest={algorithm:'sha256',value:64位小写十六进制,byteLength}`。

- 结构化对象对排除摘要字段自身后的 RFC 8785 JSON UTF-8 计算。
- Artifact 原始字节使用 `artifactContentDigest`；ArtifactRef 元数据另有 `contentDigest`，并绑定前者。
- Map、文件条目和无语义顺序的集合必须稳定排序。
- 摘要、Scope 或 Ref 校验失败产生 `EVIDENCE_INTEGRITY` 或 `PERSISTENCE_FAILURE`，对象不得继续作为可信输入。

`Ref<T>={schema,id,digest,revision?}`。不可变对象无 revision；生命周期对象 Ref 必须带 revision，并解析到该 Revision 的完整摘要。

### 3.3 OperationContext 与 PortResult

所有 I/O Port 接收：

`OperationContext={operationId,idempotencyKey,deadlineAt,cancellationToken,actorRole,traceId}`。

纯计算 Port 接收：

`DeterministicContext={operationId,idempotencyKey,effectiveAt,ruleSetDigest,traceId}`，不得读取 Clock、随机源、文件系统或网络。

相同幂等键只允许相同输入摘要；重放返回首次结果，异输入返回 `CONFLICT`。

`PortResult<T>`：

| 字段 | 规则 |
|---|---|
| `status` | `SUCCEEDED/REJECTED/FAILED/CANCELLED` |
| `value?` | 仅 SUCCEEDED 存在 |
| `rejectionCode?` | REJECTED 必填：`INVALID_INPUT/NOT_FOUND/CONFLICT/UNSUPPORTED/PRECONDITION_FAILED/STALE_REVISION/AUTHORIZATION_DENIED` |
| `failureDrafts` | FAILED/CANCELLED 至少一项；其他状态可为空 |
| `warnings` | 不终止流程的结构化警告 |

执行 Port 首次发现失败时返回 FailureDraft；App 提交为 FailureRecord 后，再用精确 Ref 推进状态。App 不修改领域结果或重算摘要。

## 4. 结果、状态和失败

### 4.1 相互独立的结果维度

| 维度 | 枚举 |
|---|---|
| `CheckOutcome` | `PASS/FAIL/UNEVALUABLE` |
| `GateVerdict` | `PASS/FAIL/UNEVALUABLE` |
| `OperationalHealth` | `HEALTHY/DEGRADED/FAILED` |
| `EvidenceCompleteness` | `COMPLETE/PARTIAL` |
| `EvidenceValidity` | `VALID/INVALID` |
| `SourceTrust` | `INDEPENDENT/COOPERATIVE/UNVERIFIED` |

Run 完成不代表 PASS。Agent 结果错误且证据可信为 FAIL；Collector/Judge 自身错误通常使相关 Check UNEVALUABLE；报告生成失败不修改已提交 Gate。

Gate 固定优先级：

```text
任一已证明 hardGate FAIL → FAIL
否则任一 required Check UNEVALUABLE → UNEVALUABLE
否则 → PASS
```

UNEVALUABLE 没有默认数值，不参与平均，也不能转换成普通失败分。

Gate 每 Run 只提交一次，时序固定为 CheckResults 已提交且 Reset/Verification/Cleanup 事实已保存之后；Gate 输入仍只包含 Agent CheckResults。环境收尾失败改变 Run Operational 状态，不进入或改写 Verdict。

### 4.2 MVP 生命周期

| 对象 | 合法状态与迁移 |
|---|---|
| Run | `CREATED→PREFLIGHTING→RUNNING→FINALIZING→FINISHED`；终点 `FAILED/CANCELLED` |
| Case | `PENDING→RUNNING→EVALUATING→FINISHED`；终点 `ERRORED/ABORTED` |
| Attempt | `PENDING→RUNNING→SUCCEEDED`；终点 `TARGET_FAILED/TIMED_OUT/HARNESS_ERROR/ENVIRONMENT_ERROR/CANCELLED` |
| Environment | `CREATED→PREPARED→SEEDED→IN_USE→RESETTING→VERIFIED→CLEANED`；终点 `QUARANTINED/CLEANUP_FAILED` |
| ObservationSession | `PLANNED→BASELINING→BASELINED→ACTIVE→DRAINING→SEALED`；终点 `FAILED` |

生命周期初始 Projection 精确公共字段：`schema/aggregateId/scope/state/revision=0/createdAt/updatedAt/failureRefs/projectionDigest`。

状态更新使用 `StateTransition={aggregateRef,expectedRevision,fromState,toState,reasonCode,supportingRefs,failureRefs,occurredAt,nextProjection}`。`LifecycleEvent` Schema=`dsheval.mvp.lifecycle-event/v1`，字段为 `eventId/aggregateSchema/aggregateId/scope/revision/fromState/toState/reasonCode/supportingRefs/failureRefs/occurredAt/priorProjectionRef/nextProjectionDigest/contentDigest`。所属模块验证合法箭头，Repository 以 expectedRevision 做 CAS 并追加 JSONL Event；MVP 不定义通用 TransitionRequest 大联合。

### 4.3 FailureRecord

`FailureRecord={failureId,scope,category,origin,actor,phase,severity,retryable:false,messageRedacted,reasonCode,evidenceRefs,artifactRefs,occurredAt,contentDigest}`。

`FailureOrigin=USER/TARGET/DSHEVAL/ENVIRONMENT/EXTERNAL_DEPENDENCY/UNKNOWN`。

| Category | MVP 语义 |
|---|---|
| `INPUT_VALIDATION` | Descriptor、Config、Pack 非法；不创建 Run |
| `TARGET_RESOLUTION/TARGET_INTEGRITY` | Target 无法冻结或运行前发生变化 |
| `PLAN_UNSATISFIABLE` | Probe、File Sensor、Judge、权限或 Pack 缺失 |
| `PLATFORM_SECURITY_FAILURE` | 真实身份、路径或隔离预检失败；不计 Agent 分 |
| `ENVIRONMENT_FAILURE` | Prepare、Seed、Reset 或 Cleanup 失败 |
| `TARGET_EXECUTION/TIMEOUT/CANCELLED` | Agent 执行事实；证据可信时仍可 Judge |
| `OBSERVATION_FAILURE` | Probe/File Sensor 中断、晚接入、快照不完整 |
| `EVIDENCE_INCOMPLETE/EVIDENCE_INTEGRITY` | 证据不足或不可信 |
| `JUDGE_FAILURE` | Judge 实现错误；相关 Check UNEVALUABLE |
| `TARGET_SECURITY_VIOLATION` | 独立文件证据确认路径越界；Security Check FAIL |
| `PERSISTENCE_FAILURE/REPORT_FAILURE/CLEANUP_FAILURE/INTERNAL_INVARIANT` | DSHEval 操作失败；与 Agent Verdict 分开报告 |

MVP 无自动 Retry，所有 FailureRecord 的 `retryable` 固定 false。

报告中的五类故障是由 `category+origin+actor` 派生的只读视图，不写回 FailureRecord：Target/Plan 输入与兼容性问题→`plan_conflict`；Observation/Evidence 采集问题→`collector_error`；Judge 实现问题→`judge_error`；来源为 TARGET 的执行或已证实安全问题→`agent_failure`；Platform/Environment/Storage/Report/Cleanup/Internal 问题→`infrastructure_error`。用户主动取消仅显示 `CANCELLED`，不伪装成上述故障。原始 category/origin/actor 永远保留。

## 5. 公共记录

TargetDescriptor、scope-less EvaluationPack 和调用级 ConfigSnapshot 都直接作为各自 Schema 的顶层记录保存，不包通用 `payload`。其他不可变记录都包含 `schema`、专属 ID、`scope`、`createdAt`、`producerVersion`、`contentDigest`。生命周期 Projection 使用 `state/revision/createdAt/updatedAt/failureRefs/projectionDigest`，不以 contentDigest 冒充当前 Revision 摘要。

### 5.1 Planning 记录

| 对象 / Schema | 精确业务字段 |
|---|---|
| `TargetDescriptor` / `dsheval.mvp.target-descriptor/v1` | `targetId/targetType='FULL_AGENT'/sourceRoot/dshExecutable/dshHome/profile/targetIdentity` |
| `TargetSnapshot` / `dsheval.mvp.target-snapshot/v1` | `targetSnapshotId/targetId/sourceManifestRef/dshExecutablePath/dshPackageVersion?/dshEntrypointDigest/dshHomeManifestRef/profile/profileManifestRef/lockfileRef/effectiveConfigRef/driverFingerprint/platform/secretRefNames` |
| `InspectionSnapshot` / `dsheval.mvp.inspection/v1` | `inspectionId/targetSnapshotRef/dshVersionStatus/profile/probeConfigured/probeSchema/probeOrderStatus/headlessDriverStatus/toolSchemas/permissionPreset/sandboxMode/limitations/sourceArtifactRefs` |
| `EvaluationRequest` / `dsheval.mvp.evaluation-request/v1` | `requestId/requestedLabelIds/preferredDatasetIds/excludeCaseIds`；LabelId 必须来自固定 Registry，Dataset ID 只能作为覆盖候选的消歧 Pin |
| `CatalogResolution` / `dsheval.mvp.catalog-resolution/v1` | `requestId/selectedLabelIds/selectedDatasetIds/units/contentDigest`；Unit=`caseId/datasetId/labelBindings/environmentId/environmentObserverSourceRequirementId/runtimeSourceRequirementId/judgeAssetId/checkIds` |
| `EvaluationPack` / `dsheval.mvp.evaluation-pack/v1` | `packId/version/request/resolution/dataset/metricPool/scenario/checks/judges/environment/sourceRequirements/contentDigest` |
| `ConfigSnapshot` / `dsheval.mvp.config/v1` | `configId/invocationId/targetRoot/runRoot/artifactRoot/reportRoot/workspaceRoot/runtimeDshHomeRoot/runDeadlineMs/caseDeadlineMs/stableWindowMs/stableMaxWaitMs/maxArtifactBytes/contentMode/allowedModelEndpoints/minimumIsolationLevel/rendererVersion/fieldSources/platform/nodeVersion/dshevalVersion/secretRefNames/createdAt/contentDigest` |
| `EvaluationPlan` / `dsheval.mvp.evaluation-plan/v1` | `evaluationPlanId/targetSnapshotRef/inspectionRef/packRef/request/catalogResolution/casePlan/checkPlans/budget/gateRule/exclusions/semanticDigest/status='FROZEN'`；不可满足时不提交 Plan |
| `ObservationPlan` / `dsheval.mvp.observation-plan/v1` | `observationPlanId/evaluationPlanRef/casePlanId/sourceRequirements/boundaryPolicy/stablePolicy/contentPolicy/semanticDigest` |
| `EvidenceContract` / `dsheval.mvp.evidence-contract/v1` | `evidenceContractId/checkId/requiredFactTypes/allowedSourceTypes/minimumTrust/minimumCompleteness/validityRequired/timeBoundary/authorizedJudgeId/ruleParameters/missingOutcome='UNEVALUABLE'/semanticDigest`；ruleParameters 来自 Dataset Pack，永不进入 AgentTask |

`CasePlan` 精确字段：`casePlanId/order=1/scenarioId/datasetId/labelBindings/environmentId/environmentObserverSourceRequirementId/runtimeSourceRequirementId/judgeAssetId/agentTaskArtifactRef/visibleInputArtifactRefs/seedSpec/allowedPaths/forbiddenPaths/deadlineMs/stableWindowMs/maxAttempts=1/checkIds`。

`LabelBinding` 精确字段：`labelId/metricId/checkId/metricParameters/requiredEvidenceTypes/required/hardGate`。其中 `requiredEvidenceTypes` 由 Registry 复制并冻结；Dataset JSON 只声明 `labelId/metricId/checkId/metricParameters/required/hardGate`，不得自行声明或删减证据类型。

Label Registry 固定 15 个版本化 Label，并保存唯一 `labelId/metricId/title/requiredEvidenceTypes`。Registry 中 LabelId 与 MetricId 都必须唯一。Metric Pool 只包含当前 Dataset 实际使用、已有 Judge 调用方的 Metric，实现字段为 `metricId/checkId/type/resultType='VERDICT'/judgeId/evidenceContractTemplateId`。Catalog 校验 Registry、Metric Pool 和 Dataset 三方一致后编译 `CheckDefinition`。Dataset 不能创建临时 Label、复用别的 MetricId 或修改评分算法。

`CheckPlan` 精确字段：`checkId/type/required/hardGate/judgeId/evidenceContractRef`。`type` 由 Judge 注册表解释，Core 不枚举具体评测方法。

`SourceRequirement` 精确字段：`sourceRequirementId/sourceType/sensorImplementationId/sensorImplementationVersion/sensorCapabilityDigest/resourceBinding/mandatory/minimumTrust/contentMode/maxBytes/timeoutMs/watermarkDefinition`。`sourceType` 由 Observer 注册表解释。

`PlanBuildResult` 是进程内判别联合：`FROZEN={evaluationPlan,observationPlan,evidenceContracts}`；`UNSATISFIABLE={gaps,failureDrafts}`。UNSATISFIABLE 分支不得携带部分 Plan。

`DriverFingerprint={driverCapabilityId,dshEntrypointDigest,dshPackageVersion?,headlessBundleVersion,headlessBundleDigest,cliGrammarId,cancelSupported,stdoutSemantics,stderrSemantics,exitSemantics,workspaceSemantics,profileMutationSemantics}`。

### 5.2 Runtime 与环境记录

| 对象 / Schema | 精确业务字段 |
|---|---|
| `EvaluationRun` / `dsheval.mvp.run/v1` | `runId/targetSnapshotRef/evaluationPlanRef/observationPlanRef/state/revision/caseId/operationalHealth/gateDecisionRef?/failureRefs/environmentFinalState?` |
| `EvaluationCase` / `dsheval.mvp.case/v1` | `caseId/runId/casePlanId/state/revision/attemptId/checkResultRefs` |
| `ExecutionAttempt` / `dsheval.mvp.attempt/v1` | `attemptId/caseId/ordinal=1/state/revision/workspacePath/runtimeDshHomePath/sourceRunId/startedAt?/endedAt?/terminationKind?/stdoutArtifactRef?/stderrArtifactRef?/failureRefs` |
| `EnvironmentInstance` / `dsheval.mvp.environment/v1` | `environmentInstanceId/attemptId/environmentId/state/revision/workspaceBinding/resetGeneration/seedManifestRef?/baselineSnapshotRef?/failureRefs` |
| `ControlEvent` / `dsheval.mvp.control-event/v1` | `controlEventId/scope/operation=TARGET_START/TARGET_STOP/ENV_PREPARE/ENV_SEED/ENV_RESET/ENV_CLEANUP/startedAt/endedAt/result/failureRefs` |
| `SeedManifest` / `dsheval.mvp.seed-manifest/v1` | `seedManifestId/environmentInstanceRef/resetGeneration/resourceEntries/completedAt/contentDigest`；ResourceEntry=`portablePath/entryType/contentDigest?/mode/readOnlyForTarget` |
| `SecurityPreflight` / `dsheval.mvp.security-preflight/v1` | `preflightId/runId/targetIdentity/observerIdentity/judgeIdentity/allowedRoots/deniedRoots/networkPolicyDigest/telemetryDisabled/probeOrderValid/status/failureRefs`；网络默认 DENY，只允许 Config 冻结的模型端点 |
| `ResetVerification` / `dsheval.mvp.reset-verification/v1` | `verificationId/environmentInstanceRef/resetGeneration/expectedCleanDigest/postResetSnapshotRef/collectionStatusRef/result=MATCH/MISMATCH/UNAVAILABLE/differenceSummary` |
| `LeaseRecord` / `dsheval.mvp.lease/v1` | `leaseId/runId/slotId='vm-global'/state=ACTIVE/RELEASED/ownerPid/ownerProcessStartToken/acquiredAt/releasedAt?` |

### 5.3 Observation 记录

| 对象 / Schema | 精确业务字段 |
|---|---|
| `SourceDescriptor` / `dsheval.mvp.source/v1` | `sourceId/sourceType/externalSchema/collectorName/collectorVersion/collectorCapabilityDigest/trust/resourceBinding/sequenceMode/watermarkDefinition/contentMode/knownBlindSpots` |
| `ObservationSession` / `dsheval.mvp.observation-session/v1` | `observationSessionId/attemptId/observationPlanRef/state/revision/sourceRefs/baselineStartedAt?/baselinedAt?/activeAt?/targetTerminatedAt?/drainStartedAt?/sealedAt?/collectionStatusRefs/completionLedger?/failureRefs` |
| `RawObservation` / `dsheval.mvp.raw-observation/v1` | `observationId/attemptId/sourceRef/externalEventType/sourceTime/payloadInline?或payloadArtifactRef?/captureMetadata/rawDigest` |
| `CollectionStatus` / `dsheval.mvp.collection-status/v1` | `collectionStatusId/sourceRef/openedAt/closedAt/recordCount/firstSourceSeq?/lastSourceSeq?/finalWatermark?/gaps/truncated/health/completeness/failureRefs` |
| `FileSnapshot` / `dsheval.mvp.file-snapshot/v1` | `snapshotId/attemptId/phase=BEFORE/AFTER/POST_RESET/rootBinding/scanStartedAt/scanCompletedAt/entries/readErrors/completeness/snapshotDigest` |
| `FileDiff` / `dsheval.mvp.file-diff/v1` | `diffId/beforeSnapshotRef/afterSnapshotRef/added/removed/modified/typeChanged/unchangedCount/diffDigest` |

`FileEntry={portablePath,entryType='FILE'|'DIRECTORY'|'SYMLINK'|'OTHER',mode,byteLength?,contentDigest?,linkTarget?,resolvedWithinRoot,readError?}`，按 PortablePath UTF-8 字节序排序。扫描中发生变化或读取失败时 Snapshot 不得 COMPLETE。

`CompletionLedger` 固定项目：`TARGET_TERMINATION/TOOL_CALLS/SESSION_FLUSH/PROBE_WATERMARK/STABLE_WINDOW/FINAL_FILE_SNAPSHOT`。每项为 `{kind,required,status='COMPLETE'|'INCOMPLETE'|'UNKNOWN'|'FAILED',reasonCodes,supportingRefs}`。

Runtime Probe 每行是 `dsh-eval.probe/v1` JSON：`schema/runId/probeSeq/at/monotonicNs/pid/kind/data`。runId 必须等于 Attempt.sourceRunId；probeSeq 从 0 连续递增。MVP 最低识别：

| kind | 最低 data |
|---|---|
| `probe/start` | `outputPath/contentMode/captureDispatch/captureLogs/node/cwd` |
| `probe/stop` | 无最低业务字段，作为最终 watermark 之一 |
| `session/event` | `sessionId/event`；event 至少 `seq/type/data` |
| `runtime/log` | `loggerSeq/timestamp/name/level/args/historical` |

Protocol 规则识别 `turn/start|end`、`step/start|end`、`tool/call|result`：Turn 要 `data.turn`，Step 要 `turn/step`，Call 要 `callId/name`，Result 通过 `message.source.callId` 回链。未知 kind/event 原样保存但不自动提升为已知 Protocol Fact。必须验证 `probe/start < committed turn < turn/end < probe/stop`；缺口进入 CollectionStatus。

### 5.4 Evidence、Judge 与报告记录

| 对象 / Schema | 精确业务字段 |
|---|---|
| `EvidenceRecord` / `dsheval.mvp.evidence/v1` | `evidenceId/attemptId/factType/factValue/sourceRefs/observationRefs/artifactRefs/authority=COMMITTED|ATTEMPTED|ENVIRONMENT_STATE|DIAGNOSTIC/derivationRuleId?/timeRange/completeness/validity/trust/contentDigest` |
| `EvidenceBundle` / `dsheval.mvp.evidence-bundle/v1` | `bundleId/attemptId/observationSessionRef/evidenceRefs/inputObservationRefs/unconsumedInputRefs/status=SEALED/INVALID/sealedAt/sealDigest/failureRefs`；Processor 操作失败时不造 Bundle，只记录 Failure |
| `EvidenceClosure` / `dsheval.mvp.evidence-closure/v1` | `closureId/checkId/bundleRef/evidenceContractRef/completeness/validity/state=CLOSED/INCOMPLETE/INVALID/satisfiedRequirements/gaps/authorizedEvidenceRefs` |
| `JudgementRecord` / `dsheval.mvp.judgement/v1` | `judgementId/checkId/judgeId/judgeVersion/closureRef/authorizedEvidenceRefs/status=COMPLETED/BLOCKED/ERROR/outcome?/findingRefs/reasonCodes/failureRefs` |
| `Finding` / `dsheval.mvp.finding/v1` | `findingId/checkId/code/severity/messageRedacted/evidenceRefs/hardGate` |
| `CheckResult` / `dsheval.mvp.check-result/v1` | `checkResultId/checkId/judgementRef/outcome/required/hardGate/reasonCodes` |
| `GateDecision` / `dsheval.mvp.gate/v1` | `gateDecisionId/runId/inputCheckResultRefs/verdict/triggeredHardFailureRefs/unevaluableRequiredRefs/ruleVersion` |
| `EvaluationReport` / `dsheval.mvp.report/v1` | `reportId/runRef/targetSnapshotRef/planRefs/caseRef/attemptRef/sourceRefs/collectionStatusRefs/closureRefs/judgementRefs/checkResultRefs/gateDecisionRef?/resetVerificationRef?/failureRefs/operationalHealth/artifactRefs` |

### 5.5 Storage 记录

`ArtifactRef` / `dsheval.mvp.artifact/v1` 精确字段：`artifactId/scope/artifactType/logicalName/mediaType/portablePath/byteLength/artifactContentDigest/producerVersion/createdAt/sensitivity='EXPORTABLE'|'RESTRICTED'/redactionState='NOT_REQUIRED'|'APPLIED'|'FAILED'/state='COMMITTED'/contentDigest`。

`ArtifactReadPurpose=TASK_INPUT/INSPECTION/EVIDENCE_CAPTURE/JUDGE_INPUT/REPORT_INPUT`；调用者必须使用与身份和 Anchor 匹配的单一用途，Repository/ArtifactStore 不接受自由文本用途。

Artifact 一旦 COMMITTED 不可修改或覆盖；相同 ID/摘要重放返回原 Ref，相同 ID/不同摘要冲突。绝对宿主路径、Secret Value、Observer Token 不进入 ArtifactRef、Report 或 Export。

## 6. 两大接口

### 6.1 Evaluation Asset Matching Port

输入：TargetSnapshot、InspectionSnapshot、Label-centric EvaluationRequest、固定 Label Registry、Dataset Pack、ConfigSnapshot、注册的 Sensor/Judge 描述。Catalog 先产生 Case-centric CatalogResolution；Planner 为选中的 Check 输出 EvaluationPlan、ObservationPlan、EvidenceContract，或 `PLAN_UNSATISFIABLE`。

当前 Attention Pack 的匹配：

| Check | Scenario/Environment | Source | Judge |
|---|---|---|---|
| Artifact | Attention 代码产物 | FILESYSTEM Before/After | ArtifactPresentJudge |
| Response | 论文讲解回答 | DSH_PROBE | ResponsePresentJudge |
| Tool | Python/PyTorch 执行记录 | DSH_PROBE | ToolCompletedJudge |

LabelId 是 Planner 的选择轴和结果轴，只能来自固定 15 项 Registry。Dataset Pack 用 LabelBinding 引用唯一 `Label→Metric/Check`，并绑定 metricParameters、同质 Cases、Environment/Observer、Runtime Source、Judge/Gate。所有 required/hardGate Label 必须由 EvaluationRequest 显式选择，Planner 不隐式增加评分项。Metric Pool 只提供当前 Dataset 实际引用且已有实现的 Metric，不参与 Planner 自由选择。Environment 与其 Observer Requirement 必须精确一致。候选歧义未 Pin、标签集合需要多 Dataset、映射漂移或 V0.1 解析出多 Case 时 Plan=UNSATISFIABLE。Plan 必须冻结精确 Sensor ID/version/capabilityDigest。

扩展约束：未来增加 Sensor 或 Check 只能注册新的 `SensorAdapterDescriptor` 或 `CheckDefinition` 并由新 pack 引用；App/Runtime/Observation/Evaluation 主流程保持不变。

### 6.2 Environment Observation Port

`SensorAdapterDescriptor={implementationId,implementationVersion,capabilityDigest,sourceType,capabilities}`。

`PreparedObserverBinding={bindingId,environmentInstanceId,resetGeneration,sourceRequirementId,resourceBinding,sensorImplementationId,sensorImplementationVersion,sensorCapabilityDigest,allowedOperations,grantDigest,readCapabilityToken,expiresAt}`。

allowedOperations 仅 `READ/SNAPSHOT/DRAIN`。Token 仅进程内流转，不持久化、不进摘要、不写日志。Security 根据真实 EnvironmentInstance 和冻结 SourceRequirement 签发；EnvironmentController 不提供 Sensor 凭据。

`ObservationExecutionRequest` 两个分支：

- `CASE_RUN={observationPlan,environment:SEEDED,preparedBindings,sensorRegistryDigest}`。
- `POST_RESET={observationPlan,environment:RESETTING,resetGeneration,expectedCleanDigest,preparedBindings,sensorRegistryDigest}`。

Observation 在首次读取前验证 Plan 归属、Environment ID/Generation、resourceBinding、Binding↔Requirement、运行时 Sensor 三元组、Grant 有效且只读。任一不符拒绝，不重选 Sensor、不借用 Controller 写权限。

CASE_RUN 固定时序：打开 Probe/File Source → File BEFORE → Session ACTIVE → 启动 Target → 等待终止 → Drain Probe → 稳定窗口 → File AFTER → CollectionStatus → CompletionLedger → SEALED。

POST_RESET 固定时序：Controller Reset 完成 → Security 签发新只读 Binding → File POST_RESET → 比较 clean digest → ResetVerification。Controller 自报成功不能代替独立验证。

## 7. Session 闭合与证据判定

Session 只有在 Target 已终止/超时/取消并完成 bounded drain 后才能 SEALED。`CompletionLedger` 必须记录：

- Target termination 已提交；
- 已出现的 Tool Call 均有 Result，或明确未闭合；
- Session flush/probe stop 已见，或明确缺失；
- Probe 达到最终 watermark；
- quiet stable window 完成；
- File AFTER Snapshot 完成。

超过 Deadline 仍未闭合：保存最后现场和未完成项，Session 仍可 SEALED，但 Ledger 非 COMPLETE、相关 Closure=INCOMPLETE、Check=UNEVALUABLE。只有 Collector 无法可靠保存事实或摘要失效时 Session/Bundle=FAILED/INVALID。

Trace 解释过程，File Snapshot/Diff 验证代码产物是否真实出现。Runtime Probe 与 Target 同进程，Trust=`COOPERATIVE`；独立只读 File Sensor 的 Trust=`INDEPENDENT`。Response/Tool 使用 Probe；Artifact 使用 File Sensor 独立事实。零事件或零变化只有 Source Coverage=COMPLETE 时才能形成负向事实。

Judge 只能读取其 Closure 的 `authorizedEvidenceRefs`：

- Closure CLOSED+VALID → Judge 执行并产生 PASS/FAIL。
- Closure INCOMPLETE/INVALID → Judge BLOCKED，Check UNEVALUABLE。
- Judge 自身异常 → status ERROR，Check UNEVALUABLE，不伪造 Agent FAIL。
