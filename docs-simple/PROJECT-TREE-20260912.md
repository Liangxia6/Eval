> 2026-09-12 Evaluation 已重构；详细输入输出见 [重构说明](EVALUATION-REFACTOR-20260912.md)。

# DSHEval 当前项目文件夹结构

- 整理日期：2026-09-12
- 项目位置（VM）：`/Users/dsheval/Projects/dsheval`
- 本文记录当前结构，不是重构后的建议结构。
- 源码展开到文件；数据集、依赖和生成产物折叠展示，`…` 表示省略同类内容。
- 数据集与文件数量反映本次检查时的状态，后续可能变化。

## 文件树与注释

```text
dsheval/
├── README.md                         # 项目入口说明
├── package.json                      # 依赖、构建、测试、运行命令
├── pnpm-lock.yaml                    # 依赖版本锁定
├── tsconfig.json                     # TypeScript 编译配置
├── .editorconfig                     # 编辑格式约定
├── .gitignore                        # Git 忽略规则
├── .git/                             # 版本历史
├── .github/
│   └── workflows/ci.yml               # CI 自动检查
│
├── config/                           # 评测系统及被测 DSH 的配置
│   ├── macos-vm.json                  # VM 路径、运行限制、隔离等配置
│   └── targets/
│       ├── real-dsh.json              # 真实 DSH 的位置、启动方式、Profile
│       └── fixture-dsh.json           # 自动化测试使用的模拟 DSH
│
├── planning/                         # Planner 的配置资产，不是实现代码
│   ├── policies.json                 # 选题数量、预算等规划约束
│   └── prompts/
│       └── standard.json             # Planner 提示词
│
├── labels/                           # 评分维度定义：证据要求、Judge 提示词、评分规则
│   ├── artifact.delivery.json        # 产物交付
│   ├── collaboration.json            # 协作
│   ├── efficiency.reliability.json   # 效率与可靠性
│   ├── loop.json                     # 执行循环
│   ├── memory.json                   # 记忆
│   ├── multimodal.json               # 多模态
│   ├── reasoning.planning.json       # 推理与规划
│   ├── retrieval.json                # 检索
│   ├── safety.boundary.json          # 安全边界
│   ├── tool.code.json                # 代码与终端工具
│   ├── tool.data.json                # 数据工具
│   ├── tool.document.json            # 文档工具
│   ├── tool.external.json            # 外部工具
│   └── tool.web.json                 # Web 工具
│
├── datasets/                         # 被测 Agent 要完成的题目，当前 43 个目录、173 题
│   ├── catalog.md                    # 数据集目录说明
│   ├── agentbench-os/
│   │   └── agentbench-os-calc/        # 一个实际题目
│   │       ├── question.json         # 题目定义及关联配置
│   │       └── private/
│   │           ├── Dockerfile        # 题目原生环境定义
│   │           ├── environment.json  # 环境要求
│   │           ├── check.sh          # 校验脚本
│   │           └── final.json        # 终局评价配置
│   ├── algotune/
│   │   └── algotune-optimize-lti-sim/ # 另一种实际题目结构
│   │       ├── question.json
│   │       ├── prompt.md             # 独立的任务提示词
│   │       ├── input/problems.json  # 题目附带的数据
│   │       └── private/final.json
│   ├── appworld/
│   ├── gaia/
│   ├── osworld/
│   ├── spreadsheetbench/
│   ├── webarena/
│   └── …                             # 其他数据集；内部结构不完全一致
│
├── environments/                     # 评测环境的声明配置
│   └── macos.json                    # 工作区、环境及观测源配置
│
├── trace/                            # Trace 采集规则配置，不存放某次运行的 Trace
│   └── dsh-runtime.json              # 运行时证据要求、完整性规则、读取容量限制
│
├── observer-lab/                      # 十类外部环境 Observer 并列组织
│   ├── README.md
│   ├── config/macos-worker.json       # 观测组件具体配置
│   ├── bin/observer-smoke.mjs         # 独立调试入口
│   ├── lib/
│   │   ├── core.mjs                  # 变化比较及共享工具
│   │   └── watch.mjs                 # 统一轮询、最终采集和覆盖状态
│   ├── tests/watch.test.mjs          # 变化及错误状态回归测试
│   └── adapters/
│       ├── index.mjs                 # 十类独立入口的导出
│       ├── filesystem/
│       │   ├── sensor.ts             # 正式文件采集
│       │   ├── index.mjs             # 独立入口；正式 watch 复用 sensor.ts
│       │   └── binding.ts            # 正式流程接入、阶段快照处理
│       ├── process/
│       │   ├── sensor.ts             # 正式进程采集
│       │   ├── index.mjs             # 独立入口；正式 watch 复用 sensor.ts
│       │   ├── binding.ts            # 正式流程接入
│       │   └── records.ts            # 进程专属记录转换
│       ├── application/index.mjs     # 应用
│       ├── browser/index.mjs         # 浏览器
│       ├── clipboard/index.mjs       # 剪贴板
│       ├── database/index.mjs        # 数据库
│       ├── desktop/index.mjs         # 桌面
│       ├── external-api/index.mjs    # 外部 API
│       ├── network/index.mjs         # 网络
│       └── system/index.mjs          # 系统
│
├── src/                              # DSHEval 主程序源码
│   ├── app/                          # 入口与整体流程编排
│   │   ├── cli.ts                    # inspect、plan、run、report 命令入口
│   │   ├── viewer-cli.ts             # 报告浏览服务命令入口
│   │   ├── bootstrap.ts              # 加载配置、组装各模块服务
│   │   ├── batch.ts                  # Parent Run：规划、展开 Case、调度单题流程
│   │   └── workflow.ts               # 单题完整流程，串起执行、观测、评分和报告
│   │
│   ├── core/                         # 模块之间共享的基础定义
│   │   ├── contracts.ts              # 接口契约
│   │   ├── models.ts                 # 数据模型、状态、标识等
│   │   └── errors.ts                 # 错误类型和错误码
│   │
│   ├── planning/                     # 静态观测与 Planner 实现
│   │   ├── target.ts                 # 冻结被测 DSH，检查插件、工具等静态信息
│   │   ├── agent-static.ts           # 整理供 Planner 使用的 Agent 静态信息
│   │   └── planner.ts                # 调用模型选题，检查预算和规划结果
│   │
│   ├── datasets/                     # 数据集读取与适配
│   │   ├── catalog.ts                # 读取数据集描述和目录信息
│   │   └── loader.ts                 # 加载题目、公开输入和题目评分参考
│   │
│   ├── runtime/                      # 被测 DSH 的执行
│   │   ├── environment.ts            # 准备 Workspace、运行目录、目标副本及清理恢复
│   │   ├── case-input.ts             # Case + Trace/Environment → 执行输入
│   │   ├── source-requirement.ts      # 校验采集配置
│   │   ├── evaluation-plan-compiler.ts # 冻结执行、Trace 和环境观测计划
│   │   ├── runner.ts                 # 管理 Run、Case、Attempt、环境的状态转换
│   │   ├── target.ts                 # 实际启动、超时控制、停止 DSH 进程
│   │   └── dsh-session-trace.ts       # 将 DSH Session 存档转换成兼容 Trace
│   │
│   ├── agent-trace/                  # DSH 内部运行轨迹采集与转换
│   │   ├── reader.ts                 # Probe 读取、解析及完整性检查
│   │   ├── native-probe-adapter.ts    # 原生事件、日志转换及完整性检查
│   │   └── native-probe/             # 接入 DSH 的原生探针子包
│   │       ├── package.json
│   │       ├── tsconfig.json
│   │       ├── config/cordis.patch.yml # 探针加载配置
│   │       ├── src/
│   │       │   ├── introspect.ts     # 查看插件、服务等运行时信息
│   │       │   ├── probe.ts          # 安装采集钩子，捕获事件
│   │       │   ├── snapshot.ts       # 运行时对象快照
│   │       │   ├── types.ts          # 探针数据类型
│   │       │   └── writer.ts         # 写入事件、日志、序号及哈希链
│   │       └── lib/                  # 探针编译输出
│   │
│   ├── observation/                  # 外部观测协调与汇集
│   │   ├── coordinator.ts            # 观测会话及生命周期记录
│   │   └── collection.ts             # 启停组件，汇集变化证据和采集状态
│   │
│   ├── labels/
│   │   └── catalog.ts                # labels/ 唯一加载入口，保存冻结评分标准
│   ├── all-trace/
│   │   ├── types.ts                  # 三层真实证据和来源、覆盖状态
│   │   └── assemble.ts               # 统一证据装配，不做标签过滤
│   ├── evaluation/
│   │   ├── types.ts                  # Judge 输入、数值评分与维度汇总类型
│   │   ├── llm-label-judge.ts         # label 标准 + Case 参考 + all trace → 分数
│   │   └── scoring.ts                # 按标签汇总数值和评分覆盖数量
│   ├── reporting/
│   │   ├── types.ts                  # 统一结果记录类型
│   │   ├── record.ts                 # JSON 记录、摘要与读取校验
│   │   ├── html.ts                   # Case 展示，不计算评价
│   │   └── batch-html.ts             # Parent Run 展示
│   │
│   ├── storage/                      # 数据持久化
│   │   ├── artifacts.ts              # 产物保存、摘要计算和读取
│   │   └── repositories.ts           # 各类记录保存及状态版本管理
│   │
│   └── platform/                     # 运行基础设施及结果交付
│       ├── config.ts                 # 运行配置解析与校验
│       ├── security.ts               # 运行前检查、隔离与权限
│       ├── services.ts               # 运行租约及服务健康检查
│       ├── case-bundle.ts            # 汇集单题结果目录，包括证据和报告
│       ├── export.ts                 # 报告文件写入、读取和导出
│       └── viewer.ts                 # 本地只读报告浏览服务
│
├── tests/                            # 测试 DSHEval 自身，不是被测 Agent 的题库
│   ├── unit/                         # Loader、Planner、证据、Judge、报告等模块测试
│   ├── integration/                  # 运行、安全、存储、浏览服务之间的集成测试
│   ├── e2e/
│   │   └── workflow.test.ts          # 使用模拟 DSH 检查完整流程
│   └── fixtures/                     # 测试用固定输入
│       ├── agents/fake-dsh/          # 模拟 DSH 程序及 Profile 配置
│       └── datasets/attention-pytorch-v1.json # 测试用旧式 Evaluation Pack
│
├── scripts/                          # 数据资产维护脚本
│   ├── import-dataset-handoff.mjs     # 导入、转换数据集
│
├── docs-simple/                      # 项目说明、设计与检查记录
│   ├── README.md                     # 文档入口
│   ├── ARCHITECTURE.md               # 架构说明
│   ├── CODE_GUIDE.md                 # 代码导读
│   ├── CONTRACTS.md                  # 接口契约说明
│   ├── TESTING.md                    # 测试说明
│   ├── AGENT_DATASETS.md             # 数据集说明
│   ├── DATASET_EXAMPLE.md            # 数据集示例
│   ├── DECISIONS-20260911.md          # 设计决策记录
│   ├── REVIEW-20260911.md            # 项目检查记录
│   ├── ALL-TRACE-JUDGE-WALKTHROUGH-20260911.md # 实际证据与 Judge 输入讲解
│   ├── OBSERVER-CHANGES-20260912.md   # Observer 流程与验证说明
│   ├── PROJECT-TREE-20260912.md       # 本文
│   └── assets/                       # 架构图等文档图片
│
├── var/                              # 实际运行数据，包含需要保留的结果与原始证据
│   ├── artifacts/                    # 原始及中间产物
│   ├── records/                      # 运行、规划、观测、证据等结构化记录
│   ├── batch-runtime/                # 批次及各 Case 的运行目录
│   ├── runtime-homes/                # DSH 运行时 HOME
│   ├── workspaces/                   # 被测 Agent 实际操作的工作区
│   ├── evaluation-results/           # 按 Agent / Run / Case 整理的最终结果
│   ├── reports/                      # 中间或旧路径下的报告
│   └── reviews/                      # 排查记录、原始证据备份、清理备份
│
├── dist/                             # 主项目及测试的编译输出
├── node_modules/                     # 安装的依赖
├── .codex-build/                      # 架构图、PPT 生成脚本及预览等工作文件
└── .codex-finalizer/                  # 架构 PPT 候选文件及校验结果
```

## 五个业务模块与当前目录的对应关系

| 关注的模块 | 当前主要位置 |
|---|---|
| 静态观测和 Planner | `src/planning/`、`planning/`、`config/targets/` |
| 跑测试和获取 all trace | `src/app/`、`src/runtime/`、`src/agent-trace/`、`src/observation/`，以及 `src/all-trace/assemble.ts`、`src/platform/case-bundle.ts` |
| 标签和 Judge | `labels/`、`src/evaluation/` |
| 数据集 | `datasets/`、`src/datasets/`、数据集导入脚本 |
| 环境组件和 Observer | `environments/`、`observer-lab/`、`src/observation/`、`src/runtime/environment.ts` |

这些业务模块目前没有与文件夹一一对应。例如，执行与证据采集分散在多个目录，环境观测也同时服务于执行和证据整理。

## 当前容易混淆的地方

1. **同名目录分别存配置和代码。** 例如根目录 `planning/` 存配置，`src/planning/` 存实现。
2. **all trace 没有独立、集中的模块目录。** 采集、转换、证据整理、结果打包分散在多个目录；根目录 `trace/` 只存配置。
3. **评分模块已拆分。** 题目加载位于 datasets/，统一证据位于 all-trace/，标签标准位于 labels/，evaluation/ 只评分，reporting/ 只记录与展示。
4. **`datasets/` 和 `tests/` 面向不同对象。** 前者测被测 Agent 的能力，后者测试 DSHEval 框架自身。
5. **`var/` 不只是可丢弃的临时目录。** 其中包含实际运行报告、原始证据和排查备份；是否保留需要按具体内容判断。

## Observer 当前行为

外部环境采集按十类组件并列组织。每个 Case 启动全部配置组件，运行中只有变化才追加环境证据；状态清单区分无变化、未配置和采集失败。

文件、进程的正式 watch 复用各自 sensor.ts。组件专属接入和记录转换位于各自目录。observation/ 只保留 coordinator.ts 与 collection.ts；Probe 解析已移到 agent-trace/reader.ts。

详细流程、结果包结构、适配范围及实际验证见 [Observer 优化说明](OBSERVER-CHANGES-20260912.md)。
