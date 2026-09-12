# mTLS CA 列表长度与配置隔离

你是可使用工具和修改工作区文件的 Agent。

base 是共享 TLS 配置字典；trusted 与 host 是 CA subject 字符串数组。使用 UTF-8 编码，每个 subject 占 2+字节长度，总和 <=65535 时每连接 advertised=trusted，否则 advertised=host；host 仍超限抛 ValueError。输出 {connection:克隆base并设置ClientCAs=advertised,base_after:原base}。不得修改输入 base 或丢失其他 TLS 配置。此题只测配置选择，不宣称握手成功。
`input/buggy.py` 是需修复的最小模型；复制到 output/solution.py 后修复。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写最小 Python 行为模型；不是原仓库补丁，未测原框架集成。
- 保留缺陷的输入边界和正确行为；测试对象仍须编写并交付可运行程序。
