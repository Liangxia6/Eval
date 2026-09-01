# DSHEval MVP 文档

本目录是一套**可以独立指导实现的 MVP 规格**。它不是 `docs/` 的逐段摘要，也不要求先实现完整版再做删减。

两套文档服务于不同目标：

- `docs/`：完整产品架构，面向后续扩展和完整实现。
- `docs-simple/`：最小可信纵向闭环，面向一套干净、可运行、可测试的 MVP。

同一次实现只能选择其中一套作为需求基线。开发 MVP 时，以本目录为准；完整版中超出本目录的能力一律视为 `DEFERRED`，不能顺手加入 MVP。

MVP 应在独立分支或 worktree 中从干净的文档基线开始，不能直接覆盖或继续扩写由完整版 `docs/` 生成的 `src/`。已有完整实现只能作为对照；任何复用代码都必须逐组件通过本目录的契约和测试后再进入 MVP。

## MVP 一句话定义

在单台 Appliance VM 中，对一个完整 DSH Agent 执行一个确定性文件任务，同时采集 DSH Runtime Probe 与文件系统 Before/After；依据闭合证据形成 CheckResult，完成独立复位验证后输出 `PASS`、`FAIL` 或 `UNEVALUABLE`，并生成 JSON、JSONL、Artifact 和静态 HTML。

## 固定范围

| 项目 | MVP 选择 |
|---|---|
| Target | `FULL_AGENT` |
| DSH 基线 | `0.1.1-rc.2`，Headless + Runtime Probe |
| 部署 | 单台 Appliance VM 内的模块化单体 |
| 并发 | 一个活动 Run |
| 执行规模 | 一个 Run、一个 Case、一个 Attempt，`maxAttempts=1` |
| 场景 | 一个确定性文件复制/写入场景 |
| 观测 | Runtime Probe + File Sensor Before/After |
| Judge | Protocol、File State、基础 Path Security |
| Verdict | `PASS` / `FAIL` / `UNEVALUABLE` |
| 存储 | 本地 JSON、JSONL、Artifact |
| 展示 | `status.html`、`report.html` |
| 收尾 | Reset 后独立 File Verification |

## 文档结构

| 文档 | 回答的问题 |
|---|---|
| [PRODUCT.md](./PRODUCT.md) | MVP 为谁解决什么问题，交付什么，不做什么 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 一次评测如何流转，两大接口如何分工 |
| [LAYERS.md](./LAYERS.md) | 七个逻辑层的职责、依赖和边界 |
| [COMPONENTS.md](./COMPONENTS.md) | 8 个源码模块、28 个 MVP 组件分别负责什么 |
| [REPOSITORY_STRUCTURE.md](./REPOSITORY_STRUCTURE.md) | 代码、资产、数据、测试和文档放在哪里 |
| [DECISIONS.md](./DECISIONS.md) | 已冻结的关键取舍及原因 |
| [development/README.md](./development/README.md) | AI/开发者的实现规则、顺序与全局验收 |
| [development/V0.1_VERTICAL_SLICE.md](./development/V0.1_VERTICAL_SLICE.md) | 唯一纵向场景的事实、步骤、判定和 E2E 验收 |

`development/` 中其余文件保持相同层级，分别细化公共契约、测试、可视化和八个源码模块。它们必须服从本页的固定范围。

## 推荐阅读顺序

1. `PRODUCT.md`
2. `ARCHITECTURE.md`
3. `development/README.md`
4. `development/V0.1_VERTICAL_SLICE.md`
5. `development/core.md` 与 `development/CONTRACT_CATALOG.md`
6. 当前准备实现的模块文档
7. `development/TESTING.md` 与 `development/VISUALIZATION.md`

## 维护规则

1. 本目录只描述 MVP 当前必须实现的能力；未来能力只能列在 `DEFERRED`，不能设计伪实现。
2. 全局要求统一使用 `MVP-DEV-REQ-*`，验收统一使用 `MVP-DEV-AC-*`；不复制完整版的要求编号。
3. 一个概念只有一个权威定义；其他文档引用它，不重复扩写第二套语义。
4. 任何范围、状态、接口或 Verdict 变化，必须同步检查架构、公共契约、纵向切片和测试。
5. 文档只描述行为与契约，不包含具体实现代码。
