# agentbench-os 上游环境（本地 Linux VM）

5 道 AgentBench OS 题（calc/count-files/date-format/recursive-permissions/shared-file-permissions）
需要在 **Linux guest** 中执行并跑私有 `check.sh`。题包约束是
`executionScope=local-linux-vm`：macOS VM 只负责托管 Linux guest，初始化、Agent
命令和私有检查均在 guest 内执行。

## 需要什么

- macOS VM 上安装 Lima/Colima，并准备一个 Linux guest
- Linux guest 中提供 bash、python3、coreutils、findutils、util-linux
- 每题 Agent 的交付产物放在 `<case>/deliverables/` 下（可执行文件以命令名命名：
  `calc`、`count`、`date-format`；权限题交付脚本即可，由运行侧执行）

## 本地 Linux VM 验收（主路径）

```bash
# 只检查 Linux guest、题包和私有环境定义是否就绪
bash environments/agentbench-os/run_vm_checks.sh preflight

# Agent 已经把交付物写入每题的 deliverables/ 后执行私有检查
bash environments/agentbench-os/run_vm_checks.sh run
```

脚本默认使用 `LIMA_HOME=$HOME/.colima/_lima` 下的
`colima-dsheval-qemu` 实例，可用 `LINUX_VM_INSTANCE` 覆盖。Lima guest 默认用户是
普通用户，脚本会通过 `sudo -n` 以 root 执行初始化、私有检查和清理（题目会写入
`/root/videos`、`/testfile` 并管理测试用户）。`run` 没有交付物时会报告 `SKIP`，不会
伪造题目通过。

## Docker 兼容验收（旧路径）

以下脚本仍保留，用于已有 Docker 镜像的兼容回归；它不是题包声明的主执行边界。

```bash
# 构建兼容镜像
DATASETS_ROOT=~/Projects/dsheval/datasets \
  bash environments/agentbench-os/run_checks.sh build

# 执行 5 题 check.sh 验收
DATASETS_ROOT=~/Projects/dsheval/datasets \
  bash environments/agentbench-os/run_checks.sh run
```

## 预置状态（与题目要求对齐）

| 资源 | 预置值 | 对应题 |
|---|---|---|
| 用户 jack/bill/tom/george | 已建；前三人同属 guest-readers 组 | shared-file-permissions |
| `/testfile` | 内容 `test`，root:root 0600 | shared-file-permissions（Agent 改权限使三人可读、george 不可读） |
| `/root/videos/` | 2 文件 + 1 子目录 + 1 空文件，644/755 | recursive-permissions（Agent 改为文件 660、目录 750） |
| 系统目录 | Ubuntu 22.04 标准目录树 | count-files（check.sh 统计 /usr/local、/bin 等） |
| `python3`、GNU `date` | 已装 | calc、date-format 的 check.sh 依赖 |

## DSH 接入方式（二选一，VM 上定）

1. **执行型工具**：Agent 的工具调用转发进容器执行（`docker exec`），结果回传；
2. **挂载型**：把容器 workspace 挂到 Agent 的 macOS 工作区，Agent 在容器 shell 内完成全部操作。

## 验收清单

- [ ] `run_checks.sh build` 镜像构建成功
- [ ] `run_checks.sh run` 五题全部 exit 0
- [ ] DSH Agent 实际执行一题并与 check.sh 结果一致
