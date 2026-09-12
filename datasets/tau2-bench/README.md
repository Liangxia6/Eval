# τ²-bench（dataset.tau2-bench/v1）

在用户与 Agent 共同影响环境的任务中澄清问题、遵循政策并协调操作，重点观察多轮决策和状态变化后的策略调整。

## 题目规模

- 本地题包：5 题
- 能力标签：collaboration, loop, reasoning-planning, safety-boundary, tool-external
- 每题超时：1800–1800 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark environment；pinned upstream benchmark runtime；trusted upstream evaluator
- 公开输入：input/main_policy.md×3、input/policy.md×2、input/tech_support_manual.md×3、input/tech_support_workflow.md×3
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- databaseSeed: <varies>
- databaseSeedLocation: pinned upstream runtime; not copied into Agent workspace
- domain: <varies>
- dualControl: <varies>
- environmentReset: restore upstream initial state before each trial
- missingPrerequisiteResult: UNEVALUABLE
- privateResourcesVisibility: controller-and-judge-only
- required: true
- scenario: private/scenario.json
- taskId: <varies>
- userSimulator: required; pin model, temperature and seed

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配 API 与业务系统工具、推理与规划、执行闭环、安全与权限边界，以及可观察的双方协作。

## 不适配情况

不适合只提供 Agent 单侧工具反馈的配置；不应一次性公开用户背景，也不能省略电信任务的用户设备环境。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/scenario.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/sierra-research/tau2-bench
- commit: 672227c6b6676edc20d57ea53b7000262aae77b9

## 逐题清单

- tau2-bench-retail-010：portable，1800s，输出 output/response.txt
- tau2-bench-retail-040：portable，1800s，输出 output/response.txt
- tau2-bench-telecom-000：portable，1800s，输出 output/response.txt
- tau2-bench-telecom-020：portable，1800s，输出 output/response.txt
- tau2-bench-telecom-040：portable，1800s，输出 output/response.txt

## 当前局限

名称沿用清单中的 τ²-bench，但所选固定提交实际是 τ³ 修订任务，不代表原 τ² 论文快照或全量成绩。版本见 question.source；缺少双端环境时应判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
