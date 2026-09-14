# Retrieval Hotpot Evidence

本地轻量适配专题，包含 3 个独立 evidence-grounding case。

- 来源：HotpotQA（https://hotpotqa.github.io/），固定来源标识见各题 `question.json`。
- 标签：retrieval-grounding、reasoning-planning。
- 依赖：Python 3.10+ 标准库；无需联网、向量库或模型服务。
- 适配：将小型候选段落随题注入 `input/context.md`，要求输出 `output/answer.json`，保留多跳/比较证据选择目标。
- 许可：上游 HotpotQA 数据为 CC BY-SA 4.0；正式发布时保留归属并复核再分发范围。

本题包未修改 `src/datasets/catalog.ts` 或 `datasets/catalog.md`。