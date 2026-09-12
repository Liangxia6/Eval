# Harbor USACO Sleeping Cows（dataset.harbor-usaco/v1）

实现 USACO Sleeping Cows 的 Python 解法，并通过隐藏输入输出测试。测组合推理、动态规划、代码实现与回归可靠性。

## 题目规模

- 本地题包：1 题
- 能力标签：artifact-delivery, efficiency-reliability, loop, reasoning-planning, tool-code
- 每题超时：1200–1200 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Node.js >=22；Python >=3.11
- 公开输入：无
- 交付产物：output/solution.py

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/reference-tests/__init__.py
- private/reference-tests/conftest.py
- private/reference-tests/data/1.in
- private/reference-tests/data/1.out
- private/reference-tests/data/10.in
- private/reference-tests/data/10.out
- private/reference-tests/data/11.in
- private/reference-tests/data/11.out
- private/reference-tests/data/12.in
- private/reference-tests/data/12.out
- private/reference-tests/data/13.in
- private/reference-tests/data/13.out
- private/reference-tests/data/14.in
- private/reference-tests/data/14.out
- private/reference-tests/data/15.in
- private/reference-tests/data/15.out
- private/reference-tests/data/16.in
- private/reference-tests/data/16.out
- private/reference-tests/data/17.in
- private/reference-tests/data/17.out
- private/reference-tests/data/18.in
- private/reference-tests/data/18.out
- private/reference-tests/data/19.in
- private/reference-tests/data/19.out
- private/reference-tests/data/2.in
- private/reference-tests/data/2.out
- private/reference-tests/data/20.in
- private/reference-tests/data/20.out
- private/reference-tests/data/3.in
- private/reference-tests/data/3.out
- private/reference-tests/data/4.in
- private/reference-tests/data/4.out
- private/reference-tests/data/5.in
- private/reference-tests/data/5.out
- private/reference-tests/data/6.in
- private/reference-tests/data/6.out
- private/reference-tests/data/7.in
- private/reference-tests/data/7.out
- private/reference-tests/data/8.in
- private/reference-tests/data/8.out
- private/reference-tests/data/9.in
- private/reference-tests/data/9.out
- private/reference-tests/data/constraint.json
- private/reference-tests/evaluate.py
- private/reference-tests/judges/__init__.py
- private/reference-tests/judges/judge.py
- private/reference-tests/judges/usaco_batch_judge.py
- private/reference-tests/judges/usaco_utils.py
- private/reference-tests/metrics.py
- private/reference-tests/result_type.py
- private/reference-tests/test.sh
- private/reference-tests/test_outputs.py
- private/reference-tests/utils.py

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- usaco-assign-cows-to-barns：darwin，1200s，输出 output/solution.py
