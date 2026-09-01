# DSHEval MVP 仓库结构

> 目标：让一次文件评测从入口到报告都容易定位，同时避免为未来能力提前拆目录。

## 1. 推荐文件树

```text
Eval/
├── src/
│   ├── app/
│   │   ├── bootstrap.*          # 装配 8 个模块
│   │   ├── workflow.*           # 十步端到端流程
│   │   └── cli.*                # 本地命令入口与退出码
│   ├── core/
│   │   ├── models.*             # 稳定领域对象
│   │   ├── contracts.*          # Port 与模块契约
│   │   └── errors.*             # 结构化故障语义
│   ├── planning/
│   │   ├── target.*             # FULL_AGENT 冻结
│   │   ├── inspector.*          # DSH/Profile/插件/权限事实
│   │   ├── catalog.*            # filesystem pack 加载校验
│   │   └── planner.*            # 匹配、编译、Preflight
│   ├── runtime/
│   │   ├── target.*             # DSH Headless 生命周期
│   │   ├── runner.*             # Run/Case/Attempt 生命周期
│   │   └── environment.*        # 文件 Seed/Reset
│   ├── observation/
│   │   ├── coordinator.*        # Before/Active/Drain/Seal
│   │   ├── runtime.*            # Runtime Probe 采集
│   │   ├── environment.*        # Environment Observation Port
│   │   └── sensors/
│   │       └── file.*           # 唯一环境 Sensor
│   ├── evaluation/
│   │   ├── evidence.*           # 标准化、关联、密封
│   │   ├── closure.*            # EvidenceContract 闭合
│   │   ├── judging.*            # 三个确定性 Judge
│   │   ├── scoring.*            # 三值 Verdict 聚合
│   │   └── report.*             # JSON 与静态 HTML 模型
│   ├── storage/
│   │   ├── repositories.*       # JSON/JSONL 记录
│   │   └── artifacts.*          # Artifact 与摘要
│   └── platform/
│       ├── config.*             # ConfigSnapshot
│       ├── security.*           # 身份、权限、只读 Binding
│       ├── services.*           # 健康、Lease、关闭
│       └── export.*             # 本地校验导出
├── packs/
│   ├── environments/
│   │   └── filesystem-v1.json
│   ├── scenarios/
│   │   └── filesystem-copy-exact-v1.json
│   ├── domains/
│   │   └── filesystem-baseline-v1.json
│   └── judges/
│       └── filesystem-copy-exact-v1.json
├── tests/
│   ├── unit/                    # 纯规则、模型、解析与状态测试
│   ├── integration/             # 相邻模块与本地 I/O 协作测试
│   ├── e2e/                     # 唯一文件纵向链路及故障路径
│   └── fixtures/                # Fake Agent、Probe、快照和 pack 样本
├── docs/                        # 完整产品规格；不作为 MVP 实现基线
├── docs-simple/                 # 当前 MVP 权威规格
│   └── development/             # 全局、模块、测试与展示规格
├── var/                         # 本地运行数据；不提交 Git
├── package.json
├── tsconfig.json
└── README.md
```

后缀 `.*` 表示由实现工具链确定的源码后缀；当前文档只规定职责，不包含具体代码。

## 2. 为什么保持 8 个一级模块

八个模块分别对应组合、公共契约、规划、执行、观测、评测、存储和平台。它们足以表达关键边界，同时仍能在一个进程中端到端调试。

MVP 不建立以下目录：

- `providers/`、`plugins/`、`factories/`、`strategies/`；
- PostgreSQL、HTTP、Browser Sensor；
- Gap、Repair、Retry、Multi-Agent、LLM Judge；
- controller/service/repository 的重复嵌套层；
- Web 前后端、微服务、消息总线或 ORM。

未来真实需求出现后，可以在对应 Port 后增加实现，但不能为了“以后可能需要”先生成空文件。

## 3. Pack 的最小职责

MVP 只有一个 filesystem pack，由四个版本化 JSON 资产组成：

| 资产 | 定义什么 | 不定义什么 |
|---|---|---|
| Environment | 隔离工作区、Seed 和 Reset 目标 | Agent 如何完成任务 |
| Scenario | 输入、任务文本、允许输出和 Ground Truth | Judge 实现逻辑 |
| Domain | 三个 Checks 及其必需性 | 插件名称和安装方式 |
| Judge | 判定规则版本、证据要求和硬失败 | 运行时状态或历史结果 |

每个资产必须有稳定 ID、Schema 版本、内容摘要和适用条件。Plan 只保存已校验的确定版本；运行中不重新读取不同内容。

## 4. 本地运行数据布局

```text
var/
├── records/                      # Config 的 runRoot
│   ├── locks/active-run.lock
│   └── <run-id>/
│       ├── records/<kind>/<id>.json
│       ├── events/lifecycle.jsonl
│       ├── events/failures.jsonl
│       ├── events/raw-observations.jsonl
│       └── status.html
├── artifacts/<run-id>/           # Config 的 artifactRoot
│   ├── objects/<artifact-id>
│   └── index.jsonl
├── reports/<run-id>/             # Config 的 reportRoot
│   ├── report.json
│   └── report.html
├── workspaces/<run-id>/<case-id>/<attempt-id>/
└── runtime-homes/<run-id>/<case-id>/<attempt-id>/
```

原则：

1. 一个 Run 在互不包含的 records/artifacts/reports 根下使用同名分区，所有记录带 Run/Case/Attempt/Source 作用域。
2. JSON 保存快照/结果，JSONL 保存只追加事件，Artifact 保存原始大对象。
3. 文件先写临时位置，校验并原子替换；密封对象只读。
4. ArtifactRef 保存摘要、大小、媒体类型和 `portablePath`，不保存 VM 的个人绝对路径。
5. Agent 工作区、Probe 暂存区和 DSHEval 可信数据目录分离。
6. `var/`、运行 Secret 和 VM 特定配置不进入 Git。

## 5. 测试归属

| 测试 | 放置规则 |
|---|---|
| Unit | 单一模型、纯函数、Parser、Judge、状态转换 |
| Integration | Catalog→Planner、Runner→Target、Observation→Evidence、Storage→Report 等真实边界 |
| E2E | 从 CLI/Workflow 到 Reset/Report 的完整文件场景 |
| Fixture | Fake Agent 行为、Probe 片段、文件树快照、有效/无效 pack |

测试可以按真实需求增加文件，但不复制生产目录形成一套难维护的镜像。

## 6. 文件归属规则

1. 稳定跨模块数据类型和 Port 只放 `core/`。
2. 领域对象由对应模块生产，`storage` 只保存，不成为第二生产者。
3. Runtime 与 Observation 由 `app/workflow.*` 协调，二者不直接互相调用内部实现。
4. Evaluation 不导入 Planning/Observation 的具体实现，只接收冻结对象和 EvidenceView。
5. 环境写操作只在 `runtime/environment.*`；只读文件观测只在 `observation/sensors/file.*`。
6. HTML 的数据模型属于 `evaluation/report.*`，文件交付属于 `platform/export.*`。
7. 一个概念已有清晰归属时，不创建 `common/`、`utils/` 或第二份模型；真正无领域语义的小工具留在当前调用模块。

## 7. 演进门禁

新增目录、Provider 或抽象前必须有：

- 第二个已经实现、行为确实不同的用例；
- 当前文件出现可证明的职责冲突；
- 明确契约和独立测试；
- 对纵向切片复杂度的影响说明。

否则不扩结构。优先交付可运行、可测试、可删除的直接实现，而不是未来工厂、万能基类和空壳 Adapter。
