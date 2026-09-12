"""tau2-bench 官方包接线：DB 加载、工具实例化、动作执行与断言求值。

依赖官方 tau2 包（environments/tau2-bench/requirements.txt，固定 commit
与各题 question.json 的 source.commit 一致）。数据文件由
environments/tau-bench/fetch_data.py 按 databaseSeed 清单下载校验，
按上游路径布局存放在 environments/tau2-bench/data/ 下。
"""

import os

from tau2.domains.retail.data_model import RetailDB
from tau2.domains.retail.tools import RetailTools
from tau2.domains.telecom.data_model import LineStatus, TelecomDB
from tau2.domains.telecom.tools import TelecomTools
from tau2.domains.telecom.user_data_model import PaymentRequest, TelecomUserDB
from tau2.domains.telecom.user_tools import TelecomUserTools


def load_env(domain: str, data_dir: str):
    """返回 (db, tools, user_db, user_tools)；retail 域无用户工具（None）。"""
    if domain == "retail":
        db = RetailDB.load(os.path.join(data_dir, "data", "tau2", "domains", "retail", "db.json"))
        return db, RetailTools(db), None, None
    db = TelecomDB.load(os.path.join(data_dir, "data", "tau2", "domains", "telecom", "db.toml"))
    user_db = TelecomUserDB.load(
        os.path.join(data_dir, "data", "tau2", "domains", "telecom", "user_db.toml")
    )
    return db, TelecomTools(db), user_db, TelecomUserTools(user_db)


def sync_tools(tools, user_tools):
    """复刻官方 TelecomEnvironment.sync_tools：把线路状态同步到用户侧。"""
    if user_tools.db.surroundings.phone_number is None:
        return
    phone_number = user_tools.db.surroundings.phone_number
    line = tools._get_line_by_phone(phone_number)
    if line is None:
        raise ValueError(f"Wrong scenario, line not found for phone number: {phone_number}")
    user_tools.db.surroundings.line_active = line.status == LineStatus.ACTIVE
    user_tools.db.surroundings.roaming_allowed = line.roaming_enabled
    plan = tools._get_plan_by_id(line.plan_id)
    if plan is None:
        raise ValueError(
            f"Wrong scenario, invalid plan id ({line.plan_id}) for the phone number {phone_number}"
        )
    user_tools.db.surroundings.mobile_data_usage_exceeded = (
        line.data_used_gb >= plan.data_limit_gb + line.data_refueling_gb
    )
    request = user_tools.db.surroundings.payment_request
    if request is not None:
        if request.paid:
            tools._set_bill_to_paid(request.bill_id)
            user_tools.db.surroundings.payment_request = None
    request = user_tools.db.surroundings.payment_request
    if request is None:
        customer = tools.get_customer_by_phone(phone_number)
        bills = tools._get_bills_awaiting_payment(customer)
        if bills:
            bill = bills[0]
            user_tools.db.surroundings.payment_request = PaymentRequest(
                bill_id=bill.bill_id, amount_due=bill.total_due
            )


def execute_action(tools, user_tools, requestor, name, arguments):
    """requestor=user 走用户侧工具；agent/assistant 走领域工具。"""
    target = user_tools if requestor == "user" else tools
    method = getattr(target, name)
    return method(**arguments)


def evaluate_assertions(tools, user_tools, assertions):
    """官方 env_assertions：按 env_type 选目标对象，调用断言函数并与 assert_value 比较。"""
    for assertion in assertions or []:
        target = user_tools if assertion["env_type"] == "user" else tools
        function = getattr(target, assertion["func_name"])
        value = function(**assertion.get("arguments", {}))
        assert value == assertion["assert_value"], (
            f"{assertion['func_name']}{assertion.get('arguments')}: {value} != {assertion['assert_value']}"
        )
