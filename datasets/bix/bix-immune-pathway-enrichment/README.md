# 题目作者区说明

本目录是单题适配草案，不是原 Harbor 任务复现，也没有真实 Agent 分数。
公开输入只注入 assets/data.json；private/ 和 checks/ 留在评测侧。
检查原型调用：python checks/check.py --workspace <Agent工作区>
检查器只读取完成后的答案文件，不启动 Agent，不代替 LLM 轨迹评分。
参考答案由构建脚本从合成数据推导；权重和无法评价低分留给统一配置。
