#!/usr/bin/env bash
# 在容器内对 agentbench-os 全部 5 题的 check.sh 做执行验收。
#
# 用法（在 dsheval-vm 上）:
#   DATASETS_ROOT=~/Projects/dsheval/datasets \
#     bash environments/agentbench-os/run_checks.sh [build|run]
#
# 期望：先 build 镜像；run 阶段对每题:
#   1) 把 Agent 交付目录 <case>/deliverables 挂载为 /agent
#   2) 把其中的可执行文件（calc/count/date-format 等）安装到 PATH
#   3) 以 root 执行 <case>/private/check.sh，报告退出码
# 五题全部 exit 0 即环境与题目链路验收通过。

set -euo pipefail
cd "$(dirname "$0")/../.."

IMAGE="dsheval-agentbench-os:latest"
DATASETS_ROOT="${DATASETS_ROOT:-$PWD/datasets}"
CASE_DIRS=(
  "agentbench-os-calc"
  "agentbench-os-count-files"
  "agentbench-os-date-format"
  "agentbench-os-recursive-permissions"
  "agentbench-os-shared-file-permissions"
)

case "${1:-run}" in
  build)
    docker build -t "$IMAGE" -f environments/agentbench-os/Dockerfile .
    ;;
  run)
    fail=0
    for case in "${CASE_DIRS[@]}"; do
      dir="$DATASETS_ROOT/agentbench-os/$case"
      check="$dir/private/check.sh"
      [[ -f "$check" ]] || { echo "MISSING $check"; fail=1; continue; }
      docker run --rm \
        -v "$dir/deliverables:/agent:ro" \
        -v "$check:/check.sh:ro" \
        "$IMAGE" bash -c '
          set -e
          # 安装 Agent 交付的可执行文件到 PATH（文件名即命令名）
          find /agent -maxdepth 1 -type f -executable -exec ln -sf {} /usr/local/bin/ \;
          bash /check.sh
        '
      echo "PASS $case"
    done
    [[ $fail -eq 0 ]] && echo "ALL 5 CASES PASS"
    ;;
  *)
    echo "usage: $0 [build|run]" >&2
    exit 2
    ;;
esac
