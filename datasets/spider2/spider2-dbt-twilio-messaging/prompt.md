# 消息账户与号码分层聚合

你是可使用工具和修改工作区文件的 Agent。

输入 messages=[{id,account,from,to,direction,status,price}]。id重复时保留首条。direction为inbound或outbound；inbound用to号码归属，outbound用from。price为费用字符串（可负），null表示0；spend用abs(price)，以十进制精确求和并输出两位字符串。phone级按account,phone，account级按account，统计inbound,outbound,statuses（各状态计数）,spend。输出{phones:[...],accounts:[...]}按键升序；同号码不同账户不可合并。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 采用合成消息记录，替代dbt/DuckDB环境；费用符号与重复ID规则在新题显式定义。
