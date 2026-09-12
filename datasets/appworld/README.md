# AppWorld（dataset.appworld/v1）

通过应用 API 完成联系人同步、Spotify 播放列表整理、笔记迁移及购物车条件转移，重点观察跨应用数据依赖和实际执行能力。

## 题目规模

- 本地题包：5 题
- 能力标签：loop, reasoning-planning, safety-boundary, tool-code, tool-external
- 每题超时：1800–1800 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark environment；pinned upstream benchmark runtime；trusted upstream evaluator
- 公开输入：无
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- baseDatabases: provision from the same upstream bundle, do not expose raw databases to agent
- dataBundleSha256: c9299e6cafe92bce4592a3c117c047c973d1554a667c21dd81537e78ab2f532e
- dataBundleUrl: https://s3.us-west-2.amazonaws.com/appworld.dev/data-0.2.0.bundle
- dataVersion: 0.2.0
- environmentReset: restore upstream initial state before each trial
- missingPrerequisiteResult: UNEVALUABLE
- privateResourcesVisibility: controller-and-judge-only
- required: true
- runtimeSpecs: <varies>
- split: <varies>
- taskDatabaseDiffs: private/database-diffs.json
- taskId: <varies>

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配 API 与业务系统工具、代码与终端工具、推理与规划、执行闭环及安全与权限边界，检查目标外的数据是否保持不变。

## 不适配情况

不适合没有应用运行时或无法执行 API 的系统；不能只提供最终答案，也不能省略无关数据库的副作用检查。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/database-diffs.json
- private/evaluation.py
- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/StonyBrookNLP/appworld
- commit: 42b5bcf3cd334fee33f0c37c02070a9f5807add5

## 逐题清单

- appworld-07bb666-1：portable，1800s，输出 output/response.txt
- appworld-0d01c76-1：portable，1800s，输出 output/response.txt
- appworld-3d9a636-1：portable，1800s，输出 output/response.txt
- appworld-634f342-1：portable，1800s，输出 output/response.txt
- appworld-9bf2c8a-1：portable，1800s，输出 output/response.txt

## 当前局限

5 题仅覆盖有限应用流程，不代表全量成绩；缺少基库或运行环境时应判 UNEVALUABLE。解包内容仅限本地或私有使用，公开再分发及衍生内容须遵守随目录保留的加密分发许可要求。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
