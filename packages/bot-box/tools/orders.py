#!/usr/bin/env python3
"""Jie's working moomoo orders and stop coverage for the private bot (read-only, prints only).

Takes no options. Reads through the local moomoo OpenD gateway and prints one JSON object:

- working_orders: every order moomoo still has working (waiting, submitted or partly
  filled): ticker, market, side, order type, status, quantity, filled quantity, limit
  price, trigger price, trailing settings, time in force, outside-RTH flag and times.
- stop_coverage: for each long position, how many shares working SELL stop orders
  (STOP, STOP_LIMIT, TRAILING_STOP, TRAILING_STOP_LIMIT) cover: COVERED, PARTIAL or NONE,
  with the trigger prices. A take-profit limit is not a stop and does not count.

What it never does:
- trade: it never unlocks trading and calls no order-changing function; the only
  trade-context calls are get_acc_list, position_list_query, order_list_query and close
  (tests/test_opend_tools.py checks the source);
- identify: order, deal, account and card numbers are never printed;
- guess: gateway down, not logged in, not exactly one live account, a failed query or a
  timeout prints status UNAVAILABLE with the reason and no orders (exit 3, opend_common.run).
  moomoo's order list is the authority; if an order is missing there, it is missing here.

    python packages/bot-box/tools/orders.py
"""
from __future__ import annotations

from collections import defaultdict
import sys

import opend_common as oc

WORKING = {"WAITING_SUBMIT", "SUBMITTING", "SUBMITTED", "FILLED_PART"}
STOP_TYPES = {"STOP", "STOP_LIMIT", "TRAILING_STOP", "TRAILING_STOP_LIMIT"}


def text(value):
    value = str(value if value is not None else "").strip()
    return value.split(".")[-1].upper() if value else ""


def order_row(row):
    code = str(row.get("code", ""))
    market, _, ticker = code.partition(".")
    return {"ticker": ticker or code, "market": market if ticker else None, "name": str(row.get("stock_name", "")),
            "side": text(row.get("trd_side")), "order_type": text(row.get("order_type")),
            "status": text(row.get("order_status")), "quantity": oc.number(row.get("qty")),
            "filled_quantity": oc.number(row.get("dealt_qty")), "limit_price": oc.number(row.get("price")),
            "trigger_price": oc.number(row.get("aux_price")), "trail_type": text(row.get("trail_type")) or None,
            "trail_value": oc.number(row.get("trail_value")), "time_in_force": text(row.get("time_in_force")) or None,
            "outside_rth": bool(row.get("fill_outside_rth")) if row.get("fill_outside_rth") is not None else None,
            "created_time": str(row.get("create_time", ""))[:19], "updated_time": str(row.get("updated_time", ""))[:19],
            "currency": str(row.get("currency", ""))}


def coverage(positions, orders):
    """Stop coverage for each long position from working SELL stop orders."""
    stops = defaultdict(list)
    for o in orders:
        if o["side"].startswith("SELL") and o["order_type"] in STOP_TYPES:
            stops[(o["market"], o["ticker"])].append(o)
    out = []
    for p in positions:
        held = p["quantity"]
        if not held or held <= 0:
            continue
        mine = stops.get((p["market"], p["ticker"]), [])
        covered = sum(max((o["quantity"] or 0) - (o["filled_quantity"] or 0), 0) for o in mine)
        state = "NONE" if covered <= 0 else ("COVERED" if covered >= held else "PARTIAL")
        out.append({"ticker": p["ticker"], "market": p["market"], "held": held, "covered_by_stops": covered,
                    "status": state,
                    "stops": [{"order_type": o["order_type"], "trigger_price": o["trigger_price"],
                               "limit_price": o["limit_price"], "trail_type": o["trail_type"],
                               "trail_value": o["trail_value"], "quantity": o["quantity"]} for o in mine]})
    return out


def read():
    with oc.sdk_output():
        from moomoo import OpenQuoteContext, OpenSecTradeContext, RET_OK, SecurityFirm, TrdEnv, TrdMarket
        state = oc.global_state(OpenQuoteContext, RET_OK, need_trading=True)
        trade = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=oc.HOST, port=oc.PORT,
                                    security_firm=SecurityFirm.FUTUMY)
        try:
            account = oc.live_account(trade, RET_OK, TrdEnv)
            ret, orders = trade.order_list_query(trd_env=TrdEnv.REAL, acc_id=account, refresh_cache=True)
            if ret != RET_OK:
                raise oc.Unavailable("order list query failed")
            ret, positions = trade.position_list_query(trd_env=TrdEnv.REAL, acc_id=account, refresh_cache=True)
            if ret != RET_OK:
                raise oc.Unavailable("position query failed")
        finally:
            trade.close()
    working = [o for o in (order_row(r) for _, r in orders.iterrows()) if o["status"] in WORKING]
    held = []
    for _, r in positions.iterrows():
        code = str(r.get("code", ""))
        market, _, ticker = code.partition(".")
        held.append({"ticker": ticker or code, "market": market if ticker else None,
                     "quantity": oc.number(r.get("qty"))})
    return state, working, held


def render(result):
    state, working, held = result
    return {"status": "OK", "source": "moomoo OpenD order list (read-only, live account; identifiers withheld)",
            "queried_at_utc": oc.now_utc(), "us_market_state": str(state.get("market_us", "")),
            "working_count": len(working), "working_orders": working, "stop_coverage": coverage(held, working),
            "note": "Working orders as moomoo reports them. Stop coverage counts only working SELL stop and "
                    "trailing-stop orders against long positions; take-profit limits are not stops."}


if __name__ == "__main__":
    sys.exit(oc.run(read, render))
