"""按 Case 组装数据 + 工具注册表，提供动作执行入口。"""

import json
import os

from .env import load_data, tool_registry, execute_action


class CaseController:
    """一个 tau-bench Case 的工具执行会话。

    - domain 由 case 目录名推断（含 -airline- 为 airline，否则 retail）；
    - 数据从 environments/tau-bench/data/ 加载（由 fetch_data.py 下载校验）；
    - execute(action) 执行 {name, kwargs} 动作并返回工具结果字符串；
    - scenario（private/scenario.json）为官方用户指令，供用户模拟器使用。
    """

    def __init__(self, case_dir, data_dir):
        case_name = os.path.basename(case_dir.rstrip("/"))
        domain = "airline" if "-airline-" in case_name else "retail"
        self.case_dir = case_dir
        self.domain = domain
        self.data = load_data(domain, data_dir)
        self.tools = tool_registry(domain)
        scenario_path = os.path.join(case_dir, "private", "scenario.json")
        with open(scenario_path, encoding="utf-8") as file:
            self.scenario = json.load(file)

    def execute(self, action):
        return execute_action(self.data, self.tools, action["name"], action.get("kwargs", {}))
