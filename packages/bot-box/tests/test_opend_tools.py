"""Offline tests for the bot's read-only OpenD tools: positions, quotes and trades.

A fake `moomoo` package stands in for the SDK and a local listening socket stands in for
the OpenD port, so no broker, gateway or network is touched. Each case copies the tools
folder, points opend_common's HOST/PORT/WATCHDOG at the fakes and runs the tool as a
child process. FIFO arithmetic for trades is also tested in-process.

    python -m unittest discover -s packages/bot-box/tests -p "test_opend_tools.py" -v
"""
from __future__ import annotations

import ast
from datetime import date
import importlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

TOOLS = Path(__file__).resolve().parents[1] / "tools"
# Mutation checks point this at a folder of weakened copies; the real tools are never edited.
TOOLS = Path(os.environ.get("OPEND_TOOLS_UNDER_TEST") or TOOLS)
OPEND_FILES = ("opend_common.py", "positions.py", "quotes.py", "trades.py", "orders.py")

FAKE_MOOMOO = '''
import json, os, time
import pandas as pd
CFG = json.loads(open(os.environ["FAKE_MOOMOO_CFG"], encoding="utf-8").read())
RET_OK, RET_ERROR = 0, -1
class TrdEnv:
    REAL = "REAL"
    SIMULATE = "SIMULATE"
class TrdMarket:
    US = "US"
class SecurityFirm:
    FUTUMY = "FUTUMY"
def log(name):
    with open(CFG["log"], "a", encoding="utf-8") as f:
        f.write(name + "\\n")
print("fake sdk: import banner")
class OpenQuoteContext:
    def __init__(self, host, port):
        print("fake sdk: quote connect")
        log("quote.init")
    def get_global_state(self):
        log("get_global_state")
        if CFG.get("state_error"):
            return RET_ERROR, "boom"
        return RET_OK, {"market_us": CFG.get("market", "AFTERNOON"), "qot_logined": CFG.get("qot", True),
                        "trd_logined": CFG.get("trd", True)}
    def get_market_snapshot(self, codes):
        log("snapshot:" + ",".join(codes))
        rows = CFG.get("snapshot", {})
        unknown = [c for c in codes if c not in rows]
        if unknown:
            return RET_ERROR, "Unknown stock. " + unknown[0]
        return RET_OK, pd.DataFrame([dict(rows[c], code=c) for c in codes])
    def close(self):
        log("quote.close")
class OpenSecTradeContext:
    def __init__(self, filter_trdmarket, host, port, security_firm):
        print("fake sdk: trade connect")
        log("trade.init:%s:%s" % (filter_trdmarket, security_firm))
        if CFG.get("hang"):
            time.sleep(600)
    def get_acc_list(self):
        log("get_acc_list")
        return RET_OK, pd.DataFrame(CFG["accounts"])
    def position_list_query(self, trd_env, acc_id, refresh_cache=False):
        log("position_list_query:%s:%s" % (trd_env, acc_id))
        if CFG.get("position_error"):
            return RET_ERROR, "boom"
        return RET_OK, pd.DataFrame(CFG["positions"])
    def history_deal_list_query(self, start, end, trd_env, acc_id):
        log("deals:%s:%s:%s:%s" % (start, end, trd_env, acc_id))
        if CFG.get("deal_error"):
            return RET_ERROR, "boom"
        return RET_OK, pd.DataFrame(CFG.get("deals", []), columns=["code", "stock_name", "deal_market", "deal_id",
                                    "order_id", "qty", "price", "trd_side", "create_time", "status"])
    def order_fee_query(self, order_id_list, acc_id, trd_env):
        log("fees:%d" % len(order_id_list))
        if CFG.get("fee_error"):
            return RET_ERROR, "boom"
        fees = CFG.get("fees", {})
        return RET_OK, pd.DataFrame([{"order_id": o, "fee_amount": fees[o], "fee_details": []}
                                     for o in order_id_list if o in fees], columns=["order_id", "fee_amount"])
    def order_list_query(self, trd_env, acc_id, refresh_cache=False):
        log("order_list_query:%s:%s" % (trd_env, acc_id))
        if CFG.get("order_error"):
            return RET_ERROR, "boom"
        return RET_OK, pd.DataFrame(CFG.get("orders", []))
    def unlock_trade(self, *args, **kwargs):
        log("UNLOCK")
        return RET_OK, None
    def place_order(self, *args, **kwargs):
        log("ORDER")
        return RET_OK, None
    def close(self):
        log("trade.close")
'''

LIVE_ID, CARD, UNI_CARD, POSITION_ID = 987654321012345, "1111222233334444", "5555666677778888", 424242424242
LIVE = {"acc_id": LIVE_ID, "trd_env": "REAL", "acc_type": "MARGIN", "card_num": CARD, "uni_card_num": UNI_CARD,
        "security_firm": "FUTUMY", "trdmarket_auth": ["HK", "US", "MY"], "acc_status": "ACTIVE"}
PAPER = {"acc_id": 1308265, "trd_env": "SIMULATE", "acc_type": "MARGIN", "card_num": "N/A", "uni_card_num": "N/A",
         "security_firm": "N/A", "trdmarket_auth": ["US"], "acc_status": "ACTIVE"}
IDENTIFIERS = (str(LIVE_ID), CARD, UNI_CARD, str(POSITION_ID), "acc_id", "card_num", "position_id",
               "order_id", "deal_id", "ORD-", "DEAL-")


def position(code, qty, avg, price, currency="USD", **extra):
    row = {"code": code, "stock_name": code.split(".")[1] + " Corp", "position_side": "LONG", "qty": qty,
           "average_cost": avg, "nominal_price": price, "market_val": qty * price,
           "unrealized_pl": (price - avg) * qty, "pl_ratio_avg_cost": (price / avg - 1) * 100,
           "today_pl_val": 1.5, "currency": currency, "cost_price_valid": True, "pl_ratio_valid": True,
           "pl_val_valid": True, "position_id": POSITION_ID, "realized_pl": 0.0, "diluted_cost": avg}
    row.update(extra)
    return row


def snap(price, previous, update_time, **extra):
    row = {"name": "Corp", "last_price": price, "prev_close_price": previous, "open_price": previous,
           "high_price": price, "low_price": previous, "volume": 1000.0, "volume_ratio": 1.3,
           "update_time": update_time, "pre_price": None, "pre_change_rate": None, "after_price": None,
           "after_change_rate": None}
    row.update(extra)
    return row


def deal(when, code, side, qty, price, order):
    return {"code": code, "stock_name": code, "deal_market": code.split(".")[0], "deal_id": "DEAL-" + order,
            "order_id": "ORD-" + order, "qty": qty, "price": price, "trd_side": side, "create_time": when,
            "status": "OK"}


POSITIONS = [position("US.NVDA", 10, 100.0, 110.0), position("MY.1234", 2000, 0.5, 0.55, currency="MYR"),
             position("US.GONE", 0, 50.0, 60.0)]
TODAY = date.today().isoformat()
DEALS = [deal("2026-01-05 10:00:00.000", "US.AAA", "BUY", 10, 100.0, "1"),
         deal("2026-01-06 10:00:00.000", "US.AAA", "BUY", 10, 110.0, "2"),
         deal(TODAY + " 10:00:00.000", "US.AAA", "SELL", 15, 120.0, "3")]
FEES = {"ORD-1": 1.0, "ORD-2": 1.0, "ORD-3": 1.5}


def order(code, side, order_type, status, qty, price=None, aux=None, dealt=0, oid="9"):
    return {"code": code, "stock_name": code, "trd_side": side, "order_type": order_type, "order_status": status,
            "order_id": "ORD-" + oid, "qty": qty, "dealt_qty": dealt, "price": price, "aux_price": aux,
            "trail_type": "N/A", "trail_value": 0.0, "time_in_force": "GTC", "fill_outside_rth": False,
            "create_time": "2026-09-28 10:00:00.000", "updated_time": "2026-09-28 10:00:00.000", "currency": "USD"}


ORDERS = [order("US.NVDA", "SELL", "STOP", "SUBMITTED", 6, aux=95.0, oid="11"),
          order("US.NVDA", "SELL", "NORMAL", "SUBMITTED", 4, price=130.0, oid="12"),     # take-profit, not a stop
          order("US.NVDA", "SELL", "STOP", "CANCELLED_ALL", 4, aux=90.0, oid="13"),     # not working
          order("US.AMD", "BUY", "NORMAL", "SUBMITTED", 5, price=150.0, oid="14")]


class OpenDTools(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.dir = Path(temp.name)
        (self.dir / "fake" / "moomoo").mkdir(parents=True)
        (self.dir / "fake" / "moomoo" / "__init__.py").write_text(FAKE_MOOMOO, encoding="utf-8")
        self.log = self.dir / "calls.log"
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(8)
        self.addCleanup(self.listener.close)
        # Accept and drop each probe, as a live gateway would, so the backlog never fills.
        threading.Thread(target=self.accept_forever, daemon=True).start()

    def accept_forever(self):
        while True:
            try:
                connection, _ = self.listener.accept()
            except OSError:
                return
            connection.close()

    def run_tool(self, tool, *args, port=None, watchdog=45, **cfg):
        config = {"log": str(self.log), "accounts": [LIVE, PAPER], "positions": POSITIONS,
                  "deals": DEALS, "fees": FEES}
        config.update(cfg)
        (self.dir / "cfg.json").write_text(json.dumps(config), encoding="utf-8")
        copy = self.dir / "tools"
        shutil.rmtree(copy, ignore_errors=True)
        copy.mkdir()
        for name in OPEND_FILES:
            shutil.copy(TOOLS / name, copy / name)
        common = (copy / "opend_common.py").read_text(encoding="utf-8")
        port = self.listener.getsockname()[1] if port is None else port
        for old, new in (('HOST, PORT = "127.0.0.1", 11111', 'HOST, PORT = "127.0.0.1", {}'.format(port)),
                         ("WATCHDOG_SECONDS = 45", "WATCHDOG_SECONDS = {}".format(watchdog))):
            self.assertEqual(common.count(old), 1, old)
            common = common.replace(old, new)
        (copy / "opend_common.py").write_text(common, encoding="utf-8")
        if self.log.exists():
            self.log.unlink()
        env = dict(os.environ, PYTHONPATH=str(self.dir / "fake"), FAKE_MOOMOO_CFG=str(self.dir / "cfg.json"))
        started = time.monotonic()
        done = subprocess.run([sys.executable, "-B", str(copy / tool), *args], capture_output=True, text=True,
                              encoding="utf-8", env=env, stdin=subprocess.DEVNULL, timeout=60)
        self.elapsed = time.monotonic() - started
        self.calls = self.log.read_text(encoding="utf-8").split() if self.log.exists() else []
        self.assertNotIn("UNLOCK", self.calls)
        self.assertNotIn("ORDER", self.calls)
        return done, json.loads(done.stdout)

    def assertNoIdentifiers(self, text):
        for secret in IDENTIFIERS:
            self.assertNotIn(secret, text)

    def assertUnavailable(self, done, report, reason):
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertEqual(report["status"], "UNAVAILABLE")
        self.assertIn(reason, report["reason"])
        for key in ("positions", "quotes", "fills", "realized"):
            self.assertNotIn(key, report)
        self.assertNoIdentifiers(done.stdout)

    # --- positions -------------------------------------------------------------------------

    def test_positions_without_any_identifier(self):
        done, report = self.run_tool("positions.py")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual((report["status"], report["count"]), ("OK", 2))       # zero-quantity row left out
        nvda = report["positions"][0]
        self.assertEqual((nvda["ticker"], nvda["market"], nvda["quantity"], nvda["average_cost"], nvda["price"],
                          nvda["unrealized_pl"], nvda["currency"], nvda["status"]),
                         ("NVDA", "US", 10.0, 100.0, 110.0, 100.0, "USD", "OK"))
        self.assertAlmostEqual(nvda["unrealized_pl_pct"], 10.0)
        self.assertEqual(report["positions"][1]["currency"], "MYR")
        self.assertNoIdentifiers(done.stdout)
        self.assertNotIn("fake sdk", done.stdout)
        self.assertIn("fake sdk", done.stderr)
        self.assertIn("position_list_query:REAL:{}".format(LIVE_ID), self.calls)
        self.assertIn("trade.init:US:FUTUMY", self.calls)
        self.assertIn("trade.close", self.calls)

    def test_positions_invalid_broker_values_become_null(self):
        rows = [position("US.NAN", 5, 20.0, float("nan")), position("US.FLAG", 5, 20.0, 21.0, pl_val_valid=False),
                position("US.OKAY", 5, 20.0, 21.0)]
        done, report = self.run_tool("positions.py", positions=rows)
        by = {p["ticker"]: p for p in report["positions"]}
        for ticker in ("NAN", "FLAG"):
            self.assertEqual((by[ticker]["status"], by[ticker]["quantity"]), ("INVALID_DATA", 5.0))
            for key in ("average_cost", "price", "market_value", "unrealized_pl", "unrealized_pl_pct", "today_pl"):
                self.assertIsNone(by[ticker][key], key)
        self.assertEqual(by["OKAY"]["status"], "OK")
        self.assertNotIn("NaN", done.stdout)

    # --- quotes ----------------------------------------------------------------------------

    def test_quotes_retry_one_by_one_when_a_symbol_is_unknown(self):
        fresh = "2099-01-01 00:00:00"
        snapshot = {"US.NVDA": snap(110.0, 100.0, fresh, pre_price=108.0, pre_change_rate=-1.8),
                    "US.BRK.B": snap(0.0, 400.0, fresh)}
        done, report = self.run_tool("quotes.py", "--tickers", "NVDA,NOPE,BRK.B,nvda", snapshot=snapshot)
        self.assertEqual(done.returncode, 0, done.stderr)
        by = {q["ticker"]: q for q in report["quotes"]}
        self.assertEqual(list(by), ["NVDA", "NOPE", "BRK.B"])                 # upper-cased, de-duplicated
        self.assertEqual((by["NVDA"]["status"], by["NVDA"]["change_pct"]), ("OK", 10.0))
        self.assertEqual(by["NVDA"]["pre_market"], {"price": 108.0, "change_pct": -1.8})
        self.assertIsNone(by["NVDA"]["after_hours"])
        self.assertEqual(by["NOPE"]["status"], "UNKNOWN_TICKER")
        self.assertEqual(by["BRK.B"]["status"], "INVALID_DATA")
        self.assertTrue(any(c.startswith("snapshot:US.NVDA,US.NOPE") for c in self.calls))
        self.assertIn("snapshot:US.BRK.B", self.calls)                        # the per-ticker retry
        self.assertFalse([c for c in self.calls if c.startswith("trade.")])   # quotes never open trading
        self.assertNotIn("fake sdk", done.stdout)

    def test_quotes_are_stale_when_the_session_is_open_and_the_update_is_old(self):
        snapshot = {"US.OLD": snap(10.0, 9.0, "2020-01-02 10:00:00")}
        for market, status in (("AFTERNOON", "STALE"), ("MORNING", "STALE"), ("CLOSED", "OK")):
            with self.subTest(market=market):
                done, report = self.run_tool("quotes.py", "--tickers", "OLD", snapshot=snapshot, market=market)
                self.assertEqual(report["quotes"][0]["status"], status)

    # --- trades ----------------------------------------------------------------------------

    def test_trades_fifo_net_of_fees_without_identifiers(self):
        done, report = self.run_tool("trades.py", "--days", "7")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual([f["side"] for f in report["fills"]], ["SELL"])      # buys are outside the window
        sell = report["realized"][0]
        # cost 10*100 + 5*110 = 1550; gross 1800 - 1550 = 250; fees 1.5 + 10*0.1 + 5*0.1 = 3.0
        self.assertEqual((sell["gross_pl"], sell["realized_pl"], sell["average_cost"], sell["net_of_fees"]),
                         (250.0, 247.0, 103.3333, True))
        self.assertEqual(report["realized_totals"], {"USD": 247.0})
        self.assertTrue(report["fees_complete"])
        self.assertNoIdentifiers(done.stdout)
        deals_call = next(c for c in self.calls if c.startswith("deals:"))
        start, end = deals_call.split(":")[1:3]
        self.assertLessEqual((date.fromisoformat(end) - date.fromisoformat(start)).days, 359)

    def test_trades_never_estimate_missing_cost_basis_or_fees(self):
        deals = [deal(TODAY + " 09:00:00.000", "US.OLD", "SELL", 5, 50.0, "9")]
        done, report = self.run_tool("trades.py", deals=deals)
        row = report["realized"][0]
        self.assertIsNone(row["realized_pl"])
        self.assertIn("before the 360-day history", row["reason"])
        self.assertEqual(report["realized_totals"], {})
        done, report = self.run_tool("trades.py", fee_error=True)
        self.assertFalse(report["fees_complete"])
        self.assertFalse(report["realized"][0]["net_of_fees"])
        self.assertEqual(report["realized"][0]["realized_pl"], 250.0)          # before fees, and says so

    # --- fail closed (all three) -------------------------------------------------------

    def test_gateway_not_listening_fails_before_any_sdk_call(self):
        spare = socket.socket()
        spare.bind(("127.0.0.1", 0))
        closed_port = spare.getsockname()[1]
        spare.close()
        for tool, args in (("positions.py", ()), ("quotes.py", ("--tickers", "NVDA")), ("trades.py", ())):
            with self.subTest(tool=tool):
                self.assertUnavailable(*self.run_tool(tool, *args, port=closed_port), "not reachable")
                self.assertEqual(self.calls, [])

    def test_unusable_gateway_or_account_fails_closed(self):
        cases = [("positions.py", {"trd": False}, "not logged in"), ("positions.py", {"qot": False}, "not logged in"),
                 ("positions.py", {"state_error": True}, "state query failed"),
                 ("positions.py", {"accounts": [PAPER]}, "exactly one live US-enabled account, found 0"),
                 ("positions.py", {"accounts": [LIVE, dict(LIVE, acc_id=LIVE_ID + 1)]}, "found 2"),
                 ("positions.py", {"accounts": [dict(LIVE, trdmarket_auth=["HK", "MY"])]}, "found 0"),
                 ("positions.py", {"position_error": True}, "position query failed"),
                 ("quotes.py", {"qot": False}, "not logged in"),
                 ("trades.py", {"trd": False}, "not logged in"),
                 ("trades.py", {"accounts": [PAPER]}, "found 0"),
                 ("trades.py", {"deal_error": True}, "fill history query failed")]
        for tool, cfg, reason in cases:
            with self.subTest(tool=tool, cfg=cfg):
                args = ("--tickers", "NVDA") if tool == "quotes.py" else ()
                self.assertUnavailable(*self.run_tool(tool, *args, **cfg), reason)

    def test_a_gateway_that_never_answers_is_cut_off(self):
        done, report = self.run_tool("positions.py", watchdog=2, hang=True)
        self.assertUnavailable(done, report, "did not answer within 2 s")
        self.assertLess(self.elapsed, 30)

    # --- the sources ---------------------------------------------------------------------

    def test_sources_call_no_trading_function(self):
        allowed = {"get_acc_list", "position_list_query", "history_deal_list_query", "order_fee_query",
                   "order_list_query", "close"}
        for name in OPEND_FILES:
            with self.subTest(file=name):
                tree = ast.parse((TOOLS / name).read_text(encoding="utf-8"))
                names = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)} | \
                        {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
                # getattr/eval/exec/__import__ are banned too, so no call can be built from a string.
                for forbidden in ("unlock_trade", "place_order", "modify_order", "cancel_order", "cancel_all_order",
                                  "change_order", "SIMULATE", "getattr", "eval", "exec", "__import__"):
                    self.assertNotIn(forbidden, names, forbidden)
                trade_calls = {n.func.attr for n in ast.walk(tree)
                               if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                               and isinstance(n.func.value, ast.Name) and n.func.value.id == "trade"}
                self.assertLessEqual(trade_calls, allowed, name)

    # --- orders --------------------------------------------------------------------------

    def test_orders_working_only_with_stop_coverage_and_no_identifiers(self):
        done, report = self.run_tool("orders.py", orders=ORDERS)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(report["status"], "OK")
        self.assertEqual(report["working_count"], 3)                         # cancelled order left out
        self.assertNotIn("CANCELLED_ALL", done.stdout)
        cover = {c["ticker"]: c for c in report["stop_coverage"]}
        self.assertEqual((cover["NVDA"]["held"], cover["NVDA"]["covered_by_stops"], cover["NVDA"]["status"]),
                         (10.0, 6.0, "PARTIAL"))                              # the 130 limit is not a stop
        self.assertEqual([s["trigger_price"] for s in cover["NVDA"]["stops"]], [95.0])
        self.assertEqual(cover["1234"]["status"], "NONE")
        self.assertNotIn("GONE", cover)                                      # zero-quantity position
        self.assertNoIdentifiers(done.stdout)
        self.assertIn("order_list_query:REAL:{}".format(LIVE_ID), self.calls)
        self.assertIn("trade.close", self.calls)

    def test_orders_fully_covered_and_failed_query(self):
        stops = [order("US.NVDA", "SELL", "TRAILING_STOP", "FILLED_PART", 12, dealt=2, oid="21")]
        done, report = self.run_tool("orders.py", orders=stops, positions=[position("US.NVDA", 10, 100.0, 110.0)])
        self.assertEqual(report["stop_coverage"][0]["status"], "COVERED")
        done, report = self.run_tool("orders.py", order_error=True)
        self.assertUnavailable(done, report, "order list query failed")
        self.assertNotIn("working_orders", report)

    def test_positions_takes_no_options(self):
        tree = ast.parse((TOOLS / "positions.py").read_text(encoding="utf-8"))
        self.assertFalse([n for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr == "argv"])
        imported = {a.name for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
        self.assertNotIn("argparse", imported)


class TradesFifo(unittest.TestCase):
    """In-process arithmetic checks; importing trades opens no gateway connection."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(TOOLS))
        cls.trades = importlib.import_module("trades")

    @classmethod
    def tearDownClass(cls):
        sys.path.remove(str(TOOLS))
        sys.modules.pop("trades", None)
        sys.modules.pop("opend_common", None)

    def fill(self, when, side, qty, price, fee, ticker="AAA", market="US"):
        return {"time_exchange": when, "ticker": ticker, "market": market, "side": side, "quantity": qty,
                "price": price, "fee": fee, "currency": "USD", "_order": when}

    def test_partial_lots_carry_over_between_sells(self):
        fills = [self.fill("2026-01-01 10:00:00", "BUY", 10, 100.0, 0.0),
                 self.fill("2026-02-01 10:00:00", "SELL", 4, 110.0, 0.0),
                 self.fill("2026-03-01 10:00:00", "BUY", 10, 200.0, 0.0),
                 self.fill("2026-04-01 10:00:00", "SELL", 8, 150.0, 0.0)]
        rows = self.trades.realized(fills, "2026-01-01")
        self.assertEqual([r["realized_pl"] for r in rows], [40.0, 6 * 50.0 + 2 * -50.0])

    def test_window_only_filters_what_is_reported(self):
        fills = [self.fill("2026-01-01 10:00:00", "BUY", 10, 100.0, 0.0),
                 self.fill("2026-02-01 10:00:00", "SELL", 5, 110.0, 0.0),
                 self.fill("2026-03-01 10:00:00", "SELL", 5, 120.0, 0.0)]
        rows = self.trades.realized(fills, "2026-02-15")
        self.assertEqual([(r["time_exchange"][:10], r["realized_pl"]) for r in rows], [("2026-03-01", 100.0)])

    def test_tickers_and_markets_keep_separate_lots(self):
        fills = [self.fill("2026-01-01 10:00:00", "BUY", 10, 100.0, 0.0, ticker="AAA"),
                 self.fill("2026-01-02 10:00:00", "SELL", 10, 90.0, 0.0, ticker="BBB"),
                 self.fill("2026-01-03 10:00:00", "SELL", 10, 90.0, 0.0, ticker="AAA", market="MY")]
        rows = self.trades.realized(fills, "2026-01-01")
        self.assertEqual([r["realized_pl"] for r in rows], [None, None])


if __name__ == "__main__":
    unittest.main()
