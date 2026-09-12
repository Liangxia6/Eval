# 多表继承父链字段选择

你是可使用工具和修改工作区文件的 Agent。

输入 parent 为父模型名，fields 含 name,target,parent_link。只在 target=parent 且 parent_link=true 的字段中选择父链。恰有一个返回其 name；零个返回 "<parent>_ptr"；超过一个抛 ValueError。普通 OneToOne 关联不能冒充父链，字段声明顺序不影响结果。
`input/buggy.py` 是需修复的最小模型；复制到 output/solution.py 后修复。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写最小 Python 行为模型；不是原仓库补丁，未测原框架集成。
- 保留缺陷的输入边界和正确行为；测试对象仍须编写并交付可运行程序。
