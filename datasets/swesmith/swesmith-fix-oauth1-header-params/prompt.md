# OAuth1 参数编码与 URI 保留

你是可使用工具和修改工作区文件的 Agent。

输入 params 为键值二元数组，均为字符串；uri 为待追加查询参数的 URI。输出 header 和 uri。header="OAuth "+以", "连接 percent(key)="percent(value)"；percent 使用 UTF-8、空格%20、safe="~-._"。URI 新增参数用同样编码并以 & 连接，保留原 query、路径和 fragment（不二次编码原内容）；重复键保留顺序。使用虚构凭据，禁止对外发送请求。
`input/buggy.py` 是需修复的最小模型；复制到 output/solution.py 后修复。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写最小 Python 行为模型；不是原仓库补丁，未测原框架集成。
- 保留缺陷的输入边界和正确行为；测试对象仍须编写并交付可运行程序。
