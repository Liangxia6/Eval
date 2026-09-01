# DSHEval MVP

DSHEval MVP 是一个面向完整 DSH Agent 的本地、单进程评测纵向切片。它固定执行一个 filesystem Case 和一次 Attempt，以 DSH Runtime Probe 解释执行过程，以独立文件 Before/After 验证真实结果，保存证据与三项确定性 CheckResult，独立验证 Reset 后只计算一次 Gate，并交付 JSON、JSONL、Artifact、`status.html` 和 `report.html`。

实现范围严格以 [`docs-simple`](./docs-simple/README.md) 为准。MVP 不包含并发 Run、重试、多 Case、插件 Target、远程调度、面向公网的在线报告或未来兼容层。仓库额外提供一个只读回环 Viewer，方便经 SSH 隧道查看同一 VM 上已经落盘的静态状态与报告；它不是新的评测事实源。

## 环境

- Node.js 22 或更高版本；
- pnpm 11.24.0；
- 正式评测需要 Linux Appliance VM、util-linux 的 `/usr/bin/setpriv`、相互独立的 `dsheval`/`dshagent` OS 身份，以及 DSH `0.1.1-rc.2` Headless + `dsh-eval.probe/v1`；
- 如真实 Agent 需要模型凭据，只在配置的 `secretRefNames` 中写环境变量名称，绝不能把 Secret 值写入配置、TargetDescriptor 或命令行。

安装并验证：

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
pnpm test
pnpm build
```

## CLI

构建后使用 `pnpm --silent cli -- ...`（或直接执行 `node dist/src/app/cli.js ...`）。CLI 进程的 stdout 始终只有一行可解析 JSON；诊断写入 stderr；`--silent` 用于抑制 pnpm 自己的脚本提示行。

```bash
# 冻结并检查 Target
pnpm --silent cli -- inspect \
  --target examples/fixture-target.json \
  --config examples/mvp.config.json \
  --fixture

# 生成唯一 filesystem 计划，不创建执行 Run/Attempt
pnpm --silent cli -- plan \
  --target examples/fixture-target.json \
  --config examples/mvp.config.json \
  --fixture

# 执行完整十步链路
pnpm --silent cli -- run \
  --target examples/fixture-target.json \
  --config examples/mvp.config.json \
  --fixture \
  --fixture-behavior copy

# 从已提交且摘要有效的 report.json 确定性重渲染或验证 HTML
pnpm --silent cli -- report --run <run-id>
```

`run` 和 `plan` 可通过 `--pack <directory>` 指定唯一 filesystem pack；未指定时使用仓库的 `packs/`。可用 `--run-id <stable-id>` 预分配 ID。若报告根不是默认的 `var/reports`，向 `report` 传 `--report-root <directory>`；`--max-bytes` 必须与生成报告时的上限相容。

退出码遵循冻结契约：`0=PASS/成功`、`1=FAIL`、`2=PLAN_UNSATISFIABLE`、`3=UNEVALUABLE`、`4=DSHEval 或交付失败`、`130=用户取消`。操作性失败优先，但只要 Gate 已存在，stdout JSON 仍保留 Gate。

## VM 实时查看

Viewer 只读取指定 Run 的 `status.html` 和 `report.html`：Run 尚未创建时显示等待页，运行中每 2 秒刷新，最终报告生成后自动切换并停止刷新。它不公开 JSON、JSONL、Artifact 或目录列表，也只允许监听 `127.0.0.1`/`::1`。

先在 VM 的一个终端启动 Viewer；`--run` 必须和随后评测命令的 `--run-id` 完全一致：

```bash
pnpm build
pnpm --silent viewer -- \
  --run vm-run-001 \
  --run-root /absolute/path/to/Eval-simple/var/records \
  --report-root /absolute/path/to/Eval-simple/var/reports \
  --host 127.0.0.1 \
  --port 4173
```

在本机建立 SSH 隧道并打开浏览器：

```bash
ssh -N -L 4173:127.0.0.1:4173 <vm-user>@<vm-host>
open http://127.0.0.1:4173/
```

最后在 VM 的另一个终端启动真实评测：

```bash
pnpm --silent cli -- run \
  --run-id vm-run-001 \
  --target /absolute/path/to/real-target.json \
  --config /absolute/path/to/vm.config.json
```

不要把 Viewer 绑定到 `0.0.0.0` 或暴露到公网。浏览器中的实时页是非权威的运维视图，只展示最后一次已提交的状态；`report.json`、密封摘要和最终 Gate 仍是权威结果。

## Fixture 与正式评测

当前仓库只带一套纵向切片资产，用于证明评测闭环而不是覆盖 DSH 的全部能力：

- 1 个评测域：文件系统；
- 1 个场景：把 `input/source.txt` 原样复制到 `output/result.txt`；
- 1 条固定公开输入样本；
- 3 项确定性硬标准：执行协议完整、路径边界合规、目标文件内容完全一致。

因此当前结果只能说明这一个文件 Case 是否通过，不能解释为 DSH 的综合能力分数。新增测试集时应继续以 `Environment + Scenario + Domain + Judge` 四类冻结资产为一个可审计单元。

[`fixture-target.json`](./examples/fixture-target.json) 调用真实子进程和真实文件系统，不生成 Mock 成功结果；它仅用于自动化验收。`inspect`/`plan` 必须显式传 `--fixture`，完整 `run` 还必须给出具体的 `--fixture-behavior`，不能隐式假定成功行为。输出会标记 `fixture: true` 与 `securityIsolation: PROCESS_FIXTURE`。Fixture 不能证明 VM 的 OS 身份隔离，也不能作为正式发布的安全 PASS。

正式评测时使用实际 TargetDescriptor，移除 `--fixture`，并确保：

- `sourceRoot` 中存在真实 DSH 入口、`dshHome`、Profile、包版本和已脱敏的 `effective-config.json`；
- `targetIdentity` 是 VM 中的低权限 `dshagent`；
- 框架由 `dsheval` 身份运行，`dshagent` 无法读取 Target/records/artifacts/reports 等受限根；
- Target 只能写当前 Attempt Workspace、Runtime Home 和 Probe 暂存区。

`dsheval` 控制器必须由服务管理器只授予 `CAP_SETUID`、`CAP_SETGID`，以便通过 `/usr/bin/setpriv` 切换到冻结的 `dshagent` UID/GID；不要给通用 Node 可执行文件设置 file capabilities，也不要配置 sudo。一个最小的 systemd 服务约束如下（其他路径和环境仍按 Appliance 实际值配置）：

```ini
User=dsheval
Group=dsheval-attempt
AmbientCapabilities=CAP_SETUID CAP_SETGID
CapabilityBoundingSet=CAP_SETUID CAP_SETGID
NoNewPrivileges=yes
```

Preflight 和真实 DSH 使用同一条受控启动路径。该路径在执行目标前清空 supplementary groups、inheritable/ambient capabilities，并启用 `no_new_privs`；Preflight 还会在实际 `dshagent` 进程中检查 UID、GID、`CapInh/CapPrm/CapEff/CapAmb` 与 `NoNewPrivs`。任何一项不能确认都会保存为 Platform Security Failure 并阻止 Agent 启动。

正式模式只会验证这些隔离条件，不会替 VM 修改用户、ACL 或防火墙。推荐在 Appliance 镜像中预置一个仅用于 Attempt 的主组（上例为 `dsheval-attempt`）：`dsheval` 与 `dshagent` 使用不同 UID，服务进程的有效 GID 与 `dshagent` 的 primary GID 都设为该组。`setpriv --clear-groups` 会清除 supplementary groups，因此权限不能依赖 `dshagent` 的附加组。`workspaceRoot` 与 `runtimeDshHomeRoot` 应由 `dsheval:dsheval-attempt` 持有并设为 setgid，对该组只授予 traverse（不能 list/read/write）；框架创建的三级 `run/case/attempt` 路径最终只让当前 Attempt 目录获得组读写。Target、records、artifacts、reports、框架 HOME、Docker socket 与 sudo 配置不得向 `dshagent` 开放。若使用 POSIX ACL，实现同样的“父级仅 traverse、精确 Attempt 可读写”语义即可。

VM 还必须预先实施按 `dshagent` 身份生效的默认拒绝 egress 策略，只允许配置中 `allowedModelEndpoints` 的 HTTPS 主机/端口。Preflight 会以该 UID 正向连接全部允许端点，并反向探测公共非允许端点；任一结果不符都会阻止 Target 启动。模型 Secret 应先注入 `dsheval` 进程环境，再仅把变量名列入 `secretRefNames`；变量缺失、使用 harness 保留名称，或 Secret canary 出现在 Probe/stdout/stderr/普通记录/报告中都会 fail closed。

因此，正式命令只有在上述 VM 配置已经完成后才应运行：

```bash
MODEL_API_KEY='replace-in-VM-secret-store' \
pnpm --silent cli -- run \
  --target /absolute/path/to/real-target.json \
  --config /absolute/path/to/vm.config.json
```

配置文件只写 `"secretRefNames": ["MODEL_API_KEY"]`，不写变量值。正式发布还必须在该 VM 上执行文档中的 `MVP-CT-REAL-001`；本仓库的 Fixture 结果不能替代它。

TargetDescriptor 的 `sourceRoot` 可相对描述文件定位；如果显式提供 `contentDigest`，`sourceRoot` 必须是绝对路径。示例配置中的相对数据根以启动 CLI 时的当前目录解析。未知字段、错误类型、宽根、symlink 根和相互重叠的根会在创建 Run 前拒绝。

## 产物

默认位置如下：

```text
var/records/<run-id>/       JSON、状态迁移 JSONL、status.html
var/artifacts/<run-id>/     内容寻址 Artifact 与 index.jsonl manifest
var/reports/<run-id>/       report.json、report.html、delivery/
var/workspaces/             Attempt Workspace（Reset 验证后清理）
var/runtime-homes/          Attempt DSH Home（收尾后清理）
```

`report.json` 是唯一权威报告。`status.html` 只展示已经提交的十步进度；`report.html` 只从重新读取且摘要有效的 JSON 渲染，不运行 Judge，也不会改变已经保存的 Gate。
