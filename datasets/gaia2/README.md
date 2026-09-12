# Harbor GAIA2（dataset.harbor-gaia2/v1）

在模拟邮件和日历应用中执行长链任务，并根据后续回复撤销、清理冲突和重新排期。测动态适应、工具循环与跨应用协作。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, collaboration, efficiency-reliability, loop, reasoning-planning, safety-boundary, tool-external
- 每题超时：1200–1200 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：ARE event-log and provenance collection；GAIA2 ARE MCP service；GAIA2 ARE MCP sidecar with private scenario；Node.js >=22
- 公开输入：无
- 交付产物：output/response.txt

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/scenario.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- gaia2-adapt-hard-1：darwin，1200s，输出 output/response.txt
- gaia2-adapt-hard-2：darwin，1200s，输出 output/response.txt
- gaia2-ambiguous：darwin，1200s，输出 output/response.txt
- gaia2-timed-1：darwin，1200s，输出 output/response.txt
- gaia2-timed-2：darwin，1200s，输出 output/response.txt
