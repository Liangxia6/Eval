#!/usr/bin/env python3
"""tau2-bench 适配器验收：用本地 5 题的 gold actions 回放官方工具层。

前置：pip install -r environments/tau2-bench/requirements.txt（Python >= 3.12）
      并运行 environments/tau-bench/fetch_data.py tau2-bench 下载数据。
通过标准：
1. 每题 gold 动作（agent/assistant/user）全部执行无异常；
2. 官方 env_assertions 全部满足；
3. retail-040 的支付方式变更落库。
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from tau2_env.controller import CaseController  # noqa: E402

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CASES_DIR = os.path.join(REPO_ROOT, "datasets", "tau2-bench")
DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")


def load_answer(case_id):
    with open(os.path.join(CASES_DIR, case_id, "private", "final.json"), encoding="utf-8") as file:
        return json.load(file)["answer"]


def main():
    case_ids = sorted(
        name for name in os.listdir(CASES_DIR)
        if os.path.isdir(os.path.join(CASES_DIR, name))
    )
    assert len(case_ids) == 5, case_ids
    for case_id in case_ids:
        answer = load_answer(case_id)
        controller = CaseController(os.path.join(CASES_DIR, case_id), DATA_DIR)
        for action in answer["actions"]:
            result = controller.execute(action)  # 任何异常都会在此处暴露
        controller.evaluate(answer.get("env_assertions"))
        if case_id == "tau2-bench-retail-040":
            order = controller.tools.get_order_details("#W4923227")
            # 官方语义：改支付 = 新增一笔 payment(新卡) + 退款(旧卡)；取最后一笔 payment 记录
            payments = [p for p in order.payment_history if p.transaction_type == "payment"]
            assert payments[-1].payment_method_id == "credit_card_8897086", payments
        print(f"PASS {case_id}: {len(answer['actions'])} actions replayed")
    print("ALL 5 CASES PASS")


if __name__ == "__main__":
    main()
