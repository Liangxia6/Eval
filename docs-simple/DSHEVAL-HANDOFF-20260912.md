# DSHEval 今日修改与项目交接

日期：2026-09-12  
项目：VMmac `/Users/dsheval/Projects/dsheval`  
用途：同步今日调整、当前代码与验证状态、同事接手事项和后续问题。  
记录基线：本次读取的 VM 工作区，Git HEAD 为 `d667b2b`；工作区包含大量未提交修改，HEAD 不代表本文所有修改已提交。

## 1. 当前结论

DSHEval 已完成一轮 Observer、评价模块和 Case 输入输出的结构调整。受控端到端链路已跑通：加载题目 → 模拟 Agent 执行 → 实际采集外部变化 → all trace → Judge 测试响应 → 数值评分 → JSON、HTML 和 output 归档。

**尚不能宣称已经完成对 VM 中实际使用的 DSH 的端到端验收。** 今日确认评测配置指向另一份 Headless 目标，实际运行的却是 `web` Profile；两者插件配置不同，静态观测和执行还存在 Home 混用路径。这是当前优先级最高的正确性问题。

用户已将以下工作交给同事，本文将其记录为待交付，未把它们写成已完成：

1. Probe 改造，减少冗余 Evidence / all trace。
2. all trace 结构调整。
3. Judge 改为 ReAct 模式，支持按需获取证据、渐进式披露。
4. 标签与数据集的格式、内容微调。

本文将用户所说的“React”理解为 Judge 的 **ReAct 推理与工具取证循环**，不是前端 React。具体协议以同事最终交付为准。

## 2. 已明确的产品与模块职责

| 模块 | 已确定的职责 |
|---|---|
| 静态观测与 Planner | 识别实际被测 DSH、配置及插件能力，选择适合的 Dataset / Case |
| 数据集与 Loader | 加载题目、公开输入、固定标签及私有评分参考；完成运行输入准备 |
| 环境与执行 | 环境由同事预先手动配置；执行层向 DSH 提交任务和真实附件 |
| Probe | 采集 Agent 内部运行事件、会话及工具活动；是采集插件，不是 Judge |
| 外部 Observer | 各组件并列，Case 运行时全部进入观测生命周期；只有变化进入环境证据 |
| all trace | 汇集 Agent 记录、外部变化、交付物；保存来源与覆盖情况 |
| 标签与 Judge | 结合标签评分标准、Case 专用评分参考及 all trace，评价该 Case 覆盖的维度 |
| 汇总与报告 | 按标签汇总数值；统一结构化结果，由 HTML 展示，不在展示层再次评分 |

已确认的边界：

- 只服务 DSH；插件和数据集允许异构，不要求内容完全同构。
- 每题只评价自身覆盖的标签，全部 Case 完成后形成所覆盖标签的多维评分。
- 标签分数与题目专用评分内容共同决定评价，不能只看标签或只看文件是否存在。
- 不恢复旧的“必要证据”评分前门槛；证据不足由 Judge 说明，无法判断返回 null。
- 因无法判断返回的 null 不参与该维度平均；有效 0 分必须参与。
- Judge 调用或解析错误单独计数，不能当成 Agent 的 0 分。
- 用户选择加权平均，**当前代码尚未实现权重**。
- 环境安装、数据库及初始数据由同事手动完成，不自动执行旧 Setup。
- 已取消 Case 要求 check；输入路径、摘要和响应格式检查仍是数据完整性约束。
- 不要求逐题恢复 VM；期望按被测 Agent 恢复。工作区清理不能等同于整台 VM 恢复。
- 不新增强制 VM 全局串行锁；并发使用是需要面对的实际场景。
- 原先“每题每标签一次 LLM 调用”是当前实现；ReAct 将引入多轮取证，调用次数与预算需要随新模式更新。

## 3. 今天已经修改的内容

### 3.1 Observer 结构和变化采集

原先文件、进程采集与编排、Agent Trace 解析混在 observation 中。现在：

- Agent Trace 解析移动到 `src/agent-trace/`。
- 文件、进程与其他八类外部 Observer 并列放在 `observer-lab/adapters/`。
- `src/observation/` 保留会话协调、组件启动停止和结果接入。
- 不按评分标签筛掉 Observer；所有配置组件进入观测。
- 开始前采集基线，运行期间持续采集，结束时做最后采集。
- 无变化不生成环境评分证据；无变化、未配置、采集失败和部分覆盖在 coverage 中区分。
- 文件阶段快照仍可用于交付物提取和工作区清理，不把静态基线自动当成 Agent 成果。

实际限制：轮询间隔默认约 250 ms 加采集耗时，无法保证捕获所有短暂变化；同 UID 的其他进程也会变化，不能自动归因给当前 Agent。

### 3.2 Evaluation、标签与报告拆分

已完成：

- `labels/` 成为标签标准来源，通过 `src/labels/catalog.ts` 加载。
- Dataset 加载与评价模块解耦。
- 删除旧 `src/evaluation/evidence.ts`、`closure.ts` 和独立 Evaluation Pack 加载入口。
- 不再生成旧 Judge 所需的派生事实与按标签授权闭包。
- 所有标签 Judge 取得同一份 all trace，由 Judge 选择相关证据。
- 输入同时包含标签标准与 Case grading，执行前保留其内容及摘要。
- 输出为数值评分、原因、引用 ID，或无法判断 / Judge 错误。
- 删除以 Gate、通过 / 失败替代能力分数的主评价路径。
- 报告移到 `src/reporting/`；统一 JSON 记录与 HTML 展示分开。

`src/evaluation/scoring.ts` 目前对有效分数取普通算术平均，按标签统计 SCORED、UNASSESSABLE 和 ERROR 数量。相同标签的不同评分标准摘要不能直接混算。

### 3.3 Setup、Loader 与输入输出

已完成：

- Loader 改读顶层 `question.inputs`。
- 公开输入迁移到 `datasets/<dataset>/<case>/input/`。
- 旧 `environment.inputs`、运行时 Setup 分支和 `final.checks` 调度已移除。
- 原题目评分材料转换为 `grading` 参考；保留私有参考内容和异构字段。
- 原先四道选项打乱题固化选项顺序与映射，运行时不再执行打乱分支。
- 输入声明区分 `workspace` 与 `chat-attachment`。
- 输入没有作者摘要时，用实际字节计算摘要；有摘要时仍校验。
- 交付文件在工作区清理前收集，按原名称与子目录归档到 Case 结果的 `output/`。
- 报告记录输入交付回执，链接实际导出的 output 文件。

迁移审计基线为 173 题、232 条输入引用，并非更早版本的 265 条。229 个实际存在的原文件迁移后字节一致；新增 4 个固定映射文件后，共 236 条引用。

**附件接入的验证范围需要纠正：** 当前新增适配器面向既有 Headless 链路，使用 DSH 原生图片存储和消息接口。测试确认该适配器明确拒绝 PDF 聊天附件，但这不能代表实际 `web` Profile 加载全部插件后的附件能力。真实 Web 附件接入仍待适配。

## 4. 今天发现但尚未修复的关键问题：被测对象不一致

### 4.1 实际对象与配置对象

| 项目 | VM 实际运行的 DSH | 当前评测配置 |
|---|---|---|
| 安装根目录 | `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh` | `/Users/dsheval/Targets/dsh-headless-current/package` |
| 可执行入口 | `/opt/homebrew/bin/dsh`，链接到实际安装的 `lib/bin.js` | 副本 `package/lib/bin.js` |
| Home | `/Users/dsheval/.dsh` | 描述文件声明副本 `dsh-home` |
| Profile | `web` | `dsheval` |
| 启动核查 | `node /opt/homebrew/bin/dsh --profile web` | 按 Headless 目标执行 |
| 基础版本 | `0.1.1-rc.2` | `0.1.1-rc.2`；同版本不代表同能力 |

实际 Web Profile 声明：

```text
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
@dsheval/dsh-top100-plugin
dsh-memory-evolve
dsh-doublecheck
@yolk_vat-y/dsh-project-memory
dsh-context
@xmanrui/dsh-im
dsh-univer-office
```

除 Base、Web 外有 7 个扩展 Bundle 声明。声明不等于成功加载；展开后的插件、工具数量还需运行时确认。副本 Profile 只声明 Base、Probe、Headless，不能代表这一组合。

### 4.2 需要修改的连接点

- `config/targets/real-dsh.json` 仍指向副本，尚未纠正。
- `src/planning/target.ts` 要求安装入口和 Home 位于同一个 sourceRoot，不能直接表达真实安装与 Home 分离的布局。
- `src/app/workflow.ts` 还读取目标根目录中的 `effective-config.json`，需要改成真实生效配置的可靠获取方式。
- SESSION_SEPARATED 分支从进程环境 / 用户 Home 获取共享 `.dsh`；`src/runtime/target.ts` 优先使用该 Home，可能形成“副本入口 + 实际 Home + dsheval Profile”的组合。
- 当前运行准备包含副本 staging、Profile 准备；Web DSH 的真实会话接入与 Headless 单次命令执行不同。
- 当前实际 Web Profile 的上述声明中没有 Probe；不能把副本 Probe 加载成功当成实际 Web 已完成接入。

修复目标：静态观测、Planner、任务提交、Probe 和结果归属必须绑定同一套实际安装、Home、Profile 与会话。不能用 sourceRoot 设成整个文件系统，或再复制一份 Profile，来掩盖身份不一致。

历史报告可以用于排查框架，但不能直接作为当前实际 Web DSH 的能力评分。本次文档整理没有修改目标配置或重启 DSH。

## 5. 当前代码结构

以下列出主链路与重要边界，不展开依赖、所有题目和历史运行文件。

```text
dsheval/
├── config/
│   ├── macos-vm.json                  # VM 路径、执行限制、隔离配置
│   └── targets/real-dsh.json           # 当前仍指向错误的 Headless 副本
├── labels/*.json                      # 14 个标签定义；同事将微调格式和内容
├── datasets/
│   ├── catalog.md                     # Dataset 目录、说明及标签关系
│   └── <dataset>/<case>/
│       ├── question.json              # 题目、输入交付声明、运行参数、grading
│       ├── prompt.md                  # 可选任务正文
│       ├── input/                     # 公开输入原件
│       └── private/                   # 评分参考与数据集专有材料
├── environments/macos.json            # 执行环境与观测源声明
├── trace/dsh-runtime.json              # Trace 解析、采集与容量配置
├── planning/
│   ├── policies.json、prompts/        # Planner 策略与提示资产
│   └── *.py                           # 静态发现、选题等独立 CLI / 原型
├── observer-lab/
│   ├── adapters/
│   │   ├── filesystem/                # 文件扫描、绑定及独立入口
│   │   ├── process/                   # 进程采集、绑定及记录转换
│   │   ├── application/               # 应用变化
│   │   ├── browser/                   # 浏览器变化
│   │   ├── clipboard/                 # 剪贴板变化
│   │   ├── database/                  # 数据库变化，依赖配置具体目标
│   │   ├── desktop/                   # 桌面 / 窗口观测，依赖权限与配置
│   │   ├── external-api/              # 外部 API，依赖配置具体目标
│   │   ├── network/                   # 网络状态变化
│   │   └── system/                    # 系统状态变化
│   ├── lib/{core,watch}.mjs            # 差异比较、轮询、去重、覆盖状态
│   └── config/macos-worker.json        # Observer 具体参数
├── src/
│   ├── app/
│   │   ├── cli.ts                     # inspect / plan / run / report
│   │   ├── bootstrap.ts               # 配置与启动依赖
│   │   ├── workflow.ts                # 单次主流程；仍然较大、职责较多
│   │   ├── batch.ts                   # Parent Run、Case 队列、汇总
│   │   └── plugins.ts、plugin-ui.ts    # 另有插件检索 / 临时 Target 安装入口
│   ├── planning/
│   │   ├── target.ts                  # Target 冻结、Profile / 插件静态检查
│   │   ├── agent-static.ts            # 将检查结果投影为 Planner 静态输入
│   │   └── planner.ts                 # Dataset / 标签选择与计划
│   ├── datasets/{catalog,loader}.ts    # 题库目录与 Case 加载
│   ├── labels/catalog.ts              # 标签唯一加载入口
│   ├── runtime/
│   │   ├── case-input.ts              # 题目与运行配置组合
│   │   ├── evaluation-plan-compiler.ts# 编译执行、环境与采集计划
│   │   ├── source-requirement.ts       # 采集组件配置适配
│   │   ├── environment.ts             # 工作区、运行目录和清理
│   │   ├── runner.ts、target.ts        # 进程执行、超时取消、DSH 启动
│   │   ├── input-delivery.ts          # 附件清单与临时启动补丁
│   │   ├── dsh-input-runner.ts         # 当前 Headless 附件 / 消息适配器
│   │   └── dsh-session-trace.ts        # 条件满足时的 Session 归档回退解析
│   ├── agent-trace/
│   │   ├── native-probe/              # Cordis Probe 插件源码及构建配置
│   │   ├── native-probe-adapter.ts     # 原生 Probe 格式适配
│   │   └── reader.ts                  # 读取、范围关联和完整性检查
│   ├── observation/
│   │   ├── coordinator.ts             # 观测会话 / 生命周期
│   │   └── collection.ts              # 外部组件启动停止及结果接入
│   ├── all-trace/
│   │   ├── types.ts                   # 当前三层证据结构
│   │   └── assemble.ts                # assembleAllTrace：最终装配入口
│   ├── evaluation/
│   │   ├── types.ts                   # Judge 输入、标签分数、维度汇总
│   │   ├── llm-label-judge.ts          # 当前一次性全量输入 LLM Judge
│   │   └── scoring.ts                 # 普通平均，尚未加权
│   ├── reporting/
│   │   ├── types.ts、record.ts         # 统一结果结构与记录校验
│   │   └── html.ts、batch-html.ts      # Case 与 Parent Run HTML
│   ├── platform/
│   │   ├── case-bundle.ts             # 结果、附件和 output 归档
│   │   └── …                          # 服务组装、安全边界、导出与 Viewer
│   ├── storage/                       # 阶段记录、内容寻址 Artifact
│   └── core/                          # 公共模型、契约与错误类型
├── scripts/                           # 迁移、转换、人工题库检查
├── tests/{unit,integration,e2e}/       # 单元、接口与端到端测试
├── tests/fixtures/                    # 模拟 DSH 和受控 Dataset
├── docs-simple/                       # 项目说明与阶段交接
└── var/                               # 工作区、结果、运行记录与审计备份
```

`planning/*.py` 不应与正式 Inspector 混同。例如 `plugin_static_cli.py` 是基于 README 的能力发现原型，明确不能证明插件已经安装、加载或可执行。插件选择入口生成临时 Target 的模式，也需要与“测 VM 实际 DSH”的主目标区分。

## 6. 当前实际执行链路

```text
CLI run
  → Parent Run 调用 Workflow 到 PLAN
  → 冻结 / 检查当前配置 Target，得到选题结果
  → 枚举 Case 队列
  → 每个 Case 再进入完整 Workflow
      → 再次冻结 Target，复用 Dataset 选择结果
      → Loader 加载公开输入、标签关系与私有 grading
      → 加载 / 冻结标签标准，准备 Workspace
      → 准备全部外部 Observer、采集基线
      → 执行 DSH，Probe 记录内部事件
      → 结束采集、读取 Probe 或符合条件的 Session 回退记录
      → 提取最终回答及实际交付文件
      → assembleAllTrace
      → 每个覆盖标签调用一次当前 LLM Judge
      → 数值汇总、执行收尾与结果归档
  → Parent Run 汇总 Case 标签分数
  → run.json / HTML
```

目前 `src/app/batch.ts` 的 `CASE_CONCURRENCY = 1`。代码虽然使用分组 Promise.all，实际仍串行；没有完成“一个 Agent 冻结一次、Planner 后并行跑 Case”的调整。

批处理中，每题有独立临时运行目录；成功产出 Case Bundle 后会删除该题临时记录区。因此工作区不一定总在默认 `var/workspaces`：批量运行会覆盖为 `var/batch-runtime/<run>/…/workspaces`。检查历史证据时，应以该次运行配置和留存结果为准。

当前结果包：

```text
var/evaluation-results/agents/<agent>/runs/<run>/
├── run.json / report.html            # Parent Run 汇总
└── cases/<case>/
    ├── report.json                  # 输入、执行、allTrace、标签评分、异常
    ├── report.html                  # 同一记录的展示
    ├── output/                      # 实际文件交付物
    └── attachments/                 # 可导出的原始证据文件
```

当前 `allTrace` 的 schema 为 `dsheval.all-trace/v1`，包含 `entries`、`sources`、`coverage`、`artifacts`、`integrity` 和 `contentDigest`。entries 分为 AGENT、ENVIRONMENT、DELIVERY 三层。产物交付 Judge 同样通过 all trace 取得交付物，不另走一套文件存在性判分。

Probe 只负责其中 Agent 内部记录，**不会独自生成完整 all trace**。最终装配由 `src/all-trace/assemble.ts` 的 `assembleAllTrace()` 负责，`src/app/workflow.ts` 调用并保存。

## 7. 已跑通什么，尚未证明什么

本次整理读取已有日志和结果，没有重新启动完整测试或真实模型评测。以下是各阶段的验证记录，不能把早期全绿数字当成当前最终状态。

| 阶段 | 已记录结果 | 范围 |
|---|---|---|
| Observer 调整 | 136 / 136 通过 | 含真实 VM 文件变化与十类 Observer 独立观测 |
| Evaluation 拆分 | 124 / 124 通过 | 受控 Dataset、Fake DSH、Judge HTTP 测试响应 |
| 输入输出调整，最后一轮完整记录 | 134 项，128 通过、6 失败；类型检查通过 | 6 项为修改前题库备份也能复现的内容 / 测试不一致 |
| Loader 实际题库审计 | 43 个 Catalog 条目、173 题、171 题加载成功 | 2 题受原已缺失的 3 个文件影响 |
| 附件接入 | 原生图片存储 / 消息接口通过；原生启动测试确认 PDF 拒绝 | 图片测试 Agent 为替身；不代表实际 Web DSH 能力 |
| 完整链路样例 | 统一 JSON、HTML、output 与评分成功生成 | Fake DSH + 显式 Judge 测试响应，不是真实能力分数 |

最近受控样例：

`var/reviews/setup-input-20260912/smoke/results/agents/fixture-agent/runs/setup-input-final-smoke/cases/setup-input-final-smoke.case/`

实际留存 all trace：

- 文件大小 268,116 字节。
- 30 条 entries：AGENT 9、ENVIRONMENT 19、DELIVERY 2。
- 11 个来源、11 项覆盖记录。
- 输出包含实际生成的 `output/attention.py`。
- 样例分数 3/4 来自测试响应，只说明调用、解析、引用和展示通路正常。

Observer 独立实测曾发现：数据库、外部 API 未配置目标；桌面部分读取失败且未开启截图。十个组件都启动，不等于十个组件都取得完整证据。

题库缺失文件：

```text
datasets/replicationbench/replicationbench-find-galactic-vz-peaks/input/paper_masked.json
datasets/replicationbench/replicationbench-find-galactic-vz-peaks/input/dataset_info.json
datasets/skillsbench/skillsbench-model-investment-shock-gdp/input/test-supply.xlsx
```

这些文件没有被擅自补造或恢复；需要题库维护者判断补齐输入还是修正题目引用。

## 8. 已交给同事的工作及适配边界

### 8.1 Probe 精简

现状：`src/agent-trace/native-probe/` 以 Cordis 插件方式记录事件、日志和快照。部分事件频繁且信息重叠，Probe 调整要同时适配原生适配器、reader 和 all trace 装配。

建议验收重点：

- 保留任务、工具调用及结果、结束状态、来源关联等可追溯信息。
- 重复快照、轮询噪声和完整对象重复序列化得到控制。
- 对截断、丢弃、未捕获给出明确状态，不能把精简变成静默丢证据。
- 在真正被测 Profile 中验证插件已加载及事件属于该次 Session。

### 8.2 all trace 结构

现状：已统一三层输入，但结构仍有冗余。`assemble.ts` 同时保存 `observation` 与 `content`；环境记录可能把同一 `payloadInline` 保存两次。报告也内嵌 allTrace，HTML 展示与原始附件仍会增加总存储。

历史四个逐标签 evidence 文件合计约 1.90 MB，21 次证据条目出现只有 10 个唯一证据对象；主要是逐标签复制及派生索引重复。这是旧产物，不能直接等同于当前格式。

需要共同适配：`all-trace/types.ts`、`assemble.ts`、Workflow 持久化、ArtifactStore 引用、Case Bundle、Judge 取证、报告与测试。

建议新协议明确：稳定证据 ID、层级、来源、Case / Session 关联、时间、正文或读取位置、截断 / 覆盖说明、结构版本。去重后仍应能定位原始内容。

### 8.3 Judge 改为 ReAct

现状：`llm-label-judge.ts` 一次性把同一 all trace 全文、标签标准和 Case grading 放入请求；尚无证据目录读取工具或循环取证。

同事将接手的行为：先读取证据目录，再按需获取内容，循环评价并输出最终分数。

建议联调时保持：

- 两个评分参照都进入评价上下文。
- 证据正文始终作为待评价内容，不能成为控制 Judge 的指令。
- 取证过程可记录；最终引用能定位回真实证据。
- 保持 SCORED / UNASSESSABLE / ERROR 与数值 / null 的语义。
- 定义轮次、时间、上下文预算和终止条件；错误不要伪装成 Agent 低分。
- 不重新引入 required evidence / Closure 评分前阻塞。

### 8.4 标签与数据集微调

同事维护语义内容，运行框架维护读取与接口适配。当前标签有 14 份定义，题库的私有评分材料允许不同字段，不应为方便读取强行改成同一种答案结构。

联调点：

- Dataset / Case 的标签归属与 Judge 实际调用维度一致。
- 标签标准负责通用维度，Case grading 负责题目专用正确性。
- Loader 保留评分参考中的异构内容，私有材料不送入 Agent。
- 输入引用、交付方式、评分参考位置和标签 ID 可正确读取。
- 不能仅凭“JSON 加载成功”宣称标签与题目评分语义已经适配；需要抽取不同类型真实题审阅 Judge 结果。

## 9. 其余待处理问题

| 优先级 | 问题 | 当前状态 / 下一步 |
|---|---|---|
| P0 | 实际 DSH 身份不一致 | 尚未修复；统一安装、Home、Profile、会话、Probe 与报告身份 |
| P0 | 真实端到端验收缺失 | 先纠正目标，再跑真实 Case、真实 DSH、真实 Judge，逐步审阅内容 |
| P1 | 加权平均未实现 | 明确权重是 Case 权重还是 Case×标签权重，再实现有效分数加权及 null 排除 |
| P1 | Parent Run 重复冻结、串行 | 当前每题仍冻结、并发数 1；完成一次 Agent 冻结与 Case 执行解耦 |
| P1 | Agent 级 VM 恢复 | 用户要求已明确，尚无已验收的按 Agent 自动恢复闭环；不能用工作区清理替代 |
| P1 | 真实 Web 附件接入 | 当前适配器面向 Headless；要验证实际聊天 / 文件接口与输入回执 |
| P1 | Observer 噪声和归因 | 进程状态抖动、同用户后台活动较多；变化不等于由本 Case 引起 |
| P1 | 外部采集覆盖 | 配置数据库 / API 目标、桌面权限等；缺失状态要如实进入报告 |
| P1 | 2 题输入缺失、6 项既有测试失败 | 由题库变更与测试预期共同核对，不恢复旧数据掩盖问题 |
| P2 | Benchmark 内容与评分质量 | 后续持续优化，抽样检查题目—标签—证据—评分是否互相支持 |
| P2 | 工作流仍庞大 | `workflow.ts` 仍统筹大量阶段；先稳定接口，再拆分，避免与同事并行重写同一逻辑 |
| P2 | 历史文档及结果易混淆 | 旧文档仍含旧 Setup、授权证据、逐标签 evidence 描述，需标记版本边界 |
| P2 | 多人工作区交付边界 | 本次工作区改动很多且未全部提交；应按模块整理差异与测试记录后交接 |

加权汇总期望为：

```text
某标签分数 = Σ（有效 Case 分数 × 对应权重） / Σ（有效 Case 的对应权重）
```

无有效分数时为 null；有效 0 分参与计算；UNASSESSABLE 和 ERROR 不进入分母，但数量与原因继续展示。权重来源与跨 Dataset 的平衡方式尚未确定。

建议后续顺序：纠正真实 Target → 联调同事的 Probe / all trace / ReAct / 标签数据格式 → 单 Case 真实验收 → 多种异构 Case 验收 → 批量、权重与 Agent 恢复验收。不能把框架完成运行当成各个能力维度已测准。

## 10. 证据和文档索引

路径均相对于 VM 项目目录：

- `var/reviews/observer-changes-only-20260912/verification.json`：Observer 阶段验证。
- `var/reviews/evaluation-refactor-20260912/verification.json`：Evaluation 阶段验证及样例。
- `var/reviews/setup-input-20260912/verification.json`：最后一轮完整测试、附件验证与题库审计汇总。
- `var/reviews/setup-input-20260912/migration-verification.json`：输入迁移字节对照。
- `var/reviews/setup-input-20260912/catalog-loader-audit.json`：实际 Catalog → Loader 审计。
- `var/reviews/setup-input-20260912/full-tests-final.log`：完整测试日志。
- `var/reviews/setup-input-20260912/baseline-data-tests.log`：修改前题库上的既有失败复现。
- `var/reviews/setup-input-20260912/smoke/`：最近受控全链路结果。
- `docs-simple/OBSERVER-CHANGES-20260912.md`：早期 Observer 阶段说明，含后来已被替换的旧证据格式。
- `docs-simple/EVALUATION-REFACTOR-20260912.md`：中间阶段说明，Setup / final.checks 段落已被后续输入改造替换。
- `docs-simple/CASE-INPUT-OUTPUT-20260912.md`：输入输出说明；其中 DSH 附件限制仅适用于已测试 Headless 接口，不能泛化至实际 Web 配置。

本文是今天的汇总交接。对当前状态有冲突时，以上述代码核查、最后一轮验证记录及本文明确列出的范围为准；同事的新协议交付后，应重新记录版本和联调结果。
