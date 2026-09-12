# tau-bench（(未列入 catalog)）

airline 多轮客服：遵循政策、通过模拟用户逐步获知需求并实际修改业务状态。

## 题目规模

- 本地题包：5 题
- 能力标签：collaboration, loop, reasoning-planning, safety-boundary, tool-external
- 每题超时：1800–1800 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark environment；pinned upstream benchmark runtime；trusted upstream evaluator
- 公开输入：input/policy.md×5
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- databaseSeed: <varies>
- databaseSeedLocation: pinned upstream runtime; not copied into Agent workspace
- domain: <varies>
- dualControl: false
- environmentReset: restore upstream initial state before each trial
- missingPrerequisiteResult: UNEVALUABLE
- privateResourcesVisibility: controller-and-judge-only
- required: true
- scenario: private/scenario.json
- taskId: <varies>
- userSimulator: required; pin model, temperature and seed

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/scenario.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/sierra-research/tau-bench
- commit: 59a200c6d575d595120f1cb70fea53cef0632f6b

## 逐题清单

- tau-bench-airline-000：portable，1800s，输出 output/response.txt
- tau-bench-airline-020：portable，1800s，输出 output/response.txt
- tau-bench-retail-000：portable，1800s，输出 output/response.txt
- tau-bench-retail-022：portable，1800s，输出 output/response.txt
- tau-bench-retail-068：portable，1800s，输出 output/response.txt

> 注：该数据集尚未列入 datasets/catalog.md。
