# Harbor SkillsBench（dataset.harbor-skillsbench/v1）

基于 PWT、IMF WEO 和 ECB 数据构建格鲁吉亚投资冲击的潜在 GDP 模型，交付带 HP 滤波和公式的 Excel。

## 题目规模

- 本地题包：2 题
- 能力标签：artifact-delivery, loop, multimodal, reasoning-planning, retrieval-grounding, tool-data, tool-document, tool-web
- 每题超时：600–1800 秒（darwin）

## 运行环境要求

- 平台：darwin
- 依赖声明：Internet access to PWT 10.01, IMF WEO April 2025 and ECB；LibreOffice formula recalculation；Node.js >=22；OCR engine；XLSX editing tools；openpyxl；spreadsheet writer
- 公开输入：input/img/007.jpg×1、input/img/009.jpg×1、input/img/010.jpg×1、input/img/011.jpg×1、input/img/019.jpg×1、input/img/034.jpg×1、input/img/039.jpg×1、input/img/052.jpg×1、input/img/063.jpg×1、input/img/064.jpg×1、input/img/069.jpg×1、input/img/071.jpg×1、input/img/074.jpg×1、input/img/077.jpg×1、input/img/078.jpg×1、input/img/080.jpg×1、input/img/083.jpg×1、input/img/087.jpg×1、input/img/088.jpg×1、input/img/090.jpg×1、input/img/094.jpg×1、input/img/097.jpg×1、input/test-supply.xlsx×1
- 交付产物：output/stat_ocr.xlsx、output/test-supply.xlsx

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/test_outputs.py

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/harbor-framework/harbor-index
- commit: 5399ea1026fb2c7fc384cf8acd91a7d10fc943f3

## 逐题清单

- skillsbench-model-investment-shock-gdp：darwin，1800s，输出 output/test-supply.xlsx
- skillsbench-ocr-receipts-to-excel：darwin，600s，输出 output/stat_ocr.xlsx
