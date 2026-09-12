# Harbor Humanity's Last Exam（dataset.harbor-hle/v1）

阅读 Argand 图回答量子隧穿物理问题。需要读取本地图片，测多模态理解与物理推理。

## 题目规模

- 本地题包：8 题
- 能力标签：artifact-delivery, multimodal, reasoning-planning
- 每题超时：1800–1800 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Node.js >=22；image-reading-tool
- 公开输入：input/image.gif×1、input/image.jpg×1、input/image.png×3
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- agent: {}
- verifier: {"timeout_sec": 300, "environment_mode": "separate", "environment": {"build_timeout_sec": 600, "cpus": 1, "memory_mb": 2048, "storage_mb": 1…

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- hle-dirac-fermion-tunneling：darwin，1800s，输出 output/response.txt
- hle-fibered-category-schemes：darwin，1800s，输出 output/response.txt
- hle-identify-city-from-photo：darwin，1800s，输出 output/response.txt
- hle-identify-ingvar-runestone：darwin，1800s，输出 output/response.txt
- hle-interval-coverage-bound：darwin，1800s，输出 output/response.txt
- hle-name-alkaloid-compound：darwin，1800s，输出 output/response.txt
- hle-shock-wave-density-profile：darwin，1800s，输出 output/response.txt
- hle-vowel-marking-system：darwin，1800s，输出 output/response.txt
