# UNION 查询派生时保持原查询

你是可使用工具和修改工作区文件的 Agent。

输入 left/right 为含 id,value 的记录、original_order 与 derived_order 为 id/value 或带前缀 - 的降序字段、projection 为 id/value。UNION 按 (id,value) 去重，先得到原顺序完整行。派生查询按 derived_order 排序并只取 projection 值；再次执行原查询保持原顺序和列。输出 original_before,derived,original_after。排序字段平局按 id 再 value 升序。
`input/buggy.py` 是需修复的最小模型；复制到 output/solution.py 后修复。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写最小 Python 行为模型；不是原仓库补丁，未测原框架集成。
- 保留缺陷的输入边界和正确行为；测试对象仍须编写并交付可运行程序。
