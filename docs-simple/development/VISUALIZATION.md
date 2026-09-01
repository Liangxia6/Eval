# DSHEval MVP 可视化规格

> 产物：每 Run 一个 `status.html` 和终态 `report.html`｜完整版参考：[VISUALIZATION.md](../../docs/development/VISUALIZATION.md)

## 1. 目标

网页用于回答三个问题：现在运行到哪一步、为什么停住、结论依据是什么。MVP 只生成本地静态 HTML，不建设 Web API、前端框架、数据库或实时推送服务。

- `status.html`：运行期排障页，非权威，可原子替换。
- `report.html`：终态报告，只从权威 `report.json` 渲染。

HTML 不产生事实、不重新 Judge、不改变 Gate。

## 2. 固定页面结构

### 2.1 顶部摘要

显示 Run ID、Target 摘要、当前阶段、Run 状态、Gate（若已有）、系统健康、开始/更新时间。运行期未知项显示“尚未产生”，不能显示默认 PASS。

### 2.2 十步时间线

```text
1 冻结 Target
2 Inspector
3 Planner
4 Case Compiler
5 环境准备/Seed/Baseline
6 Agent 执行/观测
7 Drain/证据闭合
8 Judge/CheckResult
9 Reset/独立验证/Cleanup
10 Gate/Run 终态/Report/HTML/Export
```

每步状态：`PENDING/RUNNING/SUCCEEDED/FAILED/BLOCKED`，并显示起止时间、关键对象 Ref、Failure 分类和下一条确定性提示。只有已提交记录才可标 SUCCEEDED。

### 2.3 三个核心视图

| 视图 | 内容 |
|---|---|
| 规划 | Target/插件摘要、一个 Case、三个 Check、Scenario/Environment/Judge/File Sensor 的匹配理由 |
| 执行与环境 | Target 进程、Probe 完整度、File Before/After/Diff、Reset Verification/最终环境状态 |
| 判定 | 每 Check 的 Closure、Judge 状态、Outcome、Finding、Evidence Ref、最终 Gate |

## 3. 证据下钻

点击/锚点至少能从 CheckResult 定位：

```text
CheckResult
→ Judgement / Closure
→ EvidenceRecord
→ RawObservation
→ Probe JSONL 行 或 File Snapshot Entry
```

页面必须视觉区分：独立/协作/未验证来源，完整/部分/无效证据，确定关系/推断关系，Agent Failure/DSHEval Failure。不得补画缺失边或把时间接近画成因果。

## 4. 排障提示

提示由稳定 reasonCode 映射，不调用 LLM。至少覆盖：

| 问题 | 提示 |
|---|---|
| Plan UNSATISFIABLE | 显示缺失资产/能力及返回 Planner 的位置 |
| Seed/Baseline 失败 | 显示服务、路径、权限或 Sensor 问题；说明 Agent 未启动 |
| Probe Gap/缺 stop | 显示缺口范围及受影响 Check |
| Agent 非零/超时 | 显示退出事实，并提示查看 stderr/Trace/环境结果 |
| Evidence INCOMPLETE | 显示缺哪种来源/水位/内容 |
| Judge ERROR | 明确是 Judge 故障，不标 Agent FAIL |
| Reset MISMATCH | 显示残留 Diff，环境已隔离 |
| HTML/报告失败 | 显示 Gate 已保存且可重新渲染 |

## 5. status.html

- Run 创建后首次生成，并回填已经提交的 Target/Plan 事实。
- 每个 Workflow 门禁提交后原子替换；失败保留上一完整页面。
- 可以缺少尚未产生的 Gate/Report，但必须明确“不存在的原因”。
- 不生成 ArtifactRef，不进入最终 Export，不作为恢复输入。

## 6. report.html

- 输入只能是重新读取且摘要有效的 `EvaluationReport` JSON。
- 显示 PASS/FAIL/UNEVALUABLE、三个 Check、证据缺口、Failure、Reset/Cleanup 和证据链接。
- 相同 JSON Digest + Renderer Version 生成完全相同字节。
- 渲染失败仅记录 Report/Delivery Failure，不改 Run/Gate。

## 7. 安全与实现限制

- 单个自包含 HTML；仅本地 CSS，不使用 CDN、外部字体、网络请求或可执行脚本。
- Agent/Target/错误内容按纯文本转义；禁止注入 HTML/SVG/URL scheme。
- Restricted 原始内容默认不嵌入，只展示摘要和受控定位。
- 页面生成器接收 View Model，不直接查询 Repository/环境。
- MVP 不引入 React、图数据库、图表库或前端构建链。

## 8. MVP 要求与验收

| ID | 要求 |
|---|---|
| `MVP-VIS-REQ-001` | 每个已创建 Run 都有可用 status.html |
| `MVP-VIS-REQ-002` | 十步状态只来自已提交对象，失败有稳定提示 |
| `MVP-VIS-REQ-003` | report.html 只从权威 JSON 渲染，不重算结论 |
| `MVP-VIS-REQ-004` | Check 可下钻到原始 Probe 行/File Entry |
| `MVP-VIS-REQ-005` | HTML 无网络依赖、脚本执行和未转义 Agent 内容 |

| ID | 验收条件 |
|---|---|
| `MVP-VIS-AC-001` | 正常、Agent FAIL、UNEVALUABLE、系统失败均能定位停止步骤 |
| `MVP-VIS-AC-002` | Sensor/Judge/Reset Failure 不显示成 Agent FAIL |
| `MVP-VIS-AC-003` | 每个 CheckResult 的 Evidence 链可定位原始行/Entry |
| `MVP-VIS-AC-004` | 相同 JSON 重渲染字节一致，页面可离线打开 |
| `MVP-VIS-AC-005` | 注入脚本/危险 URL 只显示为文本且不执行 |

## 9. 延后实现

实时 WebSocket、交互式图谱、跨 Run 趋势、筛选查询、多人权限、远程托管和 LLM 诊断。新增 UI 必须继续以已提交 JSON 为事实来源。
