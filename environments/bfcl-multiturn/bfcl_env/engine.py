"""BFCL 多轮工具调用执行引擎（按 Case 隔离状态）。

适配自 Apache-2.0 的 gorilla/berkeley-function-call-leaderboard BFCL
多轮评测引擎（multi_turn_utils.py）。与原版的差异只有一处：工具实例
存放在每个 Case 自己的 CaseBackends 里，而不是进程 globals()，使单个
进程可以同时安全地服务多个 Case。

执行语义与原版保持一致：
- 从 scenario.initial_config 逐类调用 _load_scenario 初始化状态；
- 对调用串做方法名 -> 实例前缀改写后 eval，并拦截危险函数名；
- 结果序列化：str 原样、dict 转 json.dumps、其余转 str；
- 任何异常都折叠为 "Error during execution: ..." 字符串结果。
"""

import importlib
import inspect
import json
import os
import re
import sys
from copy import deepcopy

_VENDOR_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vendor"
)
if _VENDOR_DIR not in sys.path:
    sys.path.insert(0, _VENDOR_DIR)

# 与原版 constants/executable_backend_config.py 相同的前缀约定；
# 这里只保留本适配器用到的六个有状态类。
CLASS_FILE_PATH_MAPPING = {
    "GorillaFileSystem": "bfcl_eval.eval_checker.multi_turn_eval.func_source_code.gorilla_file_system",
    "TwitterAPI": "bfcl_eval.eval_checker.multi_turn_eval.func_source_code.posting_api",
    "TicketAPI": "bfcl_eval.eval_checker.multi_turn_eval.func_source_code.ticket_api",
    "TradingBot": "bfcl_eval.eval_checker.multi_turn_eval.func_source_code.trading_bot",
    "TravelAPI": "bfcl_eval.eval_checker.multi_turn_eval.func_source_code.travel_booking",
    "VehicleControlAPI": "bfcl_eval.eval_checker.multi_turn_eval.func_source_code.vehicle_control",
}

_BLOCKED_CALL_NAMES = {"kill", "exit", "quit", "remove", "unlink", "popen", "Popen", "run"}


class CaseBackends:
    """一个 Case 的全部有状态工具后端实例及其方法归属表。"""

    def __init__(self, involved_classes, initial_config, long_context=False):
        self.instances = {}
        self._owner_var = {}
        for index, class_name in enumerate(involved_classes):
            module = importlib.import_module(CLASS_FILE_PATH_MAPPING[class_name])
            instance = getattr(module, class_name)()
            instance._load_scenario(
                deepcopy(initial_config.get(class_name, {})),
                long_context=long_context,
            )
            self.instances[class_name] = instance
            var_name = f"_instance_{index}"
            for method_name, _ in inspect.getmembers(instance, predicate=inspect.ismethod):
                if not method_name.startswith("_"):
                    self._owner_var[method_name] = var_name

    def execute(self, calls, blocked=None):
        """执行一串工具调用，返回与原版引擎一致的字符串结果列表。"""
        blocked = set(blocked or [])
        namespace = {
            f"_instance_{index}": instance
            for index, instance in enumerate(self.instances.values())
        }
        results = []
        for call in calls:
            top = call.split("(")[0]
            function_name = top.split(".")[-1] if "." in top else top
            if function_name in _BLOCKED_CALL_NAMES:
                results.append(f"Error during execution: function call {function_name} is not allowed.")
                continue
            if function_name in blocked:
                # 与原版一致：该轮函数尚不可用时，调用落入 NameError 并折叠为错误结果。
                results.append(f"Error during execution: name '{function_name}' is not defined")
                continue
            try:
                processed = re.sub(
                    r"\b([a-zA-Z_]\w*)\s*(?=\()",
                    lambda match: (
                        f"{self._owner_var[match.group(1)]}.{match.group(1)}"
                        if match.group(1) in self._owner_var
                        else match.group(1)
                    ),
                    call,
                )
                value = eval(processed, {}, namespace)
            except Exception as error:  # noqa: BLE001 - 与原版一致，把执行异常折叠进结果
                results.append(f"Error during execution: {str(error)}")
                continue
            if type(value) is str:
                results.append(value)
            elif type(value) is dict:
                try:
                    results.append(json.dumps(value))
                except TypeError:
                    results.append(str(value))
            else:
                results.append(str(value))
        return results
