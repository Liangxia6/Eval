# OSWorld（dataset.osworld/v1）

在隔离桌面环境中完成应用设置变更，通过界面观察、操作和复核达成目标，重点观察计算机使用能力及实际状态改变。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, loop, multimodal, tool-external
- 每题超时：1200–1200 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark environment；pinned upstream benchmark runtime；trusted upstream evaluator
- 公开输入：无
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- actionSpace: must be pinned by evaluation protocol; record whether computer-use or command tools are allowed
- controllerConfig: private/environment.json
- environmentReset: restore upstream initial state before each trial
- externalTaskDownloads: false
- guestOS: Linux
- missingPrerequisiteResult: UNEVALUABLE
- nativeEvaluatorRoot: desktop_env/evaluators/
- nativeTaskId: <varies>
- privateResourcesVisibility: controller-and-judge-only
- required: true
- snapshot: <varies>

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配多模态理解、外部应用工具操作、执行闭环及产物交付，适用于具有桌面动作接口的 Agent。

## 不适配情况

不适合没有截图输入或桌面操作接口的系统；只有静态屏幕定位答案不能构成本组任务完成。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/environment.json
- private/final.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/xlang-ai/OSWorld
- commit: fc31a9049664292fcb35d6e501ee1dc839f2cf6d

## 逐题清单

- osworld-chrome-030eeff7：portable，1200s，输出 output/response.txt
- osworld-gimp-7b7617bd：portable，1200s，输出 output/response.txt
- osworld-libreoffice-impress-2cd43775：portable，1200s，输出 output/response.txt
- osworld-vlc-a5bbbcd5：portable，1200s，输出 output/response.txt
- osworld-vs-code-930fdb3b：portable，1200s，输出 output/response.txt

## 当前局限

本组来自原始/Verified 主基准，是无需额外任务文件下载的 5 道设置变更题，不是 OSWorld-V2，也不代表复杂文档任务难度。固定版本见 question.source；缺少 VM 或应用环境时应判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
