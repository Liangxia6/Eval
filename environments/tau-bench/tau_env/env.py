"""tau-bench 数据加载与官方工具注册表。

工具实现来自 vendor/tau_bench（MIT，sierra-research/tau-bench，固定 commit 见各题
question.json 的 source.commit）。数据文件不在仓库内：由 fetch_data.py 按
question.json 的 databaseSeed 清单（路径 + sha256）下载校验到 environments/tau-bench/data/。
"""

import importlib
import json
import os
import sys

_VENDOR_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "vendor")
if _VENDOR_DIR not in sys.path:
    sys.path.insert(0, _VENDOR_DIR)

DOMAIN_MODULES = {
    "airline": "tau_bench.envs.airline.tools",
    "retail": "tau_bench.envs.retail.tools",
}

DATA_FILES = {
    "airline": ["flights.json", "reservations.json", "users.json"],
    "retail": ["orders.json", "products.json", "users.json"],
}


def load_data(domain: str, data_dir: str) -> dict:
    """按官方 data/__init__.py 的方式读取 JSON 数据为 dict（键为 id）。

    文件按上游路径布局存放：<data_dir>/tau_bench/envs/<domain>/data/<file>.json
    （与 fetch_data.py 按 databaseSeed 清单下载后的布局一致）。
    """
    files = DATA_FILES[domain]
    data = {}
    for name in files:
        path = os.path.join(data_dir, "tau_bench", "envs", domain, "data", name)
        with open(path, encoding="utf-8") as file:
            data[name.removesuffix(".json")] = json.load(file)
    return data


def tool_registry(domain: str) -> dict[str, type]:
    """{tool_name: ToolClass}，来自官方 ALL_TOOLS。"""
    module = importlib.import_module(DOMAIN_MODULES[domain])
    return {tool.get_info()["function"]["name"]: tool for tool in module.ALL_TOOLS}


def execute_action(data: dict, tools: dict[str, type], name: str, kwargs: dict) -> str:
    tool = tools.get(name)
    if tool is None:
        return f"Error: unknown tool {name}"
    return tool.invoke(data=data, **kwargs)
