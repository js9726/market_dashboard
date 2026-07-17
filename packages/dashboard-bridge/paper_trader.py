#!/usr/bin/env python3
"""
paper_trader.py — SIMULATE-ONLY forward-validation trader (2026-07-16).

Purpose: forward-validate the A-list strategy with real fills in the moomoo
PAPER account. Reads currently-actionable ENTER signals from the dashboard
(`GET /api/alist/actionable`, gate-vetted server-side since commit 5064ea79),
places simulated entry orders, manages protective stops, and syncs the paper
book to the dashboard as the `moomoo Paper (SIM)` broker account so holdings
and performance are visible (excluded from the real equity curve by isLive).

SAFETY INVARIANTS (do not weaken):
  * trd_env is HARD-CODED to TrdEnv.SIMULATE everywhere. No flag can flip it.
  * acc_id is HARD-CODED to the paper account and re-verified against
    get_acc_list() (trd_env must be SIMULATE) before any order call.
  * fills are NEVER posted to the dashboard (fills=[]) so paper activity can
    never reach the real trade journal / reconciler.
  * fail-closed: no signals endpoint, no OpenD, or account-verify mismatch
    => exit non-zero, place nothing.

Usage (from packages/dashboard-bridge/):
  python paper_trader.py --dry-run     # show decisions, place/sync nothing
  python paper_trader.py               # place entries+stops, sync book
  python paper_trader.py --no-orders   # sync the paper book only

Sizing: risk RISK_PCT of paper equity per trade => qty = risk$/(entry-stop),
notional capped at MAX_NOTIONAL_PCT of equity, min 1 share, cash-checked.
Entry sanity: skip if last > entry*1.03 (stale chase) or last <= stop (broken).
Stops are managed softly: each run, any position whose last <= stop is exited
with a marketable limit sell (moomoo SIMULATE fills limit orders only).
State (per-ticker stop/entry) persists in paper_state.json next to this file.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
from pathlib import Path
from typing import Any

import requests

from bridge.config import load_config
from bridge.client import DashboardClient

from moomoo import (  # type: ignore
    OpenQuoteContext,
    OpenSecTradeContext,
    TrdMarket,
    SecurityFirm,
    TrdEnv,
    TrdSide,
    OrderType,
    Currency,
    RET_OK,
)

# ── Hard-coded paper-account constants (safety: never configurable) ─────────
PAPER_ACC_ID = 1308265
PAPER_ALIAS = "moomoo Paper (SIM)"
HOST, PORT = "127.0.0.1", 11111

RISK_PCT = 0.01          # 1% of paper equity risked per trade (wiki: 0.25-1%)
MAX_NOTIONAL_PCT = 0.20  # single-position notional cap
CHASE_LIMIT = 1.03       # skip entry if last has run >3% past the entry zone
STATE_FILE = Path(__file__).with_name("paper_state.json")

log = lambda *a: print("[paper]", *a)  # noqa: E731


def load_state() -> dict[str, Any]:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text())
        except Exception:
            log("WARN: state file unreadable — starting fresh")
    return {}


def save_state(state: dict[str, Any]) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=1))


def fetch_signals(cfg) -> list[dict[str, Any]]:
    key = cfg.dashboard.brief_ingest_key or os.environ.get("BRIEF_INGEST_KEY")
    if not key:
        # Operator-local fallback: the app's main secrets file (same file the
        # morning-brief _env_loader chains to).
        envf = Path(__file__).resolve().parents[2] / "apps" / "market_dashboard" / ".env.local"
        if envf.exists():
            for line in envf.read_text(encoding="utf-8-sig").splitlines():
                if line.startswith("BRIEF_INGEST_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"')
                    break
    if not key:
        raise SystemExit("FAIL-CLOSED: no BRIEF_INGEST_KEY available for the signals endpoint")
    r = requests.get(
        f"{cfg.dashboard.url}/api/alist/actionable",
        headers={"Authorization": f"Bearer {key}"},
        timeout=30,
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("ok"):
        raise SystemExit(f"FAIL-CLOSED: signals endpoint returned {body}")
    return body.get("signals", [])


def verify_paper_account(tctx: OpenSecTradeContext) -> None:
    """Abort unless PAPER_ACC_ID exists and is a SIMULATE account."""
    ret, df = tctx.get_acc_list()
    if ret != RET_OK:
        raise SystemExit(f"FAIL-CLOSED: get_acc_list failed: {df}")
    row = df[df["acc_id"].astype(str) == str(PAPER_ACC_ID)]
    if row.empty:
        raise SystemExit(f"FAIL-CLOSED: paper acc {PAPER_ACC_ID} not found in OpenD account list")
    env = str(row.iloc[0]["trd_env"])
    if env.upper() != "SIMULATE":
        raise SystemExit(f"FAIL-CLOSED: acc {PAPER_ACC_ID} trd_env={env!r} is not SIMULATE — refusing")
    log(f"verified paper account {PAPER_ACC_ID} (SIMULATE)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="show decisions; place nothing, sync nothing")
    ap.add_argument("--no-orders", action="store_true", help="skip order placement; still sync the book")
    ap.add_argument("--no-sync", action="store_true", help="skip the dashboard sync")
    args = ap.parse_args()

    cfg = load_config()
    signals = fetch_signals(cfg)
    log(f"actionable ENTER signals: {len(signals)}" + (f" -> {[s['ticker'] for s in signals]}" if signals else ""))

    state = load_state()
    qctx = OpenQuoteContext(host=HOST, port=PORT)
    tctx = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=HOST, port=PORT, security_firm=SecurityFirm.FUTUMY)
    placed, exited = [], []
    try:
        verify_paper_account(tctx)

        # ── Paper book: equity, positions, open orders ──────────────────────
        ret, acc = tctx.accinfo_query(trd_env=TrdEnv.SIMULATE, acc_id=PAPER_ACC_ID, refresh_cache=True, currency=Currency.USD)
        if ret != RET_OK:
            raise SystemExit(f"FAIL-CLOSED: accinfo_query failed: {acc}")
        equity = float(acc.iloc[0]["total_assets"])
        cash = float(acc.iloc[0]["cash"])
        market_val = float(acc.iloc[0].get("market_val", 0) or 0)
        log(f"paper equity ${equity:,.0f}  cash ${cash:,.0f}  marketVal ${market_val:,.0f}")

        ret, pos = tctx.position_list_query(trd_env=TrdEnv.SIMULATE, acc_id=PAPER_ACC_ID, refresh_cache=True)
        if ret != RET_OK:
            raise SystemExit(f"FAIL-CLOSED: position_list_query failed: {pos}")
        positions = {str(r["code"]).replace("US.", ""): r for _, r in pos.iterrows() if float(r.get("qty", 0)) > 0}

        ret, orders = tctx.order_list_query(trd_env=TrdEnv.SIMULATE, acc_id=PAPER_ACC_ID)
        open_orders: set[str] = set()
        if ret == RET_OK:
            for _, o in orders.iterrows():
                if str(o.get("order_status")) in ("SUBMITTED", "WAITING_SUBMIT", "SUBMITTING"):
                    open_orders.add(str(o["code"]).replace("US.", ""))
        log(f"positions: {sorted(positions)}  open orders: {sorted(open_orders)}")

        # ── Quotes for everything we may act on ─────────────────────────────
        want = sorted({s["ticker"] for s in signals} | set(positions))
        last_px: dict[str, float] = {}
        if want:
            ret, snap = qctx.get_market_snapshot(["US." + t for t in want])
            if ret == RET_OK:
                for _, r in snap.iterrows():
                    last_px[str(r["code"]).replace("US.", "")] = float(r["last_price"])
            else:
                log(f"WARN: snapshot failed ({snap}) — entries skipped this run, stops still checked via 0-px guard")

        # ── Entries ──────────────────────────────────────────────────────────
        for s in signals:
            t = s["ticker"]
            entry, stop = float(s["entryZone"]), float(s["stop"])
            if t in positions or t in open_orders:
                log(f"  {t}: already in book/ordered — skip")
                continue
            last = last_px.get(t)
            if last is None or last <= 0:
                log(f"  {t}: no live quote — fail-closed skip")
                continue
            if last <= stop:
                log(f"  {t}: last {last} already <= stop {stop} — setup broken, skip")
                continue
            if last > entry * CHASE_LIMIT:
                log(f"  {t}: last {last} is >{(CHASE_LIMIT-1)*100:.0f}% past entry {entry} — stale, no chase, skip")
                continue
            risk_ps = entry - stop
            qty = math.floor((equity * RISK_PCT) / risk_ps)
            qty = min(qty, math.floor((equity * MAX_NOTIONAL_PCT) / last), math.floor(cash / last))
            if qty < 1:
                log(f"  {t}: sized to 0 shares (risk/share ${risk_ps:.2f}) — skip")
                continue
            limit = round(min(last * 1.002, entry * CHASE_LIMIT), 2)
            if args.dry_run or args.no_orders:
                log(f"  {t}: WOULD BUY {qty} @ {limit} (risk ${risk_ps * qty:,.0f} = {RISK_PCT*100:.0f}% eq, stop {stop})")
                continue
            ret, resp = tctx.place_order(price=limit, qty=qty, code="US." + t, trd_side=TrdSide.BUY,
                                         order_type=OrderType.NORMAL, trd_env=TrdEnv.SIMULATE, acc_id=PAPER_ACC_ID)
            if ret == RET_OK:
                placed.append(t)
                state[t] = {"entry": entry, "stop": stop, "qty": qty, "placedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "signalConviction": s.get("conviction")}
                log(f"  {t}: BUY {qty} @ {limit} placed (stop {stop})")
            else:
                log(f"  {t}: place_order FAILED: {resp}")

        # ── Stop management (soft: exit on last <= stop) ─────────────────────
        for t, p in positions.items():
            st = state.get(t, {}).get("stop")
            if st is None:
                log(f"  {t}: position has no journaled paper stop — flagging (no auto-exit without a stop)")
                continue
            last = last_px.get(t)
            if last is None or last <= 0:
                continue
            if last <= float(st):
                qty = int(float(p.get("can_sell_qty", p.get("qty", 0))))
                if qty < 1:
                    continue
                limit = round(last * 0.995, 2)
                if args.dry_run or args.no_orders:
                    log(f"  {t}: WOULD SELL {qty} @ {limit} (stop {st} breached, last {last})")
                    continue
                ret, resp = tctx.place_order(price=limit, qty=qty, code="US." + t, trd_side=TrdSide.SELL,
                                             order_type=OrderType.NORMAL, trd_env=TrdEnv.SIMULATE, acc_id=PAPER_ACC_ID)
                if ret == RET_OK:
                    exited.append(t)
                    state.setdefault(t, {})["exitedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
                    log(f"  {t}: STOP EXIT {qty} @ {limit} placed")
                else:
                    log(f"  {t}: stop-exit place_order FAILED: {resp}")

        if not args.dry_run:
            save_state(state)

        # ── Dashboard sync (positions + equity, NEVER fills) ────────────────
        if not args.dry_run and not args.no_sync:
            def fnum(v, fallback=0.0):
                """moomoo SIMULATE returns 'N/A' strings for some cost fields."""
                try:
                    x = float(v)
                    return x if x == x else fallback  # NaN guard
                except (TypeError, ValueError):
                    return fallback

            def avg_cost(p):
                # average_cost is 'N/A' on manually-opened SIM positions —
                # fall back to cost_price, then to the live nominal price so
                # the dashboard at least shows a sane basis.
                for k in ("average_cost", "cost_price", "nominal_price"):
                    v = fnum(p.get(k), fallback=float("nan"))
                    if v == v and v > 0:
                        return v
                return 0.0

            sync_positions = [{
                "ticker": str(p["code"]),
                "qty": float(p["qty"]),
                "avgCost": avg_cost(p),
                "currency": "USD",
            } for p in positions.values()]
            equity_snap = {
                "snapshotDate": dt.date.today().isoformat(),
                "totalAssets": equity,
                "cash": cash,
                "marketVal": market_val,
                "unrealizedPl": None,
                "currencyCode": "USD",
            }
            # Post under the PAPER alias — shallow config override, token reused.
            from dataclasses import replace
            paper_cfg = replace(cfg, broker=replace(cfg.broker, account_alias=PAPER_ALIAS))
            result = DashboardClient(paper_cfg).sync(positions=sync_positions, fills=[], equity=equity_snap)
            log(f"dashboard sync: {result}")
    finally:
        qctx.close()
        tctx.close()

    log(f"done. placed={placed or 'none'} stop-exits={exited or 'none'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
