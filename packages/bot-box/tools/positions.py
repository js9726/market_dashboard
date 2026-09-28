#!/usr/bin/env python3
"""Read-only view of Jie's live moomoo positions for the private bot.

Takes no options. Reads through the local moomoo OpenD gateway and prints one JSON
object: each open position's ticker, market, name, side, quantity, average cost, broker
price, market value, unrealised P&L (amount and percent on average cost), today's P&L
and currency, with the query time and OpenD's US market state.

What it never does:
- trade: it never unlocks trading and calls no order function; the only trade-context
  calls are get_acc_list, position_list_query and close (tests/test_positions.py checks
  the source);
- identify the account: account numbers, card numbers and account totals are never
  printed; the one live, US-enabled account is found through the API, not configured;
- guess: if OpenD is unreachable, not logged in, the account is not exactly one, the query
  fails or the whole run exceeds its time limit, it prints status UNAVAILABLE with the
  reason and no numbers (exit 3). A row whose broker values are flagged invalid or are
  not finite keeps its quantity but shows the rest as null with status INVALID_DATA.

Broker positions are authoritative for quantity, average cost, price and unrealised P&L;
nothing here recomputes them.

    python packages/bot-box/tools/positions.py
"""
from __future__ import annotations

import contextlib
from datetime import datetime, timezone
import json
import math
import os
import socket
import sys
import threading

HOST, PORT = "127.0.0.1", 11111
CONNECT_SECONDS = 3
WATCHDOG_SECONDS = 45
EXIT_UNAVAILABLE = 3
# The real stdout, captured before anything redirects it. redirect_stdout is process-wide,
# so while the worker thread sends SDK chatter to stderr, a timeout report written through
# sys.stdout would land on stderr too.
OUT = sys.stdout


class Unavailable(Exception):
    """The positions cannot be read reliably; the message says why."""


def emit(payload):
    OUT.buffer.write((json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    OUT.buffer.flush()


def unavailable(reason):
    emit({"status": "UNAVAILABLE", "reason": reason, "source": "moomoo OpenD",
          "checked_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    return EXIT_UNAVAILABLE


def number(value):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def position_row(row):
    """One position in the output shape; broker values flagged invalid become null."""
    code = str(row.get("code", ""))
    market, _, ticker = code.partition(".")
    out = {"ticker": ticker or code, "market": market if ticker else None,
           "name": str(row.get("stock_name", "")), "side": str(row.get("position_side", "")),
           "quantity": number(row.get("qty")), "average_cost": number(row.get("average_cost")),
           "price": number(row.get("nominal_price")), "market_value": number(row.get("market_val")),
           "unrealized_pl": number(row.get("unrealized_pl")),
           "unrealized_pl_pct": number(row.get("pl_ratio_avg_cost")),
           "today_pl": number(row.get("today_pl_val")), "currency": str(row.get("currency", "")),
           "status": "OK"}
    flagged = any(row.get(flag) is False for flag in ("cost_price_valid", "pl_ratio_valid", "pl_val_valid"))
    values = ("average_cost", "price", "market_value", "unrealized_pl", "unrealized_pl_pct")
    if out["quantity"] is None or flagged or any(out[k] is None for k in values):
        for key in values + ("today_pl",):
            out[key] = None
        out["status"] = "INVALID_DATA"
    return out


def read_positions():
    """Query OpenD. SDK log lines go to stderr so stdout stays one JSON object."""
    try:
        with socket.create_connection((HOST, PORT), timeout=CONNECT_SECONDS):
            pass
    except OSError as error:
        raise Unavailable("OpenD is not reachable at {}:{} ({})".format(HOST, PORT, error.__class__.__name__))
    with contextlib.redirect_stdout(sys.stderr):
        from moomoo import OpenQuoteContext, OpenSecTradeContext, RET_OK, SecurityFirm, TrdEnv, TrdMarket
        quote = OpenQuoteContext(host=HOST, port=PORT)
        try:
            ret, state = quote.get_global_state()
        finally:
            quote.close()
        if ret != RET_OK:
            raise Unavailable("OpenD state query failed")
        if not (state.get("qot_logined") and state.get("trd_logined")):
            raise Unavailable("OpenD is not logged in to quotes and trading")
        trade = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=HOST, port=PORT,
                                    security_firm=SecurityFirm.FUTUMY)
        try:
            ret, accounts = trade.get_acc_list()
            if ret != RET_OK:
                raise Unavailable("account list query failed")
            live = accounts[(accounts["trd_env"] == TrdEnv.REAL)
                            & accounts["trdmarket_auth"].apply(lambda markets: "US" in list(markets))]
            if len(live) != 1:
                raise Unavailable("expected exactly one live US-enabled account, found {}".format(len(live)))
            ret, table = trade.position_list_query(trd_env=TrdEnv.REAL, acc_id=int(live.iloc[0]["acc_id"]),
                                                   refresh_cache=True)
            if ret != RET_OK:
                raise Unavailable("position query failed")
        finally:
            trade.close()
    rows = [position_row(row) for _, row in table.iterrows()]
    return state, [r for r in rows if r["quantity"] != 0]


def main():
    result = {}

    def work():
        try:
            result["value"] = read_positions()
        except Unavailable as error:
            result["unavailable"] = str(error)
        except Exception as error:      # the SDK raises assorted errors; never guess past one
            result["unavailable"] = "moomoo query error ({})".format(error.__class__.__name__)

    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    worker.join(WATCHDOG_SECONDS)
    if worker.is_alive():
        code = unavailable("OpenD did not answer within {} s".format(WATCHDOG_SECONDS))
        os._exit(code)                  # SDK threads may still be waiting on the gateway
    if "unavailable" in result:
        return unavailable(result["unavailable"])
    state, positions = result["value"]
    emit({"status": "OK", "source": "moomoo OpenD (read-only position query, live account; identifier withheld)",
          "queried_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
          "us_market_state": str(state.get("market_us", "")), "count": len(positions),
          "positions": positions,
          "note": "Broker values. price is the broker's last price for the current market state; "
                  "unrealized_pl_pct is on average cost. No account totals are shown."})
    return 0


if __name__ == "__main__":
    sys.exit(main())
