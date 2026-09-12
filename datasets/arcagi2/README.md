# Harbor ARC-AGI-2 网格变换（dataset.harbor-arcagi2/v1）

从训练网格推断转换规则，对测试网格生成 JSON 结果。适合抽象推理与结构化产物交付，不要求固定工具路线。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, reasoning-planning
- 每题超时：1200–1800 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Node.js >=22
- 公开输入：无
- 交付产物：output/output.json

## 上游环境与前置条件（environment.upstreamConstraints）

- agent: <varies>
- verifier: {"timeout_sec": 300, "environment_mode": "separate", "environment": {"build_timeout_sec": 600, "cpus": 1, "memory_mb": 1024, "storage_mb": 2…

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- arcagi2-grid-transform-88e3：darwin，1800s，输出 output/output.json
- arcagi2-grid-transform-8b7b：darwin，1800s，输出 output/output.json
- arcagi2-grid-transform-a32d：darwin，1800s，输出 output/output.json
- arcagi2-grid-transform-de80：darwin，1200s，输出 output/output.json
- arcagi2-grid-transform-faa9：darwin，1200s，输出 output/output.json
