# agentbench-os 上游环境（Linux guest 容器配方）

5 道 AgentBench OS 题（calc/count-files/date-format/recursive-permissions/shared-file-permissions）
需要在 **Linux guest** 中执行并跑私有 `check.sh`。本目录提供一键容器配方，在
dsheval-vm 上装好 Docker 后即可验收。

## 需要什么

- dsheval-vm 上安装 Docker（或 lima/colima）
- 每题 Agent 的交付产物放在 `<case>/deliverables/` 下（可执行文件以命令名命名：
  `calc`、`count`、`date-format`；权限题交付脚本即可，由运行侧执行）

## 使用

```bash
# 构建镜像（预置 jack/bill/tom/george 用户、/testfile、~/videos 种子目录）
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
