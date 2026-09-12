# Harbor WideSearch（dataset.harbor-widesearch/v1）

全量检索并整理 2025 年 1–5 月竣工的一带一路中企海外项目，交付单一中文 Markdown 表格。测广域网页检索、证据整合与结构化交付。

## 题目规模

- 本地题包：1 题
- 能力标签：artifact-delivery, efficiency-reliability, loop, reasoning-planning, retrieval-grounding, tool-web
- 每题超时：1200–1200 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Node.js >=22；public-web-access
- 公开输入：无
- 交付产物：output/output.md

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/eval_config.json
- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- widesearch-list-bri-projects-2025：darwin，1200s，输出 output/output.md
