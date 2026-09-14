> **2026-09-12 评分链路更新：** 当前接口以 [Evaluation 重构说明](EVALUATION-REFACTOR-20260912.md) 为准。下文出现的 Pack、EvidenceContract、Closure、Gate 和旧评分报告字段均已移除；历史说明保留用于追溯。

# DSHEval 测试与 VMmac 单步调试

## 1. 自动测试

```bash
pnpm run check
pnpm test
```

自动测试用于验证类型、契约、Planner 结果校验、Dataset Loader、Trace 解析、Observer 物化、Judge/Gate、Case Bundle 和 Fixture。自动测试不能代替真实 DSH、真实模型与 VM 环境验收。

## 2. VMmac 基础环境

进入 VM 后先设置执行环境：

```bash
export PATH=/opt/homebrew/Cellar/node@22/22.23.2_1/bin:/opt/homebrew/Cellar/node@22/22.23.2_1/lib/node_modules/corepack/shims:/opt/homebrew/bin:/usr/bin:/bin
set -a
source ~/.dsh/.env
set +a
cd /Users/dsheval/Projects/dsheval
pnpm run build
```

`/opt/homebrew/bin` 不能省略：读取 DSH Session Archive 需要 `zstd`。真实评测还需要 `DEEPSEEK_API_KEY`，或分别设置 `DSHEVAL_PLANNER_API_KEY` 和 `DSHEVAL_JUDGE_API_KEY`。

## 3. 单步一：静态观测

```bash
node dist/src/app/cli.js inspect \
  --target config/targets/real-dsh.json \
  --config config/macos-vm.json \
  --run-id inspect-real-01
```

检查输出：

- `fixture` 必须为 `false`；
- Target 是真实 DSH `headless` Profile；
- 插件、工具、权限、Probe 状态和 limitation 与当前 VM 一致；
- 该步骤不再输出“Agent 标签选择”。

## 4. 单步二：统一 Planner

```bash
node dist/src/app/cli.js plan \
  --target config/targets/real-dsh.json \
  --dataset-catalog datasets/catalog.md \
  --datasets datasets \
  --labels labels \
  --trace trace/dsh-runtime.json \
  --environment environments/macos.json \
  --test-profile STANDARD \
  --config config/macos-vm.json \
  --run-id plan-real-01
```

检查输出：

- Planner API 只调用一次；
- `selectedDatasets` 中 ID 必须来自 Catalog 且不重复；
- 每个 Dataset 当前 `caseCount=2`；
- 总题量不超过 `planning/policies.json` 的边界；
- `selectedLabelIds` 是所选 Dataset 标签的程序化并集；
- Dataset 的运行条件和 Adapter/Judge 状态不能被 Prompt 文案误判为已满足。

需要调试 Planner Prompt 时，只打开项目现有的 Planner Debug 环境变量，并以 CLI 打印出的最终请求为准；静态快照、Catalog、Eligibility 和 Policy 都应是运行时注入数据，不得手工复制成固定 Prompt。

## 5. 单步三：两题 Smoke Run

```bash
export DSHEVAL_DEBUG_ERRORS=1
node dist/src/app/cli.js run \
  --target config/targets/real-dsh.json \
  --dataset-catalog datasets/catalog.md \
  --datasets datasets \
  --labels labels \
  --trace trace/dsh-runtime.json \
  --environment environments/macos.json \
  --test-profile STANDARD \
  --config config/macos-vm.json \
  --run-id standard-smoke-01 \
  --max-cases 2
```

`--max-cases 2` 是对整个 Parent Run 的全局截断，只适合 Smoke Test。它不会让“每个选中 Dataset 都执行 2 题”。完整 STANDARD 运行时删除该参数：

```bash
node dist/src/app/cli.js run \
  --target config/targets/real-dsh.json \
  --dataset-catalog datasets/catalog.md \
  --datasets datasets \
  --labels labels \
  --trace trace/dsh-runtime.json \
  --environment environments/macos.json \
  --test-profile STANDARD \
  --config config/macos-vm.json \
  --run-id standard-full-01
```

## 6. 运行中观察什么

CLI 应依次打印：

```text
planning
starting 1/N: <case-id>
finished 1/N: <case-id> (...)
starting 2/N: <case-id>
...
```

当前 `caseConcurrency=1`。每个 Case 应在 DSH Web 页面中出现一个新会话，自动收到该 Case 的真实题目，并显示工具调用和最终回答；上一题对话历史不应进入下一题。

框架状态 `COMPLETED` 只表示流程跑完，不代表 Agent 通过。CLI 退出码的重点语义：

| 退出码 | 含义 |
|---|---|
| `0` | 流程完成且 Gate PASS |
| `1` | 流程完成但 Gate FAIL |
| `2` | PLAN_UNSATISFIABLE |
| `3` | Gate UNEVALUABLE |
| `4` | 基础设施或 Workflow 失败 |
| `130` | 用户取消 |

## 7. 结果审查

```text
var/evaluation-results/agents/<agent-id>/runs/<run-id>/
├── target.json
├── run.json
├── report.html
└── cases/<case-id>/
    ├── task.json
    ├── plan.json
    ├── execution.json
    ├── trace/{index.json,status.json,raw.jsonl.gz}
    ├── observers/*.json
    ├── evidence/*.json
    ├── judge/*.json
    ├── artifacts/
    ├── report.json
    ├── report.html
    └── manifest.json
```

逐项检查：

1. `task.json` 是从选中 Dataset 的真实题目字段解析出来的，不是旧 Attention/Mem 固化 Prompt；
2. `execution.json` 有 Session ID、Agent 最终回答、stdout/stderr 和终止状态；
3. `trace/index.json` 有关键工具参数与结果，但没有大量 `assistant/chunk`；
4. `artifacts/` 包含 Agent 实际交付物及可读内容；
5. `observers/` 中存在本题需要的组件事件和运行状态；
6. 每个 Dataset Label 都有独立 `evidence/<label>.json` 和 `judge/<label>.json`；
7. Case `report.html` 展示本题全过程，Run 根目录 `report.html` 展示全部已执行 Case；
8. `manifest.json` 中每个文件的大小和 SHA-256 可复核。

`var/` 不提交 Git。重新测试使用新的 `run-id`，不要覆盖不可变 Case Bundle。

## 8. 2026-09-10 真实 Demo 基线

已完成运行：`standard-e2e-20260910-1800`。

- Planner 选择 4 个 Dataset，每个 2 题，共计划 8 题；Smoke 参数只执行前 2 题；
- 两题各创建一个真实 DSH Session；
- Case 1 流程完成、Gate FAIL；Case 2 流程完成、Gate PASS；
- Parent Run 流程状态 `COMPLETED`、运行健康 `HEALTHY`、聚合 Gate `FAIL`；
- 结果证明全链路可运行，也暴露出 Dataset 可执行性过滤和 Agent 访问私有评分材料的问题。

## 9. 下一轮验收重点

- 不可执行 Dataset 在 LLM 之前被硬过滤；
- Agent 无法读取 DSHEval 源码、结果目录和 Dataset 私有评分文件；
- Browser、Database、External API Observer 的 `COMPLETE/PARTIAL/UNAVAILABLE/IDLE` 均能进入 Case Bundle；
- Raw Trace 体积下降，但 SQL、命令参数、工具返回正文、错误、最终回答和交付物不丢失；
- 完整 STANDARD 确实对每个选中 Dataset 执行 2 个不同 Case，并只执行一次。

## Observer 变化采集回归

pnpm test 同时运行 TypeScript 测试和 observer-lab/tests/*.test.mjs。新增测试覆盖无变化不写证据、临时文件创建后删除、结束前最后采集、中途失败不被覆盖，以及真实文件变化进入证据与 Judge 授权闭包。外部服务在隔离测试中显式标记未启用；真实 VM 组件状态另行记录。
