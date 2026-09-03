# DSHEval MVP

DSHEval 在真实环境中运行完整 DSH Agent，同时采集 Runtime Trace 和独立环境证据，再生成可追溯的 `PASS`、`FAIL` 或 `UNEVALUABLE` 结果。

当前代码支持单 VM、单活动 Run、单 Dataset、单 Case、单 Attempt。仓库自带 Attention + PyTorch Dataset Pack 和明确标记的 Fixture，用于验证完整纵向闭环。

评测内容位于 `packs/`，与框架源码分离。增删复用现有能力的 Dataset Pack 不需要修改 `src/`；只有新增 Judge 算法或新的环境观测方式时，才需要实现并注册相应接口。

开发说明从 [docs-simple/README.md](./docs-simple/README.md) 开始。

## 环境

- Node.js 22+
- pnpm 11.24.0
- 真实评测：Linux VM、DSH `0.1.1-rc.2`、独立 `dsheval` / `dshagent` 身份

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
  --target examples/fixture-target.json \
  --config examples/mvp.config.json \
  --fixture
```

生成计划：

```bash
pnpm --silent cli -- plan \
  --target examples/fixture-target.json \
  --pack packs/attention-pytorch-v1.json \
  --config examples/mvp.config.json \
  --fixture
```

运行 Fixture：

```bash
pnpm --silent cli -- run \
  --run-id fixture-run-001 \
  --target examples/fixture-target.json \
  --pack packs/attention-pytorch-v1.json \
  --config examples/mvp.config.json \
  --fixture \
  --fixture-behavior attention-success
```

重新验证并渲染报告：

```bash
pnpm --silent cli -- report --run fixture-run-001
```

退出码：`0=PASS/成功`、`1=FAIL`、`2=PLAN_UNSATISFIABLE`、`3=UNEVALUABLE`、`4=系统或交付失败`、`130=取消`。

## VM 实时查看

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
```

`report.json` 是权威报告；HTML 只负责展示。`var/`、`dist/` 和 `node_modules/` 均可删除并由运行、构建或安装命令重新生成。

真实模式不得把 Secret 值写入配置或命令行。配置中只保存环境变量名称，并在 VM 上完成身份、路径和网络隔离验证。
