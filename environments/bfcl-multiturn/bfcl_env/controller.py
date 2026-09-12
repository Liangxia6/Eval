"""按 Case 加载 scenario 并提供逐轮门控执行。"""

import json
import os

from .engine import CaseBackends


class CaseController:
    """一个 BFCL 多轮 Case 的会话控制器。

    - 从 private/scenario.json 读取 initial_config、involved_classes、
      missed_function（"第 N 轮不可用的函数" -> 0 基轮次索引）；
    - question 为逐轮用户消息（放题由运行侧负责，这里只提供数据）；
    - execute(turn, calls) 执行一轮工具调用，自动拦截该轮不可用的函数。
    """

    def __init__(self, case_dir):
        scenario_path = os.path.join(case_dir, "private", "scenario.json")
        with open(scenario_path, encoding="utf-8") as file:
            scenario = json.load(file)
        self.case_dir = case_dir
        self.scenario = scenario
        long_context = "long-context" in os.path.basename(case_dir.rstrip("/"))
        self.backends = CaseBackends(
            scenario["involved_classes"],
            scenario.get("initial_config", {}),
            long_context=long_context,
        )
        self.missed_function = {
            int(turn) - 1: functions
            for turn, functions in scenario.get("missed_function", {}).items()
        }

    @property
    def turns(self):
        return self.scenario["question"]

    def execute(self, turn_index, calls):
        return self.backends.execute(calls, blocked=self.missed_function.get(turn_index))
