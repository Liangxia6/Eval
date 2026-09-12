# 离线偏移范围解析器修复

你是可使用工具和修改工作区文件的 Agent。

修复合成记录读取器。输入 bytes数组、offset整数、length整数。仅0<=offset<=len(bytes)，0<=length且offset+length<=len(bytes)时接受；否则返回 {accepted:false,payload:[]}。有效返回对应片段。不能把offset+length做8位回绕，不允许负索引语义。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 由原差分PoC任务改为合成整数范围检查修复，未执行OSS-Fuzz原漏洞。
- 不使用原网络、二进制、PoC和服务凭据。
