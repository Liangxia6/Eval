# 项目组开发与数据互通约定

> 版本：0.1（团队讨论稿）  
> 更新：2026-09-12  
> 基线：VMmac 中 DSHEval 当前工作区实现；包含尚未提交的迭代。  
> 适用：项目组后续开发的 Agent、评测、数据集、环境工具、观测和结果展示项目。

## 1. 这份文档统一什么

我们希望不同项目能够组合使用：一个项目提供 Agent，另一个提供数据集或环境，DSHEval 负责组织评测，其他工具能够读取证据与结果。

优先统一三件事：

1. **名词和字段含义**：同一个名称表达同一个概念，避免依靠口头解释对接。
2. **项目边界上的数据**：输入、输出、状态、版本、文件引用和错误能够被对方识别。
3. **最少的协作信息**：别人能启动项目、调用接口、验证修改，并知道限制在哪里。

语言、内部类结构、数据库、Web 框架和内部目录由各项目自行选择。无需给所有函数套相同返回结构，也无需让所有项目复制 DSHEval 的目录。

本文使用两种标记：

- **现有**：DSHEval 当前代码已经采用的格式；接入它时按对应类型实现。
- **建议**：新项目默认采用的约定；需要接入 DSHEval 时仍需适配，不能直接假定已经被它支持。

本文是约定入口，不替代源码类型。发生冲突时先核对对应生产者和消费者的代码，再一起修正文档。

## 2. 先把业务概念统一

| 名称 | 统一含义 | 容易混淆的地方 |
|---|---|---|
| Agent / Target | Agent 是被评估的产品或系统；Target 是一次评测中配置好的被测对象 | 模型名称不足以描述 Agent；还涉及插件、工具、权限和配置 |
| Static Snapshot | 执行前观察到的版本、配置和能力入口 | 安装了某个插件，不代表已经测得对应能力 |
| Planner | 根据被测对象信息、数据集描述和评测策略选择测试内容 | 选题结果不是 Agent 能力评分 |
| Dataset | 一组题目及来源、描述等元数据 | 数据集存在，不代表它所需的环境已经可运行 |
| Case 定义 | 可复用的一道题，包括任务、公开输入和私有评分上下文 | 与“这道题本次执行的实例”分开 |
| Run | 一次评测任务；可以包含多个 Case 执行实例 | 不是一个 DSH Session |
| Attempt | 某个 Case 执行实例的一次尝试 | 重试产生新的尝试，不能覆盖旧证据 |
| Session | Agent 实际使用的会话 | 不同产品的会话结构可能不同，由适配层关联 |
| Label | 一个评分维度及其评分标准、Judge 配置 | 不是静态观测给 Agent 贴的能力结论 |
| Probe / Agent Trace | 从 Agent 内部采集的事件或日志 | 记录的是 Agent 一侧的信息 |
| Observer | 从外部环境观察文件、进程、应用等状态与变化 | 不直接相信 Agent 声称的成功 |
| All Trace | 一次尝试的三层证据及采集状态、附件索引 | “all”不保证全知；遗漏、截断仍需记录 |
| Artifact | 被保存的文件、回答或其他产物 | 文件存在和内容正确是两个结论 |
| Judge / Score | Judge 依据评分标准和证据产生的评价 | 执行成功、证据完整、评分高低不能混成一个状态 |

**适性评价的共同理解：** 不同 Agent 可以分配不同评测集，但共享维度定义和结果表达。比较两个 Agent 时，需要同时看到各自测了什么、题目难度或类型、覆盖量和评分规则版本。不同选题上的平均分，不能直接当作公平的统一排名。

## 3. 字段、类型和编码

### 3.1 新接口默认写法

| 项目 | 建议 | 示例 |
|---|---|---|
| JSON 字段 | camelCase | `targetId`、`createdAt`、`mediaType` |
| TypeScript 类型 | PascalCase | `JudgeInput`、`LabelScore` |
| 普通源码文件 | kebab-case；框架固定文件名除外 | `input-delivery.ts` |
| 状态枚举 | 明确的字符串；新接口默认 UPPER_SNAKE_CASE | `SCORED`、`UNASSESSABLE` |
| 时间点 | UTC ISO 8601；展示层再转时区 | `2026-09-12T08:30:00.000Z` |
| 时长、大小 | 字段名带单位 | `durationMs`、`byteLength` |
| 文本文件 | UTF-8、LF、文件末尾换行 | JSON、Markdown、源码 |
| 结构化交换 | JSON；事件流可采用 JSONL | 不让消费者解析自然语言日志或 HTML |

Python 内部可以继续使用 snake_case；序列化到共享接口时映射。上游数据、第三方协议和已经发布的接口保留原格式。

**现有例外需要保留：** Planner 部分输入输出使用 `target_type`、`selected_datasets`、`case_count`；标签评分配置使用 `scoring_scale`；输入交付方式是 `workspace` / `chat-attachment`。这些不能为“统一风格”直接改名。

### 3.2 空值、时间和精度

- 字段未提供通常表示“不适用或尚未产生”；显式 `null` 的含义由该接口说明。
- 当前 `LabelScore.score = null` 表示没有数值评分；`0` 是一个真实评分。不要互相替换。
- 列表为空表示列表没有成员，不自动代表采集完整或功能不支持。
- JSON 数字使用有限值，不能输出 NaN、Infinity；超过安全整数范围的值应另行约定字符串表示。
- 当前题库的 `timeoutSeconds` 进入运行配置时转换为 `deadlineMs`，不能原值直接拷贝。
- 事件同时涉及源时间与采集时间时，保留两者。DSHEval 已有 `SourceTime`，包含 `observedAt`、`clockDomain` 及可选的 `wallTime`、`monotonicNs`、`sourceSeq`。不同进程的单调时钟不能直接互相比较。

UTC 格式是团队建议；当前部分校验仅检查时间能否解析，不应描述为代码已强制 UTC。

## 4. 标识、归属与版本

### 4.1 ID 不承担所有信息

| 字段或类型 | 现有含义与示例 |
|---|---|
| `targetId` | 被测对象 ID |
| `targetSnapshotId` | 本次使用的被测对象快照 ID |
| `runId` | 一次评测任务 ID |
| `scope.caseId` | 本次 Run 中的题目执行实例 ID |
| `attemptId` | 一次执行尝试 ID |
| `sessionId` | 被关联的运行会话 ID，可选 |
| `labelId` | 评分维度资产 ID，如 `label.tool-code/v1` |
| `datasetId` | 数据集资产 ID，如 `dataset.agentbench-os/v1` |
| `traceId` / `scoreId` / `artifactId` | 对应证据集合、评分记录、产物记录的 ID |

当前 `ScopeRef` 以 `targetId` 为必填字段，其他归属字段按对象所在阶段提供。子对象沿用所属执行链的 ID，不能分别生成一套同名但无关的 ID。

现有运行 ID 使用 `StableId`：1–128 个字符，首位为字母或数字，其余允许字母、数字、点、下划线、连字符。资产 ID 可以带 `/v1` 等版本后缀，不要混用这两类校验。

**当前需要特别注意的同名字段：**

- 原始 `question.json.id` 标识题目，例如 `agentbench-os.agentbench-os-calc`。
- Loader 产出的 `DatasetCase.caseId` 是题目定义 ID，例如 `scenario.agentbench-os.agentbench-os-calc/v1`。
- `ScopeRef.caseId` 是运行实例 ID，不能直接填入上述带斜杠的定义 ID。
- `targetId` 与部分目录或组件里的 `agentId` 不能无条件视为相同字段。

**建议：** 新项目涉及题目定义和执行实例时，显式区分 `sourceCaseId` 与 `caseId`，由适配层维护映射。这是新接口建议，不是要求修改当前 DSHEval 的字段。

ID 对消费者应尽量作为完整字符串使用；不要靠拆文件名或 ID 前缀恢复业务关系。关系应由字段和引用表达。

### 4.2 三种版本不要混为一谈

| 字段 | 表达什么 |
|---|---|
| `schema` | 数据结构的协议版本，例如 `dsheval.label/v2` |
| `version` | 题目或标签等资产自身的版本 |
| `producerVersion` | 生成记录的软件版本 |
| `contentDigest` | 此次实际内容的摘要，用于确认是否为同一份内容 |

例如，当前标签结构为 `dsheval.label/v2`，其中的资产 ID 仍可为 `label.tool-code/v1`。两者不需要同步递增。

**建议：** 新项目使用自己的 schema 命名空间，如 `project-name.record/v1`。DSHEval 的部分现有通用校验器只接受特定 `dsheval.*` 的 v1 格式；新命名空间或 v2 需要专用解析器或显式转换，不能直接套用该校验器。

### 4.3 摘要和文件引用

现有 `ContentDigest` 包含 `algorithm: "sha256"`、`value`、`byteLength`。摘要值为 64 位小写十六进制。

- 文件摘要针对实际字节；JSON 对象摘要使用约定的规范化序列化。
- 对接 DSHEval 对象时复用对应构造与校验函数，不用普通 `JSON.stringify` 随手计算替代。
- 对象的 `contentDigest` 和文件内容的 `artifactContentDigest` 含义不同。
- 含摘要字段的对象如何排除自身字段，以该记录的实现为准；不要自行推断。

当前 `Ref<T>` 包含 `schema`、`id`、`digest` 和可选 `revision`。注意 `ArtifactRef` 本身是产物元数据记录，`Ref<ArtifactRef>` 才是指向该记录的引用。

普通内部临时对象无需全部加摘要；跨项目保存、复用和评价的内容优先使用版本与摘要，便于追溯。

## 5. 模块之间交换什么

以下是 DSHEval 的业务边界，其他项目按实际职责接入其中一段即可。

| 边界 | 提供的数据 | 消费者关注的内容 |
|---|---|---|
| Agent → 静态观测 / Planner | 版本、插件、工具、配置、权限等可见信息 | 有哪些可用入口，以及观测限制 |
| Planner → 执行 | 选中的 Dataset、题量和相关计划记录 | 实际要执行哪些题；选择原因可追溯 |
| Dataset → 执行 / Judge | 任务、公开输入、标签、私有评分上下文 | Agent 能看什么，Judge 用什么判分 |
| Agent 接入 → 执行 | 启动、输入交付、结束信息、会话关联 | 请求是否真的提交、执行是否结束 |
| Probe / Observer / 产物采集 → All Trace | 原始事件、环境观测、回答和文件 | 来源、作用域、采集状态和原始内容 |
| Label + Case + All Trace → Judge | 评分标准、题目上下文、同一份三层证据 | 每个维度给出评价并引用证据 |
| 评分 / 执行记录 → 报告 | 分数、原因、状态、覆盖情况和引用 | 可展示、可比较、可追溯 |

“最小 Probe 接入”是减少 Agent 侧接入工作的方向。它不自动解决 Agent 的输入交付、数据集所需环境、上游评分器等适配问题。当前 DSH 接入已经存在；Pi、LangGraph 等通用接入能力不应在文档中宣称已经完成。

### 5.1 Dataset：统一入口，保留题目差异

当前题目目录：

```text
datasets/<dataset>/<case>/
├── question.json       # 任务、输入声明、来源、环境描述、标签等
├── prompt.md           # 可选；存在时作为实际任务文本
├── input/              # 公开输入，可交付给 Agent
└── private/
    └── final.json      # 私有评分上下文；还可以有参考文件或上游检查材料
```

Loader 产出的 `DatasetCase` 包含：

| 字段 | 含义 |
|---|---|
| `version`、`caseId`、`contentDigest` | 题目定义的身份与内容版本 |
| `task`、`deadlineMs` | 实际交付的任务文本与时限 |
| `inputs` | 输入文件声明 |
| `seedEntries`、`allowedPaths` | 工作区准备与允许修改范围 |
| `labelIds` | 该题对应的评分维度 |
| `grading` | 私有评分上下文，保留原始结构 |
| `question` | 原始题目对象，保留来源和其他描述 |

每个输入包含 `source`、`destination`、`delivery`、`mediaType`、`sha256`。当前 source 相对于题目目录，destination 相对于执行工作区，两者都位于 `input/` 下。

新题优先复用这套入口。原始数据库状态、网页任务、文档、测试程序等继续按各自语义保存，不强行变成同一种答案 JSON。对现有 Loader 无法表达的新类型，在适配层增加支持并说明限制，避免修改所有旧题。

环境描述不等于环境就绪：当前运行环境由人工准备，题目中的依赖与 `upstreamConstraints` 不能被理解为运行器已执行这些配置。尤其不能因为 `platform: "portable"` 被接受，就声称原始 Linux 等基准环境要求已满足。

原始 Benchmark 指标与 DSHEval 的标签评分需要分别说明。LLM Judge 的评价不能冒充“原生检查器通过”。

### 5.2 All Trace：三层共用，保留来源

现有 schema 为 `dsheval.all-trace/v1`：

| 字段 | 含义 |
|---|---|
| `traceId`、`scope` | 证据集合 ID 和所属执行 |
| `createdAt`、`producerVersion`、`contentDigest` | 生成时间、软件版本、内容摘要 |
| `entries` | 三层证据条目 |
| `sources` | 采集来源描述 |
| `coverage` | 各来源的采集状态 |
| `artifacts` | 相关产物元数据 |
| `integrity` | 完整性问题记录；不直接代替评分 |

`TraceEntry` 的字段是 `id`、`layer`、可选 `sourceId`、可选 `observation`、`content`；`layer` 取值如下：

| layer | 放什么 | 解释边界 |
|---|---|---|
| `AGENT` | Agent 内部事件、工具调用与结果等 | Agent 声称成功不等于外部效果已发生 |
| `ENVIRONMENT` | 文件、进程、浏览器、数据库等外部观测 | 同时发生的变化不自动证明由该 Agent 导致 |
| `DELIVERY` | 最终回答、交付文件及内容 | 交付存在不等于交付正确 |

保留异构原始内容，统一来源和关联方式；不要为了统一而丢弃工具参数、返回正文、错误信息或环境状态。截断和访问限制应保留对应标记；缺少某类采集不能用“没有发生”补齐。

当前所有 Label Judge 读取同一份 All Trace，不先通过旧 EvidenceContract / Closure 做证据筛选。未来改为证据目录加逐步获取时，需要定义查询、访问记录和引用规则；本文不把该方案当作现有接口。

### 5.3 Label 与 Judge：统一评价输入输出

现有标签定义使用 `dsheval.label/v2`，主要包含：

- `labelId`、`title`、`version`、`contentDigest`；
- `scoringStandard`：评分标准，包含 `scoring_scale`；
- `judge.modelRole` 与 `judge.instructions`：Judge 配置。

不同标签可以使用不同评分尺度；不能把某个标签的 0–4 分当作全项目固定尺度。

当前真实调用接口：

```typescript
interface JudgeInput {
  readonly label: LabelDefinition;
  readonly case: DatasetCase;
  readonly allTrace: AllTrace;
}

interface LabelJudge {
  evaluate(input: JudgeInput): Promise<LabelScore>;
}
```

当前 `LabelScore` 使用 `dsheval.label-score/v1`：

| 字段组 | 字段 |
|---|---|
| 身份与归属 | `scoreId`、`scope`、`labelId` |
| 此次评分依据 | `labelDigest`、`caseDigest`、`allTraceDigest` |
| 评价 | `status`、`score`、`scale.min`、`scale.max`、`reason` |
| 证据引用 | `evidenceIds`，指向本份 All Trace 中存在的条目 |
| 来源与版本 | `model`、`createdAt`、`producerVersion`、`contentDigest` |

每次执行用到的题目、标签标准与证据内容应固定下来。评分后改了标准，应产生可以区分的新评价，不能覆盖旧分数却沿用旧摘要。

汇总维度时同时保留 `scoredCases`、`unassessableCases`、`errorCases`。不同标签版本、评分尺度或题目覆盖的结果，应明确区分后再决定如何比较。

## 6. 状态和错误：分清是哪一层的问题

| 层次 | 现有状态例子 | 含义 |
|---|---|---|
| 输入交付 | `SUBMITTED` / `FAILED` | 输入有没有提交到 Agent 接口 |
| Observer 变化 | `CHANGED` / `UNCHANGED` / `UNKNOWN` | 观测窗口内的变化结论 |
| Observer 运行 | `COMPLETE` / `PARTIAL` / `UNAVAILABLE` / `NOT_CONFIGURED` / `IDLE` | 该观测源是否正常采集；具体值由组件协议定义 |
| 整体运行健康 | `HEALTHY` / `DEGRADED` / `FAILED` | 评测基础设施的工作状态 |
| 标签评价 | `SCORED` / `UNASSESSABLE` / `ERROR` | 有评分、无法判断、Judge 出错 |

标签状态与分数的约定：

- `SCORED`：有合法数值；0 分表示按标准得了 0 分。
- `UNASSESSABLE`：现有上下文不足以作出评价，`score = null`。
- `ERROR`：Judge 调用、解析或验证等发生错误，`score = null`。

外部观测 `UNCHANGED` 不表示 Agent 没有执行；它可能没有造成变化，也可能变化未被该采样方式捕捉。执行进程退出码为 0，也不自动表示题目通过。

错误优先提供稳定的 `reasonCode` 和可读说明，再提供归属与必要诊断引用。消费者按错误码处理，不解析中文或英文报错文本。

DSHEval 现有 `FailureDraft` 使用 `messageRedacted`，并记录 `scope`、`origin`、`phase`、`severity`、`occurredAt` 等；部分核心端口使用 `PortResult<T>`。直接接入这些端口时遵循它们的类型，其他项目无需给所有内部函数复制这套包装。

## 7. 文件、结果与权限边界

### 7.1 路径必须说明相对于哪里

交换文件默认使用 POSIX 相对路径，例如 `input/data.csv`、`output/answer.json`。不要把某台机器的绝对目录写成共享数据的唯一定位方式。

| 路径 | 根目录 |
|---|---|
| 题目输入 `source` | Dataset 中对应 Case 的目录 |
| 输入 `destination` | 本次执行工作区 |
| Artifact 的 `portablePath` | 对应 Artifact Store 或导出包约定的根目录 |

普通 `portablePath` 不包含父目录跳转、反斜杠或通配符。`allowedPaths` 中的 `output/**` 属于修改范围规则，不是普通文件路径。

大文件通过产物引用传递；是否内嵌文本、JSON 或 BASE64 由接口声明。文件内容截断时必须保留标记，不能把预览当作完整内容。

### 7.2 结果消费者读取结构化记录

DSHEval 当前工作区与评测产物通常组织为：

```text
var/
├── workspaces/<run>/<case>/<attempt>/
│   ├── input/             # 公开输入
│   ├── work/              # 执行工作目录
│   └── output/            # Agent 交付
└── evaluation-results/agents/<agent>/runs/<run>/cases/<case>/
    ├── report.json        # 结构化 Case 结果
    ├── report.html        # 展示视图
    ├── output/            # 导出的交付内容
    └── attachments/       # 相关附件
```

其他项目通过 `report.json` 等明确的结构化入口消费结果，不解析 HTML，也不依赖文件名猜测状态。当前 Case 报告 schema 为 `dsheval.result/v1`，含执行、证据、评分、维度、失败和产物等信息。读取可选字段时要容纳对应阶段尚未产生数据的情况。

上述目录是当前 DSHEval 的约定；其他项目可以不同，但应提供明确的结果入口和路径根说明。

### 7.3 公开输入和私有评价材料分开

Agent 接收任务、公开输入与允许使用的环境信息。参考答案、私有检查和 Judge 上下文属于评测侧材料，不能为方便接入一并放进公开输入包。

产物已有 `sensitivity` 与 `redactionState`。导出或展示时遵守对应范围，不直接把完整私有 Case 对象发布到前端。

目录叫 `private/` 只表达用途，不等于系统已经实现访问隔离；接入项目需说明实际访问边界。密钥通过环境变量或本机配置注入，示例配置仅保留变量名，不提交真实凭据或带凭据的日志。

## 8. 轻量开发与协作方式

### 8.1 每个项目提供一个能用的入口

建议 README 至少写清以下内容，短项目几段文字即可：

- 项目解决什么问题，由谁维护，当前可用范围；
- 如何安装、配置、启动，以及一条最小调用示例；
- 对外输入、输出的类型或 schema 链接；
- 如何运行必要检查，结果保存在哪里；
- 尚未支持的能力，以及如何与 DSHEval 对接。

源码、文档、测试、配置示例和运行产物应容易区分。运行产物、依赖目录和构建输出通常不提交 Git；少量稳定的测试样例可以提交到测试目录。

DSHEval 当前采用 Node.js 22+、TypeScript、ESM 和 pnpm；其他项目可使用不同技术栈，只需声明并固定自己的依赖版本。无需统一所有项目的语言和包管理器版本。

### 8.2 测试重点放在边界

| 变更 | 优先验证 |
|---|---|
| 字段或序列化变更 | 一份真实样例能否被生产者写出、消费者读入 |
| Dataset / 输入适配 | 任务和文件交付正确；私有材料未混入公开输入 |
| Probe / Observer | 来源关联正确；采集失败、截断和无变化能区分 |
| Judge | 评分范围、空值语义、证据引用与错误状态正确 |
| 报告展示 | 数值、状态、缺失信息和附件链接没有误导 |
| 多模块联动 | 一条有代表性的端到端流程 |

单元测试验证局部逻辑，集成测试验证模块接口，E2E 验证从入口到结果的真实链路。使用 Mock、回放或真实 Agent 时注明测试模式，不能把回放通过写成真实评测成功。

DSHEval 当前检查命令为 `pnpm check`、`pnpm test`、`pnpm verify`，应在 VM 项目目录运行。其他项目在 README 提供等价命令即可。纯文档修改检查内容与链接；无需为低影响修改额外堆测试。

### 8.3 一次修改让协作者看得懂

- 尽量围绕一个明确目的修改；不要顺手批量格式化或重命名无关文件。
- 修改共享字段时，把生产者、消费者、样例和文档一起检查。
- 提交或 PR 说明：解决了什么、接口是否变化、如何验证、还有哪些限制。
- 共享工作区中保留他人未提交内容；必要时使用独立分支或工作树。
- 不用“测试通过”掩盖部分失败：区分本次检查、未检查项和已有问题。

环境重置粒度、并行执行、锁和重试策略由项目实际需要决定，并写入运行说明。它们不作为全团队固定架构；需要共享外部状态的项目应明确并发与污染边界。

## 9. 接口如何演进

新增字段先检查消费者是否拒绝未知字段；“新增可选字段”也不一定天然兼容。改字段含义、单位、枚举或评分尺度时，按协议或资产版本显式演进。

轻量做法：

1. 对外接口有一个明确维护入口：类型文件、JSON Schema 或协议文档，选合适的一种即可。
2. 提供至少一份输入输出样例和兼容性说明。
3. 发生不兼容变化时说明迁移方式；必要时由适配器短期兼容旧版本。
4. 多个项目稳定复用同一协议后，再考虑提取共享包，避免一开始建设庞大的通用框架。

**当前不要再推广的旧设计：** Pack、EvidenceContract、Metric/Check 评分链、Closure、Gate 和旧评分报告结构已被本轮评分链路替换。旧文档里的这类字段不能直接作为新项目规范。

**当前仍应保留的现实边界：** 部分核心记录仍使用 `dsheval.mvp.*` schema；Loader 对平台和输入交付类型有具体限制；渐进式证据获取及跨 Agent 通用适配尚需继续开发。新项目对接时按当前接口实现，不把规划能力写成已支持能力。

## 10. 新项目接入说明模板

无需额外审批流程，把下面的信息补到项目 README 或单独一页文档即可。

```text
项目名称与维护人：
解决的问题 / 对外提供的能力：
当前支持与不支持的范围：

输入：
  入口、字段/类型、文件根目录、最小样例
输出：
  结果入口、字段/类型、状态、文件引用、最小样例
关联：
  如何关联 target / run / case / attempt；哪些不适用
版本：
  schema、软件版本、资产版本与兼容范围

与 DSHEval 的连接位置：
  Agent / Dataset / Environment / Observer / Judge / Report 等
适配工作：
  复用哪些现有接口，哪些字段需要转换，保留哪些原始数据

运行与验证：
  启动命令、配置方式、测试命令、一次最小联调步骤
已知限制：
  环境依赖、采集盲区、访问边界、未完成能力
```

## 11. DSHEval 实现入口

下列路径均相对于本文件所在的 `docs-simple/` 目录：

| 内容 | 当前入口 |
|---|---|
| 基础类型、作用域、摘要、文件引用 | [core/models.ts](../src/core/models.ts) |
| Dataset 加载与输入声明 | [datasets/loader.ts](../src/datasets/loader.ts) |
| 输入交付 | [runtime/input-delivery.ts](../src/runtime/input-delivery.ts) |
| Agent Trace 读取 | [agent-trace/reader.ts](../src/agent-trace/reader.ts) |
| 外部观测接入 | [observation/collection.ts](../src/observation/collection.ts) |
| All Trace 类型 | [all-trace/types.ts](../src/all-trace/types.ts) |
| 标签定义 | [labels/catalog.ts](../src/labels/catalog.ts) |
| Judge 输入与评分结果 | [evaluation/types.ts](../src/evaluation/types.ts) |
| Judge 实现 | [evaluation/llm-label-judge.ts](../src/evaluation/llm-label-judge.ts) |
| 结构化报告 | [reporting/types.ts](../src/reporting/types.ts) |
| 最新输入输出调整 | [CASE-INPUT-OUTPUT-20260912.md](CASE-INPUT-OUTPUT-20260912.md) |
| 评分链路调整背景 | [EVALUATION-REFACTOR-20260912.md](EVALUATION-REFACTOR-20260912.md) |

后续维护重点是共享字段及其含义、接口样例和兼容性变化；阶段性题量、插件数量、某次运行路径等不作为长期开发约定。
