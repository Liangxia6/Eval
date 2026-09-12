# Harbor ReplicationBench（dataset.harbor-replicationbench/v1）

复现实证天文学分析，定位 Gaia DR2 样本垂直速度峰值的两个银河中心半径。测科研数据分析、代码工具与数值复现。

## 题目规模

- 本地题包：1 题
- 能力标签：artifact-delivery, loop, reasoning-planning, tool-code, tool-data
- 每题超时：10800–10800 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Gaia DR2 FITS private seed；Node.js >=22；Python scientific stack
- 公开输入：input/dataset_info.json×1、input/download_datasets.py×1、input/paper_masked.json×1
- 交付产物：output/result.json

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- replicationbench-find-galactic-vz-peaks：darwin，10800s，输出 output/result.json
