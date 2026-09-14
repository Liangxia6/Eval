# all trace 与标签 Judge：一次真实结果的讲解

- 日期：2026-09-11
- 项目：DSHEval
- 运行环境：VMmac
- Run：`e2e-live-20260911-99133940`
- Case：`agentbench-os.case-1`
- 题目：实现 `calc` 计算器命令

本文用本次实际落盘的文件说明：测试结束后保存了什么、各类证据能证明什么，以及标签 Judge 实际如何获得证据并评分。本文描述本次运行的结果，不代表所有数据集的通用表现，也不代表下述改进已经实现。

## 1. 先分清三类产物

当前没有一个独立的 `all-trace.json` 包含所有证据。

广义的 all trace 分散在 `trace/`、`observers/`、`artifacts/` 中；`evidence/` 是筛选整理后的标签输入，`judge/` 是评分输出。

| 类别 | 对应目录 | 回答的问题 |
|---|---|---|
| 原始记录、观测与交付物 | trace、observers、artifacts | 实际发生了什么、留下了什么？ |
| 标签证据包 | evidence | 本标签实际可以使用哪些证据？ |
| Judge 判定 | judge | 本标签如何评分，依据是什么？ |

题目和执行计划则提供理解证据所需的上下文。

## 2. 实际目录结构

VM 中的结果目录：

```text
/Users/dsheval/Projects/dsheval/var/evaluation-results/agents/vm.real-dsh-headless/runs/e2e-live-20260911-99133940/cases/agentbench-os.case-1/
```

下列文件名均相对于上面的目录：

```text
agentbench-os.case-1/
├── task.json                       题目原文
├── plan.json                       本题执行与评分安排
├── execution.json                  DSH 执行结果
│
├── trace/
│   ├── raw.jsonl.gz                 压缩后的适配后运行轨迹
│   ├── index.json                  轨迹摘要、工具调用和原始记录定位
│   └── status.json                 轨迹完整性及缺口
│
├── observers/
│   ├── filesystem.json             文件前后状态、变化、清理结果
│   └── process.json                进程快照与变化
│
├── artifacts/
│   ├── stdout.txt                  DSH 标准输出
│   ├── stderr.txt                  DSH 标准错误
│   ├── deliverables.json           交付物清单
│   └── deliverables/output/
│       ├── calc                    Agent 生成的可执行脚本
│       ├── calc.py                 同一实现的 Python 文件
│       └── response.txt            Agent 写的完成说明
│
├── evidence/
│   ├── artifact-delivery.json      交付物标签获得的证据
│   ├── loop.json                   执行闭环标签获得的证据
│   ├── reasoning-planning.json     推理规划标签获得的证据
│   └── tool-code.json              代码工具标签获得的证据
│
├── judge/
│   ├── artifact-delivery.json      交付物标签判定
│   ├── loop.json                   执行闭环标签判定
│   ├── reasoning-planning.json     推理规划标签判定
│   └── tool-code.json              代码工具标签判定
│
├── report.json
├── report.html
└── manifest.json                   文件清单、大小及校验摘要
```

本题没有浏览器、数据库、外部 API 的 Observer 结果文件，不能据此声称所有环境组件都有证据。文件缺失本身也不足以判断是没有事件、没有启用，还是采集失败，需要结合组件运行状态核对。

本题 manifest 列出的 24 个文件，其大小与 SHA-256 已核验一致。这证明结果包与清单一致，不等于证明采集完整或任务正确。

## 3. 原始内容记录了什么

### 3.1 题目上下文

`task.json` 要求实现支持四则运算和括号的 calc 命令。例如：

```text
calc 6 * (9 / 3) + 7
```

预期结果为 `25`，误差小于 `1e-5`。

题目还要求写 `output/response.txt`，并明确说明：

- 完成说明本身不是任务成功的证明；
- 应在评测提供的 Benchmark 环境内执行；
- 必要环境或工具缺失时，应报告 UNEVALUABLE，不能用文字模拟成功。

这些约束属于 Judge 理解证据时需要的上下文。

### 3.2 DSH 的执行结果

`execution.json` 中真实字段摘录：

```json
{
  "durationMs": 164785,
  "exitCode": 0,
  "terminationKind": "EXITED"
}
```

这意味着 DSH 进程运行约 2 分 45 秒并正常退出。退出码不能单独证明题目正确。

本次 Session：

```text
session-532b0c00-c8fc-43fc-bab0-56352eb3910f
```

### 3.3 正式报告中的运行轨迹

`trace/index.json` 的摘要实际包含：

| 项目 | 本次值 |
|---|---|
| 模型 | deepseek-v4-flash |
| Provider | deepseek-official |
| Session 数量 | 1 |
| 会话事件数量 | 127 |
| 工具调用数量 | 22 |
| 工具返回数量 | 22 |

127 是摘要中的会话事件数量，不是所有底层原始记录的总数。

其中第一条工具调用为：

```text
工具：bash
用途：List workspace contents
命令：ls -la && echo "---" && ls -la .. 2>/dev/null | head -50
```

索引还记录原始文件、行号、字节位置和摘要，用于回到原文核对证据。

`trace/status.json` 的 source 对象包含：

```json
{
  "completeness": "PARTIAL",
  "health": "DEGRADED",
  "trust": "COOPERATIVE"
}
```

其含义是：

- PARTIAL：正式评分轨迹不完整；
- DEGRADED：该来源的采集质量存在问题；
- COOPERATIVE：来自被测 DSH 内部探针，与外部 Observer 的独立观测属于不同证据来源。

`trace/raw.jsonl.gz` 保存的是经过读取预算和适配流程处理后的正式轨迹，并不是本次完整的 Native Probe 输出。压缩后的文件大小也不能用来判断是否发生了截断。

### 3.4 文件 Observer 确认了什么

文件初始快照只有 `input/`、`output/` 两个目录。执行后快照确认新增：

| 文件 | 实际大小 | 独立确认的事实 |
|---|---:|---|
| output/calc | 5216 字节 | 文件存在，具有可执行权限 |
| output/calc.py | 5216 字节 | 文件存在，与 calc 内容摘要相同 |
| output/response.txt | 3327 字节 | 完成说明存在 |

因此，“三个文件由无到有”是评测侧观察到的事实。

文件内容中的“测试通过”，仍然需要其他证据支持。采集到了一份说明，不代表独立验证了说明中的全部宣称。

### 3.5 三种不同的证明力度

| 材料 | 能直接证明什么 |
|---|---|
| Agent 在完成说明中写“测试通过” | Agent 做出了这个宣称 |
| 工具返回实际测试输出 | 执行轨迹记录了这些测试结果 |
| 评测侧独立检查器运行并返回结果 | 评测侧按指定规则核验了结果 |

本次额外保全的完整诊断日志中，确实有以下工具返回。它属于第二类，不是独立上游检查器的结果：

```text
PASS  '6 * (9 / 3) + 7'        got=25.0         want=25
PASS  '1 + 2 * 3'              got=7.0          want=7
PASS  '(1 + 2) * 3'            got=9.0          want=9
PASS  '10 / 4'                 got=2.5          want=2.5
PASS  '-(3.5 - 1.5) * 2'       got=-4.0         want=-4
PASS  '1e3 / 8'                got=125.0        want=125
ALL PASS
```

对应工具调用的 Native 序号为 877，callId 为：

```text
call_00_V11UxyRzLFVyvAeE3JKe1721
```

关键限制：这段后期测试记录没有完整进入正式评分轨迹。

完整 Native 日志有 31 次工具调用及 31 次返回，正式报告只保留前 22 次。完整原始数据约 110.6 MB，超过当前 64 MiB 读取预算。我们额外保存的诊断副本，不能算作当时 Judge 已经拿到的输入。

完整诊断数据的全局序号与哈希链校验通过，且包含正常的回合结束与 probe.stop。本次正式记录中的“结束未确认”，不能直接解释为 DSH 没有正常退出。

## 4. 从 all trace 到标签 Judge

期望的业务流程是：

```text
题目上下文 + all trace + 当前标签评分标准
                       ↓
                   标签 Judge
                       ↓
             该标签分数、理由、证据引用
```

当前实际流程多了一层标签证据筛选：

```text
原始记录、Observer 观测、交付物
             ↓
        生成证据条目
             ↓
    检查当前标签的必需证据
             ↓
     形成该标签的授权证据包
             ↓
   满足要求：调用 Judge
   不满足：阻断评分
```

证据条目把材料整理成可引用的事实。它既包含事实内容，也包含来源、完整性、可信度和关联材料。

“原始材料存在”“被整理成证据”“被允许交给当前 Judge”，是三个不同阶段。

## 5. 交付物 Judge 实际拿到了什么

本次 `evidence/artifact-delivery.json` 中包含两个授权证据条目：

| 条目 | 实际内容 |
|---|---|
| SUBMISSION，编号结尾 .806 | 预期输出是否存在、三个交付文件的内容与属性 |
| FILE，编号结尾 .809 | 文件 Observer 确认三个文件由无到有 |

完整证据编号：

```text
evidence.e2e-live-20260911-99133940.c1.attempt.806
evidence.e2e-live-20260911-99133940.c1.attempt.809
```

SUBMISSION 证据中的真实字段摘录如下，省略了文件内容和其他元数据：

```json
{
  "factType": "SUBMISSION",
  "completeness": "COMPLETE",
  "trust": "INDEPENDENT",
  "factValue": {
    "expectedOutputPath": "output/response.txt",
    "expectedOutputPresent": true
  }
}
```

INDEPENDENT 表示交付文件由评测侧采集确认，不表示 response.txt 中的每一句话都经过独立验证。

FILE 证据中则记录了三个 ADDED 变化：

```text
ADDED output/calc
ADDED output/calc.py
ADDED output/response.txt
```

## 6. 交付物 Judge 怎样形成评分

当前 Judge 调用逻辑会组合：

1. 本题题干；
2. “产物交付”的评分标准；
3. 数据集的参考信息与检查参数；
4. 授权证据条目；
5. 分数、理由和证据引用的输出要求。

本次可以直接核对的输入证据，是上面两个条目，其中包含代码内容和完成说明。

当前接口没有让模型自主打开整个结果目录并循环寻找其他材料。“提供证据目录，按需读取、渐进式披露”属于后续方案。

本次 `judge/artifact-delivery.json` 保存的真实判定字段摘录：

```json
{
  "judgementStatus": "COMPLETED",
  "outcome": "PASS",
  "reasonCodes": [
    "LLM_LABEL_SCORE_3"
  ]
}
```

Judge 给出的理由包括：

> 交付物完整可用：output/calc（可执行，mode 493）与 output/calc.py 为自包含的递归下降解析器实现。

并指出：

> 验证仅由 Agent 自述的直接执行记录支撑，缺少独立判分证据，故未达 4 分。

这里的 3/4 是模型根据文件内容和文件事实形成的交付物评价，不是评测侧重新运行计算器后得到的功能测试分数。当前通过线为 3 分，因此这个维度转成 PASS。

当前结果包保存了授权证据与整理后的判定，没有单独保存完整模型请求、响应原文。因此能核对材料和判定依据，但不能逐字还原当时整份 HTTP 请求。

## 7. 另外三个 Judge 为什么没有评分

`evidence/loop.json` 的实际内容为：

```json
{
  "schema": "dsheval.result-label-evidence/v1",
  "labelId": "label.loop/v1",
  "checkId": "check.loop",
  "requiredEvidenceTypes": [
    "RUNTIME_EVENT",
    "TOOL_RESULT"
  ],
  "authorizedEvidence": []
}
```

它说明：

1. 执行闭环标签要求运行事件和工具返回；
2. 正式 Trace 被标记为不完整；
3. 必需证据要求未满足；
4. 该标签没有获得可评分的证据包；
5. 框架在调用该标签的模型 Judge 前阻断了评分。

推理规划、代码工具标签同样被阻断。

因此，这三个 Judge 并不是“看完 all trace 后认为证据不足”，而是没有进入模型评分阶段。

## 8. 本次实际交接结果

| 标签 | Judge 实际得到什么 | 是否调用模型 | 结果 |
|---|---|---|---|
| 产物交付 | 文件内容、文件变化事实 | 是 | 3/4，PASS |
| 执行闭环 | 授权证据为空 | 否 | BLOCKED，UNEVALUABLE |
| 推理规划 | 授权证据为空 | 否 | BLOCKED，UNEVALUABLE |
| 代码工具 | 授权证据为空 | 否 | BLOCKED，UNEVALUABLE |

本题最终 Gate 为 UNEVALUABLE。它不表示计算器已经被证明错误，而表示本次流程没有形成足以完成所要求评分的证据。

此外，本题要求的原生 Linux 环境和上游检查器尚未接通。即使补齐 Trace，也不能自动视为通过了原生 Benchmark 验收。

## 9. 与期望流程的差距

当前需求是：每个标签都获得全部三层证据，依据各自的能力标准评价；未来再演进到证据目录与渐进式读取。

本次实际情况是：

- 完整 Native 记录存在，但正式轨迹截断；
- 交付物与文件变化被独立保存；
- 标签接口根据证据类型与完整性做筛选；
- 只有交付物 Judge 获得文件证据；
- 另外三个维度在证据检查阶段被阻断。

下一步要核对的接口是：all trace 如何把完整事实、证据来源和缺口一起交给每个标签 Judge，以及缺少某类证据时如何明确评分范围和不可评测原因。

## 10. 实际材料位置

### 正式结果

```text
/Users/dsheval/Projects/dsheval/var/evaluation-results/agents/vm.real-dsh-headless/runs/e2e-live-20260911-99133940/cases/agentbench-os.case-1/
```

### 额外保全的诊断材料

```text
/Users/dsheval/Projects/dsheval/var/reviews/e2e-live-20260911-99133940/
```

其中包括：

- `native-e2e-live-20260911-99133940.c1-events.jsonl.gz`：完整 Native 事件诊断副本；
- `native-e2e-live-20260911-99133940.c1-logs.jsonl.gz`：配套运行日志；
- `e2e-live-20260911-99133940.c1-observed-tools.json`：运行中保全的工具调用与返回；
- `native-analysis.json`：完整序列、哈希链、事件数量与工具调用分析；
- `verification.json`：结果包文件校验及两题结果摘要；
- `REPORT.md`：本次端到端测试总体复盘。

诊断副本用于解释本次问题，未用于覆盖正式报告或重新评分。

