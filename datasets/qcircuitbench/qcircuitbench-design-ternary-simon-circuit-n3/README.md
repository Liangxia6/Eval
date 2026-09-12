# 三元 Simon 测量后处理

版本2.2.0，沿用题目侧 `process/local` 约定。作者区格式，尚未接入主系统。

公开注入：prompt.md 与 assets/（按 question.json 映射到 input/）。私有：private/、checks/、参考实现及本文，不交给被测Agent。

输入是任务指令和工作区材料；程序类要求 Agent 实际编写提交程序，评分器执行该程序；文件类检查实际交付文件。模拟参考答案仅用于验证题目，不是被测Agent运行记录。

适配范围：`major-scope-change`。

- 使用重新编写的自包含小型科学计算输入和结果检查，不依赖上游环境。
- 保留数值方法关键边界；样例通过仅验证本适配契约。
- 大幅缩减为后处理切片；没有QASM、量子模拟或oracle调用证据，不得视为原量子算法题完成。

确定性检查原型：`python checks/check.py --workspace <绝对工作区>`。
作者验证记录：`docs/validation/pipeline/qcircuitbench-design-ternary-simon-circuit-n3/summary.json`（相对题库根目录）。参考、错误、损坏、缺失、输入篡改共5种场景通过。

正式系统须把原型检查放到独立评分侧，并为不可信提交程序提供操作系统级隔离。`final.kind=llm` 保持现有题目约定；硬门槛须由主程序桥接执行，不能只靠提示词当作已经实现的门槛。

所有参考样例和模拟采分点位于 private/。没有真实Agent成绩、真实LLM Judge分数或原Harbor复现成绩。
