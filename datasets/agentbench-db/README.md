# AgentBench DBBench（dataset.agentbench-db/v1）

对完整本地数据表 Jiu-Jitsu Championships Results 执行 SQL，完成 other 查询；需要检查表结构、解释筛选和聚合条件，并交付查询结果。材料为公开表格 JSON 和 Python 标准库 SQLite 工具。

## 题目规模

- 本地题包：16 题
- 能力标签：artifact-delivery, reasoning-planning, tool-data
- 每题超时：600–600 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：Python >=3.9 with standard-library sqlite3
- 公开输入：input/LICENSE×16、input/README.md×16、input/db_tool.py×16、input/table.json×16
- 交付产物：output/answer.txt

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/THUDM/AgentBench
- commit: ed013ff9887b0c3d7864c56ae54d41eba54a99d8

## 逐题清单

- agentbench-db-0001：portable，600s，输出 output/answer.txt
- agentbench-db-0008：portable，600s，输出 output/answer.txt
- agentbench-db-0013：portable，600s，输出 output/answer.txt
- agentbench-db-0017：portable，600s，输出 output/answer.txt
- agentbench-db-0027：portable，600s，输出 output/answer.txt
- agentbench-db-0031：portable，600s，输出 output/answer.txt
- agentbench-db-0034：portable，600s，输出 output/answer.txt
- agentbench-db-0042：portable，600s，输出 output/answer.txt
- agentbench-db-0051：portable，600s，输出 output/answer.txt
- agentbench-db-0060：portable，600s，输出 output/answer.txt
- agentbench-db-0061：portable，600s，输出 output/answer.txt
- agentbench-db-0069：portable，600s，输出 output/answer.txt
- agentbench-db-0074：portable，600s，输出 output/answer.txt
- agentbench-db-0077：portable，600s，输出 output/answer.txt
- agentbench-db-0081：portable，600s，输出 output/answer.txt
- agentbench-db-0096：portable，600s，输出 output/answer.txt
