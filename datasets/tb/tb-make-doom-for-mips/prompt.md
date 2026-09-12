# MIPS 指令编码与解释执行切片

你是可使用工具和修改工作区文件的 Agent。

输入 program 为指令数组，支持 {op:"addiu",rt,rs,imm}、{op:"addu",rd,rs,rt}、{op:"sw",rt,base,offset}、{op:"halt"}。寄存器0..31，初始全0，r0恒0；32位无符号回绕，imm/offset为有符号16位；sw地址须非负且4字节对齐。按顺序编码：addiu opcode9，addu funct33，sw opcode43，halt编码0xffffffff；以每字32bit小端字节拼接hex。再执行编码的指令，输出{machine_hex,registers:32项,memory:[{address,value}]按地址排序}，遇halt停止但machine_hex仍含全部指令。无halt或无效寄存器/地址/立即数抛ValueError。不得只伪造ELF头或初始化日志。

交付 `output/solution.py`，提供 `solve(data)`，输入和输出必须可 JSON 序列化。公开样例见 `input/data.json`，评分侧另有同契约测试输入；必须实现通用逻辑。不得依赖只对样例有效的硬编码。执行每次调用不修改传入对象，异常按题意抛出。

保留 `input/` 原样，可在 `work/` 保存辅助代码和中间产物。最终回复说明完成内容及实际核验情况；不要把计划执行的步骤说成已经执行。方法不限，模拟参考步骤不是规定路线。

适配范围：
- 缩减为重新设计的MIPS编码执行题，无DOOM源代码、ELF链接、图形后端或帧渲染。
- 这是大幅缩减、需范围复核的能力切片，不代表原DOOM项目可替代。
