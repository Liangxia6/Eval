# Harbor FeatureBench（dataset.harbor-featurebench/v1）

在固定 PyTorch Lightning 基线恢复 Trainer 接口及支持逻辑，通过真实训练中的 hook 顺序测试。

## 题目规模

- 本地题包：4 题
- 能力标签：artifact-delivery, loop, reasoning-planning, tool-code
- 每题超时：1800–1800 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Dask；Node.js >=22；Python；Python >=3.11；pinned upstream dependency environment；pytest；sanitized Lightning-AI/pytorch-lightning@126fa6f1bf0dceb03643c59ff4130c701b61aca4 source fixture；sanitized mlflow/mlflow@93dab383a1a3fc9882ebc32283ad2a05d79ff70f source fixture；xarray source fixture
- 公开输入：无
- 交付产物：output/agent.patch

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/setup_patch.diff
- private/test.sh
- private/test_patch.diff

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- featurebench-add-feature-lightning-hooks：darwin，1800s，输出 output/agent.patch
- featurebench-add-feature-mlflow-bedrock-autolog：darwin，1800s，输出 output/agent.patch
- featurebench-add-feature-mlflow-unity-catalog：darwin，1800s，输出 output/agent.patch
- featurebench-add-feature-xarray-backend-chunks：darwin，1800s，输出 output/agent.patch
