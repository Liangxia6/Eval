# DSHEval MVP 组件安排

> MVP 固定为 8 个源码模块、28 个组件文件。一个文件可以承载若干紧密相关职责，不继续拆 `service/manager/factory/adapter` 子层。

## 1. 规模

| 模块 | 组件数 | 当前职责 |
|---|---:|---|
| `app` | 3 | 装配、端到端 Workflow、CLI |
| `core` | 3 | 模型、Port、错误语义 |
| `planning` | 4 | Target 冻结、检查、资产加载与计划 |
| `runtime` | 3 | Target、Run/Case/Attempt、文件环境生命周期 |
| `observation` | 4 | 观测协调、Probe、环境观测、File Sensor |
| `evaluation` | 5 | Evidence、Closure、Judge、Verdict、Report |
| `storage` | 2 | 结构化记录与 Artifact |
| `platform` | 4 | 配置、安全、服务健康、导出 |
| **合计** | **28** | **一条完整纵向闭环** |

这 28 个都是 MVP 当前调用链的一部分。PostgreSQL、HTTP、Browser、插件 Target、Retry、Gap、Repair 和语义 Judge 不计入当前组件，也不得创建空实现。

## 2. `app`（3）

| 文件/组件 | 输入 → 输出 | 明确边界 |
|---|---|---|
| `bootstrap.*` | 配置与实现 → 已装配应用 | 唯一组合根；不含业务规则 |
| `workflow.*` | Run 请求 → 十步流程与最终状态 | 只编排 Port；不自行匹配资产、采证据或评分 |
| `cli.*` | 命令参数 → 运行请求、进度与退出码 | 不绕过 Workflow；不重算 Verdict |

## 3. `core`（3）

| 文件/组件 | 内容 | 明确边界 |
|---|---|---|
| `models.*` | Target、Plan、Run、Observation、Evidence、Result、Report 的稳定数据模型 | 纯领域数据，不做 I/O |
| `contracts.*` | 两大 Port 及模块间最小接口 | 只定义当前调用链需要的方法 |
| `errors.*` | 错误类别、来源、阶段、可判定性和序列化规则 | 不吞错，不用异常文本代替结构化归因 |

## 4. `planning`（4）

| 文件/组件 | 输入 → 输出 | 明确边界 |
|---|---|---|
| `target.*` | `FULL_AGENT` 描述 → 冻结 TargetSnapshot | 插件 Target 明确拒绝，不半执行 |
| `inspector.*` | Target 与 DSH 事实 → InspectionSnapshot | 未知显式记录；不从插件名推断能力 |
| `catalog.*` | filesystem pack → 已校验 FilesystemPack Ref 与摘要 | 只解析/校验，不做选择 |
| `planner.*` | Scope、Inspection、资产、来源能力 → Plan/Contract/已校验 CasePlan | 承载 Planner + 机械 Compiler；不创建第二套 Case 对象，不读取实时环境 |

`planner.*` 合并紧密相邻的规划、编译和预检职责，是 MVP 的有意简化；只有出现第二类真实调用方且文件无法维护时才允许拆分。

## 5. `runtime`（3）

| 文件/组件 | 输入 → 输出 | 明确边界 |
|---|---|---|
| `target.*` | 冻结 Target、任务 → Headless 进程、终止状态、输出 | 不解释成绩；命令不经 Shell 拼接 |
| `runner.*` | 冻结 CasePlan → Run/Case/Attempt 状态与 ControlEvent | 强制一个活动 Run、一个 Case、一个 Attempt |
| `environment.*` | 文件环境资产 → Seed、实例代次、ResetRecord | 只控制环境；不充当 Agent，也不验证自己的 Reset |

## 6. `observation`（4）

| 文件/组件 | 输入 → 输出 | 明确边界 |
|---|---|---|
| `coordinator.*` | ObservationPlan、执行边界 → ObservationSession、Drain/Seal、完整度 | Before 未完成不激活；After 未完成不伪装完整 |
| `runtime.*` | `dsh-eval.probe/v1` JSONL → Probe RawObservation、序号/边界状态 | 来源为 `COOPERATIVE`；不把普通日志当已提交事件 |
| `environment.*` | 实际环境、只读 Binding、File Sensor → Before/After/Diff 与 CollectionStatus | Environment Observation Port；不选择 Check |
| `sensors/file.*` | 声明根目录 → 规范化文件快照、摘要、错误 | 唯一 Sensor；只读、根边界明确、拒绝不安全链接 |

## 7. `evaluation`（5）

| 文件/组件 | 输入 → 输出 | 明确边界 |
|---|---|---|
| `evidence.*` | RawObservation → 标准 EvidenceBundle 与引用图 | 保留原始事实和冲突；密封后不可覆盖 |
| `closure.*` | EvidenceContract + Bundle → 每个 Check 的 Closure | 缺失/无效/信任不足明确为不可判定 |
| `judging.*` | 已闭合 EvidenceView → 三个确定性 CheckResult | Protocol/File State/Path Security；不连接实时环境 |
| `scoring.*` | CheckResult → 总体 Verdict | 只做三值聚合，不引入综合分或 LLM |
| `report.*` | 已提交结果/状态 → EvaluationReport + 两个 HTML ViewModel | JSON 权威；HTML 不重判 |

## 8. `storage`（2）

| 文件/组件 | 输入 → 输出 | 明确边界 |
|---|---|---|
| `repositories.*` | 结构化对象 → Run 分区 JSON/JSONL 与读取结果 | 原子提交、作用域校验、密封对象不可更新 |
| `artifacts.*` | 原始文件/页面 → ArtifactRef、摘要和 Manifest | 内容寻址或等价摘要校验；不保存 Secret 明文 |

## 9. `platform`（4）

| 文件/组件 | 输入 → 输出 | 明确边界 |
|---|---|---|
| `config.*` | 本地配置 → 已校验 ConfigSnapshot | 默认安全；Run 前冻结并记录摘要 |
| `security.*` | 身份/资源/范围 → Agent 权限与只读 Observer Binding | 不共享凭据；敏感值脱敏且不导出 |
| `services.*` | 本地依赖与锁 → 健康状态、单 Run Lease、关闭结果 | 不实现分布式调度或后台平台 |
| `export.*` | 已提交记录与 Artifact → 校验后的本地导出清单 | 失败不改 Verdict；不包含密钥或未授权原始内容 |

## 10. 两个关键协作面

| 协作面 | 生产者 | 消费者 | MVP 实现 |
|---|---|---|---|
| Evaluation Asset Matching Port | `planning/catalog.*` + `planner.*` | `app/workflow.*`、`runtime`、`observation`、`evaluation` | 仅 filesystem pack，输出 FROZEN/UNSATISFIABLE `PlanBuildResult` |
| Environment Observation Port | `observation/environment.*` + `sensors/file.*` | `evaluation/evidence.*`、`closure.*` | 仅 File Before/After/Diff 与 Reset Verification |

## 11. 组件新增门禁

只有同时满足以下条件才能新增文件或抽象：

1. 有当前 MVP 的真实调用方；
2. 现有组件职责已经产生明确冲突；
3. 新边界可写出独立测试；
4. 不只是为了未来 Provider、框架替换或未知插件；
5. 更新本表后组件总数仍可解释。

否则优先在现有 28 个组件中完成一条可运行链路。
