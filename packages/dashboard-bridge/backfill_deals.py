"""
backfill_deals.py — one-time / refreshable backfill of MooMoo deal history + fees
into TradeFill, so the dashboard can compute broker-true NET realized P&L (USD).

The regular bridge sync only pulls a recent fill window; this tool walks the full
deal history in 90-day chunks (MooMoo caps a single query at ~90 days) and pulls
per-order fees via order_fee_query (which the deal API does NOT return). Each
deal's fee is the order fee split across the order's deals by quantity.

Usage (OpenD running on this PC):
    python backfill_deals.py                 # write deals_backfill.json (dry)
    python backfill_deals.py --months 36     # go back 36 months
    python backfill_deals.py --post          # POST to the dashboard /api/bridge/sync

Output JSON rows match the bridge fills shape (+ fee), ready to ingest.
"""
from __future__ import annotations

import argparse
import datetime
import json
import sys

from moomoo import OpenSecTradeContext, TrdEnv, TrdMarket, SecurityFirm, RET_OK


def fetch(host: str, port: int, market: str, firm: str, acc_id: int, months: int) -> list[dict]:
    ctx = OpenSecTradeContext(
        filter_trdmarket=getattr(TrdMarket, market.upper(), TrdMarket.US),
        host=host, port=port,
        security_firm=getattr(SecurityFirm, firm, SecurityFirm.FUTUMY),
    )
    try:
        if not acc_id:
            ret, accs = ctx.get_acc_list()
            if ret != RET_OK:
                sys.exit(f"get_acc_list failed: {accs}")
            real = accs[accs["trd_env"] == "REAL"]
            if real.empty:
                sys.exit("no REAL account found")
            acc_id = int(real.iloc[0]["acc_id"])
            print(f"[backfill] using REAL acc_id={acc_id}", file=sys.stderr)

        # 1. deals, walked in 90-day chunks
        deals: dict[str, dict] = {}
        end = datetime.date.today()
        chunks = max(1, round(months * 30 / 90) + 1)
        for i in range(chunks):
            w_end = end - datetime.timedelta(days=90 * i)
            w_start = w_end - datetime.timedelta(days=92)
            ret, data = ctx.history_deal_list_query(
                start=w_start.isoformat(), end=w_end.isoformat(),
                trd_env=TrdEnv.REAL, acc_id=acc_id,
            )
            if ret != RET_OK:
                print(f"[backfill] window {w_start}..{w_end}: ERR {str(data)[:80]}", file=sys.stderr)
                continue
            for _, r in data.iterrows():
                did = str(r.get("deal_id", ""))
                side_raw = str(r.get("trd_side", "")).upper()
                side = "BUY" if "BUY" in side_raw else ("SELL" if "SELL" in side_raw else None)
                if not did or did in deals or side is None:
                    continue
                deals[did] = {
                    "brokerFillId": did,
                    "orderId": str(r.get("order_id", "")),
                    "ticker": str(r.get("code")),
                    "side": side,
                    "qty": float(r.get("qty", 0)),
                    "price": float(r.get("price", 0)),
                    "executedAt": str(r.get("create_time", "")),
                    "currency": "USD" if market.upper() == "US" else "HKD",
                }

        # 2. per-order fees, chunked
        order_ids = sorted({d["orderId"] for d in deals.values() if d["orderId"]})
        order_fee: dict[str, float] = {}
        for j in range(0, len(order_ids), 50):
            ret, data = ctx.order_fee_query(order_id_list=order_ids[j:j + 50], acc_id=acc_id, trd_env=TrdEnv.REAL)
            if ret != RET_OK:
                print(f"[backfill] fee chunk {j}: ERR {str(data)[:80]}", file=sys.stderr)
                continue
            for _, r in data.iterrows():
                oid = str(r.get("order_id", ""))
                fa = r.get("fee_amount")
                if oid and fa is not None:
                    try:
                        order_fee[oid] = float(fa)
                    except (TypeError, ValueError):
                        pass

        # 3. split each order's fee across its deals by qty
        order_qty: dict[str, float] = {}
        for d in deals.values():
            order_qty[d["orderId"]] = order_qty.get(d["orderId"], 0.0) + d["qty"]
        rows = []
        for d in deals.values():
            oq = order_qty.get(d["orderId"], 0.0)
            fee = order_fee.get(d["orderId"])
            d["fees"] = round(fee * (d["qty"] / oq), 4) if (fee is not None and oq > 0) else None
            d.pop("orderId", None)
            rows.append(d)
        rows.sort(key=lambda x: x["executedAt"])
        return rows
    finally:
        ctx.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=11111)
    ap.add_argument("--market", default="US")
    ap.add_argument("--firm", default="FUTUMY")
    ap.add_argument("--acc-id", type=int, default=0, help="0 = auto-detect REAL account")
    ap.add_argument("--months", type=int, default=30)
    ap.add_argument("--out", default="deals_backfill.json")
    ap.add_argument("--post", action="store_true", help="POST fills to /api/bridge/sync via bridge config")
    args = ap.parse_args()

    rows = fetch(args.host, args.port, args.market, args.firm, args.acc_id, args.months)
    buys = sum(1 for r in rows if r["side"] == "BUY")
    fees = sum(r["fees"] for r in rows if r.get("fees") is not None)
    print(f"[backfill] {len(rows)} deals (buys={buys} sells={len(rows) - buys}) | "
          f"fee coverage {sum(1 for r in rows if r.get('fees') is not None)}/{len(rows)} | total fee ${fees:.2f}",
          file=sys.stderr)

    if args.post:
        from bridge.config import load_config
        from bridge.client import DashboardClient
        cfg = load_config()
        client = DashboardClient(cfg.dashboard.url, cfg.dashboard.token)
        client.sync(positions=[], fills=rows)
        print(f"[backfill] POSTed {len(rows)} fills to {cfg.dashboard.url}", file=sys.stderr)
    else:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(rows, f)
        print(f"[backfill] wrote {len(rows)} rows -> {args.out} (use --post to ingest)", file=sys.stderr)


if __name__ == "__main__":
    main()
