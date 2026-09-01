# Platform：MVP 开发规格

> 本文直接约束 MVP 代码生成。Platform 只提供单 VM 运行所需的配置、最小权限、健康检查、单 Run 锁和本地交付能力。

## 1. 固定范围

- 形态：Linux VM 内的 TypeScript 单进程模块化单体。
- 身份：`dsheval` 运行框架；`dshagent` 只运行被测完整 Agent。
- 隔离等级：`AGENT_SEPARATED`。Controller、Observer、Judge、Storage 和 Reporter 都是 `dsheval` 进程内模块，不声称拥有更多 OS 角色隔离。
- 容量：一个活动 Run，无远程调度、控制面或集群。
- 交付：本地 JSON/HTML 与最小校验 Manifest；不上传外部系统。

Platform 不包含 Planner、Runner、Sensor、Repository 或 Judge 的领域规则。

## 2. 文件职责

| 文件 | 唯一职责 |
|---|---|
| `src/platform/config.ts` | 读取、校验和冻结 MVP 配置及摘要 |
| `src/platform/security.ts` | 校验 `dsheval/dshagent` 边界、路径与 Secret 规则，记录安全事实 |
| `src/platform/services.ts` | 运行前健康检查、单 Run Lease、受控关闭 |
| `src/platform/export.ts` | 将已提交的最小报告复制为本地可校验交付目录 |

不得建设 DI 容器、服务注册中心、企业权限系统、远程控制 API 或遥测平台。

## 3. ConfigSnapshot

配置来源优先级：安全默认值 < 一个显式配置文件 < 允许列表环境变量 < CLI。未知字段、错误类型或路径冲突必须在创建 Run 前失败。

MVP 必填配置：

```text
configId
targetRoot, runRoot, artifactRoot, reportRoot
workspaceRoot, runtimeDshHomeRoot
runDeadlineMs, caseDeadlineMs
stableWindowMs, stableMaxWaitMs
maxArtifactBytes, contentMode
allowedModelEndpoints[]
minimumIsolationLevel=AGENT_SEPARATED
rendererVersion
```

`FULL_AGENT`、单 Run/Case/Attempt、`maxAttempts=1`、`dsh-eval.probe/v1` 和 `dsheval/dshagent` 是产品常量，不再做可变配置。DSH 可执行文件/Profile/Driver 由 TargetSnapshot 冻结。

所有根都解析为绝对路径并检查互不重叠。禁止 `/`、任一用户 Home、空值、未解析变量和 symlink 根；除专用 `targetRoot` 外，运行数据根不得指向仓库根。Run 前生成不可变 `ConfigSnapshot`，至少保存有效非秘密值、字段来源、平台/Node/DSHEval 版本、生成时间、SHA-256。Run 中配置变化必须启动新 Run，不能热改。

Secret 只保存引用名和“是否可解析”，不保存原值。具体值仅在启动 DSH 进程前以最小生命周期解析。

## 4. 两个 OS 身份的安全边界

### 4.1 `dsheval`

允许：读取 Packs/Target 元数据，创建 Workspace，读取 Probe 暂存，写 Data/Result/Export，执行 File Sensor、Judge 和 Reset。

禁止：把自身数据根权限、Docker Socket、sudo 通配能力或长期 Secret 交给 Agent。内部模块共享同一身份是 MVP 已知限制，报告必须显示 `isolationLevel=AGENT_SEPARATED`。

### 4.2 `dshagent`

只允许：

- 读取当前 Attempt 的只读输入。
- 写当前 Attempt 的输出、隔离 Runtime Home 和 Probe 协作暂存文件。
- 使用短期模型凭据访问冻结的模型端点。

必须拒绝：Packs/Ground Truth、Data/Evidence/Result/Report/Export 根、其他 Run Workspace、主机 Home、长期凭据、Docker Socket、环境管理入口和 sudo。

Preflight 以 `dshagent` 身份真实执行负向访问测试，而不是只检查配置字符串。任一敏感根可读写、身份相同或权限无法确认，都属于 `PLATFORM_SECURITY_FAILURE`，Run 不得启动。

## 5. Secret、日志与网络

- DSH 使用参数数组启动；Secret 不进入 argv、ConfigSnapshot、ControlEvent、错误、stdout/stderr 元数据、Report 或 Export。
- 仅以允许列表环境变量或受控文件描述符注入短期凭据；进程结束立即失效/清理引用。
- stdout/stderr、Probe、错误和 Report 在写入普通区域前执行字段级脱敏和 Canary 扫描。无法确认的内容标为 Restricted，只能留在不可导出 Artifact。
- `dshagent` 网络默认拒绝，只允许冻结的模型端点和当前文件场景明确需要的端点；MVP 文件场景通常只有模型端点。
- DSH 非必要遥测关闭。网络策略无法证明时必须披露限制，不能声明高保证安全 PASS。

## 6. 健康检查与单 Run Lease

Run 创建前只读检查：

- 四个根路径、权限、磁盘空间和同文件系统原子 Rename 能力。
- `dsheval/dshagent` 用户存在且不同，负向访问测试通过。
- DSH 可执行文件/Profile/Runtime Probe 与冻结摘要一致。
- Probe 暂存区可由 `dshagent` 写、可由 `dsheval` 读，可信数据根反向不可访问。
- File Sensor 能对测试目录执行只读 Before/After。
- 当前没有有效 Run Lease，也没有未确认 Reset 的旧 Run。

健康结果只有 `HEALTHY|FAILED`；任一强制项失败就不启动 Agent，不引入降级自动绕过。

Lease 使用 `runRoot` 内的一个排他锁，记录 `leaseId、runId、slotId=vm-global、state、ownerPid、ownerProcessStartToken、acquiredAt、releasedAt?`。存在有效 Lease 时拒绝第二 Run。不能只按超时删除旧锁：PID/启动令牌、旧 Run 终态和环境 Verification 都确认后，才允许人工/受控释放。

关闭顺序固定为：停止新工作 → 终止 Target → Observation Drain/Seal → 保存 Evidence/Judgement 或 Failure → Reset/独立 Verification/Cleanup → 唯一 Gate/Run 终态/Report → Flush Storage → 释放 Lease。不得先关 Storage、先删 Workspace或在复位收尾前生成 Gate。

## 7. 最小本地 Export

MVP Export 只在 Run 终态后执行，允许列表固定为：

- 已提交的 `report.json`。
- 由同一 JSON 渲染并已提交的 `report.html`。
- `manifest.json`，记录 Run ID、文件相对路径、长度和 SHA-256。

Exporter 通过 Storage Verified Read 读取，拒绝临时文件、绝对路径、路径穿越、symlink、摘要不符和 Restricted Artifact。在 `<reportRoot>/<runId>/.partial/<exportId>` 暂存，复核后原子 Rename 到 `delivery/<exportId>`。失败不改变 Run、Judgement 或 Verdict，只追加 `origin=DSHEVAL, actor=EXPORTER, category=REPORT_FAILURE` 的 Failure。

本地包不默认包含 Raw Trace、Ground Truth、Secret、Workspace 或内部配置。完整 Export 权限矩阵、远程上传、签名、加密和企业审批均不属于 MVP。

## 8. 错误与审计

Platform 产生的 Failure 使用 Core `FailureRecord`，通常为 `origin=DSHEVAL, actor=PLATFORM/EXPORTER`；环境收尾错误为 `origin=ENVIRONMENT`。它不能把故障改写成 `origin=TARGET`，也不能覆盖 `actor=JUDGE, category=JUDGE_FAILURE` 的记录。

至少记录：配置冻结、身份切换与权限拒绝、Lease 获取/释放、Target 启停/强杀、Secret 引用解析结果（不含值）、Reset/隔离、Artifact/Report/Export 成败。失败时保留此前日志和 Artifact；安全失败阻止新的危险动作。

| 情况 | 处理 |
|---|---|
| 配置/路径/身份错误 | Preflight 失败，不创建 Agent 进程 |
| Lease 冲突 | 拒绝新 Run，不抢占旧 Run |
| Secret 缺失 | 仅报告 Secret Ref 名，停止启动 |
| 权限负测失败 | `PLATFORM_SECURITY_FAILURE`，无可信 PASS |
| Reset Verification 失败 | 环境隔离，保留已有 Agent 结果，Run 以系统失败收尾 |
| Export 校验失败 | 不发布目录，不改变 Verdict |

## 9. 强制要求与验收

| ID | 要求 |
|---|---|
| `MVP-PLAT-REQ-001` | Run 前校验并冻结 ConfigSnapshot，固定单 Run/Case/Attempt 和 `maxAttempts=1` |
| `MVP-PLAT-REQ-002` | 真实使用不同的 `dsheval/dshagent` OS 身份，并披露 `AGENT_SEPARATED` |
| `MVP-PLAT-REQ-003` | `dshagent` 只能访问当前 Workspace/Runtime Home/Probe 暂存和允许网络 |
| `MVP-PLAT-REQ-004` | Secret 不进入 argv、普通存储、日志、报告或导出；不确定内容 Restricted |
| `MVP-PLAT-REQ-005` | 健康检查和权限负测失败时不得启动 Agent |
| `MVP-PLAT-REQ-006` | 同时只有一个有效 Run Lease，旧锁不按时间自动抢占 |
| `MVP-PLAT-REQ-007` | 关闭时先 Seal/保存证据，再 Reset，最后 Flush/释放 Lease |
| `MVP-PLAT-REQ-008` | 本地 Export 只含已提交允许列表文件，失败不改变 Verdict |

| ID | 验收条件 |
|---|---|
| `MVP-PLAT-AC-001` | 相同配置产生相同有效值摘要；未知字段、宽根和重叠路径被拒绝 |
| `MVP-PLAT-AC-002` | 两个 OS 用户确实不同，报告只声明实际 `AGENT_SEPARATED` 等级 |
| `MVP-PLAT-AC-003` | 以 `dshagent` 身份无法读取 target/run/artifact/report 根、其他 Workspace 和 Docker Socket |
| `MVP-PLAT-AC-004` | Canary Secret 出现在任一候选输出时被隔离，普通报告和 Export 无原值 |
| `MVP-PLAT-AC-005` | DSH/Profile/Probe/权限/磁盘任一失败均发生在 spawn 前 |
| `MVP-PLAT-AC-006` | 已有 Lease 时第二 Run 明确失败；不确定旧锁不会被自动删除 |
| `MVP-PLAT-AC-007` | 超时、取消、系统失败路径都按固定关闭顺序保留证据并验证 Reset |
| `MVP-PLAT-AC-008` | Export 摘要/路径/Restricted 检查失败时无最终目录，Run/Judgement/Verdict 不变 |

## 10. DEFERRED 扩展点

完整 Export 权限矩阵与归档包、企业 IAM/密钥轮换、独立 Observer/Judge OS 身份、Kubernetes/多 VM/远程调度、VM 生命周期、VPN/SSH 管理、集中遥测和远程上传全部延后。MVP 不写这些能力的实现细节或空服务。
