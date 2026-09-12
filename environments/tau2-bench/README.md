# tau2-bench 上游环境适配器

为 5 道 τ²-bench 题（retail ×2、telecom ×3）提供官方 DB + 领域工具 + 用户工具的执行服务。
工具逻辑使用官方 tau2 包（固定 commit），DB 数据按题包 databaseSeed 清单下载校验。

## 目录结构

```
tau2-bench/
├── requirements.txt    官方 tau2 包，固定提交（与各题 source.commit 一致）
├── tau2_env/
│   ├── env.py          DB 加载、工具实例化、动作执行、env_assertions 求值、sync_tools 复刻
│   ├── controller.py   逐题控制器（requestor 分派 agent/user 动作）
│   └── server.py       HTTP 服务
└── replay_test.py      本地验收：5 题 gold 动作回放 + env_assertions
```

## 部署（VM 上）

1. Python >= 3.12：
   ```bash
   python3.12 -m venv venv && source venv/bin/activate
   pip install -r environments/tau2-bench/requirements.txt
   ```
2. 下载数据（按 databaseSeed 清单 + sha256 校验）：
   ```bash
   python3 environments/tau-bench/fetch_data.py tau2-bench
   ```
3. 启动服务：
   ```bash
   python3 environments/tau2-bench/tau2_env/server.py   # 端口 8789（TAU2_ENV_PORT 可覆盖）
   ```
4. DSH 工具适配层协议（JSON）：

| 端点 | 请求 | 响应 |
|---|---|---|
| `GET /health` | - | `{"ok": true, "cases": [...]}` |
| `POST /cases/new` | `{"case_id": "tau2-bench-retail-010"}` | `{"ok": true, "case_id": ...}` |
| `POST /cases/<id>/execute` | `{"action": {"requestor": "agent", "name": "...", "arguments": {...}}}` | `{"result": "..."}` |

5. 用户模拟器：`private/scenario.json` 为官方 user simulator 配置（含 user_scenario），
   由 DSH 侧以 LLM 驱动模拟器逐轮产出用户消息；`requestor: "user"` 的动作转发到本服务
   （telecom 的 toggle_roaming / disconnect_vpn 走用户工具）。

## 验收清单（VM 上）

- [ ] `replay_test.py` 5/5 PASS（gold 动作零异常 + env_assertions 全满足）
- [ ] `/health` 200；`/cases/new` + `/execute` 往返正确
- [ ] DSH 工具适配器 + 用户模拟器接入后，任一题可端到端执行
