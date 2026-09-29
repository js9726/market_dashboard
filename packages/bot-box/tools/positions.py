#!/usr/bin/env python3
"""Read-only view of Jie's live moomoo positions for the private bot.

Takes no options. Reads through the local moomoo OpenD gateway and prints one JSON
object: each open position's ticker, market, name, side, quantity, average cost, broker
price, market value, unrealised P&L (amount and percent on average cost), today's P&L
and currency, with the query time and OpenD's US market state.

What it never does:
- trade: it never unlocks trading and calls no order function; the only trade-context
  calls are get_acc_list, position_list_query and close (tests check the source);
- identify the account: account numbers, card numbers and account totals are never
  printed; the one live, US-enabled account is found through the API, not configured;
- guess: if OpenD is unreachable, not logged in, the account is not exactly one, the query
  fails or the whole run exceeds its time limit, it prints status UNAVAILABLE with the
  reason and no numbers (exit 3; opend_common.run). A row whose broker values are flagged
  invalid or are not finite keeps its quantity but shows the rest as null with status
  INVALID_DATA.

Broker positions are authoritative for quantity, average cost, price and unrealised P&L;
nothing here recomputes them.

    python packages/bot-box/tools/positions.py
"""
from __future__ import annotations

import sys

import opend_common as oc


def position_row(row):
    """One position in the output shape; broker values flagged invalid become null."""
    code = str(row.get("code", ""))
    market, _, ticker = code.partition(".")
    out = {"ticker": ticker or code, "market": market if ticker else None,
           "name": str(row.get("stock_name", "")), "side": str(row.get("position_side", "")),
           "quantity": oc.number(row.get("qty")), "average_cost": oc.number(row.get("average_cost")),
           "price": oc.number(row.get("nominal_price")), "market_value": oc.number(row.get("market_val")),
           "unrealized_pl": oc.number(row.get("unrealized_pl")),
           "unrealized_pl_pct": oc.number(row.get("pl_ratio_avg_cost")),
           "today_pl": oc.number(row.get("today_pl_val")), "currency": str(row.get("currency", "")),
           "status": "OK"}
    flagged = any(row.get(flag) is False for flag in ("cost_price_valid", "pl_ratio_valid", "pl_val_valid"))
    values = ("average_cost", "price", "market_value", "unrealized_pl", "unrealized_pl_pct")
    if out["quantity"] is None or flagged or any(out[k] is None for k in values):
        for key in values + ("today_pl",):
            out[key] = None
        out["status"] = "INVALID_DATA"
    return out


def read():
    with oc.sdk_output():
        from moomoo import OpenQuoteContext, OpenSecTradeContext, RET_OK, SecurityFirm, TrdEnv, TrdMarket
        state = oc.global_state(OpenQuoteContext, RET_OK, need_trading=True)
        trade = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=oc.HOST, port=oc.PORT,
                                    security_firm=SecurityFirm.FUTUMY)
        try:
            account = oc.live_account(trade, RET_OK, TrdEnv)
            ret, table = trade.position_list_query(trd_env=TrdEnv.REAL, acc_id=account, refresh_cache=True)
            if ret != RET_OK:
                raise oc.Unavailable("position query failed")
        finally:
            trade.close()
    rows = [position_row(row) for _, row in table.iterrows()]
    return state, [r for r in rows if r["quantity"] != 0]


def render(result):
    state, positions = result
    return {"status": "OK", "source": "moomoo OpenD (read-only position query, live account; identifier withheld)",
            "queried_at_utc": oc.now_utc(), "us_market_state": str(state.get("market_us", "")),
            "count": len(positions), "positions": positions,
            "note": "Broker values. price is the broker's last price for the current market state; "
                    "unrealized_pl_pct is on average cost. No account totals are shown."}


if __name__ == "__main__":
    sys.exit(oc.run(read, render))
