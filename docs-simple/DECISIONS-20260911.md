# DSHEval 开发约定与本轮变更（2026-09-11）

## 已确认方向

- 全部开发、构建、验证直接在 VMmac 主项目进行；只服务完整 DSH Agent。
- 一次 Agent 评测只冻结一次 Target，后续移除每题重复冻结。
- 结果以标签为能力维度，输出多维评分图；不以所有标签过线作为最终产品的主要表达。
- Benchmark 后续继续优化。Loader 优先兼容题库现有格式，避免为了执行器大改数据。
- 不逐题恢复 VM，切换被测 Agent 时恢复。
- 不强化 VM 全局锁；并发使用及共享环境中的表现可以成为 Agent 评测内容。后续需明确并发负载和证据归属。
- Judge 当前目标是每个标签接收全部三层证据；后续演进为证据目录、按需循环读取、渐进式披露。本轮未修改 Judge 输入路由或评分逻辑；现有实现仍有标签授权筛选，不能宣称已实现所有标签全量输入。
- 本轮未修改 Batch 调度、全局锁或 VM 恢复逻辑。

以上约定优先于 REVIEW-20260911.md 中未确认的建议。

## 已实施：Trace

- 校验 Native events/logs 共有的全局 seq 和 SHA-256 链，保留原序号和重复记录。
- 保留坏行诊断；空/损坏 Native 文件不再被当成“不存在”而静默回退。
- Native 文件读取前限制字节数，不跟随文件 symlink。
- 原始截断、采集丢失、writer failure、哈希问题通过 captureDiagnostics 随 Trace 保存，重新解析也不会丢失。
- 进程退出所补充的边界不是 Native flush/stop 证明；nativeStopObserved=false 产生明确缺证状态。
- Session Archive 检查头部归属、原事件序列、损坏行与截断，检查序列后才过滤 assistant/chunk。
- 按 Session 检查 Turn/Tool 的配对；并行 Session 的同名 callId/turn 不互相闭合。
- Workflow 将原始截断和完整性结论传到 CollectionStatus / CompletionLedger。
- Trace 不完整时相关 Judge BLOCKED/UNEVALUABLE，独立文件证据仍可评价产物。
- Archive 结束边界标明 PERSISTED_ARCHIVE_READ，不声称看到了 Native stop；仍检查头部、事件顺序、Turn/Tool 闭合及截断。

兼容性影响：以前被弱检查放行的 Trace，新运行可能得到 PARTIAL/UNEVALUABLE。没有改写历史结果。如果真实 DSH 不产生可确认的终止/flush 事实，应补充采集闭合机制，不能降低检查来恢复 PASS。

## 已实施：Loader

- 兼容 none、copy-public-inputs、self-contained-dsheval-fixture 的公开输入注入语义，保留 shuffle-options。
- 作者未给 sha256 时，实际输入字节仍进入冻结 Pack/Artifact；不写回题库。已有摘要必须核验。
- 尊重 allowedEdits 中 output/**、work/** 等路径，没有声明时维持 output 默认。
- 输出必须位于允许路径，仍拒绝受保护目录或无法解释的通配规则。
- 确定性检查器缺少执行适配器时明确拒绝，不降级成 LLM 判断。

未执行题库检查脚本，未修改 Dataset 文件。这是兼容现有格式，不是任意 Benchmark 的动态执行系统。

## 验证

- pnpm run verify：类型检查、构建、127/127 测试通过，0 skipped。
- 四个 Fixture 端到端场景确认 Trace 异常时相关 Judge 阻止评分，文件产物检查仍 PASS，环境清理和结果包保存正常。
- 真实 RunWriter 生成跨 events/logs 哈希链，经新适配器解析：COMPLETE，issues=[]。
- 全库复验：43 个 Dataset、173 题中 161 题加载成功（原为 113）；12 题缺少确定性检查执行适配器，明确拒绝。
- 至少两题可加载的 Dataset：30 个。
- Loader 成功不代表实际依赖、外部 Observer 或真实 Agent 执行已验收；本轮没有新增真实 Agent/模型调用。

修改前备份、本轮补丁、测试日志、Writer 验证及题库复验：
`/Users/dsheval/Projects/dsheval/var/reviews/trace-integrity-20260911-114408`

保留工作区原有改动，没有提交或推送 Git。

## 后续

接通确定性检查执行侧；统一一次冻结的 Run 与并发 Case 调度；设计三层证据目录及按需读取 Judge；完成多维分数聚合和有效样本/缺证展示。
