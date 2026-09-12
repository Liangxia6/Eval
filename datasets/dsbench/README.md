# DSBench（dataset.dsbench/v1）

选择 Titanic、Bike Sharing Demand、Playground S3E12、Playground S3E5、NLP Getting Started 的真实建模任务；要求读取文件、训练模型并生成预测，不纳入纯分析问答。

## 题目规模

- 本地题包：5 题
- 能力标签：artifact-delivery, tool-code, tool-data
- 每题超时：3600–3600 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：isolated benchmark workspace；task-specific pinned runtime；trusted upstream evaluator
- 公开输入：input/test.csv×5、input/train.csv×5
- 交付产物：output/submission.csv

## 上游环境与前置条件（environment.upstreamConstraints）

- environmentReset: fresh model/data workspace and fixed random seed per trial
- inputDataBundled: true
- missingPrerequisiteResult: UNEVALUABLE
- nativeEvaluator: private/evaluate.py
- networkPolicy: no original labels, solutions, competitions or external submissions
- privateAnswerFile: private/test_answer.csv
- privateResourcesVisibility: controller-and-judge-only
- pythonPackages: ["numpy", "pandas", "scikit-learn"]
- required: true

缺少上述上游环境时判定 UNEVALUABLE，不记为 Agent 成功或失败。

## 适配能力

适配 tool-data、tool-code 和 artifact-delivery；重点检查真实训练执行、数据处理质量及可复跑性。

## 不适配情况

不适合仅凭题面给出建模建议的文本模型；不得访问外部竞赛标签、参考解或提交真实竞赛。未获授权的商业数据使用不在许可范围内。

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/evaluate.py
- private/final.json
- private/test_answer.csv

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/LiqiangJing/DSBench
- commit: ba786096137a5108af11c016ad3f09cdb97beefd

## 逐题清单

- dsbench-bike-sharing-demand：portable，3600s，输出 output/submission.csv
- dsbench-nlp-getting-started：portable，3600s，输出 output/submission.csv
- dsbench-playground-series-s3e12：portable，3600s，输出 output/submission.csv
- dsbench-playground-series-s3e5：portable，3600s，输出 output/submission.csv
- dsbench-titanic：portable，3600s，输出 output/submission.csv

## 当前局限

仅覆盖 5 个建模任务，不代表完整 DSBench；数据限教育研究和非商业用途，商业用途须授权并遵循原竞赛条款。原生连续指标不直接等于 Agent 整体能力。题包已校验但尚未执行建模或接通评分入口；缺依赖判 UNEVALUABLE。

数据可用状态：数据可用状态: AVAILABLE；本地已保存 5 道题包，运行环境仍待适配，判分已接入 LLM Judge
