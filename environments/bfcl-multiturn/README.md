# bfcl-multiturn 上游环境适配器

为 5 道 BFCL 多轮题提供模拟工具后端（6 个有状态 API 类）+ 逐轮门控控制器 + HTTP 服务。
部署后，DSH 侧的 Agent 通过工具适配器把函数调用转发到本服务，即可在真实多轮场景下执行题目。

## 目录结构

```
bfcl-multiturn/
├── vendor/            BFCL 官方模拟后端源码（Apache-2.0，原样 vendor，见 vendor/LICENSE）
├── bfcl_env/
│   ├── engine.py      执行引擎：按 Case 隔离实例、安全执行、结果序列化（与原版一致）
│   ├── controller.py  逐题加载 scenario；missed_function 逐轮门控
│   └── server.py      HTTP 服务（仅标准库）
└── replay_test.py     本地验收：5 题 groundTruth 回放 + 终态断言
```

## 本地验收（纯逻辑，无网络）

```bash
python3 environments/bfcl-multiturn/replay_test.py
# 期望输出：5 题全部 PASS
```

## VM 部署

1. 同步本目录到 VM（~350 KB）：`scp -r environments/bfcl-multiturn dsheval-vm:~/Projects/dsheval/environments/`
2. 启动服务（仅标准库，无需 pip 依赖）：
   ```bash
   cd ~/Projects/dsheval && python3 environments/bfcl-multiturn/bfcl_env/server.py
   # 监听 http://127.0.0.1:8787（可用 BFCL_ENV_PORT 覆盖）
   ```
3. DSH 工具适配层按下列协议转发 Agent 的函数调用：

| 端点 | 请求 | 响应 |
|---|---|---|
| `GET /health` | - | `{"ok": true, "cases": [...]}` |
| `POST /cases/new` | `{"case_id": "bfcl-multi-turn-base-1"}` | `{"ok": true, "case_id": ...}` |
| `POST /cases/<id>/execute` | `{"turn": 0, "calls": ["ls(a=True)", ...]}` | `{"results": ["...", ...]}` |

4. 放题：DSH 运行侧按 `private/scenario.json` 的 `question` 逐轮下发用户消息（第一轮公开，
   后续轮次只在对应轮次到达时下发）；每轮把 Agent 产生的函数调用串发给 `/execute`。

## 语义保真

- 执行引擎移植自 gorilla/berkeley-function-call-leaderboard 的 `multi_turn_utils.py`：
  调用改写、危险函数拦截、结果序列化、异常折叠为 `Error during execution: ...` 均与原版一致；
  唯一差异是实例存储从进程 globals 改为按 Case 隔离。
- `missed_function` 门控等价于原版"该轮函数尚未定义"的行为：调用返回
  `Error during execution: name '<fn>' is not defined`。
- 原版按 `initial_config` 注入状态；长上下文题（`long-context` 目录名）会带 `long_context=True`
  加载，与官方评测路径一致。

## 验收清单（VM 上）

- [ ] `replay_test.py` 5/5 PASS（gold 轨迹零错误 + 终态一致）
- [ ] `/health` 200；`/cases/new` + `/execute` 往返正确
- [ ] DSH 工具适配器接入后，任一题可由 Agent 实际执行并比对 gold 轨迹
