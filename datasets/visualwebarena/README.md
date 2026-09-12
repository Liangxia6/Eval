# VisualWebArena（dataset.visualwebarena/v1）

根据页面图片识别商品或对象，再执行评论、加入愿望单或购物车等操作，重点观察视觉识别能否支撑真实网页任务完成。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, loop, multimodal, reasoning-planning, tool-web
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
- nativeRequireReset: <varies>
- nativeTaskId: <varies>
- privateResourcesVisibility: controller-and-judge-only
- required: true
- siteSnapshots: official pinned benchmark environment snapshots required; not bundled here
- sites: <varies>

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配多模态理解、浏览器与网络工具、推理与规划、执行闭环及产物交付。

## 不适配情况

不适合只接收纯文本网页的系统，也不适合无法加载图片、固定视口或重置网站的评测环境。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/web-arena-x/visualwebarena
- commit: 89f5af29305c3d1e9f97ce4421462060a70c9a03

## 逐题清单

- visualwebarena-classifieds-028：portable，1800s，输出 output/response.txt
- visualwebarena-classifieds-057：portable，1800s，输出 output/response.txt
- visualwebarena-classifieds-160：portable，1800s，输出 output/response.txt
- visualwebarena-shopping-036：portable，1800s，输出 output/response.txt
- visualwebarena-shopping-046：portable，1800s，输出 output/response.txt

## 当前局限

5 题只覆盖两个站点和有限操作类型，不代表完整视觉网页能力。固定版本见 question.source；缺少必要图片或站点环境时应判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
