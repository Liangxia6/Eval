# Storage：MVP 开发规格

> 本文直接约束 MVP 代码生成。Storage 是本地、单 Writer、可校验的事实仓库，不是通用数据库或事件平台。

## 1. 固定范围

| 项目 | MVP 决策 |
|---|---|
| 后端 | VM 本地文件系统 |
| 数据 | 不可变 JSON、追加式 JSONL、二进制/文本 Artifact |
| 并发 | 单进程、单活动 Run、单 Writer |
| 查询 | 按 Run/Case/Attempt/对象 ID 读取与回链 |
| 恢复 | 检测中断/损坏并阻止错误继续，不自动修复历史 |

Storage 只保存调用方已经生成的事实，不规划、不观察、不 Closure、不 Judge、不重算 Report。

## 2. 文件职责

| 文件 | 唯一职责 |
|---|---|
| `src/storage/repositories.ts` | 创建不可变 JSON、追加 JSONL、读取/校验 Scope 和摘要、保存生命周期与 Failure |
| `src/storage/artifacts.ts` | Artifact 暂存、Seal、Commit、Verified Read，以及非权威 `status.html` 原子替换 |

不得增加 ORM、Repository 子类树、Unit of Work、消息总线、通用查询 DSL 或数据库抽象层。

## 3. 目录与路径

正式根由 ConfigSnapshot 的 `runRoot/artifactRoot/reportRoot` 冻结，必须是互不重叠的绝对路径、由 `dsheval` 拥有且 `dshagent` 不可读写。每个 Run 使用：

```text
<runRoot>/<runId>/
├── records/<kind>/<objectId>.json
├── events/lifecycle.jsonl
├── events/failures.jsonl
├── events/raw-observations.jsonl
└── status.html

<artifactRoot>/<runId>/
├── objects/<artifactId>
└── index.jsonl

<reportRoot>/<runId>/
├── report.json
└── report.html
```

- `records/` 保存 Config、Target、Plan、Run/Case/Attempt、Observation Status/Seal、Evidence/Closure、Judgement/Result、Reset Verification 等不可变对象。
- `events/` 保存只追加事实；每行包含 Schema、Scope、事件 ID、时间和摘要。
- `artifactRoot` 保存 Probe JSONL、File Snapshot、stdout/stderr 等当前 MVP 大内容。
- Workspace 位于独立 `workspaceRoot`，不属于可信根，Reset 不得触碰 Run、Artifact 或 Report 根。

所有 `<runId>/<kind>/<objectId>` 都先按允许字符和长度校验；拼接后 realpath/父路径必须仍位于预期根。禁止绝对用户路径、`..`、symlink 跳转、Glob 和未解析变量。

## 4. 两个最小存储接口

### 4.1 Repository

只暴露公共契约中的四个行为：

- `putImmutable(record)`：按 Schema/ID/Digest 提交不可变记录；同 ID/同摘要幂等，同 ID/不同摘要拒绝。
- `createProjection(initialProjection)`：只创建 Revision 0 的生命周期投影。
- `appendTransition(transition)`：校验 expectedRevision 后追加 LifecycleEvent 并提交下一 Revision。
- `get(ref)`：按完整 Ref 复核 Schema、Scope、Revision 和摘要后读取。

Failure、RawObservation 和 Artifact Index 是否落为 JSON 或预定义 JSONL 是 Repository 内部存储策略，不再暴露第二套通用 `appendEvent/listByScope` Port。离线回链从已提交 Ref 图开始，不通过自由查询猜测关系。

生命周期的追加事件是审计来源。可以生成当前状态缓存，但缓存不是权威事实，损坏时只能从合法事件重建。

### 4.2 Artifact Store

```text
STAGING → SEALED → COMMITTED
STAGING/SEALED → INVALID
```

1. Storage 在数据根内分配随机暂存路径；调用方不能指定最终绝对路径。
2. 写完后 Flush/Sync，计算 SHA-256 和字节数，校验大小/媒体类型。
3. Seal 后设为只读；原子 Rename 并写 Artifact Index 后才返回 `ArtifactRef`。
4. `ArtifactRef` 精确使用公共契约字段：`artifactId、scope、artifactType、logicalName、mediaType、portablePath、byteLength、artifactContentDigest、producerVersion、createdAt、sensitivity、redactionState、state、contentDigest`。
5. 消费者通过 `readVerified(ref, scope, purpose)` 读取；读取前后都复核用途、Scope、路径、长度和双摘要。

Committed Artifact 永不原地覆盖、追加或重新脱敏。新内容必须新 Artifact ID；篡改使读取失败并产生 SYSTEM Failure。

## 5. 写入规则

- 不可变 JSON 直接保存公共契约定义的记录本身，不再包一层 `payload` Envelope；`kind` 只用于目录路由，不进入记录 Schema。摘要按该公共记录排除自身摘要字段后的规范化内容计算。写临时文件、Flush、原子 Rename；完成 Rename 前不得被读取为已提交。
- JSONL 由唯一 Writer 追加完整一行并 Flush；每条有唯一 event ID 和内容摘要。
- 所有引用对象只能引用已经 Commit 的对象/Artifact；悬空、跨 Run/Case/Attempt 的 Ref 被拒绝。
- Failure 是 append-only；不得因为后续成功而删除、覆盖或隐藏旧 Failure。
- `status.html` 可原子替换，但明确是非权威排障页；失败保留上一个版本。权威 `report.json/report.html` 作为不可变终态对象保存。
- Secret 原值不得进入普通 JSON/JSONL/Report。无法确认安全的大内容标为 Restricted，默认不导出。

## 6. 强制提交顺序

同一 Run 必须保持以下顺序，Storage 应拒绝违反前置关系的写入：

```text
1. Config/Target/Inspection/Plan 与 Run/Case/Attempt 创建事实
2. Seed ControlEvent、SeedManifest、File Before Artifact/记录、Observation ACTIVE
3. Target 终止事实、stdout/stderr、Probe/File After/Diff Artifact
4. RawObservation → CollectionStatus → Observation Seal
5. EvidenceBundle → EvidenceClosure
6. Judgement/CheckResult；Judge ERROR 时同时提交 Judge Failure，CheckResult 固定为 UNEVALUABLE
7. Reset ControlEvent → 独立 File Verification → Environment 终态
8. 唯一 Gate → Run 终态 → Report JSON → Report HTML → 可选本地 Export Manifest
```

因此：Observation Seal 早于 Closure；Reset 晚于已提交 Evidence 和判定事实；Gate 只在 Reset/Verification/Cleanup 事实提交后生成一次；Reset 删除 Workspace 时不会删除任何 committed Artifact。任一步失败先追加 Failure，再继续执行安全收尾允许的写入。

## 7. 启动检查与失败保留

进程启动时检查：

- 是否存在另一活动 Run/Lease。
- `.tmp/.partial` 文件是否存在；它们不能冒充 committed 对象。
- JSONL 是否有坏尾、重复 event ID 或断裂 Scope。
- committed Artifact Index 与文件是否匹配。
- 上一个 Run 是否停在非终态、环境是否已独立验证。

MVP 不自动删除、截断或猜测修复。发现不确定状态就追加/报告 `STORAGE_RECOVERY_REQUIRED` 并阻止新 Run；人工确认后可以开始新的 Run，但旧事实仍保留。

| 故障 | 处理 |
|---|---|
| 同 ID 不同内容 | 拒绝，记录 `IMMUTABILITY_CONFLICT` |
| 临时写/rename/fsync 失败 | 不发布对象或 Ref，记录 `PERSISTENCE_FAILURE` |
| JSONL 坏尾 | 保留文件和最后合法偏移，阻止把坏尾当事实 |
| Artifact 缺失/摘要不符 | Verified Read 失败，依赖证据不可用 |
| 磁盘不足 | 停止新工作，尽力写 Failure/终止事件，不声明成功 |

上述均为 `origin=DSHEVAL, actor=STORAGE` 的系统侧 Failure。Agent 执行失败和 Judge 失败可由 Storage 保存，但 Storage 不改变它们的 origin、actor 或 category。

## 8. 强制要求与验收

| ID | 要求 |
|---|---|
| `MVP-STORE-REQ-001` | 只使用本地 JSON/JSONL/Artifact，单 Writer 保存唯一活动 Run |
| `MVP-STORE-REQ-002` | immutable JSON 和 committed Artifact 同 ID 异内容必须拒绝 |
| `MVP-STORE-REQ-003` | Artifact Commit 后不可修改，读取必须复核 Scope、长度和 SHA-256 |
| `MVP-STORE-REQ-004` | 所有路径限制在冻结根内并拒绝绝对注入、`..`、symlink 和 Glob 逃逸 |
| `MVP-STORE-REQ-005` | Observation Seal→Closure→判定/Failure→Reset 的提交顺序不可颠倒 |
| `MVP-STORE-REQ-006` | Failure 和部分 Artifact 始终保留，后续成功不得覆盖旧事实 |
| `MVP-STORE-REQ-007` | Agent 无法访问数据根；Secret/Restricted 内容不进入普通报告 |
| `MVP-STORE-REQ-008` | 启动发现中断或损坏时阻止新 Run，不自动伪造恢复成功 |

| ID | 验收条件 |
|---|---|
| `MVP-STORE-AC-001` | 从 Run ID 可离线定位完整 JSON、JSONL 和 Artifact 引用链 |
| `MVP-STORE-AC-002` | 重复同内容写幂等；改一个字节后相同 ID 被拒绝 |
| `MVP-STORE-AC-003` | Artifact 被替换、截断或篡改后 Verified Read 必然失败 |
| `MVP-STORE-AC-004` | 路径穿越、根外 symlink 和跨 Run Ref 在写入前被拒绝 |
| `MVP-STORE-AC-005` | Reset 早于 Evidence/Judgement 时写入被拒绝；合法顺序可完整回放 |
| `MVP-STORE-AC-006` | 超时、Agent 失败、Sensor 失败、Judge 失败后已提交前缀仍存在且 origin 不变 |
| `MVP-STORE-AC-007` | 以 `dshagent` 身份无法遍历数据根；Restricted Artifact 不进入 report/export |
| `MVP-STORE-AC-008` | 残留 temp、JSONL 坏尾和活动 Run 均使新 Run 明确失败而非静默继续 |

## 9. DEFERRED 扩展点

数据库/对象存储后端、多 Writer、分布式事务、复杂 CAS/Fence、LateArrival Reservation 与恢复、自动历史修复、全文/跨 Run 分析和正式数据删除全部延后。MVP 不创建这些抽象的空实现。
