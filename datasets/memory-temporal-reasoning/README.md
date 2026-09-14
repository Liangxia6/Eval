# LongMemEval temporal reasoning

本专题为轻量本地适配，共 2 个 case。来源：https://github.com/xiaowu0162/LongMemEval，固定标识见各题 `question.json`。

- 标签：memory、reasoning-planning。
- 依赖：Python 3.10+ 标准库；无需联网、数据库或模型服务。
- 适配：将短上下文随题注入，要求从时间有序的记忆中回答并给出证据 ID；不调用上游评测器。
- 说明：题面和答案为小型适配样本，不代表上游 benchmark 全量分数；正式发布需按上游许可保留归属。
