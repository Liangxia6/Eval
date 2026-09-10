# DSHEval 测试说明

> 目标：证明 Attention MVP 闭环正确、失败不失真；Fixture 结果不冒充真实 VM 验收。

## 1. 发布门禁

```bash
pnpm run verify
```

`pnpm run verify` 等价于 `pnpm run check && pnpm test`，本地与 CI（`.github/workflows/ci.yml`）使用同一入口。

当前自动化共 104 项，必须全部通过。测试不访问公网，不需要模型 API Key。

## 2. 测试层次

| 层次 | 验证内容 |
|---|---|
| Unit | Digest、Scope、Label 选择、File Diff、Judge、Gate、HTML 转义 |
| Contract | 模块依赖、Port 返回、Probe/File Sensor 契约 |
| Integration | Repository、Artifact、工作区、Target 子进程、Reset、Viewer |
| E2E Fixture | Attention Pack 从 Planner 到报告的完整链路 |
| VM 验收 | 真实 DSH、真实模型、OS 身份和网络隔离；不由 Fixture 代替 |

## 3. Attention E2E Fixture

| 场景 | 预期 |
|---|---|
| 生成 `output/attention.py`、提交有效回答并完成 Python 工具调用 | 两项 Check PASS，Gate PASS |
| 缺少代码产物 | Artifact Check FAIL，Gate FAIL |
| Probe 缺少结束边界 | 相关证据不足，Gate UNEVALUABLE |
| Reset 独立验证失败 | 已形成的 Agent Gate 不变，Operational Health 降级 |

Fixture 进程在 `tests/fixtures/agents/fake-dsh/`，必须显式传入 `--fixture` 和 `--fixture-behavior`。报告会标记 `PROCESS_FIXTURE`。

## 4. 关键不变量

- Trace 只解释执行过程；文件 Observer 独立验证代码产物。
- 缺失、无效或不可信的证据不能 PASS。
- Agent、Collector、Judge、Environment 和 Infrastructure 故障分别归因。
- Judge 实现缺失或抛错产生 `JUDGE_FAILURE + UNEVALUABLE`。
- Gate 只消费计划声明且已经保存的完整 CheckResult 集合，并且每个 Run 只计算一次。
- Reset 失败不能修改已经保存的 CheckResult 或 Gate。
- Pack、Evidence、Artifact 与报告摘要被篡改后必须拒绝读取。
- Target argv、cwd、环境变量、路径和 Secret 都必须通过安全边界测试。

## 5. Pack 扩展测试

新增 Dataset Pack 时至少增加：

1. Pack 摘要和交叉引用校验；
2. Label 选择到 Check/Judge 的确定性测试；
3. 每个新 Judge 的 PASS、FAIL、UNEVALUABLE 测试；
4. 一个完整 Fixture 或真实 VM Case；
5. 如果引入新 Observer，增加 Binding、读取失败和信任级别测试。

只复用现有 Judge/Observer 的新 Pack 不应修改 Workflow。

## 6. 真实 VM 尚需验证

- DSH `0.1.1-rc.2` 的真实 Headless/Probe 事件；
- PyTorch 在 VM 中真实执行并由 Trace 记录成功结果；
- `dsheval` 与 `dshagent` 的 OS 身份隔离；
- 网络默认拒绝和允许的模型端点；
- 本机经 SSH 隧道查看 VM 内的 `status.html` / `report.html`。
