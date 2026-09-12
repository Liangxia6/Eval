# 墓园资料定位与背景碑文

你是可使用工具和修改工作区文件的 Agent。

数据为虚构风味墓园资料。flavors含id,start_year，photos含flavor_id,headstones=[{position,lines}]。先选start_year最早风味（同年id字典序），定位对应照片记录中的position=background碑文，返回 {flavor_id,last_line}。不能使用前景碑文最后一行。若无background记录则last_line=null。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 没有上游网页照片冻结副本，使用虚构结构化场景；不冒称真实历史或原照片OCR。
- 仅保留多跳定位切片，视觉检索能力已移除，必须在选题匹配描述中明确。
