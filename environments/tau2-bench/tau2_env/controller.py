"""按 Case 组装 tau2 环境（DB + 工具 + 用户工具），提供动作执行与断言求值。"""

import json
import os

from .env import evaluate_assertions, execute_action, load_env, sync_tools


class CaseController:
    """一个 tau2-bench Case 的工具执行会话。

    - domain 由 case 目录名推断（-telecom- 为 telecom，否则 retail）；
    - 数据从 environments/tau2-bench/data/ 加载（fetch_data.py 下载校验）；
    - execute(action) 按 requestor 分派到领域工具或用户工具；
    - evaluate(assertions) 求值官方 env_assertions；
    - scenario（private/scenario.json）为官方用户模拟器配置。
    """

    def __init__(self, case_dir, data_dir):
        case_name = os.path.basename(case_dir.rstrip("/"))
        domain = "telecom" if "-telecom-" in case_name else "retail"
        self.case_dir = case_dir
        self.domain = domain
        self.db, self.tools, self.user_db, self.user_tools = load_env(domain, data_dir)
        if domain == "telecom":
            sync_tools(self.tools, self.user_tools)
        scenario_path = os.path.join(case_dir, "private", "scenario.json")
        with open(scenario_path, encoding="utf-8") as file:
            self.scenario = json.load(file)

    def execute(self, action):
        return execute_action(
            self.tools,
            self.user_tools,
            action.get("requestor", "agent"),
            action["name"],
            action.get("arguments", {}),
        )

    def evaluate(self, assertions):
        evaluate_assertions(self.tools, self.user_tools, assertions)
