# 合成非编码序列的插入引物设计

你是可使用工具和修改工作区文件的 Agent。

输入 template 为合成非编码圆形DNA序列、position插入点、insert插入字符串。只允许一处连续插入。forward=insert+从position起顺时针截取nf个模板碱基；reverse=position前nr个模板碱基的反向互补。圆形索引用模运算。nf/nr均15..45且不超过模板长；各退火片段Tm用本题明确的Wallace式2*(A+T)+4*(G+C)，须58..72且差<=5。选择nf+nr最小方案，平局先nf最小再nr最小。输出forward,reverse,nf,nr,tm_forward,tm_reverse,pairs=1；无解返回null。尾部insert不参与Tm。此题为字符串与约束计算，不用于真实实验设计。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 原真实质粒替换为明确非编码合成序列。
- 用Wallace式替代原primer3最近邻Tm，输出协议改JSON；不能视为原Q5实验条件验证。
