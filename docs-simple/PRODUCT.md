# DSHEval MVP 产品定义

> 状态：MVP Baseline｜目标：先证明一条可信、可复现的完整评测链路

## 1. 产品定位

DSHEval MVP 是运行在 Evaluation Appliance VM 内、位于被测 DSH Agent 外部的评测程序。它对一个完整 Agent 提交确定性任务，观察 Agent 内部执行事件与外部文件状态，形成可追溯证据并给出结论。

MVP 不追求“尽可能多地测”，而是先证明五件事：

1. 能冻结并识别被测对象。
2. 能确定性地选择一套当前可执行的评测资产。
3. 能同时获得 DSH Trace 和独立环境事实。
4. 能在证据不足时拒绝评分。
5. 能复位环境并让一次运行可重放、可排障。

## 2. 使用者与使用方式

主要使用者是 DSHEval 开发者和 DSH Agent 集成者。使用者提供：

- 一个可在 VM 中启动的完整 DSH Agent；
- DSH `0.1.1-rc.2` Profile、插件和有效配置；
- MVP 文件评测包；
- 一次 Run 的本地配置与输出位置。

DSHEval 完成预检、执行、观测、判定、复位和报告。使用者通过 CLI 退出状态、机器结果和 HTML 判断失败发生在哪一步。

## 3. 固定评测对象

MVP 只支持 `FULL_AGENT`：冻结完整 DSH Agent、DSH 版本、Profile、插件清单、模型标识、配置摘要、权限和启动信息。

插件仍会出现在 TargetSnapshot 和 Inspector 结果中，用于解释 Agent 组成，但 MVP 不提供插件安装、append/replace、宿主对照或插件独立成绩。请求插件 Target 时必须在执行前明确返回 `UNSUPPORTED_TARGET_KIND`。

## 4. 唯一产品链路

```text
冻结 Agent
→ Inspector 识别
→ Planner 匹配 filesystem pack
→ 编译一个 Case
→ Seed 与文件 Before
→ DSH Headless 执行，同时采集 Runtime Probe
→ 文件 After 与证据闭合
→ Protocol / File State / Path Security Judge
→ Reset 与独立 File Verification
→ Gate 与 Run 终态
→ JSON、JSONL、Artifact、status.html、report.html
```

每次 Run 只有一个 Case 和一个 Attempt，`maxAttempts=1`。没有自动重试，也不在失败后修改 Agent 再覆盖原结果。

## 5. 核心原则

1. Agent 必须通过自身 DSH 插件/工具完成任务；DSHEval 只 Seed、提交任务、观测、判定和 Reset。
2. Runtime Probe 解释“Agent 报告自己做了什么”；File Sensor 验证“环境最终实际变成什么”。
3. File Sensor 使用独立只读观测权限；Agent 不能读取 Judge、Ground Truth、证据和报告目录。
4. Judge 只消费已密封证据，不直接查询运行中的 Agent 或环境。
5. 明确错误证据产生 `FAIL`；所需证据缺失、损坏或信任不足产生 `UNEVALUABLE`；只有全部强制 Check 可判且通过时才产生 `PASS`。
6. Agent 失败、采集失败、基础设施失败和 Judge 失败必须分开记录。
7. 所有输入、计划、证据、规则和输出都绑定版本、作用域与摘要。
8. Reset 后验证是独立的运行卫生检查，不回写已经保存的 Agent Verdict。

## 6. MVP 输出

| 输出 | 最低内容 |
|---|---|
| Target/Inspection | DSH、Profile、插件、配置、权限和启动事实；未知项显式记录 |
| Plan | 选中的 filesystem assets、Case、Checks、来源要求及选择理由 |
| Run records | Run/Case/Attempt 状态、时间、失败归因和 ControlEvent |
| Runtime observations | Probe 原始 JSONL、序号完整度、开始/结束边界 |
| Environment observations | Seed、Before、After、Diff、摘要、扫描错误与覆盖范围 |
| Evaluation | Closure、三个 CheckResult、总体 Verdict 与引用证据 |
| Hygiene | ResetRecord、独立 File Verification、是否可再次使用环境 |
| Delivery | 权威 JSON、JSONL、Artifact manifest、`status.html`、`report.html` |

权威事实存放在结构化记录和 Artifact 中；HTML 只读展示，不重新计算结论。

## 7. 明确不做（DEFERRED）

- PostgreSQL、HTTP Mock、Browser、网络和工业环境观测；
- 单插件 Target、插件安装策略和宿主对照；
- 多 Case、并发 Run、自动 Retry 和分布式调度；
- 自动 Gap Planner、Check Activation 补测、Repair Agent；
- Multi-Agent、Memory、Compaction、Skill 专项；
- LLM/语义 Judge、自动修改被测源码；
- Web 服务、远程控制台、数据库后端、微服务和 Kubernetes。

MVP 只保留两类稳定扩展边界：评测资产匹配接口和环境观测接口。`DEFERRED` 能力不得以空实现、万能工厂或预建目录的形式进入当前代码。

## 8. 产品完成标准

MVP 完成必须同时满足：

- 至少一个真实 DSH Agent 完成正确文件场景并得到 `PASS`；
- 错文件、额外副作用和路径越界结果稳定得到 `FAIL`；
- Probe 或 File Sensor 关键证据缺失稳定得到 `UNEVALUABLE`；
- 同一密封证据离线重判得到相同结果；
- Reset 后独立验证能发现残留并阻止环境复用；
- 每个结果可回链 Target、Plan、Attempt、Source、Evidence 和 Judge 版本；
- 正常与关键失败路径具有端到端测试；
- 没有范围外的空壳组件。
