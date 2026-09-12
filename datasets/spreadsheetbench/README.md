# SpreadsheetBench Verified（dataset.spreadsheetbench/v1）

根据公司和员工数统计有业务的国家数量。输入为真实 Excel 工作簿，要求读取数据、完成表格操作并交付修改后的工作簿。

## 题目规模

- 本地题包：12 题
- 能力标签：artifact-delivery, reasoning-planning, tool-data, tool-document
- 每题超时：1200–1200 秒（portable）

## 运行环境要求

- 平台：portable
- 依赖声明：Excel-compatible formula recalculation engine when output contains formulas；Node.js >=22；XLSX reading and editing tool
- 公开输入：input/workbook.xlsx×12
- 交付产物：output/result.xlsx

## 私有资源（仅可信控制器与 LLM Judge 读取）

- private/final.json
- private/reference.xlsx

## 判分方式

逐标签 LLM Judge（配置见 `labels/<label>.json`：证据要求、证据来源、0–4 分标准、passScore=3、Judge 提示词）。判分依据 `private/final.json` 的 answer 与 rubric，加上评测端采集的授权证据；不以 response 文字自述为准。

## 来源

- https://github.com/RUCKBReasoning/SpreadsheetBench
- commit: 49b73a94775fb489063f60ca1865e3a650079a79

## 逐题清单

- spreadsheetbench-12307：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-178-22：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-30930：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-38823：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-40478：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-41601：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-44389：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-463-17：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-493-18：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-66-24：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-82-38：portable，1200s，输出 output/result.xlsx
- spreadsheetbench-84-40：portable，1200s，输出 output/result.xlsx
