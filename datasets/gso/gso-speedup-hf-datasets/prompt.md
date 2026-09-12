# 连续数据切片的语义保持

你是可使用工具和修改工作区文件的 Agent。

data.rows 含 id/text/value，start 与 length 为非负整数。选择 rows[start:start+length]；输出 selected_rows,start_index=start,end_index=start+实际行数-1,first_id,first_text,last_id,last_text,total_value,min_value,max_value；空片的首尾及 min/max=null，total=0。越过尾部截断，负 start/length 抛 ValueError。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写独立函数与小型数据；未移植原库或原运行环境。
- 本阶段确定性验收功能等价；不设置跨机器绝对计时阈值，不声称获得原性能加速。优化合理性由实际代码和测时证据单独评价。
