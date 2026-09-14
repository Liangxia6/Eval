# AgentOps Reliability（dataset.ops-agentops-reliability/v1）

4 个轻量级、无外部依赖的可靠性题包，覆盖超时恢复、工具返回校验、限流退避和工具输出中的提示注入边界。

题目是基于 AgentOps-Bench 可靠性关注点编写的自包含适配题，不复制上游私有 fixture，也不宣称等同于官方分数。每题只要求在评测器提供的工具模拟环境中完成一次确定性的恢复或拒绝动作。

## 题目

- ops-agentops-timeout-recovery
- ops-agentops-malformed-response
- ops-agentops-rate-limit-backoff
- ops-agentops-injection-boundary

## 来源

- https://github.com/kunwarshivam/agentops-bench
- 本批为 `adapted-pilot-2026-09-12` 的自包含适配；运行不需要上游 Python、网络或第三方服务。
