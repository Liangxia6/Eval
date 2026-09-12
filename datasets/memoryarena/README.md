# MemoryArena（dataset.memoryarena/v1）

在模拟商城中逐阶段选择兼容配套商品，后续行动依赖前序商品信息；5 条完整链合计 30 阶段，但 catalog 仅计 5 题，不将阶段拆成互不依赖的问答。

## 题目规模

- 本地题包：5 题
- 能力标签：loop, memory, reasoning-planning, tool-web
- 每题超时：3600–3600 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark workspace；task-specific pinned runtime；trusted upstream evaluator
- 公开输入：无
- 交付产物：output/response.txt

## 上游环境与前置条件（environment.upstreamConstraints）

- controllerScenario: private/scenario.json
- environmentReset: restore simulated store per native stage; never perform real purchases
- historyProtocol: record whether original correct-product feedback/history is enabled; do not silently replace it with agent-only history
- judgeMode: pin native LLM attribute judge model/settings; --no-llm is a different evaluation mode
- memoryEvidence: capture MEMORY_PROBE across stage boundaries; native reward alone does not score the memory label
- memoryReset: clear between cases/trials; preserve allowed memory within the six stages
- missingPrerequisiteResult: UNEVALUABLE
- privateResourcesVisibility: controller-and-judge-only
- productDatabase: {"repository": "ai-hyz/MemoryArena-product-db", "revision": "46120a5c931d04a47bd791965d757207b7372b62", "requiredPaths": ["items_shuffle.jso…
- required: true
- runtimeCommit: 6cd9de14b71915e39ac742a20dc33785e14b6aab
- runtimeRepository: https://github.com/ZexueHe/MemoryArena
- splitSteps: true
- stageRelease: one at a time; use original reconstruction, feedback and memory lifecycle from the pinned runner
- stagesPerCase: 6

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配 memory、loop、reasoning-planning 和 tool-web；要求后续行动实际使用前序信息，并有独立轨迹支持标签评分。

## 不适配情况

不适合一次性公开全部阶段的纯问答，也不适合每阶段清空全部记忆的实验配置；不得连接真实购物账户或发生真实购买。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/scenario.json

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/ZexueHe/MemoryArena
- commit: 6cd9de14b71915e39ac742a20dc33785e14b6aab

## 逐题清单

- memoryarena-electronics-060：portable，3600s，输出 output/response.txt
- memoryarena-electronics-066：portable，3600s，输出 output/response.txt
- memoryarena-electronics-072：portable，3600s，输出 output/response.txt
- memoryarena-electronics-078：portable，3600s，输出 output/response.txt
- memoryarena-electronics-084：portable，3600s，输出 output/response.txt

## 当前局限

仅覆盖电子设备子集；代码为 Preview，未发现所选版本的根项目或数据许可证声明，公开再分发须核实。原生历史可能提供正确商品反馈，必须报告此配置；HF 重建器未结构化恢复预算/价格限制，原生 reward 不完整验证题面全部约束。尚未运行原生环境，缺环境判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
