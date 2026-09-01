# DSHEval MVP 开发总则

> 本目录用于独立生成一套干净 MVP。实现时不得把 `docs/` 的完整能力自动合并进来。

## 1. 实现目标

交付一个真实可运行的纵向切片：

```text
FULL_AGENT 冻结与检查
→ filesystem pack 确定性匹配
→ 单 Case/单 Attempt 执行
→ DSH Runtime Probe + File Before/After
→ Evidence Closure
→ Protocol/File State/Path Security Judge
→ Reset 后独立 File Verification
→ 单次 Gate、Run 终态、JSON/JSONL/Artifact、静态 HTML
```

完成的标准是端到端行为和测试，不是文件数量。禁止先生成 28 个互不连通的空壳再“以后接线”。

## 2. 实现隔离

- 在独立分支或 worktree 中从干净的文档基线生成 MVP；不要在完整版实现之上做删除式改造。
- 本目录是唯一需求输入。现有完整版源码和 `docs/` 只能对照，不能自动合并范围。
- 代码按后文 A–E 五个阶段生成；每阶段必须先跑通当前纵向切片并形成可回退检查点，再进入下一阶段。
- 复用已有代码时按组件逐项验证契约、依赖方向和测试；无法证明符合就不复用。

## 3. 权威文档与阅读顺序

实现前完整阅读：

1. [产品定义](../PRODUCT.md)
2. [总体架构](../ARCHITECTURE.md)
3. 本文
4. [最小纵向闭环](./V0.1_VERTICAL_SLICE.md)
5. [公共契约](./CONTRACT_CATALOG.md)
6. [测试规格](./TESTING.md)
7. [可视化规格](./VISUALIZATION.md)
8. 当前模块文档

冲突优先级：纵向切片的具体场景事实 > 公共契约的字段/状态 > 本文全局规则 > 模块实现说明。发现真正冲突必须停止相关实现并修正文档，不能同时保留两套行为。

完整版 `docs/` 不参与 MVP 冲突裁决；其范围外能力均为 `DEFERRED`。

## 4. 技术和结构基线

- Node.js 22、pnpm 11、TypeScript strict、ESM。
- 8 个源码模块、28 个当前组件，结构见[仓库结构](../REPOSITORY_STRUCTURE.md)。
- 一个进程内模块化单体；CLI 是唯一用户入口，`app` 是唯一组合根。
- 本地 JSON/JSONL/Artifact；不使用数据库、ORM、Web/前端框架、DI 框架、消息总线或遥测 SDK。
- 优先 Node 标准库；只在 Schema 校验、规范化摘要等当前需求无法可靠自建时加入小型依赖，并锁定精确版本。
- 不创建 PostgreSQL/HTTP/Browser/Plugin Target/Retry/Gap/Repair/Multi-Agent/LLM Judge 空实现。

## 5. 防止代码失控的强制规则

1. **纵向切片优先**：每个阶段都必须从真实入口运行到一个可验证产物。
2. **只为当前调用方抽象**：没有第二个真实实现时，不建 Provider Factory、万能 Adapter 或基类体系。
3. **合并紧密职责**：Planner/Compiler/Preflight 当前放在 `planning/planner.*`；三个确定性 Judge 当前放在 `evaluation/judging.*`。
4. **不复制模型**：稳定对象和 Port 只在 `core` 定义；其他模块引用，不自建近似类型。
5. **I/O 在边界**：纯规则与文件/进程 I/O 分开，但不因此增加无业务价值的层。
6. **失败显式传播**：不得 catch 后忽略，不得用默认 PASS/空数组掩盖失败。
7. **不可变事实**：冻结对象和密封 Evidence 不能原地修改；新事实追加新记录。
8. **范围外直接拒绝**：收到插件 Target、多个 Case 或非 filesystem asset 时返回结构化不支持，不做半套实现。
9. **测试随能力同行**：实现一个行为的同一阶段完成正常、边界和失败测试。
10. **阶段门禁**：`check`、相关测试和构建未通过，不进入下一阶段。

## 6. DSH 与来源基线

MVP 兼容目标固定为 DSH `0.1.1-rc.2`、Headless 执行、`dsh-eval.probe/v1` Runtime Probe。实际 DSH、Profile、插件清单和有效配置仍必须进入 TargetSnapshot 并参与摘要。

Runtime Probe 至少提供：

- Probe 开始/结束；
- 连续来源序号和 UTC/单调时间；
- Run/Case/Attempt/Session 作用域；
- 已提交的任务、Session、工具/插件生命周期与结束事实；
- 解析/序号缺口/晚接入等采集状态。

Probe 与 DSH 同进程，信任等级为 `COOPERATIVE`。它能证明 DSH 已提交语义，不能单独证明外部文件结果或抗篡改安全结论。

File Sensor 使用独立只读 Binding，完成工作区全量 Before/After、规范路径、类型、大小、SHA-256、链接与读取错误记录，信任等级为 `INDEPENDENT`。

## 7. 十步门禁

| 步骤 | 成功条件 | 失败行为 |
|---:|---|---|
| 1 冻结 | Target/Config/Asset 摘要完整 | `plan_conflict`，不建 Attempt |
| 2 Inspector | DSH/Profile/权限关键事实可得 | 明确未知或停止 |
| 3 Planner | 唯一 filesystem 组合可满足来源要求 | 不启动环境 |
| 4 Compiler/Preflight | CasePlan 校验后获取 Lease，一次创建 Run/Case/Attempt，再通过版本、权限、路径、Probe/File Sensor Preflight | 不 Seed、不启动 Agent；失败对象仍可追溯 |
| 5 环境/Baseline | Seed 成功、只读 Binding 生效、Before 完成 | 保存失败并 Reset/隔离 |
| 6 执行 | Attempt 已创建，Headless 被受控启动 | 保存进程事实，继续 Drain |
| 7 Closure | Agent 终止、Probe Drain、稳定窗口、After 和摘要完成或缺口已记录 | 密封部分事实，相关 Check 不可判 |
| 8 Judge | 只读闭合视图并保存三个 CheckResult | `judge_error`，不伪造分数 |
| 9 Reset | Controller Reset 后，由新只读上下文独立 Verification，再 Cleanup | 环境隔离；不覆盖 CheckResult |
| 10 Gate/交付 | 从已保存 CheckResult 只计算一次 Gate，提交 Run 终态，再渲染报告/HTML | 交付失败不重算 Verdict；保留诊断 |

Reset/Cleanup 故障可以让 Run 的操作状态为 `FAILED`，但 Gate 仍只表达 Agent 的 CheckResult；如果 CheckResult 已经足够，故障不能把 Agent 的 `PASS/FAIL/UNEVALUABLE` 改成另一结论。

表中的五类小写故障名是报告分组，由公共 FailureRecord 的 `category+origin+actor` 派生；代码只持久化公共契约细分类，不再定义另一套错误枚举。

## 8. 全局强制要求

| 编号 | 要求 |
|---|---|
| `MVP-DEV-REQ-001` | 只实现 `FULL_AGENT`、单 VM、单活动 Run、单 Case、单 Attempt，`maxAttempts=1`。 |
| `MVP-DEV-REQ-002` | DSH/Profile/插件/配置、Target、Plan、Config 和 Asset 在执行前冻结并绑定摘要。 |
| `MVP-DEV-REQ-003` | Catalog 只校验 filesystem pack；Planner 独占匹配；Compiler 只机械组装。 |
| `MVP-DEV-REQ-004` | 每条运行数据可归属唯一 Run/Case/Attempt/Source，跨作用域输入必须拒绝。 |
| `MVP-DEV-REQ-005` | Agent 通过自身 DSH 能力操作环境；Controller 只 Seed/Reset，Observer 只读。 |
| `MVP-DEV-REQ-006` | Probe 与 File Sensor 独立保存；Before 早于 Agent，After 晚于终止和稳定边界。 |
| `MVP-DEV-REQ-007` | Raw、标准和推断事实可区分；密封 Evidence/Artifact 不可覆盖且摘要可验。 |
| `MVP-DEV-REQ-008` | Judge 只读满足 EvidenceContract 的密封视图；证据不足、损坏或信任不足为 `UNEVALUABLE`。 |
| `MVP-DEV-REQ-009` | 任一确定性硬失败为 `FAIL`；三个强制 Check 均 PASS 才能总体 `PASS`。 |
| `MVP-DEV-REQ-010` | 报告将 FailureRecord 确定性分组为 `plan_conflict`、`infrastructure_error`、`collector_error`、`agent_failure`、`judge_error`，同时保留原始细分类。 |
| `MVP-DEV-REQ-011` | MVP 不自动 Retry；失败、超时或取消都保留部分现场并进入 Drain/Reset。 |
| `MVP-DEV-REQ-012` | Reset 必须由独立 File Verification 验证；失败隔离环境但不改 Agent Verdict。 |
| `MVP-DEV-REQ-013` | 本地 JSON/JSONL/Artifact 为权威数据；Secret 不进入日志、报告、HTML、Git 或导出。 |
| `MVP-DEV-REQ-014` | `status.html`/`report.html` 只展示已提交事实；Gate 只计算一次，页面不运行 Judge。 |
| `MVP-DEV-REQ-015` | 新抽象必须有当前调用方和测试；禁止范围外空壳、未来工厂和万能基类。 |

## 9. 全局验收

| 编号 | 可观察结果 |
|---|---|
| `MVP-DEV-AC-001` | 第二个活动 Run、多 Case、多 Attempt、插件 Target 均在执行前被拒绝。 |
| `MVP-DEV-AC-002` | 冻结后更改 DSH/Profile/Asset/Config，Preflight 摘要校验失败且 Agent 未启动。 |
| `MVP-DEV-AC-003` | 同一冻结输入得到相同匹配摘要；Catalog/Compiler 测试证明没有隐式重选。 |
| `MVP-DEV-AC-004` | 混入其他 Run/Attempt/Source 的 Probe 或文件记录被拒绝，不能进入 Judge。 |
| `MVP-DEV-AC-005` | 业务目标文件只由 Target 产生；ControlEvent 只包含 Seed/提交/停止/Reset 等控制动作。 |
| `MVP-DEV-AC-006` | Before 未完成时 Target 不启动；After 边界不足时相关 Check/总体不会 PASS。 |
| `MVP-DEV-AC-007` | 篡改 Raw Artifact 或密封 Evidence 后摘要校验失败，旧对象保持不变。 |
| `MVP-DEV-AC-008` | Probe/File 关键证据缺失或信任不足稳定得到 `UNEVALUABLE`，没有默认通过路径。 |
| `MVP-DEV-AC-009` | 错内容、额外文件或确定路径越界稳定得到 `FAIL`，分数/说明不能覆盖。 |
| `MVP-DEV-AC-010` | 五类故障具有不同 origin/stage/detail，并在报告中可区分。 |
| `MVP-DEV-AC-011` | 超时/取消/失败只有一个 Attempt；部分 Probe/快照/错误仍被保存并 Reset。 |
| `MVP-DEV-AC-012` | Reset 残留被新只读 Verification 发现，环境 `QUARANTINED`；已保存 CheckResult/Verdict 不变。 |
| `MVP-DEV-AC-013` | 导出包可离线发现缺失/篡改；扫描日志/HTML/导出不出现测试 Secret 原值。 |
| `MVP-DEV-AC-014` | 相同 report JSON 重渲染页面时 Verdict/证据引用不变；HTML 失败不改 Gate。 |
| `MVP-DEV-AC-015` | 生产代码不存在未被调用的范围外 Adapter/Factory/基类；每个组件至少被纵向链路或其测试使用。 |

## 10. 实现顺序

### 阶段 A：最小地基

建立严格工具链、核心模型/错误、文件 Repository/Artifact、Config 和 CLI 冒烟路径。交付：可以创建并读取一个 Run 目录，`check/test/build` 通过。

### 阶段 B：规划闭环

实现 FULL_AGENT 冻结、Inspector、filesystem Catalog、Planner/Compiler/Preflight。交付：给定固定输入得到确定 Plan，非法版本/Target/资产在执行前停止。

### 阶段 C：执行与双观测

实现文件 Seed、File Before、DSH Headless + Probe、稳定边界、File After/Diff、单 Attempt 状态。交付：成功和超时均能保存完整或部分原始事实。

### 阶段 D：证据与判定

实现 Evidence、Closure、三个确定性 Judge 和三值 Verdict。交付：正确/错误/缺证据分别得到 PASS/FAIL/UNEVALUABLE，可离线重判。

### 阶段 E：收尾与展示

实现 Reset、独立 File Verification、单次 Gate、Run 终态、status/report HTML 和导出。交付：完整十步 E2E 与故障路径通过。

每个阶段必须提交一条可运行路径，不能把跨阶段空接口当作完成。

## 11. Definition of Done

- [ ] `MVP-DEV-REQ-001..015` 均有对应自动化验收。
- [ ] [纵向切片](./V0.1_VERTICAL_SLICE.md)中的必测 E2E 全部通过。
- [ ] 至少一个真实 DSH `0.1.1-rc.2` Agent 得到可追溯结果。
- [ ] 同一密封 Evidence 离线重判相同。
- [ ] Reset/清理不会删除已提交证据，残留会隔离环境。
- [ ] `status.html` 能定位十步中的失败点，`report.html` 能追到证据。
- [ ] 类型检查、单元、集成、E2E 和构建全部通过。
- [ ] 8 模块、28 组件都服务当前纵向链路；没有 `DEFERRED` 空壳。
