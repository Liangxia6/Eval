# Evaluation 模块 MVP 开发规格

> 源码：`src/evaluation/`｜范围：文件任务纵向闭环｜完整版扩展参考：[evaluation.md](../../docs/development/evaluation.md)

## 1. 目标与边界

Evaluation 把已经密封的 DSH Trace 和文件环境观察转化为可回链证据，判断每个 Check 是否可评测，再执行三个确定性 Judge，产生 Gate、权威 JSON 报告和静态 HTML。

```text
SEALED RawObservation
→ EvidenceBundle
→ 每 Check 的 EvidenceClosure
→ Protocol / File State / Path Security Judge
→ CheckResult
→ App 完成 Reset/Verification/Cleanup 记录
→ GateDecision
→ EvaluationReport JSON
→ report.html Draft
```

MVP 不读取实时 Agent/环境，不修改原始观察，不使用 LLM Judge，不计算复杂综合分数，也不因证据不足默认通过。

## 2. 文件职责

| 文件 | MVP 职责 |
|---|---|
| `evidence.ts` | 校验密封观察，标准化 Probe 与 File Snapshot，生成可回链 EvidenceBundle |
| `closure.ts` | 按 Check 检查必需来源、完整度和可信度 |
| `judging.ts` | Protocol、File State、Path Security 三类确定性 Judge |
| `scoring.ts` | CheckResult 的三值聚合和单次 Gate |
| `report.ts` | 权威 EvaluationReport JSON、status/report HTML View Model 与确定性渲染 |

不得再拆 Graph Service、Judge Framework、Metric Engine 等新层；只有出现第二个真实消费者时才抽象。

## 3. MVP 数据契约

### 3.1 Evidence

每条 `EvidenceRecord` 精确使用公共契约字段：

- `evidenceId`、Run/Case/Attempt Scope、`factType/factValue`。
- `sourceRefs`、原始 `observationRefs`、可选 `artifactRefs`。
- `authority=COMMITTED|ATTEMPTED|ENVIRONMENT_STATE|DIAGNOSTIC`。
- `completeness/validity/trust`、可选 `derivationRuleId`、`timeRange` 和 `contentDigest`。

RawObservation 永不被覆盖。Runtime Evidence 必须保留外层 Probe Kind；`session/event` 与 `runtime/event` 的 Authority 不得混淆。派生文件 Diff 必须引用 Before/After Entry；仅时间相近不得生成确定因果关系。

`EvidenceBundle` 保存全部 Evidence Ref、来源完整度、未解析记录、失败和摘要。只接受 `SEALED` ObservationSession；摘要或 Scope 不可信时 Bundle=`INVALID`。处理器自身崩溃时只提交 Failure，不伪造 `EvidenceBundle`。

### 3.2 Closure

每个 Check 独立输出：

| Closure | 含义 |
|---|---|
| `CLOSED` | 必需来源完整、摘要有效、Trust 达标，可运行 Judge |
| `INCOMPLETE` | 来源可信但缺记录、缺 stop、水位或所需内容 |
| `INVALID` | Scope、摘要、顺序或来源身份不可信 |

`INCOMPLETE/INVALID → CheckResult=UNEVALUABLE`，Judge 不运行。MVP 三个 Check 都是必需项，不定义 `NOT_APPLICABLE`。一个 Check 不可评测不能抹掉另一个 Check 已确认的硬失败。

## 4. 三个 MVP Judge

### 4.1 Protocol Judge

基于 `dsh-eval.probe/v1` 检查：

- `probe/start`、`probe/stop`、Run ID 和从 0 连续的 `probeSeq`。
- `turn/start|end`、`step/start|end` 合法配对。
- `tool/call|result` 通过 Call ID 配对，不孤立、不重复。
- 明确的插件生命周期 `FAILED`。

未知事件原样保留，不自动失败。缺 stop/Seq Gap 使相关 Protocol Check `UNEVALUABLE`；仅 attempted `runtime/event` 的 idle/running 不能单独形成硬失败。

### 4.2 File State Judge

环境 Snapshot 是结果 Ground Truth。Judge 检查：

- 目标文件存在、类型正确、SHA-256/受控文本内容符合 Scenario。
- 变化发生在本 Attempt 的 Before→After 之间。
- 输入文件和保护路径未被修改。
- 没有禁止的额外文件或副作用。

Agent 回复、Tool Result、stdout 或退出码不能覆盖文件事实。

### 4.3 Path Security Judge

使用独立 File Sensor/Platform 事实检查真实规范化目标是否逃出 Attempt Workspace、是否通过 `..` 或 symlink 越界、是否触碰受保护路径。绝对路径语法只作风险信号；真实目标仍在允许根内时不得仅凭语法 FAIL。

安全 PASS 和硬 FAIL 都要求冻结规则规定的独立证据。只有协作式 Probe 时输出 Finding，但结果为 `UNEVALUABLE`。

## 5. CheckResult 与 Gate

`JudgementRecord` 保存 Judge 执行状态、Closure、授权 Evidence 和 Finding；`CheckResult` 只保存 `checkResultId/checkId/judgementRef/outcome=PASS|FAIL|UNEVALUABLE/required/hardGate/reasonCodes`。不得在 CheckResult 中复制 Closure、Evidence 或 Finding 字段。

Judge 异常/超时映射 `ERROR + UNEVALUABLE`，不是 Agent FAIL。

MVP Gate 固定优先级：

唯一 filesystem pack 已冻结三个 Check 均为 `required=true, hardGate=true`，因此本 MVP 的任一确定性 Check FAIL 都会使 Gate FAIL。

1. 任一 `hardGate=true` 的 Check FAIL → `FAIL`。
2. 无硬 FAIL，但任一必需 Check UNEVALUABLE → `UNEVALUABLE`。
3. 所有必需 Check PASS → `PASS`。

Gate 只在全部 CheckResult 以及 Reset/Verification/Cleanup 尝试结果已提交后，以单次原子写创建；同 Run 最多一份。环境收尾状态进入 Run/Report，但不改变由 CheckResult 得出的 Agent Verdict。Seal 后新增观察只作诊断，不改 Gate。MVP 不实现数值总分、Domain 加权、跨 Attempt 合并或复杂双索引 CAS。

## 6. 报告与 HTML

`EvaluationReport` JSON 是唯一权威报告，至少包含：

- Target/Plan/Case/Attempt 摘要。
- 十步流程状态、Failure 分类和系统健康。
- Trace 摘要、Before/After/Diff。
- 每个 Check 的 Closure、Judge、Outcome、Finding 和 Evidence Ref。
- Gate、Reset Verification、Environment 最终状态。
- 证据缺口、Failure 和确定性排障提示。

`report.html` 只能从重新读取且摘要有效的 Report JSON 渲染；不得重新 Judge 或读取环境。相同 JSON 摘要和 Renderer 版本必须生成相同 UTF-8 字节。HTML 无外部脚本/CDN，Agent 内容全部转义；渲染失败不改变 Run/Gate。

运行中的 `status.html` 只显示已提交事实，原子替换且非权威，不进入最终 Artifact/Gate。

## 7. 失败处理

| 情况 | MVP 结果 |
|---|---|
| Probe 缺尾/Gap | Protocol UNEVALUABLE；File Check 仍可独立判断 |
| File Snapshot 失败 | 依赖的 State/Security UNEVALUABLE |
| Artifact 摘要不符 | Bundle INVALID，相关 Check UNEVALUABLE |
| Judge 错误 | Judge ERROR，Check UNEVALUABLE |
| 文件结果明确错误 | File State FAIL |
| 可信路径越界 | Security 硬 FAIL |
| Report/HTML 失败 | Delivery/报告失败；既有 Gate 不变 |

## 8. MVP 要求与验收

| ID | 要求 |
|---|---|
| `MVP-EVAL-REQ-001` | Raw、标准 Evidence、派生 Diff 分离并可回链 |
| `MVP-EVAL-REQ-002` | Closure 按 Check 计算；证据不足不运行 Judge |
| `MVP-EVAL-REQ-003` | 只实现三个确定性 Judge，环境事实优先于 Agent 声称 |
| `MVP-EVAL-REQ-004` | Judge 错误映射 UNEVALUABLE，不是 Agent FAIL |
| `MVP-EVAL-REQ-005` | Gate 优先级固定，且同 Run 只提交一次 |
| `MVP-EVAL-REQ-006` | 报告/HTML 只展示已提交事实，不改变 Gate |

| ID | 验收条件 |
|---|---|
| `MVP-EVAL-AC-001` | 任一 Finding 可回链 Probe 行或 File Snapshot Entry |
| `MVP-EVAL-AC-002` | Probe 不完整时 Protocol UNEVALUABLE，但完整文件结果仍可 PASS/FAIL |
| `MVP-EVAL-AC-003` | Tool 声称成功而目标文件错误时稳定 FAIL |
| `MVP-EVAL-AC-004` | Judge 抛错不会生成 Agent FAIL 或默认 PASS |
| `MVP-EVAL-AC-005` | 硬失败优先、必需缺证据次之、全部通过才 PASS |
| `MVP-EVAL-AC-006` | 相同 Report JSON 重渲染一致，HTML 失败不改 Gate |

## 9. 延后实现

LLM/Semantic/偏好 Judge、Trajectory DAG、数值加权、跨 Domain/Attempt 聚合、自动 Gap Planner、复杂 LateArrival 恢复、在线报告服务、PostgreSQL/HTTP/Browser 业务 Judge。新增 Judge 必须消费同一 Closure 接口，不得绕过证据链。
