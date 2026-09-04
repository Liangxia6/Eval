# 动态安全测评 V1 · 使用说明

## 1. 当前能交付什么

- 能运行：匹配用例预检 → 有界奖励搜索 → 结构化反思 → 双证据验收 → 冻结 → 6 个 Profile 的独立测评 → JSON/HTML 报告。
- 能验证：15 个模拟行为标签、6 个模拟配置、360 条正式阶段模拟轨迹的完整闭环。
- 已提供：真实执行桥、攻击模型、独立轨迹评审器的**协议客户端和契约**。
- 尚需现场接入：DSH 的隔离环境重置、实际插件加载、独立审计采集、模型 API，以及 15 类风险的人工审核用例。

**不将代码测试通过等同于 DSH 安全验收通过。** `fixtures.ts` 的 15 个样本共享一个抽象效果模型，只检查管线，不能冒充现实风险覆盖。

## 2. 先理解三个角色

- **参考 Agent**：运行在 DSH 中，采用固定模型、插件集合、权限和镜像，只用于构造用例。
- **攻击生成器**：收到候选、运行反馈与反思后，只改指定 C/M/E 字段；不能改任务、判据或权限。
- **独立验证器**：确定性规则验证日志；独立评审器输出轨迹判据及事件引用；评分器再校验这些引用。

正式测评的 6 个 Profile 不参与候选反馈。它们只在用例冻结后运行；模型版本、DSH 版本、镜像、全局权限和模型设置保持一致，只改变插件集合及插件配置。参考 Agent 不作为额外排名对象，但必须在报告中注明其筛选偏差。

## 3. 本地模拟验证

```bash
pnpm install --frozen-lockfile
pnpm test:dynamic
pnpm dynamic demo --out var/dynamic-demo
pnpm dynamic verify --suite var/dynamic-demo/construction/suite/frozen.json
```

离线打开 `var/dynamic-demo/evaluation/report.html`。需要重新渲染时：

```bash
pnpm dynamic report --suite var/dynamic-demo/construction/suite/frozen.json --records var/dynamic-demo/evaluation --out var/dynamic-report-copy
```

重建时校验完成清单、冻结用例和有效运行评分，不重新调用模型，也不执行攻击。

## 4. 真实 DSH 接入

先在隔离测试环境中准备：

1. `cases.json`：15 个不同 B1–B15 用例，人工审核后标记 `readiness: "reviewed"`。每个用例固定授权、判据、初态和单一可编辑字段。
2. `reference.json`：一份真实参考配置；`profiles.json`：6 份不同的插件配置组成的数组，模型/环境等控制变量与参考配置相同。
3. `bridge.json`：替换模板中的执行桥、生成器、评审器路径和版本。配置只保存密钥环境变量**名称**，不保存密钥值。
4. 完成 [BRIDGE.md](BRIDGE.md) 的重置、隔离与可信证据映射。先用一组人工可核验的测试记录验证桥接，而不是直接跑整套攻击。

下面两条命令会调用你配置的进程，可能产生模型费用；只有隔离与授权确认后再执行：

```bash
pnpm build
pnpm dynamic construct --cases cases.json --reference reference.json --policy examples/dynamic/policy.json --bridge bridge.json --out var/dsh-construction-001 --allow-dsh-execution
pnpm dynamic evaluate --suite var/dsh-construction-001/suite/frozen.json --profiles profiles.json --bridge bridge.json --out var/dsh-evaluation-001 --allow-dsh-execution
```

未满 15 个已验收行为会阻止正式 V1 测评，不静默删题。预算耗尽的用例留在 `rejected` 清单中。正式测试中即使良性任务失败，也保留该运行与对应对抗运行，报告其 UGS，不筛掉失败样本来美化结果。

构造默认每个候选重复 3 次，良性预检也重复 3 次。这是本实现为补全计划所固定的工程参数，不声称是论文未说明细节的逐字复现。360 条仅指正式阶段，构造调用量由搜索停止位置决定。

## 5. 运行输出

```text
<construction>/
├─ requests/<run-id>.json          冻结的单次请求、Profile 和初态摘要
├─ raw-evidence/<run-id>.json      执行桥原始 JSON 证据
├─ raw-judgments/<run-id>.json     轨迹评审的二值判据和证据引用
├─ runs/<run-id>.json              请求、证据、逐项得分、VALID/INVALID 原因
├─ search/<id>.json                候选奖励、深度、运行 ID 与反思
├─ proposals/<id>.json             生成器返回的同字段候选
├─ proposal-errors/<id>.json       越界、超限、无效生成等失败记录（如有）
└─ suite/frozen.json               已验收用例、拒绝清单、配置、构造轨迹 ID 和摘要

<evaluation>/
├─ requests/、raw-evidence/、raw-judgments/、runs/   独立正式轨迹
├─ evaluation/manifest.json        6 份 Profile、用例摘要和预期运行数
├─ evaluation/complete.json        360 条记录的摘要；中断不会伪造完成清单
├─ report.json                     指标、分母、无效原因、行为分项的权威报告
└─ report.html                     可离线打开的只读可视化，不依赖外部样式或脚本
```

运行目录不可复用；中断后保留已有证据，需要新目录重新执行。暂不做自动续跑和自动补跑，避免额外尝试改变统计口径。SHA-256 可发现意外改动，不是数字签名；归档目录仍需由评测方保护。

## 6. 退出码和测试

- `0`：命令完成；不代表被测 Agent 安全。
- `2`：构造覆盖不足，未达到 15 个验收用例。
- `3`：正式运行完成但存在 Invalid。
- `4`：配置、协议、证据复核、存储或系统错误。

```bash
pnpm check          # 严格类型检查
pnpm test:dynamic   # Windows/Linux 上的动态模块测试
pnpm test           # 全仓库回归；原 MVP 集成测试需要 Linux/POSIX 环境
```

全仓库测试不绕过 Linux 的权限/软链/fsync 检查。Windows 上运行旧 MVP 集成测试可能失败；不要将“测试未运行”或平台不支持解释为测试通过。

本次开发验证（2026-09-04）：Windows / Node 24.19.0 动态测试 29 项通过；Ubuntu WSL / Node 22.23.2 全仓库测试 114 项通过。模拟验收与报告重建均通过；未调用真实 DSH 或付费模型。

## 7. 第一版最终验收清单

- [ ] 15 组**真实**匹配用例覆盖 B1–B15，全部通过良性准入。
- [ ] 15 个对抗版本在固定参考配置上通过构造验收。
- [ ] 6 份实际 Profile 的模型、插件版本、权限、配置和镜像被锁定。
- [ ] 360 条独立正式运行记录，Invalid 有原因，不混入构造运行。
- [ ] 日志与轨迹证据可追溯，评分可复算。
- [ ] JSON 与离线 HTML 报告同时交付，报告标明覆盖范围和参考配置偏差。

以上是真实测评交付条件，不因模拟测试通过而自动勾选。
