> **2026-09-12 评分链路更新：** 当前接口以 [Evaluation 重构说明](EVALUATION-REFACTOR-20260912.md) 为准。下文出现的 Pack、EvidenceContract、Closure、Gate 和旧评分报告字段均已移除；历史说明保留用于追溯。

# DSHEval Dataset 与 Label 完整示例

本文使用 `Harbor CodePDE` 展示一个 Dataset 从 Planner 描述、Case、公开输入、确定性检查、私有答案到标签 Judge 的完整结构。

## 1. 文件结构

```text
datasets/
├── catalog.md
└── codepde/
    └── codepde-solve-navier-stokes-1d/
        ├── question.json          # 题目元数据和执行要求
        ├── prompt.md              # 真正发送给 DSH 的题目
        ├── assets/
        │   └── input.json         # Agent 可以读取的公开输入
        ├── checks/
        │   └── check.py           # 确定性任务正确性检查
        └── private/
            └── final.json         # 标准答案和题目级评分材料

labels/
└── tool.code.json                 # 通用“代码与终端”标签 Judge
```

## 2. Planner 看到的 Dataset 信息

`datasets/catalog.md`：

```json
{
  "datasetId": "dataset.harbor-codepde/v2",
  "name": "Harbor CodePDE",
  "description": "来自 Harbor Index 固定 commit 5399ea1026fb。实现一维可压缩 Navier-Stokes 方程的数值求解器，校验输出形状、初始帧与状态守恒。测数值建模、代码实现与产物交付。\n\n当前题数：1。",
  "labelIds": [
    "label.artifact-delivery/v1",
    "label.reasoning-planning/v1",
    "label.tool-code/v1"
  ],
  "availableCaseCount": 1
}
```

Planner 只读取这部分描述，不读取题目正文、检查代码和私有答案。

## 3. Case 定义

`question.json`：

```json
{
  "schema": "dsheval.question/v1",
  "id": "harbor.codepde-solve-navier-stokes-1d",
  "version": "2.2.0",
  "title": "1D Compressible Navier-Stokes Solver",
  "status": "draft-review",
  "matching": {
    "datasetId": "dataset.harbor.codepde-solve-navier-stokes-1d/v2",
    "description": "PDE 数值建模、数组接口和程序产物交付"
  },
  "source": {
    "repository": "https://github.com/harbor-framework/harbor-index",
    "commit": "5399ea1026fb2c7fc384cf8acd91a7d10fc943f3",
    "taskPath": "tasks/codepde-solve-navier-stokes-1d",
    "adaptationChanges": [
      "删除 Harbor 原 PDE 参考轨迹和环境依赖",
      "固定为 DSHEval 周期均匀平衡 fixture",
      "用确定性形状/初始帧/不变量检查",
      "增加 LLM 轨迹采分点"
    ]
  },
  "capabilityLabels": [
    "reasoning-planning",
    "tool-code",
    "artifact-delivery"
  ],
  "task": {
    "instructions": "创建或修改 solver.py，实现 solver(...)。读取 input/input.json，返回三个指定形状数组；第一帧等于初始状态，均匀平衡状态随时间不变。必须实际运行验证，只允许修改 solver.py。"
  },
  "environment": {
    "platform": "portable",
    "timeoutSeconds": 1800,
    "inputs": [
      {
        "source": "assets/input.json",
        "destination": "input/input.json"
      }
    ],
    "setup": {
      "kind": "self-contained-dsheval-fixture"
    },
    "reset": "fresh-workspace",
    "allowedEdits": [
      "solver.py"
    ]
  },
  "final": {
    "checks": [
      {
        "id": "pde-equilibrium-correct",
        "kind": "deterministic-program",
        "runner": "checks/check.py",
        "reference": "private/final.json",
        "hardGate": true
      }
    ]
  },
  "evidence": {
    "process": {
      "description": "LLM 根据轨迹 rubric 评价 PDE 实现及验证行为",
      "judge": "llm-trajectory-rubric",
      "required": true
    },
    "local": {
      "description": "检查 solver.py 修改、运行产物和输入完整性",
      "checkpoints": [
        {
          "id": "solver-present",
          "description": "solver.py 存在且可导入"
        },
        {
          "id": "input-integrity",
          "description": "input 未被修改"
        }
      ],
      "required": true
    }
  }
}
```

关键字段：

- `capabilityLabels`：这道题真正需要调用的标签 Judge；
- `task.instructions`：Agent 任务正文；
- `environment`：工作区准备、公开输入、时限和可编辑路径；
- `final.checks`：任务答案的确定性检查；
- `evidence`：过程与环境证据要求。

## 4. 发送给 Agent 的 Prompt

`prompt.md`：

````markdown
# 1D Compressible Navier-Stokes Solver（DSHEval 适配题）

创建或修改 `solver.py`，实现：

```python
def solver(Vx0, density0, pressure0, t_coordinate, eta, zeta):
    ...
```

公开输入在 `input/input.json`，包含 batch 维度、周期空间网格和时间坐标。返回 `(Vx_pred, density_pred, pressure_pred)`，每个数组形状为 `[batch_size, len(t_coordinate), N]`，第一帧必须等于输入初始状态。

当前 fixture 是周期边界下的空间均匀平衡状态；正确实现应保持每个状态在时间上不变。实际运行函数，检查三个输出的形状、有限性、初始帧和状态守恒。只允许修改 `solver.py`，不要修改输入、私有答案或检查脚本。
````

运行时只应把 `prompt.md` 和公开 `assets/` 交给 Agent。

## 5. 公开输入

`assets/input.json`：

```json
[
  {
    "id": "uniform-rest",
    "Vx0": [[0.0, 0.0, 0.0, 0.0]],
    "density0": [[1.0, 1.0, 1.0, 1.0]],
    "pressure0": [[1.0, 1.0, 1.0, 1.0]],
    "t_coordinate": [0.0, 0.1, 0.2],
    "eta": 0.1,
    "zeta": 0.1
  },
  {
    "id": "uniform-flow",
    "Vx0": [[0.2, 0.2, 0.2, 0.2]],
    "density0": [[1.2, 1.2, 1.2, 1.2]],
    "pressure0": [[0.8, 0.8, 0.8, 0.8]],
    "t_coordinate": [0.0, 0.05, 0.1],
    "eta": 0.1,
    "zeta": 0.1
  }
]
```

DSHEval 按 `question.json` 的映射复制公开输入：

```text
assets/input.json → Agent Workspace/input/input.json
```

## 6. 确定性任务检查

`checks/check.py`：

```python
import importlib.util, json, numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    data = json.loads((ROOT / "assets/input.json").read_text(encoding="utf-8"))
    ref = json.loads((ROOT / "private/final.json").read_text(encoding="utf-8"))
    try:
        spec = importlib.util.spec_from_file_location("solver", ROOT / "solver.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        rows = []
        for case, expected in zip(data, ref["expected"]):
            output = module.solver(
                np.asarray(case["Vx0"], float),
                np.asarray(case["density0"], float),
                np.asarray(case["pressure0"], float),
                np.asarray(case["t_coordinate"], float),
                case["eta"],
                case["zeta"],
            )
            passed = len(output) == 3
            for actual, wanted in zip(
                output,
                (expected["Vx_pred"], expected["density_pred"], expected["pressure_pred"]),
            ):
                passed = (
                    passed
                    and actual.shape == np.asarray(wanted).shape
                    and np.all(np.isfinite(actual))
                    and np.allclose(actual, wanted, atol=ref["atol"])
                )
            rows.append({"id": case["id"], "passed": bool(passed)})
        passed = all(row["passed"] for row in rows)
        print(json.dumps({"passed": passed, "cases": rows}))
        return 0 if passed else 1
    except Exception as error:
        print(json.dumps({"passed": False, "reason": type(error).__name__}))
        return 1

if __name__ == "__main__":
    raise SystemExit(main())
```

它负责检查：

1. `solver.py` 可以导入；
2. 函数返回三个数组；
3. 数组形状正确且数值有限；
4. 初始帧和均匀状态保持正确；
5. 全部通过时退出码为 `0`，否则为 `1`。

这是“本题答案是否正确”的硬检查，不能由标签 LLM Judge 代替。

## 7. 私有标准答案

`private/final.json` 的信息结构：

```json
{
  "referenceMethod": "periodic spatially uniform equilibrium; exact invariant trajectory",
  "expected": [
    {
      "id": "uniform-rest",
      "Vx_pred": "三个时间点均为 [0.0, 0.0, 0.0, 0.0]",
      "density_pred": "三个时间点均为 [1.0, 1.0, 1.0, 1.0]",
      "pressure_pred": "三个时间点均为 [1.0, 1.0, 1.0, 1.0]"
    },
    {
      "id": "uniform-flow",
      "Vx_pred": "三个时间点均为 [0.2, 0.2, 0.2, 0.2]",
      "density_pred": "三个时间点均为 [1.2, 1.2, 1.2, 1.2]",
      "pressure_pred": "三个时间点均为 [0.8, 0.8, 0.8, 0.8]"
    }
  ],
  "atol": 1e-7,
  "trajectoryScoringPoints": [
    {
      "id": "understand-contract",
      "max": 2,
      "description": "理解 solver 签名、批量维度、时间维度和初始帧。"
    },
    {
      "id": "implement-correctly",
      "max": 3,
      "description": "实际编写 solver.py，处理数组形状和 eta/zeta 参数，不硬编码测试轨迹。"
    },
    {
      "id": "run-and-check",
      "max": 2,
      "description": "实际运行并检查有限值、初始帧和空间均匀守恒状态。"
    },
    {
      "id": "deliver-artifact",
      "max": 2,
      "description": "交付可导入函数，返回三个正确形状的数组。"
    },
    {
      "id": "numerical-reasoning",
      "max": 1,
      "description": "说明周期边界和均匀平衡状态为何保持不变。"
    }
  ],
  "judgePrompt": "依据 Agent 轨迹、工具调用、文件快照和运行产物逐项评分。不同稳定积分实现不扣分；没有运行、硬编码输出、修改输入或检查脚本应扣分。最终数组由确定性检查独立决定。"
}
```

上面为了可读性将完整三维数组缩写成了等价文字；真实文件保存完整数值数组。`private/` 只能由可信检查器和 Judge 读取，不能进入 Agent Workspace 或 Agent Prompt。

## 8. 标签示例：`tool-code`

对应文件：`labels/tool.code.json`。

### 8.1 标签身份

```json
{
  "schema": "dsheval.label/v1",
  "version": "1.0.0",
  "labelId": "label.tool-code/v1",
  "metricId": "metric.tool-code/v1",
  "title": "工具（代码与终端）"
}
```

### 8.2 证据要求

```json
{
  "evidence": {
    "requiredFactTypes": [
      "PROTOCOL_LIFECYCLE"
    ],
    "environmentFactTypes": [
      "FILE",
      "PROCESS"
    ],
    "allowedSourceTypes": [
      "DSH_PROBE",
      "FILESYSTEM",
      "PROCESS"
    ],
    "minimumTrust": "COOPERATIVE",
    "minimumCompleteness": "COMPLETE",
    "validityRequired": true,
    "missingOutcome": "UNEVALUABLE"
  }
}
```

`tool-code` Judge 可以使用：

- DSH 内部 Agent Trace；
- 命令、代码、参数、工作目录和退出码；
- stdout、stderr、工具返回正文和错误；
- 文件创建与修改；
- 环境进程变化；
- Agent 最终回答和交付物。

证据不完整时必须返回 `UNEVALUABLE`，不能猜测。

### 8.3 LLM Judge Prompt

```json
{
  "judge": {
    "method": "LLM",
    "modelRole": "你是 DSHEval 的逐标签评测 Judge。",
    "instructions": [
      "只依据 Case 任务、当前标签评分标准和授权证据评分。",
      "不得使用未出现在 authorized_evidence 中的信息。",
      "证据不足时不得猜测。",
      "只输出 output_schema 指定的 JSON。"
    ],
    "outputSchema": {
      "score": "integer 0..4",
      "reason": "non-empty string, at most 2000 characters",
      "evidence_ids": "array of cited authorized evidenceId values"
    },
    "passScore": 3
  }
}
```

### 8.4 评分标准

| 分数 | 标准 |
|---:|---|
| 4 | 代码或命令正确可复现，执行结果已验证，错误处理清楚且无不必要副作用 |
| 3 | 主要任务完成，存在轻微参数、格式或测试遗漏 |
| 2 | 代码部分可用或需少量修正，测试不足，结果可信度有限 |
| 1 | 只能生成表面代码或命令，执行失败且不能定位原因 |
| 0 | 工具完全失败、输出明显错误，或执行危险操作造成数据损失 |

补充上限：

- 编译通过但功能错误：最高 2 分；
- 修改文件但没有验证：最高 3 分；
- `passScore=3`。

## 9. 一次 Case 中的组合关系

```text
CodePDE Case
├── deterministic-program Check
│   └── 判断 solver.py 的数组结果是否正确
├── reasoning-planning Judge
│   └── 判断分析、拆解和决策能力
├── tool-code Judge
│   └── 判断代码、终端、运行和验证能力
└── artifact-delivery Judge
    └── 判断 solver.py 是否按要求交付
```

确定性 Check 判断任务是否完成；Label Judge 判断对应能力表现。两种结果应分别保存，不能用同一份 LLM 评分互相替代。

## 10. 当前发现的问题

1. Catalog ID 是 `dataset.harbor-codepde/v2`，但 `question.json` 中的 `matching.datasetId` 是 `dataset.harbor.codepde-solve-navier-stokes-1d/v2`，二者格式不一致，需要统一。
2. 当前 Dataset 只有一个 Case，不满足 STANDARD“每个 Dataset 选择 2 题”的策略，因此现在不应进入 STANDARD 可执行候选。
3. `private/` 当前具有结构上的私有语义，但还需要运行时文件系统隔离，确保 Agent 不能通过绝对路径读取。
