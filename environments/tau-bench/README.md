# tau-bench 上游环境适配器

为 5 道 τ-bench 题（airline ×2、retail ×3）提供官方工具层 + 数据的执行服务。
工具实现 vendor 自 sierra-research/tau-bench（MIT，固定 commit），数据按题包
databaseSeed 清单下载校验，不随仓库分发。

## 目录结构

```
tau-bench/
├── vendor/tau_bench/envs/   官方 tool.py + airline/retail 的 tools/ 与 rules.py（MIT）
├── tau_env/
│   ├── env.py      数据加载（官方 dict 结构）、工具注册表、动作执行
│   ├── controller.py 逐题控制器（domain 推断 + scenario）
│   └── server.py   HTTP 服务（仅标准库）
├── fetch_data.py   按 question.json 的 databaseSeed 下载数据 + sha256 校验（也支持 tau2-bench）
└── replay_test.py  本地验收：5 题 gold 动作回放 + 终态断言
```

## 部署（VM 上）

1. 无需 pip 依赖（工具层只依赖标准库）：
   ```bash
   python3 environments/tau-bench/fetch_data.py tau-bench   # 下载 6 个数据文件（约 7 MB）并校验
   python3 environments/tau-bench/tau_env/server.py        # 端口 8788（TAU_ENV_PORT 可覆盖）
   ```
2. DSH 工具适配层协议（JSON）：

| 端点 | 请求 | 响应 |
|---|---|---|
| `GET /health` | - | `{"ok": true, "cases": [...]}` |
| `POST /cases/new` | `{"case_id": "tau-bench-airline-000"}` | `{"ok": true, "case_id": ...}` |
| `POST /cases/<id>/execute` | `{"action": {"name": "book_reservation", "kwargs": {...}}}` | `{"result": "..."}` |

3. 用户模拟器：`private/scenario.json` 的 `instruction` 为官方用户指令，由 DSH 侧以
   LLM 驱动模拟器逐轮对话；Agent 的工具调用转发到本服务执行。

## 验收清单（VM 上）

- [ ] `fetch_data.py tau-bench` 全部 sha256 校验通过
- [ ] `replay_test.py` 5/5 PASS（gold 动作执行无错误、终态一致：预订 HATHAT、
      改签 1N99U6、换货 #W2378156、地址变更/恢复、829.43 查询）
- [ ] `/health` 200；`/cases/new` + `/execute` 往返正确
- [ ] DSH 工具适配器 + 用户模拟器接入后，任一题可端到端执行
