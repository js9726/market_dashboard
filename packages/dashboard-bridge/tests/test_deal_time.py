from __future__ import annotations

import unittest
from types import SimpleNamespace

import pandas as pd
from moomoo import RET_OK

from bridge.moomoo_sync import MoomooSync, deal_time_utc


class FakeTradeContext:
    """Answers the two OpenD calls MoomooSync._fills makes."""

    def __init__(self, deals: list[dict]):
        self.deals = pd.DataFrame(deals)

    def history_deal_list_query(self, **_kwargs):
        return RET_OK, self.deals

    def order_fee_query(self, **_kwargs):
        return RET_OK, pd.DataFrame([{"order_id": "O1", "fee_amount": 1.5}])


class DealTimeTests(unittest.TestCase):
    def test_smci_sell_is_sent_as_the_true_utc_instant(self) -> None:
        # OpenD reported this SMCI SELL as "2026-10-12 11:07:49.621" (New York).
        # The old bridge sent 2026-10-12T11:07:49.621Z, four hours early.
        cfg = SimpleNamespace(
            sync=SimpleNamespace(fill_lookback_days=1),
            opend=SimpleNamespace(acc_id=1, market="US"),
        )
        ctx = FakeTradeContext([{
            "deal_id": "D1", "order_id": "O1", "code": "US.SMCI", "trd_side": "SELL",
            "qty": 10.0, "price": 50.0, "create_time": "2026-10-12 11:07:49.621",
        }])

        fills = MoomooSync(cfg)._fills(ctx)

        self.assertEqual(len(fills), 1)
        self.assertEqual(fills[0]["executedAt"], "2026-10-12T15:07:49.621Z")

    def test_overnight_session_buy_keeps_its_new_york_date(self) -> None:
        # 03:39 ET on Monday 21 Sep. Read as UTC it landed on Sunday 20 Sep in New York.
        self.assertEqual(deal_time_utc("2026-09-21 03:39:00", "US.PLTR"), "2026-09-21T07:39:00.000Z")

    def test_us_winter_fill_uses_eastern_standard_time(self) -> None:
        self.assertEqual(deal_time_utc("2026-01-15 10:00:00", "US.PLTR"), "2026-01-15T15:00:00.000Z")

    def test_malaysia_and_hong_kong_use_their_own_zone(self) -> None:
        self.assertEqual(deal_time_utc("2026-10-12 10:30:00", "MY.5347"), "2026-10-12T02:30:00.000Z")
        self.assertEqual(deal_time_utc("2026-10-12 10:30:00", "HK.00700"), "2026-10-12T02:30:00.000Z")

    def test_unknown_market_or_missing_time_fails_closed(self) -> None:
        with self.assertRaises(ValueError):
            deal_time_utc("2026-10-12 10:30:00", "XX.ABC")
        with self.assertRaises(ValueError):
            deal_time_utc(None, "US.SMCI")


if __name__ == "__main__":
    unittest.main()
