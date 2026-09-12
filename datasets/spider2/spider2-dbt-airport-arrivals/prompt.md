# 机场到达汇总与球面距离

你是可使用工具和修改工作区文件的 Agent。

输入 airports=[{code,country,lat,lon}]，flights=[{id,arrival,status}]。保留country=MY机场，按code输出arrivals=[{airport,flight_count}]，统计status=arrived且arrival匹配，按flight id去重；零到达机场仍输出。distances列出MY机场所有无序对，code小者from，按from/to排序，km用地球半径6371与haversine公式（角度转弧度）。输出{arrivals,distances}。无须dbt或DuckDB服务。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 原数据库与dbt工程替换为小型合成表；保留汇总和球面距离，不测试dbt模型依赖图。
