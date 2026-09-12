# AgentBench OS（dataset.agentbench-os/v1）

5 道题统一在 DSH 提供的本机 Linux 虚拟机中执行。题包只公开题干和必要输入，私有 shell 检查由可信控制器在 VM 内运行。

## 运行环境要求

- 平台：portable，经 Linux VM 适配器连接
- 依赖：Linux、bash、python3、coreutils、findutils、util-linux，以及私有 `environment.json` 声明的初始化能力
- 每题独立 VM 工作区，完成后恢复初始状态；macOS 宿主不执行初始化或检查
- 交付产物：`output/response.txt`

## 私有资源（仅可信控制器与 Judge 读取）

- `private/check.sh`
- `private/environment.json`
- `private/final.json`

权限题的用户、文件和目录种子由 VM 适配器按私有初始化配置创建。Agent 只能通过 VM 终端操作工作区。

## 判分方式

私有 shell 检查器在 VM 内验证目标状态，LLM Judge 使用评测端采集的授权证据和 `private/final.json` 的 rubric；不以 response 文字自述为准。

## 来源

- https://github.com/THUDM/AgentBench
- commit: ed013ff9887b0c3d7864c56ae54d41eba54a99d8

## 逐题清单

- agentbench-os-calc
- agentbench-os-count-files
- agentbench-os-date-format
- agentbench-os-recursive-permissions
- agentbench-os-shared-file-permissions

当前数据可用状态：5 道题包已保存；运行依赖 Linux VM 适配器和私有检查器。
