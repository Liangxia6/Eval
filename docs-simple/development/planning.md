# Planning 模块开发规格（MVP）

> 适用范围：FULL_AGENT 的单文件 Case。精确字段见[MVP 公共契约](./CONTRACT_CATALOG.md)；[完整版 Planning](../../docs/development/planning.md)仅供未来多资产、多插件规划扩展参考。

## 1. 模块目标

Planning 将一个本地 DSH Agent 转换为唯一、确定、证据可满足的 filesystem 评测计划，回答：

1. 实际冻结的是哪个 DSH、Profile、配置和源码。
2. Headless Driver 与 Runtime Probe 是否满足执行和观测要求。
3. 固定文件 Scenario 能否在当前 VM、安全隔离和 Sensor/Judge 注册表中运行。
4. Protocol、File State、Path Security 三个 Check 分别需要哪些证据。

Planning 不启动 Agent、不 Seed/Reset 环境、不采集本次运行事实、不执行 Judge。

## 2. 文件职责

| 文件 | MVP 责任 | 不负责 |
|---|---|---|
| `target.ts` | 校验 TargetDescriptor、冻结 TargetSnapshot、运行前完整性复核 | 插件安装、修改原 Profile、启动 Agent |
| `inspector.ts` | 检查 DSH/Headless/Probe/Tool/Permission，生成 InspectionSnapshot | 插件变化基线、评分、名称猜测 |
| `catalog.ts` | 加载并验证唯一 filesystem pack | 通用资产市场、动态资产选择 |
| `planner.ts` | 生成单 Case Plan、ObservationPlan、三个 EvidenceContract | 执行计划、实时查询环境、LLM 规划 |

MVP 不新增 Case Compiler 子模块；`planner.ts` 内部机械编译单 Case，不建立无消费者的通用匹配引擎。

## 3. 输入与输出

输入：

- TargetDescriptor：FULL_AGENT、本地来源根、DSH 入口/Home/Profile、低权限身份。
- ConfigSnapshot：目录、Deadline、稳定窗口、内容模式、安全根和版本 Pin。
- filesystem pack：确定性任务、Seed/clean state、允许/禁止路径、三项 Check/Judge。
- Sensor Registry：Runtime Probe Adapter 与 File Sensor 的精确 ID、版本、能力摘要。
- Judge Registry：ProtocolJudge、FileStateJudge、PathSecurityJudge 的精确版本。
- VM Capability：只读 Observer、身份隔离、原子 Artifact、Headless Driver 能力。

输出：

- TargetSnapshot、InspectionSnapshot、FilesystemPack Ref。
- FROZEN EvaluationPlan，恰好一个 CasePlan、三个 CheckPlan。
- ObservationPlan，恰好两个 SourceRequirement：DSH_PROBE、FILESYSTEM。
- 三个 EvidenceContract。
- UNSATISFIABLE 时的结构化缺口和 FailureDraft；不创建 Run。

## 4. Target 冻结

固定步骤：

1. 规范化 sourceRoot、dshExecutable、dshHome；禁止 Shell 字符串和来源根逃逸。
2. 解析真实入口对应的包、版本、关键入口文件、Profile、锁文件和有效配置。
3. 计算 Source/Home/Profile/Lock/EffectiveConfig Artifact 摘要并提交。
4. 冻结 DriverFingerprint：入口摘要、Headless 包版本/摘要、CLI Grammar、退出/取消、Workspace 与配置语义。
5. 只用已提交 Artifact Ref 生成 TargetSnapshot。
6. Run 创建前重算关键摘要；变化产生 TARGET_INTEGRITY，必须重新冻结。

无法把入口绑定到 Package Manifest 时版本保持未知；不能用 Web Host 版本代替。`--dump-config` 只能在一次性只读语义克隆运行，产生的变化进入审计，不能写回原 Target。Secret 只保存引用名称和存在性。

## 5. Inspector 最低事实

InspectionSnapshot 必须包含：

- 实际 DSH 版本状态、Node/平台、Profile 和入口摘要。
- Headless Driver 与冻结 Fingerprint 是否兼容。
- Runtime Probe 是否配置、Schema 是否为 `dsh-eval.probe/v1`、Profile 顺序是否早于 Headless。
- Probe 是否支持 dispatch/log、ContentMode 和 one-shot SourceRunId 回显。
- 已声明 Tool Schema；未出现不代表 ABSENT。
- Permission Preset、Sandbox Mode、Target Identity。
- 所有来源 Artifact、读取错误、限制和 UNKNOWN。

事实优先级：冻结静态配置/锁文件 > 受支持声明 > 与 Snapshot 精确匹配的历史 Probe。MVP 不需要官方插件 Baseline、Plugin Change 或 Runtime Ownership Graph；这些均 DEFERRED。

## 6. Filesystem Pack

Catalog 只接受一个版本化 pack，至少包含：

| 部分 | 必需内容 |
|---|---|
| Scenario | 确定性任务模板、公开输入、Deadline、稳定窗口 |
| Environment | Seed 文件、clean state digest、Workspace 绑定、Reset 规则 |
| Path Policy | allowedPaths、forbiddenPaths；只用规范 PortablePath/显式前缀 |
| Sources | DSH_PROBE、FILESYSTEM 及精确能力要求 |
| Checks | PROTOCOL、FILE_STATE、PATH_SECURITY；三项均 `required=true, hardGate=true` |
| Judges | 三个确定性 Judge ID、版本、规则和证据模板 |
| Gate | hard FAIL > required UNEVALUABLE > PASS |

Catalog 只读取允许后缀的普通文件，不跟随 pack root 外符号链接。Schema、ID、版本、引用、路径和摘要任一非法即拒绝。pack 内公开输入与隐藏期望必须分区；只有公开输入会物化为 Target 可见 Artifact，隐藏规则编译进 EvidenceContract.ruleParameters 并留在 Target 不可访问的记录根。

## 7. Evaluation Asset Matching Port

匹配是固定而非启发式的：

```text
PROTOCOL      → Runtime Probe       → ProtocolJudge
FILE_STATE    → File Before/After   → FileStateJudge
PATH_SECURITY → File Before/After   → PathSecurityJudge
```

`Catalog.loadFilesystemPack + Planner.buildPlan` 构成 Evaluation Asset Matching Port，公共输出只使用 `PlanBuildResult`。

职责：

- Catalog 加载、校验、冻结 pack，不判断 Agent 表现。
- Planner 检查 Target/Inspection/VM/Sensor/Judge 能力并决定 FROZEN 或 UNSATISFIABLE。
- Case Compiler 只把已确定映射写入单 CasePlan，不重新选 Source/Judge。

每个 Check 必须在冻结前闭合：

```text
CheckPlan
→ EvidenceContract
→ SourceRequirement
→ filesystem Scenario/Environment
→ deterministic Judge
→ Gate Rule
```

缺任一 Mandatory 节点时不执行。MVP 不根据插件名称选择专属数据集，不做预算优化，也不合并/拆分多个 Case。

## 8. Plan 编译顺序

1. 校验 TargetSnapshot 摘要和 Inspection 绑定。
2. 加载、验证并冻结 filesystem pack。
3. 从实际 Registry 选择 Probe/File Sensor 精确 `implementationId/version/capabilityDigest`。
4. 复验三个 Judge 的 ID、版本和 deterministic 能力。
5. 提交 Visible Input 与 AgentTask Artifact；把隐藏期望编译进只授权 Judge 的 EvidenceContract.ruleParameters。
6. 编译三个 EvidenceContract。
7. 编译单 Case EvaluationPlan；`order=1`、`maxAttempts=1`。
8. 将已匹配的两个 SourceRequirement 逐字段写入 ObservationPlan，并用 `casePlanId` 绑定唯一 Case。
9. 预检路径隔离、Observer 只读、Deadline、稳定窗口和 Probe 顺序后冻结。

ObservationPlan 不反向写入已冻结 EvaluationPlan。任何内容变化必须生成新 Plan ID 和 Digest。

## 9. 与 Environment Observation Port 的边界

Planning 冻结：Source 类型、资源逻辑绑定、精确 Sensor 三元组、Mandatory、Trust、ContentMode、字节/时间上限、水位、Before/After/Stable 边界。

运行期 Security 使用真实 EnvironmentInstance/Generation 签发 PreparedObserverBinding；Observation 逐项复验并执行。Planning 不读取实时环境、不签发 Token；Observation 不选择 Check、Judge 或 Sensor。

未来新增 Sensor：注册新的 SensorAdapterDescriptor，并让新 pack 的 SourceRequirement 引用；Planner 的 Registry 选择和 Observation 的 Binding 复验接口不变。未来新增 Check：注册 CheckDefinition、EvidenceContract 模板和 Judge，再由新 pack 引用；主流程不变。

## 10. 确定性与安全

相同 TargetSnapshot、InspectionSnapshot、FilesystemPack、ConfigSnapshot、Sensor/Judge Registry 必须产生相同 Plan SemanticDigest。摘要保留所有影响执行/判定的状态、UNKNOWN、限制和版本，排除随机运行 ID、时间和存储位置。

安全预检至少验证：Target/Observer/Judge 身份分离；Observer 仅 READ/SNAPSHOT/DRAIN；Target 只能访问 Workspace/Runtime Home；证据、报告、隐藏期望目录不可见；网络默认 DENY，仅允许 ConfigSnapshot 中冻结的模型端点；Probe 在 Headless 前 Arm。

PlanningCapability 只证明可规划；Run 创建后的 SecurityPreflight 才验证真实路径与身份。失败不修改 Plan，Run 在 Target 启动前 FAILED。

## 11. 失败语义

| 情形 | 结果 |
|---|---|
| Descriptor/路径/摘要非法 | TARGET_RESOLUTION 或 TARGET_INTEGRITY |
| DSH/Driver/Probe 版本未知且规则依赖它 | PLAN_UNSATISFIABLE |
| Probe/File Sensor/Judge 缺失或三元组冲突 | PLAN_UNSATISFIABLE |
| Observer 无法只读、Target 可见隐藏目录 | PLAN_UNSATISFIABLE 或真实 Preflight 失败 |
| pack Schema/引用/隐藏隔离非法 | INPUT_VALIDATION |
| Planner 内部不变量失败 | INTERNAL_INVARIANT，不输出部分 Plan |

## 12. 实现顺序

1. `target.ts`：Descriptor、冻结、摘要、完整性复核。
2. `catalog.ts`：单 filesystem pack 加载与校验。
3. `inspector.ts`：DSH/Headless/Probe/权限事实。
4. `planner.ts`：固定三 Check 匹配、Contract、单 Case Plan、ObservationPlan。
5. 确定性、隐藏隔离、缺能力和版本冲突测试。

## 13. 强制要求

| ID | 要求 |
|---|---|
| `MVP-PLAN-REQ-001` | 只接受 FULL_AGENT，其他 Target 明确 UNSUPPORTED |
| `MVP-PLAN-REQ-002` | Snapshot 覆盖真实 DSH/Profile/锁/配置/入口摘要 |
| `MVP-PLAN-REQ-003` | Inspection 保留来源、限制和 UNKNOWN |
| `MVP-PLAN-REQ-004` | 输出恰好一个 Case、一个 Attempt 上限、三个 Check |
| `MVP-PLAN-REQ-005` | 每 Check 在冻结前具有完整证据链 |
| `MVP-PLAN-REQ-006` | Probe/File Sensor 精确三元组冻结进 Plan |
| `MVP-PLAN-REQ-007` | AgentTask 不含隐藏期望、Judge Rule、Secret 或证据路径 |
| `MVP-PLAN-REQ-008` | 相同冻结输入产生相同 Plan 摘要 |
| `MVP-PLAN-REQ-009` | 缺 Mandatory 能力时 Plan UNSATISFIABLE，不启动 Agent |
| `MVP-PLAN-REQ-010` | 新 Sensor/Check 通过 Registry+Pack 扩展，不修改主流程 |

## 14. 验收标准

| ID | 完成条件 |
|---|---|
| `MVP-PLAN-AC-001` | 合法 FULL_AGENT 产生 Snapshot、Inspection 和唯一 FROZEN Plan |
| `MVP-PLAN-AC-002` | Probe 顺序错误、File Sensor 缺失、Judge 版本冲突均冻结前失败 |
| `MVP-PLAN-AC-003` | 重排 pack 文件或重复执行不改变 Plan SemanticDigest |
| `MVP-PLAN-AC-004` | 三 Check 均可追踪到 Contract、Source、Judge、Gate |
| `MVP-PLAN-AC-005` | AgentTask/Visible Artifact 扫描不到隐藏期望和管理路径 |
| `MVP-PLAN-AC-006` | 注册兼容 File Sensor Fixture 时仅 Registry/pack 变化，Planner/App 接口不变 |
| `MVP-PLAN-AC-007` | PLUGIN Target 得到明确 UNSUPPORTED，不执行安装 |
