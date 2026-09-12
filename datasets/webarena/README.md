# WebArena（dataset.webarena/v1）

Agent 在受控网站中完成真实页面操作，任务结果体现为评论、购物车、仓库、内容或工单状态的改变，不是只从网页查找答案。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, loop, reasoning-planning, tool-web
- 每题超时：1800–1800 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark environment；pinned upstream benchmark runtime；trusted upstream evaluator
- 公开输入：input/browser.json×5
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- authenticationState: provision fresh benchmark account/session; never reuse real browser cookies
- environmentReset: restore upstream initial state before each trial
- missingPrerequisiteResult: UNEVALUABLE
- nativeRequireReset: false
- nativeTaskId: <varies>
- privateResourcesVisibility: controller-and-judge-only
- required: true
- siteSnapshots: official pinned benchmark environment snapshots required; not bundled here
- sites: <varies>

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配浏览器与网络工具、推理与规划、执行闭环和产物交付，可观察多步操作及提交后的结果核验。

## 不适配情况

不适合只读网页检索系统或没有网站重置能力的配置；不能用真实业务网站替代隔离基准实例。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/web-arena-x/webarena
- commit: dce04686a56253aefba7b18a4fa0937cf1dc987b

## 逐题清单

- webarena-389：portable，1800s，输出 output/response.txt
- webarena-431：portable，1800s，输出 output/response.txt
- webarena-475：portable，1800s，输出 output/response.txt
- webarena-486：portable，1800s，输出 output/response.txt
- webarena-809：portable，1800s，输出 output/response.txt

## 当前局限

仅选取原版 WebArena 的 5 道状态变更题，不是 WebArena-Verified，也不代表全量难度。固定版本见 question.source；缺少网站快照或浏览器环境时应判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
