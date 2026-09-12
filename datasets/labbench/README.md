# Harbor LabBench（dataset.harbor-labbench/v1）

阅读生物学实验图回答问题，测多模态理解与推理。

## 题目规模

- 本地题包：4 题
- 能力标签：artifact-delivery, multimodal, reasoning-planning
- 每题超时：1200–1200 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Node.js >=22；image-reading-tool
- 公开输入：input/figure.jpg×4、input/options.json×4
- 交付产物：output/answer.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- agent: {"build_timeout_sec": 600, "cpus": 1, "memory_mb": 2048, "storage_mb": 2048}
- verifier: {"timeout_sec": 300, "environment_mode": "separate", "environment": {"build_timeout_sec": 600, "cpus": 1, "memory_mb": 2048, "storage_mb": 2…

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- labbench-count-deg-in-pathway：darwin，1200s，输出 output/answer.txt
- labbench-habenula-fluorescence-change：darwin，1200s，输出 output/answer.txt
- labbench-highest-auc-neuron-set：darwin，1200s，输出 output/answer.txt
- labbench-read-asap2f-step-response：darwin，1200s，输出 output/answer.txt
