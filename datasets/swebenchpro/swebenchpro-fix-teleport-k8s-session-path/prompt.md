# Kubernetes 会话路由离线修复

你是可使用工具和修改工作区文件的 Agent。

输入 request、clusters、local_cluster。request 为空或不在 clusters 时返回 {error:NotFound}。目标 kind=local：返回 addr、tls、new_certificate=false；kind=remote：返回 addr="tunnel:"+目标名、tls="remote-root-ca"、new_certificate=true。kind=service：按 endpoints 输入顺序选首个，返回 addr 和 server_id=endpoint.name+"."+目标名，new_certificate=true；无端点返回 {error:BadParameter}。不连接任何网络。
`input/buggy.py` 是需修复的最小模型；复制到 output/solution.py 后修复。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写最小 Python 行为模型；不是原仓库补丁，未测原框架集成。
- 保留缺陷的输入边界和正确行为；测试对象仍须编写并交付可运行程序。
