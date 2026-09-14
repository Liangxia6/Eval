#!/usr/bin/env bash
# AgentBench OS 的本地 Linux VM 验收入口。
#
# 这个脚本在 macOS VM 主机上调用 Lima guest；私有初始化和 check.sh
# 全部在 Linux guest 内执行。它不把 check.sh 放进 Agent 工作区。
#
# 用法：
#   bash environments/agentbench-os/run_vm_checks.sh preflight
#   bash environments/agentbench-os/run_vm_checks.sh run
#
# 可选环境变量：
#   LIMA_HOME=/Users/dsheval/.colima/_lima
#   LINUX_VM_INSTANCE=colima-dsheval-qemu
#   DATASETS_ROOT=/Users/dsheval/Projects/dsheval/datasets

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
DATASETS_ROOT="${DATASETS_ROOT:-$ROOT_DIR/datasets}"
LIMA_HOME="${LIMA_HOME:-$HOME/.colima/_lima}"
LINUX_VM_INSTANCE="${LINUX_VM_INSTANCE:-colima-dsheval-qemu}"
export LIMA_HOME

command -v limactl >/dev/null 2>&1 || {
  echo "MISSING limactl: install Lima/Colima on the macOS VM" >&2
  exit 2
}

case "${1:-preflight}" in
  preflight|run) ;;
  *) echo "usage: $0 [preflight|run]" >&2; exit 2 ;;
esac

# AgentBench OS 的 init/check 会创建系统用户并写入 /root、/testfile；Lima
# 默认登录用户是普通用户，因此必须在 guest 内以 root 执行整个验收脚本。
limactl shell "$LINUX_VM_INSTANCE" -- sudo -n bash -s -- "$DATASETS_ROOT" "${1:-preflight}" <<'LINUX_SCRIPT'
set -euo pipefail

DATASETS_ROOT="$1"
MODE="$2"
BASE="$DATASETS_ROOT/agentbench-os"
CASES=(
  agentbench-os-calc
  agentbench-os-count-files
  agentbench-os-date-format
  agentbench-os-recursive-permissions
  agentbench-os-shared-file-permissions
)

[[ "$(uname -s)" == "Linux" ]] || { echo "NOT_LINUX_GUEST" >&2; exit 3; }
for tool in bash python3 find useradd runuser; do
  command -v "$tool" >/dev/null 2>&1 || { echo "MISSING_GUEST_TOOL $tool" >&2; exit 4; }
done

for case in "${CASES[@]}"; do
  dir="$BASE/$case"
  [[ -f "$dir/question.json" ]] || { echo "MISSING $dir/question.json" >&2; exit 5; }
  [[ -f "$dir/private/check.sh" ]] || { echo "MISSING $dir/private/check.sh" >&2; exit 5; }
  [[ -f "$dir/private/environment.json" ]] || { echo "MISSING $dir/private/environment.json" >&2; exit 5; }
  python3 - "$dir/question.json" "$dir/private/environment.json" <<'PY'
import json, sys
for name in sys.argv[1:]:
    with open(name, encoding="utf-8") as f:
        json.load(f)
PY
  echo "READY $case"
done

if [[ "$MODE" == "preflight" ]]; then
  echo "LINUX VM PREFLIGHT PASS"
  exit 0
fi

fail=0
missing=0
ran=0
for case in "${CASES[@]}"; do
  dir="$BASE/$case"
  deliverables="$dir/deliverables"
  if [[ ! -d "$deliverables" ]]; then
    echo "SKIP $case: missing $deliverables (Agent output not prepared)"
    missing=1
    continue
  fi

  # Each case gets a clean guest-side seed. The private init code is trusted
  # evaluator input and never copied into the Agent workspace.
  rm -rf /tmp/dsheval-agentbench-os
  mkdir -p /tmp/dsheval-agentbench-os
  export HOME=/root
  init_code="$(python3 - "$dir/private/environment.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(data.get("create", {}).get("init", {}).get("code", ""))
PY
)"
  [[ -z "$init_code" ]] || bash -c "$init_code"

  old_path="$PATH"
  PATH="$deliverables:$PATH"
  export PATH
  ran=$((ran + 1))
  if bash "$dir/private/check.sh"; then
    echo "PASS $case"
  else
    echo "FAIL $case"
    fail=1
  fi
  PATH="$old_path"
  export PATH

  # Remove only resources seeded by the five AgentBench OS cases.
  rm -rf /tmp/dsheval-agentbench-os /root/videos /testfile
  for user in jack bill tom george; do
    userdel -r "$user" >/dev/null 2>&1 || true
  done
done

if [[ "$ran" -eq 0 ]]; then
  echo "NO CASES EXECUTED: prepare Agent deliverables first" >&2
  exit 2
fi
if [[ "$fail" -ne 0 || "$missing" -ne 0 ]]; then
  echo "LINUX VM CHECKS INCOMPLETE" >&2
  exit 1
fi
echo "LINUX VM CHECKS PASS"
LINUX_SCRIPT
