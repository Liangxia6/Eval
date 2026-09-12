# BFCL V4 Multi-Turn（dataset.bfcl-multiturn/v1）

在连续对话中选择工具、补齐参数、处理工具不可用情形，并延续前序操作产生的状态。仅选择有状态多轮任务，不包含单轮 AST 匹配题。

## 题目规模

- 本地题包：5 题
- 能力标签：collaboration, loop, reasoning-planning, tool-external
- 每题超时：1200–1200 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark environment；pinned upstream benchmark runtime；trusted upstream evaluator
- 公开输入：无
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- environmentReset: restore upstream initial state before each trial
- missingPrerequisiteResult: UNEVALUABLE
- privateResourcesVisibility: controller-and-judge-only
- protocol: progressive turns; execute native tools; apply excluded/missed functions; native per-turn state and response/path checks
- required: true
- scenario: private/scenario.json
- toolClasses: <varies>
- toolDefinitions: berkeley-function-call-leaderboard/bfcl_eval/data/multi_turn_func_doc/
- toolImplementation: berkeley-function-call-leaderboard/bfcl_eval/eval_checker/multi_turn_eval/func_source_code/
- turnCount: <varies>

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配 API 与业务系统工具、推理与规划、执行闭环，以及与对话方的参数澄清和信息协作；不等同于子 Agent 委派或跨会话长期记忆测试。

## 不适配情况

不适合只能输出静态函数调用而不能接收执行反馈的系统，也不适合缺少逐轮控制器的单轮评测配置。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/scenario.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/ShishirPatil/gorilla
- commit: 6ea57973c7a6097fd7c5915698c54c17c5b1b6c8

## 逐题清单

- bfcl-multi-turn-base-1：portable，1200s，输出 output/response.txt
- bfcl-multi-turn-base-60：portable，1200s，输出 output/response.txt
- bfcl-multi-turn-long-context-150：portable，1200s，输出 output/response.txt
- bfcl-multi-turn-miss-func-120：portable，1200s，输出 output/response.txt
- bfcl-multi-turn-miss-param-90：portable，1200s，输出 output/response.txt

## 当前局限

5 题是四类多轮任务的接入子集，不代表 BFCL 全量或单轮能力。固定版本见 question.source；缺少工具运行时或多轮控制器时应判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
