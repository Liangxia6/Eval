# Harbor AlgoTune（dataset.harbor-algotune/v1）

优化线性时不变系统的连续时间响应模拟，保持数值精度并交付高性能 Solver。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, efficiency-reliability, loop, reasoning-planning, tool-code
- 每题超时：1800–1800 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Node.js >=22；NumPy；Python >=3.11；Python >=3.12；SciPy；pinned AlgoTune CPU/judge environment
- 公开输入：无
- 交付产物：output/solver.py

## 上游环境与前置条件（environment.upstreamConstraints）

- agent: {"cpus": 4, "memory_mb": 8192}
- verifier: <varies>

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/evaluator.py
- private/final.json
- private/oracle_solver.py
- private/test_outputs.py

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- algotune-optimize-lti-sim：darwin，1800s，输出 output/solver.py
- algotune-optimize-matrix-sqrt：darwin，1800s，输出 output/solver.py
- algotune-optimize-ode-seirs：darwin，1800s，输出 output/solver.py
- algotune-optimize-outer-product：darwin，1800s，输出 output/solver.py
- algotune-simplex-projection-speedup：darwin，1800s，输出 output/solver.py
