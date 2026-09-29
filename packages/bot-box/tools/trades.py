#!/usr/bin/env python3
"""Jie's recent moomoo fills and realized P&L for the private bot (read-only, prints only).

    python packages/bot-box/tools/trades.py [--days 14]

- fills: every fill in the last N days (1-90): exchange time, ticker, market, side,
  quantity, price, fee and currency.
- realized: each sell in the window matched first-in-first-out against buys from the
  last 360 days (the broker's longest single history query), net of the sell's fee and
  the matched buys' fees. A sell whose shares were bought before that history is shown
  with realized_pl null and a reason, never estimated. Totals are per currency, counting
  only sells with a known result.
- Fees come from order_fee_query. If it fails, fees are null and fees_complete is false:
  those results are before fees and say so.

Order, deal and account numbers are never printed. The only trade-context calls are
get_acc_list, history_deal_list_query, order_fee_query and close; nothing trades. The run
fails closed through opend_common (gateway down, not logged in, query failed, timeout).
"""
from __future__ import annotations

import argparse
from collections import defaultdict, deque
from datetime import date, timedelta
import sys

import opend_common as oc

LOOKBACK_DAYS = 360
CURRENCY = {"US": "USD", "MY": "MYR", "HK": "HKD", "SG": "SGD", "CN": "CNY", "JP": "JPY", "AU": "AUD"}
EPSILON = 1e-9


def fills_from(table):
    """Deal rows as plain fills, oldest first; side BUY or SELL only."""
    fills = []
    for _, row in table.iterrows():
        side = str(row.get("trd_side", "")).upper()
        side = "BUY" if "BUY" in side else "SELL" if "SELL" in side else None
        qty, price = oc.number(row.get("qty")), oc.number(row.get("price"))
        if side is None or not qty or price is None:
            continue
        market, _, ticker = str(row.get("code", "")).partition(".")
        fills.append({"time_exchange": str(row.get("create_time", ""))[:19], "ticker": ticker, "market": market,
                      "side": side, "quantity": qty, "price": price, "currency": CURRENCY.get(market, market),
                      "_order": str(row.get("order_id", ""))})
    return sorted(fills, key=lambda f: f["time_exchange"])


def attach_fees(fills, order_fees):
    """Split each order's fee across its fills by quantity; None where unknown."""
    order_qty = defaultdict(float)
    for fill in fills:
        order_qty[fill["_order"]] += fill["quantity"]
    for fill in fills:
        fee = order_fees.get(fill["_order"])
        fill["fee"] = round(fee * fill["quantity"] / order_qty[fill["_order"]], 4) if fee is not None else None


def realized(fills, window_start):
    """FIFO realized P&L for sells on or after window_start (an ISO date string)."""
    lots, out = defaultdict(deque), []
    for fill in fills:
        key = (fill["market"], fill["ticker"])
        if fill["side"] == "BUY":
            per_share_fee = (fill["fee"] or 0.0) / fill["quantity"]
            lots[key].append([fill["quantity"], fill["price"], per_share_fee, fill["fee"] is not None])
            continue
        remaining, cost, buy_fees, fees_known = fill["quantity"], 0.0, 0.0, fill["fee"] is not None
        while remaining > EPSILON and lots[key]:
            lot = lots[key][0]
            take = min(remaining, lot[0])
            cost += take * lot[1]
            buy_fees += take * lot[2]
            fees_known = fees_known and lot[3]
            lot[0] -= take
            remaining -= take
            if lot[0] <= EPSILON:
                lots[key].popleft()
        if fill["time_exchange"][:10] < window_start:
            continue
        row = {"time_exchange": fill["time_exchange"], "ticker": fill["ticker"], "market": fill["market"],
               "quantity": fill["quantity"], "sell_price": fill["price"], "currency": fill["currency"]}
        if remaining > EPSILON:
            row.update(realized_pl=None, reason="shares bought before the {}-day history".format(LOOKBACK_DAYS))
        else:
            gross = fill["quantity"] * fill["price"] - cost
            row.update(average_cost=round(cost / fill["quantity"], 4), gross_pl=round(gross, 2),
                       realized_pl=round(gross - (fill["fee"] or 0.0) - buy_fees, 2), net_of_fees=fees_known)
        out.append(row)
    return out


def main(argv=None, today=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                     allow_abbrev=False)
    parser.add_argument("--days", type=int, default=14, choices=range(1, 91), metavar="1-90")
    days = parser.parse_args(argv).days
    today = today or date.today()
    window_start = (today - timedelta(days=days - 1)).isoformat()

    def read():
        with oc.sdk_output():
            from moomoo import OpenQuoteContext, OpenSecTradeContext, RET_OK, SecurityFirm, TrdEnv, TrdMarket
            oc.global_state(OpenQuoteContext, RET_OK, need_trading=True)
            trade = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=oc.HOST, port=oc.PORT,
                                        security_firm=SecurityFirm.FUTUMY)
            try:
                account = oc.live_account(trade, RET_OK, TrdEnv)
                ret, table = trade.history_deal_list_query(
                    start=(today - timedelta(days=LOOKBACK_DAYS - 1)).isoformat(), end=today.isoformat(),
                    trd_env=TrdEnv.REAL, acc_id=account)
                if ret != RET_OK:
                    raise oc.Unavailable("fill history query failed")
                fills = fills_from(table)
                orders = list(dict.fromkeys(f["_order"] for f in fills if f["_order"]))
                fees, complete = {}, True
                for start in range(0, len(orders), 50):
                    ret, data = trade.order_fee_query(order_id_list=orders[start:start + 50], acc_id=account,
                                                      trd_env=TrdEnv.REAL)
                    if ret != RET_OK:
                        complete = False
                        continue
                    for _, row in data.iterrows():
                        fee = oc.number(row.get("fee_amount"))
                        if fee is not None:
                            fees[str(row.get("order_id", ""))] = fee
            finally:
                trade.close()
        attach_fees(fills, fees)
        return fills, complete and all(f["fee"] is not None for f in fills)

    def render(result):
        fills, fees_complete = result
        sells = realized(fills, window_start)
        totals = defaultdict(float)
        for row in sells:
            if row.get("realized_pl") is not None:
                totals[row["currency"]] += row["realized_pl"]
        shown = [{k: v for k, v in f.items() if not k.startswith("_")} for f in fills
                 if f["time_exchange"][:10] >= window_start]
        return {"status": "OK", "source": "moomoo OpenD fill history (read-only, live account; identifiers withheld)",
                "queried_at_utc": oc.now_utc(), "window_days": days, "window_start": window_start,
                "cost_basis_lookback_days": LOOKBACK_DAYS, "fees_complete": fees_complete,
                "fills": shown, "realized": sells,
                "realized_totals": {c: round(v, 2) for c, v in sorted(totals.items())},
                "note": "Realized P&L is first-in-first-out, net of the fees the broker reports. Times are "
                        "exchange local time. Totals count only sells with a known result, per currency."}

    return oc.run(read, render)


if __name__ == "__main__":
    sys.exit(main())
