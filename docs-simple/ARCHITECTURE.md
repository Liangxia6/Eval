# DSHEval 架构

> 单台 VM、模块化单体、单 Run / Case / Attempt。

## 1. 总体结构

```text
Target + EvaluationRequest + Catalog
                  │
                  ▼
              Planning
       冻结 Agent、Label、Dataset、
       Case、Metric、Environment、Observer
                  │
                  ▼
               Runtime
          Agent 自主执行任务
             ┌────┴────┐
             ▼         ▼
       Runtime Probe  Environment Observer
             └────┬────┘
                  ▼
        Evidence → Judge → LabelResult
                  │
                  ▼
         Gate → Reset → Storage / Viewer
```

Agent、DSHEval Controller 和 Observer 使用不同权限。Agent 看不到 Ground Truth、Judge、Evidence 和报告目录；Observer 只读环境；Judge 只读已经密封的 Evidence。

## 2. 模块

| 模块 | 职责 | 不负责 |
|---|---|---|
| `core` | 公共模型、ID、摘要、状态和失败语义 | I/O 和业务编排 |
| `planning` | 冻结 Agent、加载资产、选择 Dataset、编译计划 | 执行 Agent 或评分 |
| `runtime` | 准备环境并运行一个 DSH Attempt | 选择 Dataset 或 Judge |
| `observation` | 采集 Runtime Trace 和独立环境状态 | 控制 Agent 行为 |
| `evaluation` | 整理 Evidence、执行 Judge、计算 Gate、渲染报告 | 查询运行中的 Agent |
| `storage` | 追加记录、提交 Artifact、校验摘要 | 重新解释结果 |
| `platform` | 配置、安全预检、Lease、导出和 Viewer | 业务评分 |
| `app` | 组合以上模块并驱动唯一主链路 | 定义第二套业务规则 |

`app` 是唯一组合根。业务模块只依赖自身和 `core`，避免循环依赖和重复模型。

## 3. 核心组件

| 组件 | 输入 | 输出 |
|---|---|---|
| Target Inspector | Agent 路径、Profile、插件、身份 | TargetSnapshot、InspectionSnapshot |
| Label Registry | LabelId | 唯一 MetricId、证据需求 |
| Dataset Catalog | 版本化 Pack | Dataset、Case、环境和 Judge 绑定 |
| Planner | Agent 快照、目标 Label、Catalog | Frozen Plan 或 UNSATISFIABLE |
| DSH Driver | CasePlan | Attempt 进程事实 |
| Runtime Probe | DSH 生命周期和工具事件 | Cooperative Trace |
| Environment Observer | 冻结 Binding、环境事件 | Independent Observation |
| Evidence Builder | 原始 Observation | Evidence Closure |
| Judge | Metric、参数、Closure | CheckResult / LabelResult |
| Gate | 已保存的必需结果 | PASS / FAIL / UNEVALUABLE |
| Reset Verifier | Reset 后的新观测 | CLEANED / QUARANTINED |
| Store / Viewer | 已提交记录和 Artifact | JSON、JSONL、HTML |

## 4. Label、Metric 与 Dataset

Label 是跨 Agent 和 Dataset 复用的能力维度。固定 Registry 中每个 Label 只对应一个 Metric：

```text
LabelId ──1:1──► MetricId
Dataset ──N:N──► Label
Agent   ──N:N──► Label
```

Dataset 可以提供任务、Case、输入资产和 `metricParameters`，但不能创建临时 Label 或替换 Metric。Planner 根据请求的 Label 选择能够覆盖它们的 Dataset；当前 MVP 只接受一个 Dataset 和一个 Case。

固定 14 个 Label：

| 类别 | Label |
|---|---|
| 基础能力 | 推理与规划、Loop、记忆、检索与依据 |
| 工具能力 | 代码与终端、文档与 PDF、浏览器与网络、数据库与数据处理、API 与业务系统 |
| 综合能力 | 多模态、产物交付、协作与委派、安全与权限边界、效率与稳定性 |

## 5. 两个关键接口

### Planning

```text
TargetSnapshot + InspectionSnapshot
+ requestedLabelIds + Catalog + 当前运行能力
→ FROZEN(EvaluationPlan, AgentTracePlan, ObservationPlan, EvidenceContracts)
  或 UNSATISFIABLE(gaps)
```

统一 Planner 只使用 LLM 选择 Dataset 和题量，不生成或修改 Label；评测标签是所选 Dataset 既有标签的确定性并集。随后由确定性编译器把 Label 的证据要求和 Environment 的 Observer 绑定冻结成运行期计划。

### Observation

```text
AgentTracePlan + ObservationPlan + EnvironmentInstance + 只读 Binding
→ RawObservation + CollectionStatus
```

Runtime Probe 按 Agent 生命周期采集 Trace；Environment Observer 只观测文件、进程、浏览器、数据库等环境组件。未采集、读取失败或越出范围必须显式记录，不能解释为“没有变化”。

## 6. 一次评测

1. 冻结 Agent、配置和 Dataset/Label/Environment 资产摘要；
2. 检查插件、工具、DSH 版本、身份和权限；
3. Planner 选择 Dataset 与题量，程序汇总标签并冻结运行期计划；
4. 创建 Run、Case、Attempt，完成安全预检；
5. Seed 环境并采集 Before；
6. Agent 自主执行，Probe 与 Observer 同步采集；
7. Agent 结束后 Drain、采集 After，并密封 Evidence；
8. Judge 保存每个必需结果；
9. Gate 只根据已保存结果计算一次；
10. Reset 后独立验证，保存 JSON、JSONL、Artifact 和 HTML。

## 7. 证据与结果

- Runtime Trace 解释 Agent 声称和尝试了什么；
- 独立环境证据验证真实结果；
- 原始事实、标准化事实和推断事实分别保存；
- 密封 Evidence 和 Artifact 使用 SHA-256 校验；
- 明确不满足为 `FAIL`；证据缺失、不可信或 Judge 失败为 `UNEVALUABLE`；全部必需项通过才为 `PASS`；
- Agent、采集、Judge、基础设施和 Reset 故障分别归因；
- Reset 失败可以隔离环境，但不能修改已形成的 Agent Verdict。

## 8. 部署与展示

DSHEval、被测 DSH 和评测环境运行在 VM 内。Viewer 只监听 VM 回环地址，本机通过 SSH 隧道查看 `status.html` 和 `report.html`。页面只展示已提交事实，不运行 Judge，也不是新的证据来源。

## 9. 当前边界

当前代码用 Attention + PyTorch Dataset Pack 和 Fixture 验证完整闭环。Pack 是框架外部内容：复用现有 Judge 与 Observer 时可直接增删；新增判定算法或观测类型时才扩展对应实现注册表。真实 DSH 的 VM 发布验收、PDF/进程 Observer 与 LLM Judge 尚未完成。

暂不实现多 Dataset 调度、并发 Run、Retry、自动 Repair、跨 Label 数值加权、数据库后端和公网服务。新增能力必须有真实 Dataset、调用方和测试，不能预建空 Adapter、Factory 或 Provider。
