# Harbor BixBench（dataset.harbor-bix/v1）

按甲基化阈值筛选寒鸦基因组的年龄相关 CpG，计算全基因组平均染色体密度。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, reasoning-planning, tool-code, tool-data
- 每题超时：1200–1200 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：BixBench capsule 4dceea58-7d66-4576-bfc6-88c026d5b7a9 seeded to input/；BixBench capsule a02b761a-02b6-46b5-9d5e-2964d5a74960 seeded to input/；BixBench capsule f4dcda89-678d-403d-b155-1483d0071765 seeded to input/；BixBench capsule fbe0e950-76f2-4eb7-a216-a2d377970922 seeded to input/；BixBench capsule input；Node.js >=22；Python/R scientific stack
- 公开输入：无
- 交付产物：output/answer.txt

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- bix-cpg-density-jackdaw：darwin，1200s，输出 output/answer.txt
- bix-diff-expr-mirna：darwin，1200s，输出 output/answer.txt
- bix-filter-chip-variants：darwin，1200s，输出 output/answer.txt
- bix-immune-pathway-enrichment：darwin，1200s，输出 output/answer.txt
- bix-ordinal-logit-covid：darwin，1200s，输出 output/answer.txt
