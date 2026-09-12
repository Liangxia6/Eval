# WorkArena（dataset.workarena/v1）

在隔离 ServiceNow 实例中完成 incidents、hardware、users 列表排序，或按指定配置订购开发笔记本和 iPad mini，重点观察企业页面操作与结果核验。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, loop, reasoning-planning, tool-web
- 每题超时：1500–1500 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark environment；pinned upstream benchmark runtime；trusted upstream evaluator
- 公开输入：无
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- environmentReset: restore upstream initial state before each trial
- fixedConfigSource: private/final.json#answer.fixedConfig
- initialization: official task.setup with fixed_config; reset and teardown each trial
- instance: authorized WorkArena ServiceNow benchmark instance required
- level: L1
- missingPrerequisiteResult: UNEVALUABLE
- privateResourcesVisibility: controller-and-judge-only
- required: true
- runtimeClass: <varies>
- seed: 42
- validator: <varies>

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配浏览器与网络工具、推理与规划、执行闭环及产物交付，可观察企业页面操作和业务结果确认。

## 不适配情况

不适合没有授权测试实例或浏览器操作能力的系统；不得在真实企业实例执行评测订购和记录修改。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/ServiceNow/WorkArena
- commit: a772230a94cf1caf4166b8ead3983f3b3786455b

## 逐题清单

- workarena-order-developer-laptop-000：portable，1500s，输出 output/response.txt
- workarena-order-ipad-mini-001：portable，1500s，输出 output/response.txt
- workarena-sort-hardware-list-001：portable，1500s，输出 output/response.txt
- workarena-sort-incident-list-002：portable，1500s，输出 output/response.txt
- workarena-sort-user-list-001：portable，1500s，输出 output/response.txt

## 当前局限

本组仅覆盖 WorkArena-L1 的 5 道任务，不代表 WorkArena++ 的长流程难度。固定版本见 question.source；缺少授权实例或官方任务环境时应判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
