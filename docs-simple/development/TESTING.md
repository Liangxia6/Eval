# DSHEval MVP 测试规格

> 目标：证明一条真实文件任务纵向闭环正确、可追溯、失败不失真。完整版测试参考：[TESTING.md](../../docs/development/TESTING.md)

## 1. 测试原则

- 先测端到端闭环，再补支持闭环的单元/契约测试。
- Trace 解释过程，File Sensor 验证结果；二者不互相代替。
- 每个失败断言同时验证“停在哪一步、归因给谁、保留了什么”。
- 不通过 mock 全部外部边界制造假 E2E；至少一条用真实 DSH Headless。
- 证据不足必须测试为 `UNEVALUABLE`，不能只测 PASS/FAIL。
- 不为延后能力建立空测试套件或占位 Snapshot。

## 2. 测试层次

| 层次 | 内容 | 门禁 |
|---|---|---|
| Unit | Digest/Scope、状态迁移、Planner 选择、File Diff、Closure、Judge、Gate、HTML 转义 | 每次提交 |
| Contract | 模块 Port 输入输出、错误/幂等、Probe/File Sensor Fixture | 每次提交 |
| Integration | 本地 Repository/Artifact、文件环境、Headless Driver、Observation→Evaluation | 每个阶段 |
| E2E | 真实 DSH 完成文件 Case 及关键失败路径 | MVP 合并前 |
| Security | 路径逃逸、symlink、Secret/保护路径、HTML 注入 | MVP 合并前 |

## 3. 必需测试集

### 3.1 Core 与 Planning

| ID | 场景 |
|---|---|
| `MVP-UT-CORE-001` | 相同对象产生稳定摘要，修改字段后摘要变化 |
| `MVP-UT-CORE-002` | Run/Case/Attempt 串 Scope 被拒绝 |
| `MVP-UT-CORE-003` | 非法生命周期迁移和同 ID 异内容被拒绝 |
| `MVP-UT-PLAN-001` | 相同 Target/Pack 输入产生相同 Plan |
| `MVP-UT-PLAN-002` | 缺 Scenario/Judge/File Sensor 时 Plan UNSATISFIABLE |
| `MVP-UT-INSPECT-001` | Inspector 对每项事实保留来源、限制、冲突和 UNKNOWN，不以缺失猜 ABSENT |
| `MVP-CT-MATCH-001` | Check↔Case 双向匹配一致，Planner 不读取实时环境 |
| `MVP-CT-PLAN-SOURCE-001` | Plan 精确保存 Sensor ID/版本/能力摘要；任一三元组漂移在执行前失败 |
| `MVP-SEC-TASK-001` | 合法 AgentTask 仅含公开输入；注入隐藏期望、Judge Rule、Secret 或管理路径时扫描失败 |
| `MVP-CT-ARCH-001` | 八个模块只按允许方向依赖，Bootstrap 是唯一组合根 |
| `MVP-CT-ARCH-002` | 发现反向依赖、同义 Core 模型或无调用方的范围外空壳时发布门禁失败 |
| `MVP-CT-PORT-001` | 每个 MVP Port 的成功与同键同输入幂等路径符合公共 PortResult |
| `MVP-CT-PORT-002` | 每个 MVP Port 的拒绝、失败与同键异输入冲突均可区分；支持取消的 I/O Port 另验证取消 |
| `MVP-CT-EXT-001` | 替换为兼容 Sensor/Check Fixture 时只改静态 Registry/pack，App 主流程接口不变 |

### 3.2 Runtime 与 Observation

| ID | 场景 |
|---|---|
| `MVP-IT-RUN-001` | Seed→Baseline→ACTIVE→Headless→Drain→Reset 顺序正确 |
| `MVP-IT-CLOSURE-001` | Target 终止→Probe Drain→File After→Artifact Commit→Seal→Closure 的门禁完整，缺一步即拒绝 Closure |
| `MVP-CT-SOURCE-001` | Probe/File 使用不同 SourceDescriptor、Artifact 和 Trust，不能互相覆盖或伪装 |
| `MVP-UT-FILE-001` | File Snapshot/Diff 识别新增、修改、删除、类型变化 |
| `MVP-SEC-FILE-001` | 根外路径和 symlink 逃逸被拒绝且不伤邻接目录 |
| `MVP-CT-PROBE-001` | 完整 Probe v1 从 0 连续、start/stop 与 turn 边界正确 |
| `MVP-FI-PROBE-001` | 缺 stop、Seq Gap、坏 JSONL 保存前缀并标 PARTIAL |
| `MVP-FI-SENSOR-001` | File Sensor 读取失败不产生“无变化”事实 |
| `MVP-FI-TARGET-001` | 非零退出/超时/取消后仍 Drain/Seal |
| `MVP-FI-LATE-001` | Seal 后迟到记录只形成诊断，不修改 Session、Evidence、CheckResult 或 Gate |
| `MVP-SEC-RUN-001` | 合法 Headless 启动固定使用 `shell=false`、参数数组、冻结 cwd 和环境允许列表 |
| `MVP-SEC-RUN-002` | Shell/argv/cwd/env 注入和非允许环境变量在 spawn 前被拒绝 |

### 3.3 Evidence、Judge 与报告

| ID | 场景 |
|---|---|
| `MVP-IT-EVAL-001` | 完整 Trace+File Evidence 形成三个 CLOSED Check |
| `MVP-UT-CLOSURE-001` | 各 Check 独立 CLOSED/INCOMPLETE/INVALID |
| `MVP-UT-JUDGE-001` | Tool 声称成功但文件错误时 File State FAIL |
| `MVP-UT-JUDGE-002` | attempted runtime event 不单独产生 Protocol 硬失败 |
| `MVP-SEC-JUDGE-001` | 可信路径越界产生硬 FAIL，协作式单源只能 UNEVALUABLE |
| `MVP-FI-JUDGE-001` | Judge 抛错映射 UNEVALUABLE，不是 Agent FAIL |
| `MVP-UT-GATE-001` | 硬 FAIL > 必需 UNEVALUABLE > PASS，且单 Run 只有一份 Gate |
| `MVP-UT-REPORT-001` | 相同 JSON 生成相同 HTML，危险内容转义 |

### 3.4 Storage、Platform 与 App

| ID | 场景 |
|---|---|
| `MVP-CT-STORE-001` | Artifact declare→stage→seal→commit，篡改读取失败 |
| `MVP-SEC-STORE-001` | Repository/ArtifactStore 接受合法 PortablePath，并拒绝绝对路径、`..`、根外 symlink 和跨 Run Ref |
| `MVP-FI-STORE-001` | 中断写不冒充已提交 Artifact，既有事实保留 |
| `MVP-SEC-PLAT-001` | `dshagent` 不能读取 Evidence/Result/Secret 或 Docker Socket |
| `MVP-SEC-IDENTITY-001` | `dsheval/dshagent` 身份确实不同，报告只声明实际隔离等级 |
| `MVP-SEC-IDENTITY-002` | 身份相同或无法确认时 Preflight 拒绝且 Agent 未启动 |
| `MVP-SEC-SECRET-001` | Canary Secret 扫描覆盖日志、Artifact、JSON、HTML 和 Export，命中即隔离 |
| `MVP-SEC-HTML-001` | HTML 自包含、无脚本/网络依赖，危险标签和 URL 只作为转义文本 |
| `MVP-UT-PLAT-001` | 危险/重叠根、未知配置、Secret Value 被拒绝 |
| `MVP-IT-RESET-001` | Reset 后独立文件验证 MATCH 才 CLEANED；失败则隔离 |
| `MVP-IT-LEASE-001` | 第二活动 Run 与无法确认的旧 Lease 均被拒绝，不按时间抢占 |
| `MVP-IT-LEASE-002` | 正常 Run 能获取并在全部 Flush 后释放唯一 Lease |
| `MVP-FI-APP-001` | 每个十步阶段注入失败，Workflow 停在正确门禁并安全收尾 |
| `MVP-FI-CLOSE-001` | 重复取消/关闭及收尾故障不产生第二 Gate、重复 Artifact Commit、重复删除或 Lease 泄漏 |
| `MVP-FI-STATUS-001` | 每个已创建 Run 在正常和逐步故障路径中都保留可打开、指向最后提交步骤的 status.html |
| `MVP-CT-REAL-001` | 真实 E2E 报告绑定实际 DSH/Driver Fingerprint；Fake 标记或跳过真实执行使发布门禁失败 |
| `MVP-UT-CLI-001` | JSON、stderr 和退出码与 Gate/Run 状态一致 |

## 4. 三条核心 E2E

### `MVP-E2E-001` 正常通过

Agent 读取输入文件并生成目标文件；Probe 完整；Before/After 正确；三个 Check PASS；Reset MATCH/CLEANED；随后 Gate PASS；JSON/HTML 可打开。

### `MVP-E2E-002` Agent 失败

Agent 声称完成但目标文件错误或缺失；Trace 可完整；File State FAIL；Gate FAIL；不自动重试；证据和报告保留。

### `MVP-E2E-006` 证据不足

任务结果存在，但 Probe 缺 stop/关键序号；Protocol Check 不可判，Gate UNEVALUABLE；不得默认 PASS。File After 读取失败由纵向切片的 `MVP-E2E-007` 单独覆盖。

## 5. 故障注入矩阵

| 阶段 | 注入 | 预期 |
|---|---|---|
| Plan | 缺 Judge/Sensor/版本不兼容 | 不创建 Run，UNSATISFIABLE |
| Seed | 写入/权限失败 | 不启动 Agent；环境回滚/隔离 |
| Baseline | Sensor 失败 | 不启动 Agent；Collector Failure |
| Target | spawn/非零/超时/取消 | 区分 Harness 与 Agent；保存可得证据 |
| Drain | Probe 缺尾/水位超时 | Seal PARTIAL；相关 UNEVALUABLE |
| Judge | 异常/超时 | Judge Failure + ERROR Judgement + UNEVALUABLE CheckResult；不记 Agent FAIL |
| Reset | MISMATCH/UNAVAILABLE | 环境隔离，阻止复用 |
| Report | JSON/HTML 写失败 | Gate 不变，可诊断失败 |

## 6. 测试数据与确定性

- Fixture 与 Pack 进入仓库，保存 Schema、版本、平台和摘要。
- 临时目录和 ID 由测试显式注入；断言不依赖当前时间、目录枚举顺序或网络。
- 默认测试不访问公网；真实模型 E2E 通过显式环境开关运行，并记录模型配置而非 Secret。
- Snapshot 测试只用于稳定 JSON/HTML 结构，不能替代业务断言。

## 7. 开发门禁

每个阶段必须通过：格式检查、类型检查、相关 Unit/Contract、已有 Integration。合并 MVP 前必须通过全部 E2E/Security，并确认：

- 没有 `skip/todo/only`。
- 没有始终 PASS 的 Judge、空 Sensor、伪造 Report 数据。
- 覆盖了 PASS、FAIL、UNEVALUABLE 和 DSHEval 操作失败。
- 原始证据可回链，Reset/HTML 失败不覆盖原 Gate。

## 8. MVP 要求与验收

| ID | 要求 |
|---|---|
| `MVP-TEST-REQ-001` | 测试覆盖完整纵向闭环及三类最终评测结果 |
| `MVP-TEST-REQ-002` | 每个 Port 有正常、拒绝、失败和幂等测试 |
| `MVP-TEST-REQ-003` | 关键故障验证归因、门禁、证据保留和收尾 |
| `MVP-TEST-REQ-004` | 至少一条真实 DSH E2E，不能全靠 mock |
| `MVP-TEST-REQ-005` | 安全测试覆盖路径、权限、Secret 和 HTML 注入 |

| ID | 验收条件 |
|---|---|
| `MVP-TEST-AC-001` | 三条 E2E 分别稳定得到 PASS、FAIL、UNEVALUABLE |
| `MVP-TEST-AC-002` | 故障矩阵无错误归因为 Agent FAIL |
| `MVP-TEST-AC-003` | 篡改、串 Scope、坏摘要均被拒绝 |
| `MVP-TEST-AC-004` | 真实 DSH Case 能生成可回链 JSON/HTML |
| `MVP-TEST-AC-005` | `check/test/build` 全通过且无跳过测试 |
| `MVP-TEST-AC-006` | 每个公共 Port 的成功、拒绝、失败和幂等语义均有契约测试；支持取消的 I/O Port 另覆盖取消 |

## 9. 延后测试

PostgreSQL/HTTP/Browser、插件 Target、自动 Retry、多 Case/多 VM、Multi-Agent、LLM Judge、Repair/Gap Planner、长期恢复和性能压测。对应实现进入 MVP 前再增加测试，不预建空套件。
