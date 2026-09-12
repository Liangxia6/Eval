# 枚举验证与 missing 回退

你是可使用工具和修改工作区文件的 Agent。

输入 workloads 数组含 kind 与 values。kind=int：值只能为整数且属 [1,2,3,5,8,13,21,34,55,89]，返回对应 A..J；str 对 foo/barbaz/qux_quux 返回X/Y/Z；float 对0.1/3.1415/2.71828返回LOW/MID/HIGH；single 所有值返回ONLY。其他值返回ValidationError。此适配禁止字符串转数字与bool转整数，明确不复制全部 Pydantic coercion 行为。输出与 workloads 同序的名称二维数组。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写独立函数与小型数据；未移植原库或原运行环境。
- 本阶段确定性验收功能等价；不设置跨机器绝对计时阈值，不声称获得原性能加速。优化合理性由实际代码和测时证据单独评价。
