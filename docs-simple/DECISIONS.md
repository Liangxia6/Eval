# DSHEval MVP 架构决策

> 本表记录已经冻结、会直接影响实现的取舍。改变任一项前，必须同步修改产品、架构、公共契约、纵向切片和测试。

| ID | 决策 | 原因与直接后果 |
|---|---|---|
| `MVP-ADR-001` | `docs-simple/` 是独立 MVP 实现基线 | 不把完整版能力混入当前代码；`docs/` 仅作未来扩展背景 |
| `MVP-ADR-002` | 只测 `FULL_AGENT` | 先证明整体闭环；插件只进入快照，不实现安装、append/replace 或独立评分 |
| `MVP-ADR-003` | 固定 DSH `0.1.1-rc.2` Headless + Runtime Probe | 降低首版兼容变量；实际版本仍写入 TargetSnapshot，版本不符在 Preflight 停止 |
| `MVP-ADR-004` | 单台 Appliance VM 内的模块化单体 | 便于快照、复位和排障；不引入网络服务、微服务或分布式一致性 |
| `MVP-ADR-005` | 单活动 Run、单 Case、单 Attempt，`maxAttempts=1` | 排除并发与重试歧义；任何失败都保存事实并结束，不重试到通过 |
| `MVP-ADR-006` | 唯一场景是确定性文件复制/写入 | 用低依赖任务验证完整链路；PostgreSQL、HTTP、Browser 均为 `DEFERRED` |
| `MVP-ADR-007` | 两大 Port 保留，但实现范围受限 | Asset Matching 仅 filesystem pack；整体 Observation 同时采 Probe 与 File，而 Environment Observation Port 仅负责 File Sensor，不建通用工厂 |
| `MVP-ADR-008` | Trace 与文件状态是独立证据 | Probe 为 `COOPERATIVE`、File Sensor 为 `INDEPENDENT`；冲突同时保留，工具自报成功不等于结果正确 |
| `MVP-ADR-009` | 只做三个确定性 Judge | Protocol、File State、Path Security 足以验证首条链路；不使用 LLM/语义 Judge或综合分 |
| `MVP-ADR-010` | Verdict 固定为三值 | 硬错误=`FAIL`，证据不足/无效/信任不足=`UNEVALUABLE`，全部强制 Check 通过才=`PASS` |
| `MVP-ADR-011` | Reset 后进行独立 File Verification | Controller 不能自证复位成功；失败隔离环境但不改已保存 Agent Verdict |
| `MVP-ADR-012` | 本地 JSON/JSONL/Artifact 是权威存储 | 避免数据库和迁移复杂度；密封对象不可覆盖，所有引用用摘要验证 |
| `MVP-ADR-013` | HTML 是静态只读视图 | `status.html` 用于逐步排障，`report.html` 展示最终 JSON；页面不运行 Judge、不产生新事实 |
| `MVP-ADR-014` | 保持 8 模块、28 组件，不继续拆层 | 以纵向切片控制复杂度；新抽象必须有当前调用方和测试，禁止空壳/未来工厂/万能基类 |
| `MVP-ADR-015` | 正式评测不修改被测 Agent | 修改源码、Prompt、插件或配置会改变 Target；Gap、Repair 和自动改进全部 `DEFERRED` |

## DEFERRED 清单

以下能力不属于当前实现，也不需要伪接口之外的代码：

- 插件 Target、插件树差异测评；
- PostgreSQL、HTTP、Browser、网络、工业 Sensor；
- 多 Run/多 Case 并发、自动 Retry；
- Check Activation 自动补测、Gap Planner；
- Repair Agent、源码自动修改；
- Multi-Agent、Memory、Compaction、Skill 专项；
- LLM/语义 Judge、远程 Web 服务、数据库后端。

未来能力只能通过新的资产、Port 实现、Judge 和新版本文档进入，不能修改旧 Run 的冻结输入或密封证据。
