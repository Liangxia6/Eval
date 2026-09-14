# Case 输入交付与输出归档

更新：2026-09-12。实际修改、运行与检查均在 VMmac 的 /Users/dsheval/Projects/dsheval。

## 职责

- 环境由同事手动准备：应用安装、数据库和初始数据、账号等。运行流程不分发 Setup，也不增加环境就绪或 Case 要求 check。
- Loader 读取题目与公开输入，生成每题的输入清单和工作区输入副本。评分参考独立加载，只交给标签 Judge。
- DSH 接入层提交题目及聊天附件；提交回执进入统一报告的 execution.inputDelivery。
- Probe / Observer 继续采集实际运行记录和环境变化。工作区文件在观测基线前准备；附件存储在本次 Runtime Home，交付回执属于评测系统记录，不算 Agent 成果。
- Judge 使用同一份 all trace、标签标准、Case grading；不分发 final.checks，不新增评分前置门槛。
- output 文件在工作区清理前进入 ArtifactStore，再按原目录归档到结果包。数据库等非文件变化由 Observer 记录。

## 当前目录

```text
datasets/<dataset>/<case>/
├── question.json                 # 标签、输入交付声明、运行参数和评分参考位置
├── prompt.md                     # 实际提交的任务文本；缺失时使用 task.instructions
├── input/                        # 公开输入原件；Agent 不直接修改题库
└── private/final.json             # 本题评分参考

var/workspaces/<run>/<case>/<attempt>/
├── input/                        # 本次运行的只读输入副本
├── work/                         # 如题目允许，Agent 使用的中间目录
└── output/                       # Agent 的文件产物

var/evaluation-results/agents/<agent>/runs/<run>/cases/<case>/
├── output/                       # 可直接使用的交付物，保留子目录和文件名
├── report.json                   # 唯一的统一评价记录
├── report.html                   # 读取统一记录展示；链接 output 文件
└── attachments/                  # 证据原文件，沿用 ArtifactRef 路径
```

当前执行每个 Case 只有一次 attempt，结果包沿用既有 Case URL。运行工作区按 attempt 隔离；未来增加重试时，还需明确多次产物如何展示，不在本次虚设多个尝试。

## 输入声明

```json
{
  "inputs": [
    {
      "source": "input/data.json",
      "destination": "input/data.json",
      "delivery": "workspace"
    },
    {
      "source": "input/chart.png",
      "destination": "input/chart.png",
      "delivery": "chat-attachment"
    }
  ],
  "grading": {
    "reference": "private/final.json",
    "expectedOutputPath": "output/answer.txt"
  },
  "environment": {
    "platform": "portable",
    "timeoutSeconds": 900,
    "allowedEdits": ["output/**", "work/**"]
  }
}
```

delivery 缺省为 workspace。sha256 可选；提供时仍核对文件字节，未提供时也将实际字节摘要写入冻结的 Case。路径与字节校验是输入读取完整性约束，不是 Case 完成条件或评分门槛。

grading.expectedOutputPath 只是评分参考，不会触发“缺文件就阻止 Judge”的 check。原 question.evidence 也作为 evidenceGuidance 交给 Judge，保留同事编写的题目评分上下文。

## DSH 附件接入及限制

src/runtime/input-delivery.ts 为声明了聊天附件的 Case 写入附件清单及临时 Cordis 补丁。补丁禁用原 headless-runner，再插入 src/runtime/dsh-input-runner.ts；不修改被测 DSH 的核心、工具实现或安装目录。

适配器调用 DSH 原生 attachments.saveImages，随后通过 createUserMessage + agent.followup，将文本及原生 image attachment 引用提交到同一会话。SUBMITTED 表示消息已提交，不表示 Agent 完成题目或模型支持图片。

当前安装的 DSH 原生附件接口只支持 PNG、JPEG、WebP、GIF。PDF 等普通文件不能作为聊天附件提交；会记录 FAILED / DSH_ATTACHMENT_MEDIA_UNSUPPORTED，并作为输入交付错误处理。不会把 PDF 自动转成文本、图片或假装上传成功。PDF 若明确声明 workspace，仍可按普通文件交付；这与聊天附件是不同测试条件。

模型是否能处理图片，是被测 DSH 当前配置的能力，不由 Loader 替换模型解决。

## 迁移与代码入口

- src/datasets/loader.ts：公开输入、交付元数据、Case 评分参考。
- src/runtime/case-input.ts：将 Loader 的种子文件接到实际工作区。
- src/runtime/target.ts：选择附件启动补丁，读取提交回执，归类交付失败。
- src/runtime/dsh-input-runner.ts：调用 DSH 原生消息、附件及会话接口。
- src/app/workflow.ts：连接执行、采集、Judge 和输出收集。
- src/platform/case-bundle.ts：按 all trace 的交付物引用归档 output。
- src/reporting/html.ts：显示归档文件链接。
- scripts/migrate-case-inputs.mjs：一次性作者侧迁移；运行 Case 不调用它。
- scripts/migrate-question-bundles-latest.mjs：原迁移命令接入新迁移。
- scripts/convert-flat-datasets-to-question-bundles.mjs：旧数据导入工具生成新输入布局。
- scripts/validate-question-bundles.mjs：人工调用的题库格式检查工具，不接入运行时。

旧 none、copy-public-inputs、self-contained-dsheval-fixture 分支已删除；四道 shuffle-options 题沿用旧算法产生的固定顺序，将选项文本和字母映射固化后删除运行时分支。公开 final.checks 已转换为 grading 参考，private/final.json 内容保持原样。

## 实际审计

本次开始时，题库已经与先前“265 条输入引用”的版本不同。实际基线为 173 题、232 条输入引用。

- 229 个原有输入文件迁移后字节完全一致。
- 4 道选项题新增固定映射文件，当前合计 236 条输入引用。
- 没有发现迁移造成的字节不一致。
- 全部 43 个 Catalog 条目都能枚举到题目。
- 173 题中 171 题可以通过实际 Loader 加载。
- 2 题受 3 个迁移前已经缺失的输入文件影响：
  - replicationbench/replicationbench-find-galactic-vz-peaks/input/paper_masked.json
  - replicationbench/replicationbench-find-galactic-vz-peaks/input/dataset_info.json
  - skillsbench/skillsbench-model-investment-shock-gdp/input/test-supply.xlsx

未恢复同事已删除的文件，也未改写这些题的内容来掩盖缺失。

## 验证边界与留存

var/reviews/setup-input-20260912/ 保存：
- before.tgz：本次修改前的源码、测试及题库。
- migration-verification.json：逐字节迁移对照。
- dataset-audit.json：实际 Loader 的 173 题审计。
- native-dsh/result.json：真实 DSH 挂载新适配器、明确拒绝 PDF 聊天附件的回执。
- smoke/：完整流程的统一 JSON、HTML、all trace 和实际 output 文件。
- input-tests.log、check-final.log、full-tests-final.log：组件测试、类型检查及完整测试。
- baseline-data-tests.log：对修改前题库运行其原测试，区分已有数据不一致。

图片提交测试使用真实 DSH 附件存储和消息构造接口，Agent 行为由测试替身驱动。端到端 smoke 使用 Fake DSH 和显式 LLM Judge HTTP 测试响应，验证组件连接与归档，不代表真实模型对 DSH 能力的评分。真实 DSH 启动测试使用无效测试密钥，仅验证不支持的附件在模型请求前失败，不调用真实评分服务。

最终完整测试：134 项，128 项通过、6 项失败。6 项题库内容测试在修改前的题库备份上也能复现；不是本次接口变更引入。类型检查通过。本次新增的图片附件、真实 DSH 启动/PDF 拒绝、Loader 和 output 归档测试通过。
