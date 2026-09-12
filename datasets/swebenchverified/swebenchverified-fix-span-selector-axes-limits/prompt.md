# SpanSelector 不污染坐标范围

你是可使用工具和修改工作区文件的 Agent。

输入 points 为二维点、margin>=0、orientation 为 horizontal/vertical、selection=[a,b]。每轴范围按数据 min/max 加 margin*跨度；跨度0时先按值±0.5建立跨度1再加margin。建立 selector 不得使数据范围包含0。返回 before,after 两个 [xmin,xmax,ymin,ymax] 以及 selection 原值。
`input/buggy.py` 是需修复的最小模型；复制到 output/solution.py 后修复。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写最小 Python 行为模型；不是原仓库补丁，未测原框架集成。
- 保留缺陷的输入边界和正确行为；测试对象仍须编写并交付可运行程序。
