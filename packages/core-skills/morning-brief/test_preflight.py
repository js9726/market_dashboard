from __future__ import annotations

import hashlib
import json
import unittest
from datetime import datetime, timedelta
from unittest import mock

import holdings_review as hr
import preflight
import cli_run


def signed_receipt(broker: dict, generated: datetime) -> dict:
    receipt = {
        "generated_at": generated.isoformat(timespec="seconds"),
        "session_date": generated.date().isoformat(),
        "status": "PASS",
        "hard_failures": [],
        "warnings": [],
        "checks": {"broker_protection": broker},
    }
    receipt["receipt_hash"] = hashlib.sha256(
        json.dumps(receipt, sort_keys=True, default=str).encode()
    ).hexdigest()[:16]
    return receipt


class BrokerPreflightTests(unittest.TestCase):
    def test_local_order_feed_failure_is_a_hard_publication_block(self):
        with mock.patch.object(
            hr, "fetch_broker_snapshot",
            return_value={"positions": [{"ticker": "NET", "qty": 2}], "orders": None},
        ):
            result = preflight.check_broker_protection("local")
        self.assertFalse(result["ok"])
        self.assertTrue(result["hard"])
        self.assertFalse(result["publication_allowed"])
        self.assertEqual(result["feed_state"], "ORDER-FEED-UNVERIFIED")

    def test_verified_unprotected_position_warns_and_blocks_new_risk_not_brief(self):
        with mock.patch.object(
            hr, "fetch_broker_snapshot",
            return_value={"positions": [{"ticker": "NET", "qty": 2}], "orders": []},
        ):
            result = preflight.check_broker_protection("local")
        self.assertFalse(result["ok"])
        self.assertFalse(result["hard"])
        self.assertTrue(result["publication_allowed"])
        self.assertTrue(result["new_risk_block"])
        self.assertEqual(result["unprotected_tickers"], ["NET"])

    def test_verified_queued_net_stop_is_reported_without_identifiers(self):
        orders = [{
            "ticker": "NET", "side": "SELL", "order_type": "STOP_LIMIT",
            "order_status": "WAITING_SUBMIT", "remaining_qty": 2,
            "trigger_price": 268.22, "limit_price": 268.22,
            "order_id": "must-not-leak", "acc_id": "must-not-leak",
        }]
        with mock.patch.object(
            hr, "fetch_broker_snapshot",
            return_value={"positions": [{"ticker": "NET", "qty": 2}], "orders": orders},
        ):
            result = preflight.check_broker_protection("local")
        self.assertTrue(result["ok"])
        self.assertEqual(result["queued_tickers"], ["NET"])
        self.assertEqual(result["counts"]["PROTECTED-QUEUED"], 1)
        self.assertNotIn("must-not-leak", json.dumps(result))

    def test_ci_saas_mode_is_explicitly_unverified_without_false_protection(self):
        result = preflight.check_broker_protection("unavailable")
        self.assertEqual(result["feed_state"], "ORDER-FEED-UNVERIFIED")
        self.assertFalse(result["order_feed_verified"])
        self.assertTrue(result["publication_allowed"])
        self.assertTrue(result["new_risk_block"])


class PublicationReceiptTests(unittest.TestCase):
    def test_fresh_signed_receipt_with_publication_permission_passes(self):
        now = datetime.now()
        receipt = signed_receipt({"publication_allowed": True}, now)
        self.assertEqual(preflight.validate_receipt_for_publication(receipt, now=now)[0], True)

    def test_stale_or_tampered_or_feed_blocked_receipt_fails(self):
        now = datetime.now()
        stale = signed_receipt({"publication_allowed": True}, now - timedelta(minutes=16))
        self.assertFalse(preflight.validate_receipt_for_publication(stale, now=now)[0])

        tampered = signed_receipt({"publication_allowed": True}, now)
        tampered["checks"]["broker_protection"]["publication_allowed"] = False
        self.assertFalse(preflight.validate_receipt_for_publication(tampered, now=now)[0])

        blocked = signed_receipt({"publication_allowed": False}, now)
        self.assertFalse(preflight.validate_receipt_for_publication(blocked, now=now)[0])

    def test_cli_post_gate_rejects_missing_receipt_before_network(self):
        with self.assertRaises(SystemExit) as raised:
            cli_run._require_publication_preflight(None)
        self.assertEqual(raised.exception.code, 2)

    def test_prompt_block_never_upgrades_an_unverified_feed(self):
        block = cli_run._build_live_block(
            (None, None), {},
            broker_protection={
                "broker_scope": "NONE", "feed_state": "ORDER-FEED-UNVERIFIED",
                "order_feed_verified": False, "new_risk_block": True,
            },
        )
        self.assertIn("ORDER FEED UNVERIFIED", block)
        self.assertIn("new_risk_block=True", block)


if __name__ == "__main__":
    unittest.main()
