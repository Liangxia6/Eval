# DSHEval MVP

DSHEval 在真实环境中运行完整 DSH Agent，同时采集 Runtime Trace 和独立环境证据，再生成可追溯的 `PASS`、`FAIL` 或 `UNEVALUABLE` 结果。

配置按职责拆分：`datasets/` 保存描述与题目，`labels/` 保存证据要求、评分标准和逐标签 Judge，`environments/` 保存 macOS 组件到 Observer 的绑定，`planning/prompts/` 保存统一 Planner 的三种规模提示词。正式评测不再使用手写 Pack；旧 Pack 只保留在 `tests/fixtures/` 供执行内核回归测试。

开发说明从 [docs-simple/README.md](./docs-simple/README.md) 开始。

## 环境

- Node.js 22+
- pnpm 11.24.0
- 真实评测：Tart macOS VM、DSH `0.1.1-rc.2`

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
```

## CLI

先构建：

```bash
pnpm build
```

检查 Agent：

```bash
pnpm --silent cli -- inspect \
  --target config/targets/fixture-dsh.json \
  --config config/macos-vm.json \
  --fixture
```

`inspect` 只生成真实 Agent 静态快照，不调用模型。`plan` 和 `run` 把静态快照与全部动态 Dataset 描述交给统一 Planner，整个选择阶段只调用一次模型；所选 Dataset 的既有标签并集成为本次评测标签，不再单独生成 Agent 标签。

统一 Planner 默认使用 `https://api.deepseek.com/chat/completions` 与 `deepseek-chat`。设置 `DSHEVAL_PLANNER_API_KEY` 或 `DEEPSEEK_API_KEY`；Endpoint、模型和提示词目录可分别用 `DSHEVAL_PLANNER_MODEL_ENDPOINT`、`DSHEVAL_PLANNER_MODEL`、`DSHEVAL_PLANNER_PROMPT_ROOT` 配置。`planning/prompts/standard.json` 是可直接发送的完整提示词模板，运行时注入策略、Agent 静态观测、能力账本、Dataset 描述集合和可运行性索引。显式 Fixture 不访问模型。

生成计划：

```bash
pnpm --silent cli -- plan \
  --target config/targets/real-dsh.json \
  --datasets datasets \
  --labels labels \
  --trace trace/dsh-runtime.json \
  --environment environments/macos.json \
  --test-profile STANDARD \
  --config config/macos-vm.json
```

MVP 只保留 `STANDARD`。Planner 从 `datasets/catalog.md` 动态加载所有 Dataset 描述和既有标签。

运行 Fixture：

```bash
pnpm --silent cli -- run \
  --run-id fixture-run-001 \
  --target config/targets/fixture-dsh.json \
  --fixture-pack tests/fixtures/packs/attention-pytorch-v1.json \
  --config config/macos-vm.json \
  --fixture \
  --fixture-behavior attention-success
```

重新验证并渲染报告：

```bash
pnpm --silent cli -- report --run fixture-run-001
```

退出码：`0=PASS/成功`、`1=FAIL`、`2=PLAN_UNSATISFIABLE`、`3=UNEVALUABLE`、`4=系统或交付失败`、`130=取消`。

## VM 实时查看

当前部署目标是 Mac mini 上运行的 Tart VM `dsheval-macos-work`。连接 VM：

```bash
ssh -J dsheval-mini dsheval@192.168.64.8
```

项目目录：

```bash
cd /Users/dsheval/Projects/dsheval
```

前端由 `src/evaluation/report.ts` 生成：运行中读取 `status.html`，结束后读取密封的 `report.html`。Viewer 只展示已保存事实，不参与 Planner、Judge 或 Gate。

### 通用 Viewer 命令

VM 中启动只读 Viewer：

```bash
pnpm --silent viewer -- \
  --run fixture-run-001 \
  --run-root /absolute/path/to/Eval-simple/var/records \
  --report-root /absolute/path/to/Eval-simple/var/reports \
  --host 127.0.0.1 \
  --port 4173
```

本机建立 SSH 隧道：

```bash
ssh -N -L 4173:127.0.0.1:4173 <vm-user>@<vm-host>
```

然后打开 `http://127.0.0.1:4173/`。Viewer 只展示已提交状态，不参与 Judge，也不能监听公网地址。

## 输出

```text
var/records/<run-id>/     记录、事件和 status.html
var/artifacts/<run-id>/   内容寻址 Artifact
var/reports/<run-id>/     report.json 和 report.html
var/evaluation-results/agents/<agent-id>/runs/<run-id>/cases/<case-id>/
                          按 Agent/Case 聚合的自包含 MVP 结果包
```

`report.json` 是权威报告；HTML 只负责展示。`var/`、`dist/` 和 `node_modules/` 均可删除并由运行、构建或安装命令重新生成。

真实模式不得把 Secret 值写入配置或命令行。配置中只保存环境变量名称，并在 VM 上完成身份、路径和网络隔离验证。
