from __future__ import annotations

import datetime
import unittest
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from ib_async import CommissionReport, Contract, Execution, Fill

from bridge.ibkr_adapter import IBKRSync, execution_time_utc

UTC = datetime.timezone.utc


def ibkr_fill(time, exec_id: str = "0001390d.6ad7ae14.01.01") -> Fill:
    """A PLTR BUY 6 @ 194.16 as ib_async hands it to the bridge."""
    return Fill(
        contract=Contract(secType="STK", symbol="PLTR", localSymbol="PLTR", currency="USD"),
        execution=Execution(execId=exec_id, time=time, side="BOT", shares=6.0, price=194.16),
        commissionReport=CommissionReport(execId=exec_id, commission=1.0, currency="USD"),
        time=datetime.datetime(2026, 10, 21, 14, 35, 58, 609000, tzinfo=UTC),
    )


class FakeIB:
    def __init__(self, fills: list[Fill]):
        self._fills = fills

    def fills(self) -> list[Fill]:
        return self._fills


def sync_fills(*fills: Fill) -> list[dict]:
    cfg = SimpleNamespace(ibkr=SimpleNamespace(fill_lookback_days=1))
    return IBKRSync(cfg)._fills(FakeIB(list(fills)))


class IbkrFillTimeTests(unittest.TestCase):
    def test_pltr_buy_keeps_its_ibkr_execution_time(self) -> None:
        # reqExecutions: PLTR BOT 6 @ 194.16 at 2026-10-20 16:53:57 UTC (12:53 ET).
        # The old bridge stored the sync time, 2026-10-21T14:35:58.609Z.
        fills = sync_fills(ibkr_fill(datetime.datetime(2026, 10, 20, 16, 53, 57, tzinfo=UTC)))

        self.assertEqual(len(fills), 1)
        self.assertEqual(fills[0]["executedAt"], "2026-10-20T16:53:57+00:00")
        self.assertEqual(fills[0]["brokerFillId"], "0001390d.6ad7ae14.01.01")
        self.assertEqual((fills[0]["ticker"], fills[0]["side"]), ("PLTR", "BUY"))

    def test_fill_first_seen_more_than_a_day_late_is_still_sent(self) -> None:
        # TWS can report a fill days after it executed, for example after the
        # bridge was down. With a true time it must not fall to a lookback cutoff.
        old = datetime.datetime.now(UTC) - datetime.timedelta(days=3)
        fills = sync_fills(ibkr_fill(old.replace(microsecond=0)))

        self.assertEqual(len(fills), 1)
        self.assertEqual(fills[0]["executedAt"], old.replace(microsecond=0).isoformat())

    def test_aware_time_in_another_zone_is_sent_as_utc(self) -> None:
        eastern = datetime.datetime(2026, 10, 20, 12, 53, 57, tzinfo=ZoneInfo("America/New_York"))
        self.assertEqual(
            execution_time_utc(eastern),
            datetime.datetime(2026, 10, 20, 16, 53, 57, tzinfo=UTC),
        )

    def test_raw_ibkr_time_string_is_still_parsed_as_eastern(self) -> None:
        self.assertEqual(
            execution_time_utc("20261020  12:53:57 US/Eastern"),
            datetime.datetime(2026, 10, 20, 16, 53, 57, tzinfo=UTC),
        )

    def test_unusable_time_skips_the_fill_instead_of_stamping_now(self) -> None:
        naive = datetime.datetime(2026, 10, 20, 16, 53, 57)
        unset = Execution().time  # ib_async's 1970 epoch default
        for time in (naive, unset, None):
            with self.subTest(time=time):
                self.assertIsNone(execution_time_utc(time))
                with self.assertLogs("bridge.ibkr_adapter", level="ERROR"):
                    self.assertEqual(sync_fills(ibkr_fill(time)), [])


if __name__ == "__main__":
    unittest.main()
