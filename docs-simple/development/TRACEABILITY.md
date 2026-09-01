# DSHEval MVP 需求追踪矩阵

本文只追踪 `docs-simple` 的 MVP 要求。每项 Requirement 在矩阵中恰好出现一次，并绑定已有 Acceptance、正向测试和失败或边界测试。完整版 `docs/` 的编号、测试和延后能力不得进入本表。

门禁含义：`A` 为 Agent 评测门禁，`T` 为证据可信度门禁，`O` 为 DSHEval 运行门禁，`R` 为研发发布门禁。`O` 失败不得伪装成 Agent 失败。

## 全局

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-DEV-REQ-001` | `MVP-DEV-AC-001`,`MVP-CONTRACT-AC-002` | `MVP-E2E-001` | `MVP-E2E-012` | `O` / App | 仅接受单 FULL_AGENT、单 Run/Case/Attempt |
| `MVP-DEV-REQ-002` | `MVP-DEV-AC-002`,`MVP-CONTRACT-AC-001` | `MVP-UT-CORE-001` | `MVP-FI-APP-001` | `T+O` / Planning | 冻结摘要漂移时不启动 Agent |
| `MVP-DEV-REQ-003` | `MVP-DEV-AC-003` | `MVP-CT-MATCH-001` | `MVP-UT-PLAN-002` | `T` / Planning | Planner 唯一匹配，Compiler 不重选 |
| `MVP-DEV-REQ-004` | `MVP-DEV-AC-004`,`MVP-TEST-AC-003` | `MVP-UT-CORE-002` | `MVP-E2E-008` | `T` / Core | 跨 Scope 事实不能进入 Judge |
| `MVP-DEV-REQ-005` | `MVP-DEV-AC-005`,`MVP-CONTRACT-AC-005` | `MVP-IT-RUN-001` | `MVP-SEC-PLAT-001` | `A+T` / Runtime | Agent 产生业务变化，控制与观测职责分离 |
| `MVP-DEV-REQ-006` | `MVP-DEV-AC-006` | `MVP-CT-PROBE-001` | `MVP-FI-SENSOR-001` | `T` / Observation | Before/After 与 Probe 边界不足时禁止 PASS |
| `MVP-DEV-REQ-007` | `MVP-DEV-AC-007`,`MVP-CONTRACT-AC-007` | `MVP-CT-STORE-001` | `MVP-E2E-008` | `T` / Storage | Raw、Evidence 和 Artifact 可回链且不可覆盖 |
| `MVP-DEV-REQ-008` | `MVP-DEV-AC-008`,`MVP-CONTRACT-AC-003` | `MVP-IT-EVAL-001` | `MVP-E2E-006`,`MVP-E2E-007` | `T` / Evaluation | 证据不足稳定得到 UNEVALUABLE |
| `MVP-DEV-REQ-009` | `MVP-DEV-AC-009` | `MVP-UT-GATE-001` | `MVP-E2E-004` | `A` / Evaluation | 硬失败优先，全部必需项通过才 PASS |
| `MVP-DEV-REQ-010` | `MVP-DEV-AC-010`,`MVP-CONTRACT-AC-004` | `MVP-UT-CLI-001` | `MVP-FI-APP-001` | `O+T` / Core | 五类故障保持来源和阶段 |
| `MVP-DEV-REQ-011` | `MVP-DEV-AC-011` | `MVP-FI-TARGET-001` | `MVP-E2E-009` | `O` / Runtime | 不自动重试，保留唯一 Attempt 的现场 |
| `MVP-DEV-REQ-012` | `MVP-DEV-AC-012`,`MVP-CONTRACT-AC-006` | `MVP-IT-RESET-001` | `MVP-E2E-010` | `O` / Runtime | Reset 失败隔离环境，不改 Agent Verdict |
| `MVP-DEV-REQ-013` | `MVP-DEV-AC-013` | `MVP-CT-STORE-001` | `MVP-SEC-SECRET-001` | `O+T` / Platform | 权威产物可验且无 Secret 泄露 |
| `MVP-DEV-REQ-014` | `MVP-DEV-AC-014` | `MVP-UT-REPORT-001` | `MVP-E2E-011` | `O` / Evaluation | 页面只投影已提交事实，不重算 Gate |
| `MVP-DEV-REQ-015` | `MVP-DEV-AC-015` | `MVP-CT-ARCH-001` | `MVP-CT-ARCH-002` | `R` / App | 无当前调用方的抽象和空壳不得进入 MVP |

## Core

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-CORE-REQ-001` | `MVP-CORE-AC-001` | `MVP-CT-ARCH-001` | `MVP-CT-ARCH-002` | `R` / Core | 公共对象只有一份权威定义 |
| `MVP-CORE-REQ-002` | `MVP-CORE-AC-004`,`MVP-CORE-AC-006` | `MVP-UT-CORE-003` | `MVP-FI-APP-001` | `T+O` / Core | 生命周期、完整度、结果和健康不折叠 |
| `MVP-CORE-REQ-003` | `MVP-CORE-AC-002` | `MVP-UT-CORE-002` | `MVP-E2E-008` | `T` / Core | 子级 Scope 必须包含并匹配父级 |
| `MVP-CORE-REQ-004` | `MVP-CORE-AC-003` | `MVP-CT-STORE-001` | `MVP-E2E-008` | `T` / Core | Ref 只指向已提交且摘要有效对象 |
| `MVP-CORE-REQ-005` | `MVP-CORE-AC-004` | `MVP-UT-CORE-003` | `MVP-CT-STORE-001` | `T+O` / Core | 非法迁移和覆盖写被拒绝 |
| `MVP-CORE-REQ-006` | `MVP-OBS-AC-004` | `MVP-CT-PROBE-001` | `MVP-FI-PROBE-001` | `T` / Core | 未知 Probe 事件原样保留 |
| `MVP-CORE-REQ-007` | `MVP-CORE-AC-006` | `MVP-UT-CLOSURE-001` | `MVP-E2E-006` | `T` / Core | 证据不足不生成伪 PASS/FAIL |
| `MVP-CORE-REQ-008` | `MVP-CORE-AC-005` | `MVP-UT-CLI-001` | `MVP-FI-JUDGE-001` | `O+T` / Core | Failure 归因不直接映射分数 |
| `MVP-CORE-REQ-009` | `MVP-CORE-AC-007` | `MVP-CT-ARCH-001` | `MVP-CT-ARCH-002` | `R` / Core | Core 无 I/O、DSH 和业务依赖 |
| `MVP-CORE-REQ-010` | `MVP-DEV-AC-015` | `MVP-CT-ARCH-001` | `MVP-CT-ARCH-002` | `R` / Core | 延后抽象不生成占位实现 |

## Planning

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-PLAN-REQ-001` | `MVP-PLAN-AC-007` | `MVP-E2E-001` | `MVP-E2E-012` | `O` / Planning | 非 FULL_AGENT 明确 UNSUPPORTED |
| `MVP-PLAN-REQ-002` | `MVP-PLAN-AC-001` | `MVP-UT-PLAN-001` | `MVP-FI-APP-001` | `T+O` / Planning | Snapshot 绑定真实 DSH/Profile/配置摘要 |
| `MVP-PLAN-REQ-003` | `MVP-PLAN-AC-001` | `MVP-UT-INSPECT-001` | `MVP-UT-INSPECT-001` | `T` / Planning | Inspection 保留来源、限制和 UNKNOWN |
| `MVP-PLAN-REQ-004` | `MVP-PLAN-AC-001` | `MVP-CT-MATCH-001` | `MVP-E2E-012` | `O` / Planning | Plan 恰好一个 Case、三个 Check |
| `MVP-PLAN-REQ-005` | `MVP-PLAN-AC-004` | `MVP-CT-MATCH-001` | `MVP-UT-PLAN-002` | `T` / Planning | 每个 Check 有完整证据链 |
| `MVP-PLAN-REQ-006` | `MVP-PLAN-AC-002`,`MVP-PLAN-AC-004` | `MVP-CT-PLAN-SOURCE-001` | `MVP-CT-PLAN-SOURCE-001` | `T` / Planning | Source 三元组固定且可执行 |
| `MVP-PLAN-REQ-007` | `MVP-PLAN-AC-005` | `MVP-SEC-TASK-001` | `MVP-SEC-TASK-001` | `A+O` / Planning | AgentTask 不泄露隐藏期望和管理信息 |
| `MVP-PLAN-REQ-008` | `MVP-PLAN-AC-003` | `MVP-UT-PLAN-001` | `MVP-UT-CORE-001` | `T+R` / Planning | 相同冻结输入产生相同 Plan 摘要 |
| `MVP-PLAN-REQ-009` | `MVP-PLAN-AC-002` | `MVP-E2E-001` | `MVP-UT-PLAN-002` | `O+T` / Planning | Mandatory 能力缺失时不启动 Agent |
| `MVP-PLAN-REQ-010` | `MVP-PLAN-AC-006`,`MVP-CONTRACT-AC-008` | `MVP-CT-EXT-001` | `MVP-E2E-012` | `R` / Planning | 新 Sensor/Check 只经 Registry 与 Pack 扩展 |

## Runtime

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-RUN-REQ-001` | `MVP-RUN-AC-001` | `MVP-E2E-001` | `MVP-E2E-012` | `O` / Runtime | 固定单 Run/Case/Attempt 且不 Retry |
| `MVP-RUN-REQ-002` | `MVP-RUN-AC-002` | `MVP-IT-RUN-001` | `MVP-UT-PLAN-002` | `T+R` / Runtime | Runtime 只执行冻结 Plan，不规划或评分 |
| `MVP-RUN-REQ-003` | `MVP-RUN-AC-003` | `MVP-IT-RUN-001` | `MVP-FI-APP-001` | `T+O` / Runtime | ACTIVE 前不 spawn，Seal 前不 Closure |
| `MVP-RUN-REQ-004` | `MVP-RUN-AC-004` | `MVP-SEC-RUN-001` | `MVP-SEC-RUN-002` | `O` / Runtime | 安全参数、cwd、环境与低权限身份生效 |
| `MVP-RUN-REQ-005` | `MVP-RUN-AC-005` | `MVP-IT-RESET-001` | `MVP-SEC-FILE-001`,`MVP-E2E-005` | `A+O` / Runtime | Seed/Reset 无路径或链接逃逸 |
| `MVP-RUN-REQ-006` | `MVP-RUN-AC-006` | `MVP-FI-TARGET-001` | `MVP-E2E-009` | `A+O` / Runtime | 异常终止仍保留事实，退出码不直接定 Verdict |
| `MVP-RUN-REQ-007` | `MVP-RUN-AC-007` | `MVP-IT-RESET-001` | `MVP-E2E-010` | `O` / Runtime | Reset 顺序正确且由独立读取验证 |
| `MVP-RUN-REQ-008` | `MVP-RUN-AC-008` | `MVP-UT-CLI-001` | `MVP-FI-JUDGE-001` | `O+T` / Runtime | Agent/System/Judge 故障不混淆或覆盖 |

## Observation

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-OBS-REQ-001` | `MVP-OBS-AC-001` | `MVP-CT-SOURCE-001` | `MVP-E2E-008` | `T` / Observation | Probe 与 File Source 独立保存和回链 |
| `MVP-OBS-REQ-002` | `MVP-OBS-AC-002` | `MVP-IT-RUN-001` | `MVP-FI-SENSOR-001` | `T+O` / Observation | Before/ACTIVE 完成后才启动 Agent |
| `MVP-OBS-REQ-003` | `MVP-OBS-AC-003` | `MVP-IT-CLOSURE-001` | `MVP-IT-CLOSURE-001` | `T` / Observation | Drain/After/Commit 后才 Seal 和 Closure |
| `MVP-OBS-REQ-004` | `MVP-OBS-AC-004` | `MVP-CT-PROBE-001` | `MVP-FI-PROBE-001` | `T` / Observation | 缺口、坏尾、未知事件不被丢弃或猜测 |
| `MVP-OBS-REQ-005` | `MVP-OBS-AC-005` | `MVP-UT-FILE-001` | `MVP-SEC-FILE-001` | `A+T` / Observation | File Snapshot/Diff 准确且根边界安全 |
| `MVP-OBS-REQ-006` | `MVP-OBS-AC-006` | `MVP-UT-FILE-001` | `MVP-FI-SENSOR-001` | `T` / Observation | Sensor 失败不等于“无变化” |
| `MVP-OBS-REQ-007` | `MVP-OBS-AC-007` | `MVP-CT-STORE-001` | `MVP-FI-LATE-001` | `T` / Observation | Seal 后事实不改写既有 Evidence/Verdict |
| `MVP-OBS-REQ-008` | `MVP-OBS-AC-008` | `MVP-IT-RESET-001` | `MVP-E2E-010` | `O` / Observation | Reset Verification 使用独立新读取 |

## Evaluation

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-EVAL-REQ-001` | `MVP-EVAL-AC-001` | `MVP-IT-EVAL-001` | `MVP-E2E-008` | `T` / Evaluation | Finding 可回链 Raw Probe 或 File Entry |
| `MVP-EVAL-REQ-002` | `MVP-EVAL-AC-002` | `MVP-UT-CLOSURE-001` | `MVP-E2E-006` | `T` / Evaluation | Closure 按 Check 计算，缺证据不运行 Judge |
| `MVP-EVAL-REQ-003` | `MVP-EVAL-AC-003` | `MVP-UT-JUDGE-001`,`MVP-UT-JUDGE-002` | `MVP-E2E-002`,`MVP-E2E-003`,`MVP-SEC-JUDGE-001` | `A` / Evaluation | 三个确定性 Judge 以环境事实验证结果 |
| `MVP-EVAL-REQ-004` | `MVP-EVAL-AC-004` | `MVP-IT-EVAL-001` | `MVP-FI-JUDGE-001` | `T` / Evaluation | Judge Error 不生成 Agent FAIL 或默认 PASS |
| `MVP-EVAL-REQ-005` | `MVP-EVAL-AC-005` | `MVP-UT-GATE-001` | `MVP-E2E-004` | `A+T` / Evaluation | Gate 优先级稳定且只提交一次 |
| `MVP-EVAL-REQ-006` | `MVP-EVAL-AC-006` | `MVP-UT-REPORT-001` | `MVP-E2E-011` | `O` / Evaluation | 报告和 HTML 不改变 Gate |

## Storage

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-STORE-REQ-001` | `MVP-STORE-AC-001` | `MVP-CT-STORE-001` | `MVP-FI-STORE-001` | `O+T` / Storage | 单 Writer 的 JSON/JSONL/Artifact 可离线定位 |
| `MVP-STORE-REQ-002` | `MVP-STORE-AC-002` | `MVP-UT-CORE-001` | `MVP-UT-CORE-003` | `T` / Storage | 同 ID 同内容幂等，异内容拒绝 |
| `MVP-STORE-REQ-003` | `MVP-STORE-AC-003` | `MVP-CT-STORE-001` | `MVP-E2E-008` | `T` / Storage | Artifact 读取复核 Scope、长度和摘要 |
| `MVP-STORE-REQ-004` | `MVP-STORE-AC-004` | `MVP-SEC-STORE-001` | `MVP-SEC-STORE-001` | `A+O` / Storage | 存储路径不能逃逸冻结根 |
| `MVP-STORE-REQ-005` | `MVP-STORE-AC-005` | `MVP-IT-RUN-001` | `MVP-FI-APP-001` | `T+O` / Storage | Seal、Closure、结果、Reset 顺序可验证 |
| `MVP-STORE-REQ-006` | `MVP-STORE-AC-006` | `MVP-FI-TARGET-001` | `MVP-FI-STORE-001` | `T+O` / Storage | 失败和部分 Artifact 不被后续成功覆盖 |
| `MVP-STORE-REQ-007` | `MVP-STORE-AC-007` | `MVP-SEC-PLAT-001` | `MVP-UT-PLAT-001` | `O` / Storage | Agent 无数据根权限，Restricted 不进入报告 |
| `MVP-STORE-REQ-008` | `MVP-STORE-AC-008` | `MVP-CT-STORE-001` | `MVP-FI-STORE-001` | `O` / Storage | 中断或损坏阻止新 Run，不伪恢复 |

## Platform

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-PLAT-REQ-001` | `MVP-PLAT-AC-001` | `MVP-UT-PLAT-001` | `MVP-E2E-012` | `O` / Platform | Config 固定 MVP 规模并可复现 |
| `MVP-PLAT-REQ-002` | `MVP-PLAT-AC-002` | `MVP-SEC-IDENTITY-001` | `MVP-SEC-IDENTITY-002` | `O+T` / Platform | 两个 OS 身份真实分离且如实披露 |
| `MVP-PLAT-REQ-003` | `MVP-PLAT-AC-003` | `MVP-SEC-PLAT-001` | `MVP-SEC-FILE-001` | `A+O` / Platform | dshagent 仅访问允许的运行范围 |
| `MVP-PLAT-REQ-004` | `MVP-PLAT-AC-004` | `MVP-UT-PLAT-001` | `MVP-SEC-SECRET-001` | `O` / Platform | Secret 和不确定内容不进入普通输出 |
| `MVP-PLAT-REQ-005` | `MVP-PLAT-AC-005` | `MVP-IT-RUN-001` | `MVP-FI-APP-001` | `O` / Platform | Preflight/权限负测失败时不 spawn |
| `MVP-PLAT-REQ-006` | `MVP-PLAT-AC-006` | `MVP-IT-LEASE-002` | `MVP-IT-LEASE-001` | `O` / Platform | 同时只有一个 Lease，旧锁不自动抢占 |
| `MVP-PLAT-REQ-007` | `MVP-PLAT-AC-007` | `MVP-IT-RESET-001` | `MVP-FI-APP-001` | `O+T` / Platform | 关闭顺序保留证据并完成 Reset/Flush |
| `MVP-PLAT-REQ-008` | `MVP-PLAT-AC-008` | `MVP-E2E-001` | `MVP-E2E-011` | `O` / Platform | Export 失败不改变 Verdict |

## App

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-APP-REQ-001` | `MVP-APP-AC-007` | `MVP-CT-ARCH-001` | `MVP-CT-ARCH-002` | `R` / App | Bootstrap 是唯一组合根，无反向依赖 |
| `MVP-APP-REQ-002` | `MVP-APP-AC-001`,`MVP-APP-AC-003` | `MVP-IT-RUN-001` | `MVP-FI-APP-001` | `O` / App | Workflow 严格推进十步且不复制领域规则 |
| `MVP-APP-REQ-003` | `MVP-APP-AC-002` | `MVP-IT-RUN-001` | `MVP-FI-SENSOR-001` | `T+O` / App | Baseline 前不启动，Evidence 前不 Reset |
| `MVP-APP-REQ-004` | `MVP-APP-AC-003`,`MVP-APP-AC-004` | `MVP-FI-TARGET-001`,`MVP-FI-CLOSE-001` | `MVP-E2E-010`,`MVP-FI-CLOSE-001` | `O` / App | 任一终态后幂等收尾并释放 Lease |
| `MVP-APP-REQ-005` | `MVP-APP-AC-005` | `MVP-UT-CLI-001` | `MVP-FI-APP-001` | `O` / App | CLI 输出、退出码与 Failure 一致且无 Secret |
| `MVP-APP-REQ-006` | `MVP-APP-AC-006` | `MVP-UT-REPORT-001` | `MVP-E2E-011` | `O` / App | HTML/交付失败不回写 Gate |

## Testing

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-TEST-REQ-001` | `MVP-TEST-AC-001` | `MVP-E2E-001` | `MVP-E2E-002`,`MVP-E2E-006` | `R` / Tests | PASS/FAIL/UNEVALUABLE 三条闭环稳定 |
| `MVP-TEST-REQ-002` | `MVP-TEST-AC-006` | `MVP-CT-PORT-001` | `MVP-CT-PORT-002` | `R` / Tests | 每个 Port 覆盖正常、拒绝、失败与幂等 |
| `MVP-TEST-REQ-003` | `MVP-TEST-AC-002` | `MVP-FI-TARGET-001` | `MVP-FI-APP-001` | `R` / Tests | 故障归因、门禁、保留和收尾均有断言 |
| `MVP-TEST-REQ-004` | `MVP-TEST-AC-004` | `MVP-E2E-001` | `MVP-CT-REAL-001` | `R` / Tests | 至少一条真实 DSH E2E，不以全 mock 替代 |
| `MVP-TEST-REQ-005` | `MVP-TEST-AC-005` | `MVP-SEC-PLAT-001`,`MVP-SEC-SECRET-001` | `MVP-SEC-FILE-001`,`MVP-SEC-HTML-001` | `R` / Tests | 路径、权限、Secret 与 HTML 注入门禁通过 |

## Visualization

| Requirement | Acceptance | 正向测试 | 失败/边界测试 | 门禁 / Owner | 期望行为 |
|---|---|---|---|---|---|
| `MVP-VIS-REQ-001` | `MVP-VIS-AC-001` | `MVP-E2E-001` | `MVP-FI-STATUS-001` | `O` / Evaluation | 已创建 Run 始终有可诊断 status 页面 |
| `MVP-VIS-REQ-002` | `MVP-VIS-AC-001`,`MVP-VIS-AC-002` | `MVP-IT-RUN-001` | `MVP-E2E-010` | `O+T` / Evaluation | 十步状态来自已提交对象且不混淆失败来源 |
| `MVP-VIS-REQ-003` | `MVP-VIS-AC-004` | `MVP-UT-REPORT-001` | `MVP-E2E-011` | `O` / Evaluation | report 页面只渲染权威 JSON，不重算结论 |
| `MVP-VIS-REQ-004` | `MVP-VIS-AC-003` | `MVP-IT-EVAL-001` | `MVP-E2E-008` | `T` / Evaluation | Check 可下钻到原始 Probe 行或 File Entry |
| `MVP-VIS-REQ-005` | `MVP-VIS-AC-005` | `MVP-UT-REPORT-001` | `MVP-SEC-HTML-001` | `O+R` / Platform | HTML 离线、安全转义且无网络依赖 |

## 发布检查

- 矩阵中的 Requirement 集合必须与各开发文档完全一致，不能多也不能少。
- Acceptance 和测试 ID 必须在本目录有定义；测试元数据应引用对应 Requirement。
- 一个测试可覆盖多项要求，但同一失败不得同时归因为 Agent 与 DSHEval。
- 任何 Requirement 变化必须同步更新本文和相应自动化测试。
