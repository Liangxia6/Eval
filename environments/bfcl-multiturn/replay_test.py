#!/usr/bin/env python3
"""bfcl-multiturn 适配器验收：用本地 5 题的 groundTruth 回放 mock 工具环境。

只执行 mock 工具逻辑（无网络、无 Agent、无外部服务）。通过标准：
1. 每轮 gold 调用全部成功执行（结果不含 "Error during execution"）；
2. 各题关键终态与题目语义一致；
3. missed_function 门控生效：不可用函数在该轮调用会得到错误结果。

用法：python3 environments/bfcl-multiturn/replay_test.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bfcl_env.controller import CaseController  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CASES_DIR = os.path.join(REPO_ROOT, "datasets", "bfcl-multiturn")


def case_dir(case_id):
    return os.path.join(CASES_DIR, case_id)


def load_ground_truth(case_id):
    with open(os.path.join(case_dir(case_id), "private", "final.json"), encoding="utf-8") as file:
        return json.load(file)["answer"]["groundTruth"]


def replay(case_id):
    controller = CaseController(case_dir(case_id))
    ground_truth = load_ground_truth(case_id)
    all_results = []
    for turn_index, calls in enumerate(ground_truth):
        results = controller.execute(turn_index, calls)
        errors = [result for result in results if result.startswith("Error during execution")]
        assert not errors, f"{case_id} turn {turn_index}: {errors}"
        all_results.extend(results)
    return controller, all_results


def assert_final_state(controller, case_id):
    instances = controller.backends.instances
    if case_id == "bfcl-multi-turn-base-1":
        fs = instances["GorillaFileSystem"]
        pwd = fs.pwd()["current_working_directory"]
        assert pwd == "/alex/workspace/archive", pwd
        assert "log.txt" in fs.ls()["current_directory_content"]
        assert "log.txt" in fs.ls(a=True)["current_directory_content"]
    elif case_id == "bfcl-multi-turn-base-60":
        ticket = instances["TicketAPI"].get_ticket(2)
        assert ticket["status"] == "Closed", ticket
        vehicle = instances["VehicleControlAPI"]
        assert vehicle.engine_state == "running"
        assert all(state == "locked" for state in vehicle.doorStatus.values())
    elif case_id == "bfcl-multi-turn-long-context-150":
        assert instances["TravelAPI"].budget_limit == 22000.0
    elif case_id == "bfcl-multi-turn-miss-func-120":
        trading = instances["TradingBot"]
        order = trading.get_order_details(12446)
        assert order["status"] == "Cancelled", order
        # 上游语义：订单保持 Open 时未成交、不扣款；取消后状态 Cancelled、余额不变。
        assert trading.get_account_info()["balance"] == 22800.0
        # 门控：第 2 轮（0 基 1）get_order_details 尚不可用，调用应报错。
        blocked = controller.execute(1, ["get_order_details(order_id=12446)"])
        assert blocked and blocked[0].startswith("Error during execution"), blocked
    elif case_id == "bfcl-multi-turn-miss-param-90":
        vehicle = instances["VehicleControlAPI"]
        assert vehicle.engine_state == "running"
        assert vehicle.fuelLevel > 5.0
        tweets = instances["TwitterAPI"].tweets
        assert 10 in tweets
        assert "@RoadsideAssistance" in tweets[10]["mentions"]
    else:
        raise AssertionError(f"unexpected case {case_id}")


def main():
    case_ids = sorted(
        name for name in os.listdir(CASES_DIR)
        if os.path.isdir(os.path.join(CASES_DIR, name))
    )
    assert len(case_ids) == 5, case_ids
    for case_id in case_ids:
        controller, results = replay(case_id)
        assert_final_state(controller, case_id)
        print(f"PASS {case_id}: {sum(len(t) for t in load_ground_truth(case_id))} calls replayed")
    print("ALL 5 CASES PASS")


if __name__ == "__main__":
    main()
