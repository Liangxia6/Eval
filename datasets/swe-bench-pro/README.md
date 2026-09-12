# SWE-bench Pro Linux 虚拟机环境

本目录保留 5 道 SWE-bench Pro 题包。题包不携带镜像构建或容器运行配置。DSH 在本机 Linux VM 中为每题准备固定仓库检出、系统与语言依赖，并在每次试验前恢复到指定 base commit。

VM 适配器必须：

- 在隔离 Linux VM 工作区检出 `question.json` 中的 `repository` 与 `baseCommit`；
- 按私有 `environment.json` 应用测试文件初始化，仅在 VM 内执行；
- 运行 Agent 产生的 `output/solution.patch`，再由私有 F2P/P2P 测试脚本判定；
- 每题结束后丢弃或重置工作区，禁止在 macOS 宿主执行仓库命令。

完整仓库和依赖由 VM 运行时按固定版本提供，不作为公开题包输入。Agent 只接收 `prompt.md`，交付物写入 VM 工作区的 `output/`，最终归档到 Case Bundle 的 `artifacts/deliverables/output/`。
