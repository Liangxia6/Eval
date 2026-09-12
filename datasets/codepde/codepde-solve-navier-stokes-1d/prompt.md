# 1D Compressible Navier-Stokes Solver（DSHEval 适配题）

创建或修改 `solver.py`，实现：
```python
def solver(Vx0, density0, pressure0, t_coordinate, eta, zeta):
    ...
```

公开输入在 `input/input.json`，包含 batch 维度、周期空间网格和时间坐标。返回 `(Vx_pred, density_pred, pressure_pred)`，每个数组形状为 `[batch_size, len(t_coordinate), N]`，第一帧必须等于输入初始状态。

当前 fixture 是周期边界下的空间均匀平衡状态；正确实现应保持每个状态在时间上不变。实际运行函数，检查三个输出的形状、有限性、初始帧和状态守恒。只允许修改 `solver.py`，不要修改输入、私有答案或检查脚本。
