from __future__ import annotations

import os
import sys
import types
import unittest
from unittest import mock

import holdings_review as hr


class FakeFrame:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return iter(enumerate(self.rows))


def position(ticker="NET", qty=2):
    return {"ticker": ticker, "qty": qty, "avg_cost": 292.11}


def order(
    *, ticker="NET", side="SELL", order_type="STOP_LIMIT",
    order_status="WAITING_SUBMIT", qty=2, dealt_qty=0,
    trigger_price=268.22, limit_price=268.22,
):
    return {
        "ticker": ticker,
        "side": side,
        "order_type": order_type,
        "order_status": order_status,
        "qty": qty,
        "dealt_qty": dealt_qty,
        "remaining_qty": max(qty - dealt_qty, 0),
        "trigger_price": trigger_price,
        "limit_price": limit_price,
    }


class ProtectionReconciliationTests(unittest.TestCase):
    def test_net_full_queued_stop_limit_is_detected_at_268_22(self):
        result = hr.reconcile_protection(position(), [order()])
        self.assertEqual(result["protection_state"], "PROTECTED-QUEUED")
        self.assertEqual(result["queued_qty"], 2)
        self.assertEqual(result["unprotected_qty"], 0)
        self.assertEqual(result["protective_orders"][0]["trigger_price"], 268.22)

    def test_normal_sell_limit_is_not_protective(self):
        result = hr.reconcile_protection(position(), [order(order_type="NORMAL")])
        self.assertEqual(result["protection_state"], "UNPROTECTED")
        self.assertEqual(result["protective_orders"], [])

    def test_partial_quantity_stays_explicit(self):
        result = hr.reconcile_protection(position(qty=2), [order(qty=1)])
        self.assertEqual(result["protection_state"], "PARTIALLY-PROTECTED")
        self.assertEqual(result["protected_qty"], 1)
        self.assertEqual(result["unprotected_qty"], 1)
        self.assertTrue(result["new_risk_block"])

    def test_partially_filled_order_uses_remaining_quantity_against_live_position(self):
        result = hr.reconcile_protection(
            position(qty=2),
            [order(order_status="FILLED_PART", qty=3, dealt_qty=1)],
        )
        self.assertEqual(result["protection_state"], "PROTECTED-WORKING")
        self.assertEqual(result["working_qty"], 2)

    def test_cancelled_or_failed_stop_is_excluded(self):
        for status in ("CANCELLED_ALL", "FAILED", "DELETED"):
            with self.subTest(status=status):
                result = hr.reconcile_protection(position(), [order(order_status=status)])
                self.assertEqual(result["protection_state"], "UNPROTECTED")

    def test_order_feed_failure_never_claims_protection(self):
        result = hr.reconcile_protection(position(), None)
        self.assertEqual(result["protection_state"], "ORDER-FEED-UNVERIFIED")
        self.assertFalse(result["order_feed_verified"])
        self.assertTrue(result["new_risk_block"])

    def test_journal_plan_absence_does_not_hide_live_broker_protection(self):
        row = {
            **position(),
            **hr.reconcile_protection(position(), [order(order_status="SUBMITTED")]),
            "last": 292.11,
            "after_price": None,
            "planned_stop": None,
            "atr14": 5,
            "ema8": 290,
        }
        classified = hr.classify(row)
        self.assertEqual(classified["protection_state"], "PROTECTED-WORKING")
        self.assertEqual(classified["planned_stop_status"], "NO-PLAN")
        self.assertEqual(classified["stop_status"], "PROTECTED-WORKING")


class BrokerSnapshotTests(unittest.TestCase):
    def test_one_context_reads_positions_and_orders_and_redacts_identifiers(self):
        calls = []

        class Context:
            def __init__(self, **kwargs):
                calls.append(("open", kwargs))

            def get_acc_list(self):
                calls.append(("accounts", {}))
                return 0, FakeFrame([
                    {"acc_id": 987654321, "trd_env": "REAL"},
                    {"acc_id": 123456789, "trd_env": "SIMULATE"},
                ])

            def position_list_query(self, **kwargs):
                calls.append(("positions", kwargs))
                return 0, FakeFrame([{
                    "code": "US.NET", "qty": 2, "average_cost": 292.11,
                    "acc_id": "private-account",
                }])

            def order_list_query(self, **kwargs):
                calls.append(("orders", kwargs))
                return 0, FakeFrame([{
                    "code": "US.NET", "trd_side": "SELL", "order_type": "STOP_LIMIT",
                    "order_status": "WAITING_SUBMIT", "qty": 2, "dealt_qty": 0,
                    "aux_price": 268.22, "price": 268.22,
                    "order_id": "private-order", "acc_id": "private-account",
                }])

            def close(self):
                calls.append(("close", {}))

        moomoo = types.ModuleType("moomoo")
        moomoo.OpenSecTradeContext = Context
        moomoo.TrdMarket = types.SimpleNamespace(US="US")
        moomoo.SecurityFirm = types.SimpleNamespace(FUTUMY="FUTUMY")
        moomoo.TrdEnv = types.SimpleNamespace(REAL="REAL")
        moomoo.RET_OK = 0

        with mock.patch.object(hr, "_port_alive", return_value=True), mock.patch.dict(
            sys.modules, {"moomoo": moomoo}, clear=False,
        ), mock.patch.dict(os.environ, {"OPEND_ACC_ID": ""}, clear=False):
            snapshot = hr.fetch_broker_snapshot()

        self.assertEqual(
            [name for name, _ in calls], ["open", "accounts", "positions", "orders", "close"],
        )
        for name, kwargs in calls[2:4]:
            self.assertTrue(kwargs["refresh_cache"], name)
            self.assertEqual(kwargs["acc_id"], 987654321, name)
            self.assertNotIn("acc_index", kwargs, name)
        encoded = repr(snapshot)
        self.assertNotIn("private-account", encoded)
        self.assertNotIn("private-order", encoded)
        self.assertNotIn("987654321", encoded)
        self.assertEqual(snapshot["orders"][0]["trigger_price"], 268.22)

    def test_ambiguous_real_accounts_fail_closed_before_snapshot_queries(self):
        calls = []

        class Context:
            def __init__(self, **kwargs):
                calls.append("open")

            def get_acc_list(self):
                calls.append("accounts")
                return 0, FakeFrame([
                    {"acc_id": 111111111, "trd_env": "REAL"},
                    {"acc_id": 222222222, "trd_env": "REAL"},
                ])

            def position_list_query(self, **kwargs):
                raise AssertionError("positions must not be queried for an ambiguous account")

            def order_list_query(self, **kwargs):
                raise AssertionError("orders must not be queried for an ambiguous account")

            def close(self):
                calls.append("close")

        moomoo = types.ModuleType("moomoo")
        moomoo.OpenSecTradeContext = Context
        moomoo.TrdMarket = types.SimpleNamespace(US="US")
        moomoo.SecurityFirm = types.SimpleNamespace(FUTUMY="FUTUMY")
        moomoo.TrdEnv = types.SimpleNamespace(REAL="REAL")
        moomoo.RET_OK = 0

        with mock.patch.object(hr, "_port_alive", return_value=True), mock.patch.dict(
            sys.modules, {"moomoo": moomoo}, clear=False,
        ), mock.patch.dict(os.environ, {"OPEND_ACC_ID": ""}, clear=False):
            snapshot = hr.fetch_broker_snapshot()

        self.assertEqual(calls, ["open", "accounts", "close"])
        self.assertIsNone(snapshot["positions"])
        self.assertIsNone(snapshot["orders"])
        self.assertEqual(snapshot["error"], "broker account unverified")
        encoded = repr(snapshot)
        self.assertNotIn("111111111", encoded)
        self.assertNotIn("222222222", encoded)

    def test_configured_account_must_be_positive_integer(self):
        class Context:
            def __init__(self, **kwargs):
                pass

            def get_acc_list(self):
                raise AssertionError("invalid configuration must fail before account query")

            def close(self):
                pass

        moomoo = types.ModuleType("moomoo")
        moomoo.OpenSecTradeContext = Context
        moomoo.TrdMarket = types.SimpleNamespace(US="US")
        moomoo.SecurityFirm = types.SimpleNamespace(FUTUMY="FUTUMY")
        moomoo.TrdEnv = types.SimpleNamespace(REAL="REAL")
        moomoo.RET_OK = 0

        with mock.patch.object(hr, "_port_alive", return_value=True), mock.patch.dict(
            sys.modules, {"moomoo": moomoo}, clear=False,
        ), mock.patch.dict(os.environ, {"OPEND_ACC_ID": "not-an-integer"}, clear=False):
            snapshot = hr.fetch_broker_snapshot()

        self.assertEqual(snapshot["error"], "broker account unverified")
        self.assertIsNone(snapshot["positions"])
        self.assertIsNone(snapshot["orders"])


if __name__ == "__main__":
    unittest.main()
