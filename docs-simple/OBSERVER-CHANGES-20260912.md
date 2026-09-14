# Observer 全量观测、变化入证据

更新日期：2026-09-12。实现与验证均在 VM 项目中完成。

## 当前流程

1. Dataset Loader 为 Case 加载环境配置中的全部 Observer，不再按标签筛选采集组件。
2. 在 Agent 启动前准备 Observer，绑定本次工作区、被测用户和 Attempt。
3. 每个组件采集初始状态，在运行期间轮询；只有检测到变化才追加事件。
4. Agent 结束后做最后一次采集，再停止并汇集结果。
5. 变化进入证据链；无变化、未配置、权限失败等进入独立的采集状态清单。
6. Judge 收到获准使用的变化事实，并单独收到观测覆盖说明。覆盖说明不作为可引用的评分证据。

Probe 记录 Agent 内部执行过程，不适用“只保留外部环境变化”的过滤规则。

## 当前目录

```text
src/
├── agent-trace/
│   ├── reader.ts                  # 原 observation/runtime.ts：Probe 读取、解析、完整性检查
│   ├── native-probe-adapter.ts
│   └── native-probe/
└── observation/
    ├── coordinator.ts             # 观测会话及生命周期记录
    └── collection.ts              # 组件注册、启动/停止、变化及状态接入

observer-lab/
├── adapters/
│   ├── filesystem/
│   │   ├── index.mjs              # 独立入口；正式 watch 复用 sensor.ts
│   │   ├── sensor.ts              # 文件实际采集
│   │   └── binding.ts             # 正式流程请求校验、阶段快照接入
│   ├── process/
│   │   ├── index.mjs              # 独立入口；正式 watch 复用 sensor.ts
│   │   ├── sensor.ts              # 进程实际采集
│   │   ├── binding.ts             # 正式流程请求校验
│   │   └── records.ts             # 进程记录转换
│   ├── application/index.mjs
│   ├── browser/index.mjs
│   ├── clipboard/index.mjs
│   ├── database/index.mjs
│   ├── desktop/index.mjs
│   ├── external-api/index.mjs
│   ├── network/index.mjs
│   ├── system/index.mjs
│   └── index.mjs                  # 十类独立入口的导出
├── lib/
│   ├── core.mjs                   # 观测记录、变化比较、文件写入
│   └── watch.mjs                  # 统一轮询、最终采集、变化去重与覆盖状态
├── bin/observer-smoke.mjs
├── config/macos-worker.json
└── tests/watch.test.mjs
```

保留文件阶段快照用于工作区校验、交付文件提取及清理验证，但生产 Dataset 链路不会再把这些快照、种子清单和空差异自动提升为 Judge 证据。旧兼容 Pack 继续保留其确定性检查所依赖的低层事实；其结果包也只导出非空环境差异。

## all trace 中的结果

all trace 仍由 Case 结果包中的多个目录组成，不是新增一个同名大文件。

```text
case/
├── trace/
│   ├── raw.jsonl.gz               # 保留既有 Agent Trace 原始采集产物
│   ├── index.json                 # 只索引 Agent 内部 Trace
│   └── status.json
├── observers/
│   ├── status.json                # 所有观测源的覆盖状态，始终生成
│   ├── filesystem.json            # 有变化才生成，包含变化实际内容
│   └── <其他有变化的组件>.json
├── artifacts/                     # 最终回复、交付文件等
├── evidence/<label>.json          # 各 Judge 获准使用的证据
└── judge/<label>.json
```

变化记录包含时间、Attempt/Case 关联、前后状态摘要、具体变动项和原始产物引用。它证明在 Case 观测窗口内发生了环境变化，不自动证明该变化仅由当前 Agent 引起。

状态分别说明：

- `CHANGED`：有变化事件。
- `UNCHANGED`：观测成功且未发现变化。
- `UNKNOWN`：采集失败、未配置或覆盖不足，不能解释成无变化。
- `runtimeStatus` 进一步区分 `COMPLETE`、`PARTIAL`、`IDLE`、`NOT_CONFIGURED`、`UNAVAILABLE`。

“有变化”与“覆盖完整”是两个维度；部分采集失败后仍可保留已经观测到的变化。

## 已适配的位置

| 环节 | 调整 |
|---|---|
| Dataset Loader | 取消按标签决定启用哪些 Observer；所有环境组件进入计划 |
| 能力检查 | 校验组件支持所需能力子集，避免把支持更多能力的组件判为不兼容 |
| Case 执行 | 为文件/进程绑定真实 Workspace、UID；与其他组件一起持续观测 |
| 轮询 | 无变化不写事件；最终采集；中途错误保留；失败样本不伪装成环境删除；异常退出仍保留已写入的有效事件前缀 |
| 证据生成 | 十类变化映射为对应事实；生产链路不输出静态基线与空差异作为评分证据 |
| 标签路由 | 变化事实可作为各标签的可用环境上下文，不因无变化新增必需证据缺口 |
| Judge | 变化证据和观测覆盖说明分开输入；说明无事件不等于无行为 |
| 报告/导出 | 新增状态清单，按实际变化生成组件文件，保留变化内容及时间 |
| 配置 | 桌面 Observer 纳入运行；数据库/API 未配置时明确报告状态 |
| 文档/测试 | 更新路径、文件树及回归测试 |

## 验证与实际限制

最终执行 pnpm run verify：类型检查通过，136 项测试全部通过。日志见 var/reviews/observer-changes-only-20260912/verify.log。

验证包括框架测试、变化轮询回归测试，以及 VM 中真实文件创建/删除的集成测试。集成测试还将实际变化接入观测记录、证据生成和 Judge 授权闭包，确认两次变化保留，静态基线没有成为评分事实。

另外使用 VM 当前配置启动了十类 Observer，实测结果保存在：

`var/reviews/observer-changes-only-20260912/live-1789180440383/summary.json`

该次独立 Observer 实测中，文件和进程成功产生变化；浏览器、剪贴板、网络、系统观测成功且无变化；数据库与外部 API 未配置具体目标；桌面存在窗口信息读取失败，且截图未开启，报告为部分覆盖。应用组件也记录到了运行窗口内的真实变化，不能据此断言由测试动作引起。

轮询间隔目前为 250 ms 加上各组件采集耗时，不保证捕获所有短暂变化。本次没有重跑完整真实 DSH + 模型 Judge 的付费评测；不将独立 Observer 实测或模拟 Agent 的框架测试描述为真实 DSH 评分验收。

阶段性备份和测试日志位于 `var/reviews/observer-changes-only-20260912/`。
