from __future__ import annotations

import datetime
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from zoneinfo import ZoneInfo

import pandas as pd
from moomoo import RET_ERROR, RET_OK

from bridge import run
from bridge.fill_window import FillSyncState, deal_query_window, query_deals
from bridge.moomoo_sync import MoomooSync

D = datetime.date
HOST_TZ = ZoneInfo("Asia/Kuala_Lumpur")
NEW_YORK = ZoneInfo("America/New_York")
DEAL_COLUMNS = ["deal_id", "order_id", "code", "trd_side", "qty", "price", "create_time"]

# The PLTR stop: 11:05 ET on Fri 16 Oct 2026, 23:05 MYT. The bridge's last
# poll was 23:05:20 MYT and it next started at 11:46 MYT on Sun 18 Oct.
PLTR_STOP = {
    "deal_id": "D-PLTR", "order_id": "O-PLTR", "code": "US.PLTR", "trd_side": "SELL",
    "qty": 10.0, "price": 50.0, "create_time": "2026-10-16 11:05:36.562",
}
# 13:24 ET on 3 Sep 2026 is 01:24 MYT on 4 Sep: OpenD files it under 4 Sep.
OKTA_AFTERNOON = {
    "deal_id": "D-OKTA", "order_id": "O-OKTA", "code": "US.OKTA", "trd_side": "BUY",
    "qty": 10.0, "price": 50.0, "create_time": "2026-09-03 13:24:59.210",
}


class OpenDDealHistory:
    """history_deal_list_query as probed against OpenD on 2026-10-21: start/end are
    dates in the OpenD host's local time (MYT), create_time is market wall-clock."""

    def __init__(self, deals: list[dict], failures: int = 0):
        self.deals = deals
        self.failures = failures
        self.windows: list[tuple[str, str]] = []

    def history_deal_list_query(self, start: str, end: str, **_kwargs):
        self.windows.append((start, end))
        if self.failures:
            self.failures -= 1
            return RET_ERROR, "Network interruption."
        lo, hi = D.fromisoformat(start), D.fromisoformat(end)
        rows = [d for d in self.deals if lo <= _host_date(d["create_time"]) <= hi]
        return RET_OK, pd.DataFrame(rows, columns=DEAL_COLUMNS)

    def order_fee_query(self, **_kwargs):
        return RET_OK, pd.DataFrame(columns=["order_id", "fee_amount"])


def _host_date(create_time: str) -> D:
    ny = datetime.datetime.fromisoformat(create_time).replace(tzinfo=NEW_YORK)
    return ny.astimezone(HOST_TZ).date()


def _cfg(lookback_days: int = 1) -> SimpleNamespace:
    return SimpleNamespace(
        broker=SimpleNamespace(account_alias="moomoo Malaysia"),
        sync=SimpleNamespace(fill_lookback_days=lookback_days),
        opend=SimpleNamespace(acc_id=1, market="US"),
    )


class DealQueryWindowTests(unittest.TestCase):
    def test_steady_state_reaches_back_the_lookback_and_runs_to_tomorrow(self) -> None:
        self.assertEqual(deal_query_window(D(2026, 10, 21), 1, D(2026, 10, 21)), (D(2026, 10, 20), D(2026, 10, 22)))

    def test_after_an_outage_it_reaches_back_past_the_last_synced_day(self) -> None:
        self.assertEqual(deal_query_window(D(2026, 10, 18), 1, D(2026, 10, 16)), (D(2026, 10, 15), D(2026, 10, 19)))

    def test_a_catch_up_longer_than_one_query_is_clamped_and_logged(self) -> None:
        with self.assertLogs("bridge.fill_window", "WARNING"):
            start, end = deal_query_window(D(2026, 10, 21), 1, D(2026, 1, 1))
        self.assertEqual((end - start).days, 90)


class QueryDealsTests(unittest.TestCase):
    def test_transient_errors_are_retried_with_backoff(self) -> None:
        ctx = OpenDDealHistory([PLTR_STOP], failures=2)
        sleeps: list[float] = []

        with self.assertLogs("bridge.fill_window", "WARNING"):
            data = query_deals(ctx, D(2026, 10, 15), D(2026, 10, 19), 1, sleep=sleeps.append)

        self.assertEqual(list(data["deal_id"]), ["D-PLTR"])
        self.assertEqual(len(ctx.windows), 3)
        self.assertEqual(sleeps, [2.0, 5.0])

    def test_an_sdk_exception_counts_as_a_failed_attempt(self) -> None:
        ctx = mock.Mock()
        ctx.history_deal_list_query.side_effect = [ConnectionError("reset"), (RET_OK, pd.DataFrame())]

        with self.assertLogs("bridge.fill_window", "WARNING"):
            data = query_deals(ctx, D(2026, 10, 15), D(2026, 10, 19), 1, sleep=lambda _s: None)

        self.assertIsNotNone(data)

    def test_when_every_attempt_fails_it_returns_none(self) -> None:
        ctx = OpenDDealHistory([PLTR_STOP], failures=3)

        with self.assertLogs("bridge.fill_window", "ERROR"):
            self.assertIsNone(query_deals(ctx, D(2026, 10, 15), D(2026, 10, 19), 1, sleep=lambda _s: None))


class FillsTests(unittest.TestCase):
    def test_pltr_stop_missed_while_the_pc_was_off_is_fetched_after_restart(self) -> None:
        sync = MoomooSync(_cfg())

        # The old 1-day lookback on restart (Sun 18 Oct) never asked for Fri 16 Oct.
        self.assertEqual(sync._fills(OpenDDealHistory([PLTR_STOP]), today=D(2026, 10, 18)), [])

        fills = sync._fills(OpenDDealHistory([PLTR_STOP]), since=D(2026, 10, 16), today=D(2026, 10, 18))

        self.assertEqual([f["brokerFillId"] for f in fills], ["D-PLTR"])
        self.assertEqual(fills[0]["executedAt"], "2026-10-16T15:05:36.562Z")

    def test_an_afternoon_us_deal_is_not_cut_off_by_the_window_end(self) -> None:
        # Polled at 17:25 UTC on 3 Sep, when the UTC date (the old window end) is
        # still 3 Sep but OpenD has filed the deal under 4 Sep MYT.
        fills = MoomooSync(_cfg())._fills(OpenDDealHistory([OKTA_AFTERNOON]), today=D(2026, 9, 3))

        self.assertEqual([f["brokerFillId"] for f in fills], ["D-OKTA"])

    def test_a_failed_deal_query_is_reported_as_a_failure_not_as_no_fills(self) -> None:
        with mock.patch("bridge.fill_window.time.sleep"), self.assertLogs("bridge.fill_window", "ERROR"):
            fills = MoomooSync(_cfg())._fills(OpenDDealHistory([PLTR_STOP], failures=3), today=D(2026, 10, 18))

        self.assertIsNone(fills)


class FillSyncStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.path = Path(self.dir.name) / "state.json"

    def tearDown(self) -> None:
        self.dir.cleanup()

    def test_sync_time_round_trips_per_account(self) -> None:
        at = datetime.datetime(2026, 10, 16, 15, 5, 20, tzinfo=datetime.timezone.utc)
        FillSyncState(self.path).mark_synced("moomoo Malaysia", at)

        state = FillSyncState(self.path)
        self.assertEqual(state.last_synced("moomoo Malaysia"), at)
        self.assertIsNone(state.last_synced("IBKR main"))

    def test_a_missing_or_corrupt_file_reads_as_never_synced_and_is_rewritten(self) -> None:
        self.assertIsNone(FillSyncState(self.path).last_synced("moomoo Malaysia"))

        self.path.write_text("{not json", encoding="utf-8")
        with self.assertLogs("bridge.fill_window", "WARNING"):
            self.assertIsNone(FillSyncState(self.path).last_synced("moomoo Malaysia"))

        at = datetime.datetime(2026, 10, 21, 6, 0, tzinfo=datetime.timezone.utc)
        with self.assertLogs("bridge.fill_window", "WARNING"):
            FillSyncState(self.path).mark_synced("moomoo Malaysia", at)
        self.assertEqual(json.loads(self.path.read_text(encoding="utf-8"))["fillsSyncedAt"]["moomoo Malaysia"], at.isoformat())


class SyncOnceWatermarkTests(unittest.TestCase):
    """run._sync_once advances the watermark only once fills were fetched AND posted."""

    def setUp(self) -> None:
        self.dir = tempfile.TemporaryDirectory()
        self.state = FillSyncState(Path(self.dir.name) / "state.json")
        patches = [
            mock.patch.object(run, "load_config", return_value=_cfg()),
            mock.patch.object(run, "FillSyncState", return_value=self.state),
            mock.patch.object(run, "_run_scheduled_refreshes"),
            mock.patch("bridge.live_quotes.fetch_live_quotes", return_value=[]),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.dir.cleanup)

    def _sync(self, fills_ok: bool, post_ok: bool, since: D | None = None) -> mock.Mock:
        with mock.patch.object(run, "MoomooSync") as moomoo, mock.patch.object(run, "DashboardClient") as client:
            moomoo.return_value.fetch.return_value = {
                "positions": [], "fills": [], "fillsOk": fills_ok, "equity": None,
            }
            client.return_value.sync.return_value = {"ok": post_ok}
            run._sync_once(since=since)
        return moomoo.return_value.fetch

    def test_watermark_moves_only_after_fills_were_fetched_and_posted(self) -> None:
        self._sync(fills_ok=False, post_ok=True)
        self.assertIsNone(self.state.last_synced("moomoo Malaysia"))

        self._sync(fills_ok=True, post_ok=False)
        self.assertIsNone(self.state.last_synced("moomoo Malaysia"))

        self._sync(fills_ok=True, post_ok=True)
        self.assertIsNotNone(self.state.last_synced("moomoo Malaysia"))

    def test_restart_fetches_from_the_last_synced_day(self) -> None:
        self.state.mark_synced("moomoo Malaysia", datetime.datetime(2026, 10, 16, 12, 0, tzinfo=datetime.timezone.utc))

        fetch = self._sync(fills_ok=True, post_ok=True)

        fetch.assert_called_once_with(fills_since=D(2026, 10, 16))

    def test_since_widens_but_never_narrows_the_catch_up(self) -> None:
        self.state.mark_synced("moomoo Malaysia", datetime.datetime(2026, 10, 16, 12, 0, tzinfo=datetime.timezone.utc))

        self._sync(fills_ok=True, post_ok=False, since=D(2026, 7, 30)).assert_called_once_with(fills_since=D(2026, 7, 30))
        self._sync(fills_ok=True, post_ok=False, since=D(2026, 10, 19)).assert_called_once_with(fills_since=D(2026, 10, 16))


if __name__ == "__main__":
    unittest.main()
