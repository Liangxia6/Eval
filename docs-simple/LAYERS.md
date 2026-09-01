# DSHEval MVP 分层设计

> 七层是职责视图；代码保持 8 个一级模块，不按层继续拆目录或服务。

## 1. 总体依赖

```text
平台/安全 ─┬─► 控制 ─► 执行 ─► 观测 ─► 证据 ─► 评测
           │                              │
资产/数据 ─┴──────── 为各阶段提供版本化输入与持久化 ───┘
```

`core` 定义共享模型、Port 和错误；`app` 是唯一组合根。其他模块不能导入 `app`，也不能绕过契约读取相邻层内部状态。

## 2. 控制层

- 目标：回答“测谁、测什么、需要什么证据”。
- 模块：`planning/`。
- 输入：完整 Agent 描述、DSH/Profile/插件事实、filesystem pack、Probe/File Sensor 能力。
- 输出：TargetSnapshot、InspectionSnapshot、EvaluationPlan、ObservationPlan、EvidenceContract。
- MVP：只接受 `FULL_AGENT`，确定性选择一个 filesystem Case 和三个 Checks。
- 禁止：启动 Agent、读取实时环境、采集证据、评分，或根据插件名称猜测能力。

控制层内部边界：Catalog 解析资产，Planner 选择资产，Compiler/Preflight 只验证和组装。选择失败必须明确返回 `plan_conflict`，不能自动换成未冻结资产。

## 3. 执行层

- 目标：忠实执行已经冻结的计划。
- 模块：`runtime/`。
- 输入：TargetSnapshot、冻结 CasePlan、ObservationPlan 和运行配置。
- 输出：Run/Case/Attempt 生命周期、Target 输出、Seed/Reset ControlEvent。
- MVP：单 VM、单活动 Run、单 Case、单 Attempt、`maxAttempts=1`。
- 禁止：改变 Plan、证据要求或 Judge；Environment Controller 不得代做 Agent 业务任务。

执行层在 Before/Baseline 门禁通过后才能启动 Agent。结束、超时或取消后都必须进入证据 Drain 和环境收尾。

## 4. 观测层

- 目标：记录 DSH 内部过程和文件环境实际变化。
- 模块：`observation/`。
- 输入：ObservationPlan、Run Scope、实际环境代次、冻结来源描述和只读 Binding。
- 输出：Probe RawObservation、File Before/After/Diff、CollectionStatus、完整度和 Failure。
- MVP 来源：DSH Runtime Probe（`COOPERATIVE`）与 File Sensor（`INDEPENDENT`）。
- 禁止：控制 Agent、Seed/Reset、选择 Check、生成 Verdict。

观测范围之外或读取失败的区域必须标为未知。File Sensor 只实现当前工作区快照，不预建数据库、浏览器或通用 Sensor 工厂。

## 5. 证据层

- 目标：把原始观察变为可追溯、可校验、可闭合的评测事实。
- 模块：`evaluation/evidence.*`、`evaluation/closure.*`。
- 输入：两类 RawObservation、计划、来源状态和 Artifact 摘要。
- 输出：标准 Evidence、EvidenceBundle、每个 Check 的 Closure 结果。
- MVP：按 Run/Case/Attempt/Source 关联，验证摘要、Probe 序号、Before/After 边界和强制证据是否齐全。
- 禁止：控制或重跑任务、删除不利事实、按预期成绩选择证据。

原始记录、标准事实和推断必须可区分。只有密封且满足 EvidenceContract 的 EvidenceView 才能进入 Judge。

## 6. 评测层

- 目标：依据闭合证据给出确定性结论并生成报告模型。
- 模块：`evaluation/judging.*`、`scoring.*`、`report.*`。
- 输入：密封 EvidenceView、冻结 Check/Judge 资产和 Ground Truth。
- 输出：Protocol/File State/Path Security CheckResult、总体 Verdict、EvaluationReport。
- MVP：仅 `PASS`、`FAIL`、`UNEVALUABLE`；不使用 LLM Judge，不计算掩盖硬失败的综合分。
- 禁止：连接实时 Agent/环境、修改 Evidence、让语义解释覆盖确定性结果。

三个强制 Check 全部 PASS 才能总体 PASS；任一硬错误为 FAIL；否则只要存在不可判定 Check 就为 UNEVALUABLE。

## 7. 资产与数据层

- 目标：保存可版本化的评测输入和不可变运行产物。
- 模块：`planning/catalog.*`、`storage/` 与 `packs/`。
- 输入：filesystem environment/scenario/domain/judge 资产和全链路记录。
- 输出：校验后的 FilesystemPack Ref/摘要、本地 JSON/JSONL、ArtifactRef 和摘要索引。
- MVP：一个 filesystem pack；一个 Run 独立目录；密封后不可覆盖。
- 禁止：在存储层做 Planner/Judge 决策，在资产中保存运行结果、主机绝对路径或密钥。

MVP 不引入数据库、ORM、对象存储或远程服务。索引只是定位事实，不能成为第二份权威结果。

## 8. 平台与安全层

- 目标：提供装配、配置、权限、健康检查、审计、静态展示和安全导出。
- 模块：`platform/`、`app/`；共享基础在 `core/`。
- 输入：VM 能力、配置、Target/Observer 身份、全链路已提交记录。
- 输出：可运行程序、ConfigSnapshot、只读 Observer Binding、健康/审计记录、HTML 和导出清单。
- MVP：本地 CLI 和模块化单体；status/report 为静态 HTML。
- 禁止：承载 Domain/Judge 规则、向 Agent 暴露 Ground Truth/证据、让 CLI 绕过 Workflow。

配置和权限必须在 Run 前冻结。敏感值不进入普通日志、HTML、Git 或导出包。

## 9. 全局边界

1. 控制层只规划；执行层只运行；观测层只采集；证据层只组织事实；评测层只读判定。
2. Target、Plan、Config、Asset 和 Source 描述冻结后不可原地修改。
3. Runtime Probe 与 File Sensor 独立保存，冲突时同时保留。
4. Agent Verdict 与 Run/Environment 健康状态分开表达。
5. Reset 后 Verification 属于环境卫生事实，不写入已密封 Agent Evidence。
6. 新抽象必须有当前调用方和测试；不为 `DEFERRED` 能力预建空壳。
