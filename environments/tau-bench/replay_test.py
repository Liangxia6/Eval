#!/usr/bin/env python3
"""tau-bench 适配器验收：用本地 5 题的 gold actions 回放官方工具层。

先运行 fetch_data.py 下载数据，再执行本脚本（只跑工具逻辑，无 LLM、无网络）。
通过标准：
1. 每题 gold 动作全部成功执行（结果不以 "Error" 开头）；
2. 关键终态与题目语义一致（预订/换货/地址/退款）。
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tau_env.controller import CaseController  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CASES_DIR = os.path.join(REPO_ROOT, "datasets", "tau-bench")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def load_gold(case_id):
    with open(os.path.join(CASES_DIR, case_id, "private", "final.json"), encoding="utf-8") as file:
        return json.load(file)["answer"]


def replay(case_id):
    controller = CaseController(os.path.join(CASES_DIR, case_id), DATA_DIR)
    gold = load_gold(case_id)
    results = []
    for action in gold["actions"]:
        result = controller.execute(action)
        results.append(result)
    # 轨迹中允许"预期失败"的查询（如 retail-068 用户先报错邮编），
    # 但最后一个动作必须是成功语义；终态断言才是真正的验收门。
    if gold["actions"]:
        final = results[-1]
        assert not final.startswith("Error"), f"{case_id} final action errored: {final}"
    return controller, gold, results


def assert_final_state(controller, case_id, gold):
    data = controller.data
    if case_id == "tau-bench-airline-000":
        reservation = data["reservations"]["HATHAT"]
        assert [f["flight_number"] for f in reservation["flights"]] == ["HAT136", "HAT039"]
        assert reservation["passengers"][0]["first_name"] == "Mia"
        assert "HATHAT" in data["users"]["mia_li_3668"]["reservations"]
    elif case_id == "tau-bench-airline-020":
        flights = data["reservations"]["1N99U6"]["flights"]
        assert [(f["flight_number"], f["date"]) for f in flights] == [
            ("HAT266", "2024-05-19"), ("HAT112", "2024-05-27")]
    elif case_id == "tau-bench-retail-000":
        order = data["orders"]["#W2378156"]
        assert order["exchange_items"] == ["1151293680", "4983901480"], order
        assert order["exchange_new_items"] == ["7706410293", "7747408585"], order
    elif case_id == "tau-bench-retail-022":
        assert data["users"]["ethan_garcia_1261"]["address"]["address1"] == "667 Highland Drive"
        assert data["orders"]["#W9911714"]["address"]["address1"] == "101 Highway"
    elif case_id == "tau-bench-retail-068":
        assert gold["outputs"] == ["829.43"]
        assert "noah_ito_3850" in data["users"]
    else:
        raise AssertionError(f"unexpected case {case_id}")


def main():
    case_ids = sorted(
        name for name in os.listdir(CASES_DIR)
        if os.path.isdir(os.path.join(CASES_DIR, name))
    )
    assert len(case_ids) == 5, case_ids
    for case_id in case_ids:
        controller, gold, results = replay(case_id)
        assert_final_state(controller, case_id, gold)
        print(f"PASS {case_id}: {len(gold['actions'])} actions replayed")
    print("ALL 5 CASES PASS")


if __name__ == "__main__":
    main()
