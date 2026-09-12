# 进程信号状态与消息修复

你是可使用工具和修改工作区文件的 Agent。

输入 name,pid,started,finished,crashed,code,verbose。状态：未started=>not started；未finished=>running；finished且crashed且code=15=>terminated；其他crashed=>crashed；正常code=0=>exited successfully；其他正常=>exited。输出 state,was_sigterm,message,level。未完成无消息/level=null；完成的描述 name+" "+state+" with status "+code，crashed已知信号11/15/9追加(S I G名称，实际不含空格)，最后“. See :process PID for details.”。成功/15为info但仅verbose显示，其余完成错误始终error。信号仅解释 crashed=true。
`input/buggy.py` 是需修复的最小模型；复制到 output/solution.py 后修复。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 重新编写最小 Python 行为模型；不是原仓库补丁，未测原框架集成。
- 保留缺陷的输入边界和正确行为；测试对象仍须编写并交付可运行程序。
