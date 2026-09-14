# Collaboration AWS Travel

本地 dry-run 适配专题，包含 3 个旅行协作与委派 case。

- 来源：AWS Multi-agent Collaboration Scenario Benchmark（https://github.com/aws-samples/multiagent-collab-scenario-benchmark）。
- 标签：collaboration、reasoning-planning、tool-external。
- 依赖：Python 3.10+ 标准库；不连接真实航空、酒店、支付或 AWS 账户。
- 适配：以 Markdown 场景和工具返回替代动态 LiteLLM/外部系统，Agent 只交付 `output/plan.json`，必须保留角色分工、预算核算和最终确认门槛。
- 许可：代码 MIT-0，场景数据 CC BY 4.0；正式发布时保留归属。

本题包未修改 `src/datasets/catalog.ts` 或 `datasets/catalog.md`。