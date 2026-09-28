"""Offline tests for tools/positions.py: read-only, no identifiers, fail closed.

A fake `moomoo` package stands in for the SDK and a local listening socket stands in for
the OpenD port, so no broker, gateway or network is touched. Each case runs a copy of the
tool, with its HOST/PORT/WATCHDOG constants pointed at the fakes, as a child process.

    python -m unittest discover -s packages/bot-box/tests -p "test_positions.py" -v
"""
from __future__ import annotations

import ast
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

TOOL = Path(__file__).resolve().parents[1] / "tools" / "positions.py"
# Mutation checks point this at a weakened copy; the real tool is never edited for them.
TOOL = Path(os.environ.get("POSITIONS_UNDER_TEST") or TOOL)

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
        return RET_OK, {"market_us": "AFTERNOON", "qot_logined": CFG.get("qot", True),
                        "trd_logined": CFG.get("trd", True)}
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


def position(code, qty, avg, price, currency="USD", **extra):
    row = {"code": code, "stock_name": code.split(".")[1] + " Corp", "position_side": "LONG", "qty": qty,
           "average_cost": avg, "nominal_price": price, "market_val": qty * price,
           "unrealized_pl": (price - avg) * qty, "pl_ratio_avg_cost": (price / avg - 1) * 100,
           "today_pl_val": 1.5, "currency": currency, "cost_price_valid": True, "pl_ratio_valid": True,
           "pl_val_valid": True, "position_id": POSITION_ID, "realized_pl": 0.0, "diluted_cost": avg}
    row.update(extra)
    return row


POSITIONS = [position("US.NVDA", 10, 100.0, 110.0), position("MY.1234", 2000, 0.5, 0.55, currency="MYR"),
             position("US.GONE", 0, 50.0, 60.0)]


class Positions(unittest.TestCase):
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

    def run_tool(self, port=None, watchdog=45, **cfg):
        config = {"log": str(self.log), "accounts": [LIVE, PAPER], "positions": POSITIONS}
        config.update(cfg)
        (self.dir / "cfg.json").write_text(json.dumps(config), encoding="utf-8")
        source = TOOL.read_text(encoding="utf-8")
        port = self.listener.getsockname()[1] if port is None else port
        for old, new in (("HOST, PORT = \"127.0.0.1\", 11111", "HOST, PORT = \"127.0.0.1\", {}".format(port)),
                         ("WATCHDOG_SECONDS = 45", "WATCHDOG_SECONDS = {}".format(watchdog))):
            self.assertEqual(source.count(old), 1, old)
            source = source.replace(old, new)
        copy = self.dir / "positions.py"
        copy.write_text(source, encoding="utf-8")
        env = dict(os.environ, PYTHONPATH=str(self.dir / "fake"), FAKE_MOOMOO_CFG=str(self.dir / "cfg.json"))
        started = time.monotonic()
        done = subprocess.run([sys.executable, "-B", str(copy)], capture_output=True, text=True, encoding="utf-8",
                              env=env, stdin=subprocess.DEVNULL, timeout=60)
        self.elapsed = time.monotonic() - started
        self.calls = self.log.read_text(encoding="utf-8").split() if self.log.exists() else []
        self.assertNotIn("UNLOCK", self.calls)
        self.assertNotIn("ORDER", self.calls)
        return done, json.loads(done.stdout)

    def assertNoIdentifiers(self, text):
        for secret in (str(LIVE_ID), CARD, UNI_CARD, str(POSITION_ID), "acc_id", "card_num", "position_id"):
            self.assertNotIn(secret, text)

    def assertUnavailable(self, done, report, reason):
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertEqual(report["status"], "UNAVAILABLE")
        self.assertIn(reason, report["reason"])
        self.assertNotIn("positions", report)
        self.assertNotIn("average_cost", done.stdout)
        self.assertNoIdentifiers(done.stdout)

    # --- the normal read -------------------------------------------------------------------

    def test_reads_open_positions_without_any_identifier(self):
        done, report = self.run_tool()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(report["status"], "OK")
        self.assertEqual(report["count"], 2)                       # the zero-quantity row is left out
        nvda = report["positions"][0]
        self.assertEqual((nvda["ticker"], nvda["market"], nvda["quantity"], nvda["average_cost"], nvda["price"],
                          nvda["unrealized_pl"], nvda["currency"], nvda["status"]),
                         ("NVDA", "US", 10.0, 100.0, 110.0, 100.0, "USD", "OK"))
        self.assertAlmostEqual(nvda["unrealized_pl_pct"], 10.0)
        self.assertEqual(report["positions"][1]["currency"], "MYR")
        self.assertEqual(report["us_market_state"], "AFTERNOON")
        self.assertNoIdentifiers(done.stdout)
        self.assertNotIn("fake sdk", done.stdout)                   # SDK chatter goes to stderr
        self.assertIn("fake sdk", done.stderr)
        self.assertIn("position_list_query:REAL:{}".format(LIVE_ID), self.calls)
        self.assertIn("trade.init:US:FUTUMY", self.calls)
        self.assertIn("trade.close", self.calls)
        self.assertIn("quote.close", self.calls)

    def test_invalid_broker_values_become_null_not_guesses(self):
        rows = [position("US.NAN", 5, 20.0, float("nan")), position("US.FLAG", 5, 20.0, 21.0, pl_val_valid=False),
                position("US.OKAY", 5, 20.0, 21.0)]
        done, report = self.run_tool(positions=rows)
        self.assertEqual(done.returncode, 0, done.stderr)
        by = {p["ticker"]: p for p in report["positions"]}
        for ticker in ("NAN", "FLAG"):
            self.assertEqual(by[ticker]["status"], "INVALID_DATA")
            self.assertEqual(by[ticker]["quantity"], 5.0)
            for key in ("average_cost", "price", "market_value", "unrealized_pl", "unrealized_pl_pct", "today_pl"):
                self.assertIsNone(by[ticker][key], key)
        self.assertEqual(by["OKAY"]["status"], "OK")
        self.assertNotIn("NaN", done.stdout)

    # --- fail closed -------------------------------------------------------------------------

    def test_gateway_not_listening_fails_before_any_sdk_call(self):
        spare = socket.socket()
        spare.bind(("127.0.0.1", 0))
        closed_port = spare.getsockname()[1]
        spare.close()
        done, report = self.run_tool(port=closed_port)
        self.assertUnavailable(done, report, "not reachable")
        self.assertEqual(self.calls, [])

    def test_unusable_gateway_or_account_fails_closed(self):
        cases = [({"trd": False}, "not logged in"), ({"qot": False}, "not logged in"),
                 ({"state_error": True}, "state query failed"),
                 ({"accounts": [PAPER]}, "exactly one live US-enabled account, found 0"),
                 ({"accounts": [LIVE, dict(LIVE, acc_id=LIVE_ID + 1)]}, "found 2"),
                 ({"accounts": [dict(LIVE, trdmarket_auth=["HK", "MY"])]}, "found 0"),
                 ({"position_error": True}, "position query failed")]
        for cfg, reason in cases:
            with self.subTest(cfg=cfg):
                if self.log.exists():
                    self.log.unlink()
                self.assertUnavailable(*self.run_tool(**cfg), reason)

    def test_a_gateway_that_never_answers_is_cut_off(self):
        done, report = self.run_tool(watchdog=2, hang=True)
        self.assertUnavailable(done, report, "did not answer within 2 s")
        self.assertLess(self.elapsed, 30)

    # --- the source itself ---------------------------------------------------------------

    def test_source_calls_no_trading_function(self):
        tree = ast.parse(TOOL.read_text(encoding="utf-8"))
        names = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)} | \
                {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
        # getattr/eval/exec/__import__ are banned too, so no call can be built from a string.
        for forbidden in ("unlock_trade", "place_order", "modify_order", "cancel_order", "cancel_all_order",
                          "change_order", "SIMULATE", "getattr", "eval", "exec", "__import__"):
            self.assertNotIn(forbidden, names, forbidden)
        trade_calls = {n.func.attr for n in ast.walk(tree)
                       if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                       and isinstance(n.func.value, ast.Name) and n.func.value.id == "trade"}
        self.assertEqual(trade_calls, {"get_acc_list", "position_list_query", "close"})

    def test_tool_takes_no_options(self):
        tree = ast.parse(TOOL.read_text(encoding="utf-8"))
        self.assertFalse([n for n in ast.walk(tree) if isinstance(n, ast.Attribute) and n.attr == "argv"])
        self.assertNotIn("argparse", {a.name for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom))
                                      for a in n.names} | {getattr(n, "module", None) for n in ast.walk(tree)
                                                           if isinstance(n, ast.ImportFrom)})


if __name__ == "__main__":
    unittest.main()
