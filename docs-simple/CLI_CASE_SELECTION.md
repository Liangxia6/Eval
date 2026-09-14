# CLI 指定题目

`run --case` 直接从 Dataset Catalog 和磁盘上的 `question.json` 选择一题，跳过模型选题。
仍然执行目标静态检查、计划编译、环境准备、Trace 采集和 Judge。
不传 `--case` 时继续由 Planner 自动选题。

在虚拟机的 `/Users/dsheval/Projects/dsheval` 下执行：

```bash
pnpm --silent cli -- run \
  --run-id "modlens-os-$(date +%Y%m%d-%H%M%S)" \
  --target config/targets/real-dsh.json \
  --plugin liustack/modlens \
  --datasets datasets \
  --labels labels \
  --trace trace/dsh-runtime.json \
  --environment environments/macos.json \
  --test-profile STANDARD \
  --config config/macos-vm.json \
  --case agentbench-os/agentbench-os-count-files
```

支持以下写法（任选一种）：

```text
--case agentbench-os/agentbench-os-count-files
--case agentbench-os-count-files
--case datasets/agentbench-os/agentbench-os-count-files/question.json
--case /Users/dsheval/Projects/dsheval/datasets/agentbench-os/agentbench-os-count-files
--case agentbench-os.case-2
```

建议使用题目目录名：`dataset.case-N` 的 N 是该数据集下题目路径按英文排序后的编号，
增加或删除题目可能改变编号。`harbor-hle.case-1` 对应物理目录 `datasets/hle/` 下的第一题。

指定题目时只运行一题，无需 `--max-cases 1`；即使同时提供更大的 `--max-cases` 也不会增加题目。
启动日志显示实际 Case ID 和 `question.json` 路径；选择记录标记为 `user-selected-case/v1`，不会假称由模型选出。
不存在、编号越界或有重名的选择会报错，不会自动换题。
每次重跑使用新 Run ID，避免已有记录的 `IMMUTABILITY_CONFLICT`。

`--case` 不负责安装 Probe；Trace 是否完整仍取决于目标 Probe 配置、运行和采集状态。
