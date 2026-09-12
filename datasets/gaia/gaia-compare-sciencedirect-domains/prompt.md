# 冻结目录的样本标准差比较

你是可使用工具和修改工作区文件的 Agent。

读取 input/data.json。records 为模拟目录，family是Life或Health，domain为子域，kind为reference_work/journal，id为作品ID，year为收录年。仅year<=2022且kind=reference_work；按family/domain去重作品id统计数量，domains列表中的空域仍计0。分别算两大类各子域计数的样本标准差(ddof=1)，输出 {Life_counts:按domains.Life顺序,Health_counts:按domains.Health顺序,difference:Life标准差-Health标准差}。difference舍入3位小数。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 使用明确标注的合成目录，非ScienceDirect真实2022快照。
- 保留统计和范围识别能力，未测网络检索，不沿用原答案0.269。
