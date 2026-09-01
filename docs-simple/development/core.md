# Core 模块开发规格（MVP）

> 适用范围：单 VM、单 Run/Case/Attempt 的文件任务闭环。公共字段以[MVP 公共契约](./CONTRACT_CATALOG.md)为准；[完整版 Core](../../docs/development/core.md)仅供未来扩展参考。

## 1. 模块目标

Core 为 MVP 提供一套不可混用的公共语言：Scope、Ref、Digest、状态、Outcome、Failure 和 Port 返回语义。八个模块必须引用同一类型，不能各自声明近义结构。

Core 不访问文件系统、DSH、进程、网络或存储，不编排流程，不实现 Planner、Sensor、Judge、Repository。

## 2. 文件职责

| 文件 | 负责 | 不负责 |
|---|---|---|
| `models.ts` | MVP 公共值对象、记录形状、枚举和状态 | I/O、状态副作用、业务算法 |
| `contracts.ts` | 最小 Port、输入输出、Context、幂等与前置条件 | 实现类、容器、通用插件框架 |
| `errors.ts` | FailureDraft/FailureRecord、分类、来源和异常转换 | 直接生成 Check 分数或报告 |

对象只有被两个以上模块传递，或属于全链路身份/失败/结果语义时才进入 Core。Postgres、Browser、Retry、Gap、Repair 等未来对象不得提前加入。

## 3. MVP 公共语义

### 3.1 六类不可混用的结果

| 类型 | 回答的问题 |
|---|---|
| Lifecycle State | 流程走到哪里 |
| CheckOutcome / GateVerdict | Agent 表现如何 |
| OperationalHealth | DSHEval 和环境是否健康 |
| EvidenceCompleteness | 计划观察是否覆盖 |
| EvidenceValidity | Scope、来源和摘要是否可信 |
| FailureRecord | 哪里、为何、归因于谁 |

强制规则：

- `Run=FINISHED` 不代表 PASS。
- Agent 任务错误且 File/Probe 证据可信时为 FAIL，不是 Harness Error。
- Collector 或 Judge Error 使受影响 Check UNEVALUABLE，不是 Agent FAIL。
- Reset/Cleanup 失败不修改已提交 CheckResults，之后的 Gate 仍只由这些结果生成；Report 失败不修改已提交 Gate。
- UNEVALUABLE 无默认数值，不能当零分参与平均。

### 3.2 Scope、Ref 与 Digest

- Scope 严格遵循 `target→snapshot→run→case→attempt`；Observation/Evidence/Judge 必须到 Attempt。存在子级就必须包含全部父级。
- StableId 是名义类型；Target、Run、Case、Attempt、Artifact ID 不得互换。
- Ref 只指向已提交对象，携 Schema、ID、Digest；生命周期 Ref 还携 Revision。
- Artifact 字节摘要与 ArtifactRef 元数据摘要分离。
- 结构化记录按 RFC 8785 和 SHA-256 计算；列表/目录稳定排序。
- Scope、Ref、Revision 或 Digest 不一致必须拒绝，不能降级为 Warning。

### 3.3 不可变与状态更新

TargetSnapshot、Plan、ObservationPlan、EvidenceContract、RawObservation、FileSnapshot、Evidence、Judgement、CheckResult、Gate、Report、ArtifactRef 一经提交不可修改；内容变化创建新 ID。

Run、Case、Attempt、Environment、ObservationSession 使用同一聚合 ID 和单调 Revision。所属模块创建 `StateTransition` 并校验合法箭头；Repository 只做 CAS、追加事件和投影保存。App 不拼状态、不重算摘要。

MVP 不实现通用 TransitionRequest 大联合、跨聚合事务框架或事件总线。唯一运行流程由 App 按公共 Port 串联；需要同步保持的不变量在 App 的明确检查点提交。

## 4. 最小公共对象

| 分组 | 对象 |
|---|---|
| Planning | ConfigSnapshot、TargetDescriptor/Snapshot、InspectionSnapshot、FilesystemPack、CheckDefinition/Plan、CasePlan、SourceRequirement、EvaluationPlan、ObservationPlan、EvidenceContract、PlanBuildResult |
| Runtime | Run、Case、Attempt、EnvironmentInstance、ControlEvent、SeedManifest、SecurityPreflight、ResetVerification、LeaseRecord |
| Observation | SourceDescriptor、ObservationSession、RawObservation、CollectionStatus、FileSnapshot、FileDiff、CompletionLedger |
| Evaluation | EvidenceRecord/Bundle/Closure、JudgementRecord、Finding、CheckResult、GateDecision、EvaluationReport |
| Storage | ArtifactRef、FailureRecord、StateTransition |

字段只在[公共契约](./CONTRACT_CATALOG.md#5-公共记录)定义一次。业务模块可有内部 Capture，但跨模块前必须转为上述对象或明确 Port 值。

## 5. Failure 规则

Failure 必须同时保存：category、origin、actor、phase、Scope、severity、reasonCode、脱敏消息，以及适用的 `evidenceRefs/artifactRefs`。

| Origin | 典型含义 |
|---|---|
| TARGET | Agent 进程、工具行为或路径越界 |
| DSHEVAL | Harness、Collector、Judge、Repository、Reporter 错误 |
| ENVIRONMENT | Seed、Reset、Cleanup 或 VM 服务错误 |
| USER | Descriptor、Config 或取消 |
| EXTERNAL_DEPENDENCY | DSH/模型端点等外部依赖 |
| UNKNOWN | 当前证据不能可靠归因 |

执行 Port 返回 FailureDraft；App 先持久化，再以 Ref 推进聚合。MVP 不自动 Retry，因此 `retryable=false`。程序异常必须转换为 INTERNAL_INVARIANT；若 Failure 也无法保存，只输出脱敏紧急诊断并以操作失败退出。

## 6. Port 设计原则

每个公共 Port 必须声明：

- 权威输入、输出和前置状态；
- OperationContext 或 DeterministicContext；
- 幂等键及同键异输入冲突；
- SUCCEEDED/REJECTED/FAILED/CANCELLED；
- 会产生的 Artifact、Failure 或状态事实；
- 调用后必须保持的不变量。

有副作用操作遵循：进入态已提交 → Execute → 事实已提交 → 完成/失败态已提交。纯计算 Port 不读取 Clock、随机源或 I/O。

## 7. 模块依赖边界

```text
app → planning/runtime/observation/evaluation/storage/platform
planning/runtime/observation/evaluation/storage/platform → core
core → 无业务模块
```

- Planning 决定 SourceRequirement，不调用 Sensor。
- Observation 执行冻结 SourceRequirement，不选择 Check。
- Runtime 控制 Target/Environment，不读取 Judge 结果。
- Evaluation 只消费已提交 Evidence，不直接操作环境。
- Storage 校验/持久化，不推导业务结论。
- Platform 签发只读观测能力，不把 Controller 权限交给 Sensor。

未来增加 Sensor/Check 通过注册描述符和 pack 配置完成；Core 只在真正出现新的跨模块语义时扩展。

## 8. 实现顺序

1. StableId、ScopeRef、Digest、Ref、时间、Schema 校验。
2. Outcome、Health、Completeness、Validity、Failure 枚举。
3. MVP 公共记录及状态机。
4. Operation/Deterministic Context、PortResult、FailureDraft。
5. 序列化、摘要、Scope/Ref/Revision、非法状态契约测试。

## 9. 强制要求

| ID | 要求 |
|---|---|
| `MVP-CORE-REQ-001` | 公共对象只有一处权威定义 |
| `MVP-CORE-REQ-002` | Lifecycle、Outcome、Health、Completeness、Validity、Failure 分离 |
| `MVP-CORE-REQ-003` | Scope 子级包含并校验全部父级 |
| `MVP-CORE-REQ-004` | Ref 只引用已提交且摘要有效的对象 |
| `MVP-CORE-REQ-005` | 不可变记录不可覆盖；状态只通过合法 Transition+CAS 更新 |
| `MVP-CORE-REQ-006` | 外部未知 Probe 事件原样保留 |
| `MVP-CORE-REQ-007` | Evidence 不足产生 UNEVALUABLE，不伪造 PASS/FAIL |
| `MVP-CORE-REQ-008` | Failure 保留归因，不能直接映射分数 |
| `MVP-CORE-REQ-009` | Core 无 I/O、DSH 或业务模块依赖 |
| `MVP-CORE-REQ-010` | 无 MVP 消费者的完整版抽象保持 DEFERRED |

## 10. 验收标准

| ID | 完成条件 |
|---|---|
| `MVP-CORE-AC-001` | 八个模块复用同一对象，无同义复制 |
| `MVP-CORE-AC-002` | Scope 串线、不同名义 ID 串用、旧 Revision 被拒绝 |
| `MVP-CORE-AC-003` | 对象序列化往返与摘要在重排后保持稳定 |
| `MVP-CORE-AC-004` | 每个 MVP 生命周期合法/非法迁移有测试 |
| `MVP-CORE-AC-005` | Agent、Collector、Judge、Environment、Report Failure 分类不同 |
| `MVP-CORE-AC-006` | UNEVALUABLE 不参与数值聚合 |
| `MVP-CORE-AC-007` | Core 编译时无文件系统、网络、进程或业务模块依赖 |

DEFERRED：插件 Target、多 Case/Attempt、Retry、分布式事务、通用事件总线和非文件环境对象；仅在简版 MVP 形成真实消费者后再进入 Core。
