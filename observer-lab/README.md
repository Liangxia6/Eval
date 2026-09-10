# Observer Lab

这是独立于 DSHEval 工作流的只读单步工具。它不启动 DSH、不调用 Planner/Judge，也不写入 `var/`。

```bash
node observer-lab/bin/observer-smoke.mjs process describe
node observer-lab/bin/observer-smoke.mjs process baseline --output /tmp/process-before.json
node observer-lab/bin/observer-smoke.mjs process capture --output /tmp/process-after.json
node observer-lab/bin/observer-smoke.mjs process diff --before /tmp/process-before.json --after /tmp/process-after.json --output /tmp/process-diff.json
```

所有组件也支持统一的触发式事件流。`watch` 先在内存建立基线，仅当组件 `state`
摘要改变时才向 JSONL 追加一条 `dsheval.observer.event/v1`，无变化时事件流保持为空：

```bash
node observer-lab/bin/observer-smoke.mjs filesystem watch \
  --interval-ms 250 \
  --duration-ms 10000 \
  --case-id case.demo-1 \
  --agent-id agent.demo \
  --output /tmp/filesystem-events.jsonl
```

外部 Observer 只能证明变化发生在指定 Case 时间窗和资源范围内，事件会明确记录
`causality: NOT_PROVEN_BY_EXTERNAL_OBSERVER`；不得把同时发生的系统全局变化伪装成
Agent 的确定行为。Filesystem 应将 `root` 配成 Case workspace，Database、External API
应绑定该 Case 的独立实例或日志，才能获得更强关联。

组件：`filesystem`、`process`、`desktop`、`browser`、`database`、`network`、`external-api`、`clipboard`、`application`、`system`。

Database 和 External API 默认只观测服务状态；需要测具体实例时，在独立配置副本中启用对应只读查询、Mock 状态端点或请求日志。Secret 只通过环境变量传递，不写进配置。

Desktop 的窗口标题和截图、Browser 的标签页读取需要在 worker 图形桌面中给 Terminal/Node 授予“辅助功能”“屏幕录制”和“自动化”权限；通过纯 SSH 执行时会明确返回 `PARTIAL`，不会伪装成空桌面。
