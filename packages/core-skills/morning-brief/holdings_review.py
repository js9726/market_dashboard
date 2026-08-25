"""
holdings_review.py
==================
Daily / overnight review of the operator's LIVE broker holdings (the gap the
market brief and trade-analyser Mode A/B did not cover). Broker positions are the
source of truth for open holdings; this script overlays live OpenD quotes
(including after-hours), EMA/ATR structure, and stop-status so the agent can make
a HOLD / TRIM / CUT call per position.

OPERATOR-LOCAL ONLY. Pulls a personal moomoo account via local OpenD — never run
in the multi-client SaaS context. No account IDs are hardcoded here; they come
from env so this file stays safe to commit.

Pipeline:
  1. One OpenSecTradeContext -> position_list_query + order_list_query (same snapshot)
  2. fetch_opend_live.fetch_snapshots -> live last / prev / RVOL / pre / after
  3. compute_index_technicals.analyze -> EMA8/21/50, ATR14, extension, entry_risk
  4. reconcile active broker STOP / STOP_LIMIT / TRAILING_STOP orders to live quantity
  5. overlay journaled/planned stops (--stops) as intent only, never order evidence
  6. classify urgency and print a table (+ optional --json)

Env (all optional; safe defaults):
  OPEND_HOST            default 127.0.0.1
  OPEND_PORT            default 11111
  OPEND_SECURITY_FIRM   default FUTUMY   (moomoo SecurityFirm enum name)
  OPEND_ACC_ID          default unset -> first REAL US account (acc_index 0)
  OPEND_TRD_ENV         default REAL

Usage:
  python holdings_review.py
  python holdings_review.py --stops stops.json        # {"VRT": 326.48, "HUT": 93.91}
  python holdings_review.py --stops '{"VRT":326.48}'  # inline JSON also accepted
  python holdings_review.py --json --out holdings_review.json
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Quiet the moomoo SDK's connection logging so --json stdout stays parseable.
for _n in ("moomoo", "futu", "ft"):
    logging.getLogger(_n).setLevel(logging.CRITICAL)

try:
    from _env_loader import load_env as _load_env
    _load_env()
except ImportError:
    pass

# Sibling helpers (same dir) — reuse the bug-free get_cur_kline path in analyze()
from fetch_opend_live import fetch_snapshots
from compute_index_technicals import analyze

HOST = os.environ.get("OPEND_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPEND_PORT", "11111"))


def _port_alive(host: str, port: int, timeout_s: float = 2.0) -> bool:
    import socket
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except (OSError, socket.timeout):
        return False


PROTECTIVE_ORDER_TYPES = {"STOP", "STOP_LIMIT", "TRAILING_STOP", "TRAILING_STOP_LIMIT"}
QUEUED_ORDER_STATUSES = {"WAITING_SUBMIT", "SUBMITTING"}
WORKING_ORDER_STATUSES = {"SUBMITTED", "FILLED_PART"}
ACTIVE_ORDER_STATUSES = QUEUED_ORDER_STATUSES | WORKING_ORDER_STATUSES


def _enum_name(value: object) -> str:
    name = getattr(value, "name", None)
    if name:
        return str(name).upper()
    return str(value or "").split(".")[-1].upper()


def _number(value: object, default: float = 0.0) -> float:
    try:
        return float(value or default)
    except (TypeError, ValueError):
        return default


def _position_rows(df) -> list[dict]:
    rows = []
    for _, raw in df.iterrows():
        qty = _number(raw.get("qty"))
        if qty <= 0:
            continue
        code = str(raw.get("code", ""))
        rows.append({
            "ticker": code.replace("US.", "").upper(),
            "qty": qty,
            # average_cost = original un-diluted entry (use for R). cost_price/
            # diluted_cost are netted by realized P&L and would inflate R wildly.
            "avg_cost": _number(raw.get("average_cost", raw.get("cost_price", 0))),
            "diluted_cost": _number(raw.get("diluted_cost")),
            "nominal": _number(raw.get("nominal_price")),
            "unrealized_pl": _number(raw.get("unrealized_pl")),
            "realized_pl": _number(raw.get("realized_pl")),
            "today_pl_val": _number(raw.get("today_pl_val")),
            "pl_ratio_avg_cost": _number(raw.get("pl_ratio_avg_cost")),
        })
    return rows


def _order_rows(df) -> list[dict]:
    """Return only fields required for protection reconciliation; IDs stay private."""
    rows = []
    for _, raw in df.iterrows():
        qty = _number(raw.get("qty"))
        dealt = _number(raw.get("dealt_qty"))
        code = str(raw.get("code", ""))
        rows.append({
            "ticker": code.replace("US.", "").upper(),
            "side": _enum_name(raw.get("trd_side")),
            "order_type": _enum_name(raw.get("order_type")),
            "order_status": _enum_name(raw.get("order_status")),
            "qty": qty,
            "dealt_qty": dealt,
            "remaining_qty": max(qty - dealt, 0.0),
            "trigger_price": _number(raw.get("aux_price")) or None,
            "limit_price": _number(raw.get("price")) or None,
        })
    return rows


def fetch_broker_snapshot() -> dict:
    """Fetch positions and orders through one read-only trade context.

    `positions` or `orders` is None when its feed was not verified. No account or order
    identifier is returned, logged, or written to receipts.
    """
    if not _port_alive(HOST, PORT):
        print(f"[holdings] OpenD {HOST}:{PORT} unreachable — STOP and start OpenD.", file=sys.stderr)
        return {"positions": None, "orders": None, "error": "OpenD unreachable"}
    try:
        from moomoo import OpenSecTradeContext, TrdMarket, SecurityFirm, TrdEnv, RET_OK
    except ImportError:
        print("[holdings] moomoo SDK not installed — pip install moomoo-api", file=sys.stderr)
        return {"positions": None, "orders": None, "error": "moomoo SDK unavailable"}

    firm_name = os.environ.get("OPEND_SECURITY_FIRM", "FUTUMY")
    env_name = os.environ.get("OPEND_TRD_ENV", "REAL")
    sec_firm = getattr(SecurityFirm, firm_name, SecurityFirm.FUTUMY)
    trd_env = getattr(TrdEnv, env_name, TrdEnv.REAL)

    try:
        ctx = OpenSecTradeContext(
            filter_trdmarket=TrdMarket.US, host=HOST, port=PORT, security_firm=sec_firm,
        )
    except Exception as exc:
        print(f"[holdings] could not open read-only trade context: {exc}", file=sys.stderr)
        return {"positions": None, "orders": None, "error": "trade context unavailable"}
    kwargs = dict(trd_env=trd_env, refresh_cache=True)
    acc_id = os.environ.get("OPEND_ACC_ID")
    if acc_id:
        kwargs["acc_id"] = int(acc_id)
    try:
        pos_ret, pos_df = ctx.position_list_query(**kwargs)
        order_ret, order_df = ctx.order_list_query(**kwargs)
    except Exception as exc:
        print(f"[holdings] broker snapshot error: {exc}", file=sys.stderr)
        return {"positions": None, "orders": None, "error": "broker snapshot query failed"}
    finally:
        ctx.close()

    positions = _position_rows(pos_df) if pos_ret == RET_OK else None
    orders = _order_rows(order_df) if order_ret == RET_OK else None
    if positions is None:
        print("[holdings] position_list_query failed; broker positions unverified", file=sys.stderr)
    if orders is None:
        print("[holdings] order_list_query failed; broker protection unverified", file=sys.stderr)
    return {
        "positions": positions,
        "orders": orders,
        "error": None if positions is not None and orders is not None else "broker feed unverified",
    }


def reconcile_protection(position: dict, orders: list[dict] | None) -> dict:
    """Pure reconciliation of one live long position against active protective sells."""
    ticker = str(position.get("ticker", "")).upper()
    live_qty = max(_number(position.get("qty")), 0.0)
    if ticker in HOLD_EXEMPT:
        return {
            "protection_state": "HOLD-EXEMPT", "order_feed_verified": orders is not None,
            "working_qty": 0.0, "queued_qty": 0.0, "protected_qty": 0.0,
            "unprotected_qty": 0.0, "protective_orders": [], "new_risk_block": False,
        }
    if orders is None:
        return {
            "protection_state": "ORDER-FEED-UNVERIFIED", "order_feed_verified": False,
            "working_qty": 0.0, "queued_qty": 0.0, "protected_qty": 0.0,
            "unprotected_qty": live_qty, "protective_orders": [], "new_risk_block": True,
        }

    active = []
    for order in orders:
        if str(order.get("ticker", "")).upper() != ticker:
            continue
        side = _enum_name(order.get("side"))
        order_type = _enum_name(order.get("order_type"))
        status = _enum_name(order.get("order_status"))
        remaining = max(_number(order.get("remaining_qty")), 0.0)
        if side != "SELL" or order_type not in PROTECTIVE_ORDER_TYPES:
            continue
        if status not in ACTIVE_ORDER_STATUSES or remaining <= 0:
            continue
        active.append({
            "order_type": order_type,
            "order_status": status,
            "remaining_qty": remaining,
            "trigger_price": _number(order.get("trigger_price")) or None,
            "limit_price": _number(order.get("limit_price")) or None,
        })

    working_qty = sum(
        row["remaining_qty"] for row in active if row["order_status"] in WORKING_ORDER_STATUSES
    )
    queued_qty = sum(
        row["remaining_qty"] for row in active if row["order_status"] in QUEUED_ORDER_STATUSES
    )
    protected_qty = min(working_qty + queued_qty, live_qty)
    unprotected_qty = max(live_qty - protected_qty, 0.0)
    if live_qty <= 0:
        state = "UNPROTECTED"
    elif working_qty >= live_qty:
        state = "PROTECTED-WORKING"
    elif protected_qty >= live_qty:
        state = "PROTECTED-QUEUED"
    elif protected_qty > 0:
        state = "PARTIALLY-PROTECTED"
    else:
        state = "UNPROTECTED"
    return {
        "protection_state": state,
        "order_feed_verified": True,
        "working_qty": working_qty,
        "queued_qty": queued_qty,
        "protected_qty": protected_qty,
        "unprotected_qty": unprotected_qty,
        "protective_orders": active,
        "new_risk_block": state in {"PARTIALLY-PROTECTED", "UNPROTECTED"},
    }


def _load_stops(arg: str | None) -> dict:
    if not arg:
        return {}
    p = Path(arg)
    raw = p.read_text(encoding="utf-8") if p.exists() else arg
    try:
        return {k.upper(): float(v) for k, v in json.loads(raw).items()}
    except Exception as e:
        print(f"[holdings] could not parse --stops ({e}); ignoring", file=sys.stderr)
        return {}


# Permanent non-trading holds (operator-confirmed). These are NEVER reported as a
# NO-STOP defect and contribute 0 to the progressive-exposure risk budget. Source of
# truth: jie_wiki/wiki/trading/companies/materialise.md ("Holding classification - PERMANENT
# HOLD"). Override with HOLD_EXEMPT_TICKERS (comma-separated) without a code change.
HOLD_EXEMPT = {
    t.strip().upper()
    for t in os.environ.get("HOLD_EXEMPT_TICKERS", "MTLS").split(",")
    if t.strip()
}


def classify(h: dict) -> dict:
    """Attach broker-protection and separate planned-stop diagnostics."""
    if h.get("ticker", "").upper() in HOLD_EXEMPT:
        h["protection_state"], h["stop_status"], h["urgency"] = "HOLD-EXEMPT", "HOLD-EXEMPT", "OK"
        h["new_risk_block"] = False
        h["planned_stop_status"] = "NOT-REQUIRED"
        h["notes"] = ["permanent hold (operator rule) - excluded from risk budget"]
        return h

    last = h.get("last")
    after = h.get("after_price")
    planned_stop = h.get("planned_stop")
    atr = h.get("atr14")
    e8 = h.get("ema8")

    protection_state = h.get("protection_state", "ORDER-FEED-UNVERIFIED")
    urgency, notes = "OK", []
    if protection_state == "ORDER-FEED-UNVERIFIED":
        urgency = "BLOCK"
        h["new_risk_block"] = True
        notes.append("broker order feed unverified - never claim this position is protected")
    elif protection_state == "UNPROTECTED":
        urgency = "WARN"
        h["new_risk_block"] = True
        notes.append("verified live position has no active protective broker order")
    elif protection_state == "PARTIALLY-PROTECTED":
        urgency = "WARN"
        h["new_risk_block"] = True
        notes.append(
            f"only {h.get('protected_qty', 0):g}/{h.get('qty', 0):g} shares have active protection"
        )
    elif protection_state == "PROTECTED-QUEUED":
        notes.append("full protective quantity is queued, not yet broker-working")

    broker_triggers = [
        _number(row.get("trigger_price"))
        for row in h.get("protective_orders", [])
        if _number(row.get("trigger_price")) > 0
    ]
    broker_trigger = max(broker_triggers) if broker_triggers else None
    h["broker_stop_trigger"] = broker_trigger
    if broker_trigger and last and last < broker_trigger:
        urgency = "CUT"
        notes.append(
            f"last ${last:.2f} is below active broker trigger ${broker_trigger:.2f}; verify order/fill now"
        )
    elif broker_trigger and after and after < broker_trigger:
        urgency = "CUT-ON-OPEN"
        notes.append(
            f"after-hours ${after:.2f} is below broker trigger ${broker_trigger:.2f}; verify at the open"
        )

    planned_status = "NO-PLAN"
    if planned_stop and last:
        planned_status = "INTACT"
        one_r = h["avg_cost"] - planned_stop
        if one_r:
            # Journal convention only; this is plan math, not proof of broker protection.
            h["planned_R"] = round((last - h["avg_cost"]) / one_r, 2)
            h["R"] = h["planned_R"]
            if after:
                h["planned_R_afterhours"] = round((after - h["avg_cost"]) / one_r, 2)
                h["R_afterhours"] = h["planned_R_afterhours"]
        if last < planned_stop:
            planned_status, urgency = "BROKEN", "CUT"
            notes.append(f"last ${last:.2f} < planned stop ${planned_stop:.2f}")
        elif after and after < planned_stop:
            planned_status = "AH-BROKEN"
            if urgency not in {"BLOCK", "CUT"}:
                urgency = "CUT-ON-OPEN"
            notes.append(f"after-hours ${after:.2f} < planned stop ${planned_stop:.2f}")
        elif atr and (last - planned_stop) <= 0.3 * atr:
            planned_status = "THREATENED"
            if urgency == "OK":
                urgency = "WARN"
            notes.append(f"within 0.3 ATR of planned stop ${planned_stop:.2f}")

    if e8 and last and last < e8:
        notes.append(f"below 8EMA ${e8:.2f} (trail/structure soft-stop)")
        if urgency == "OK":
            urgency = "WARN"
    h["planned_stop_status"] = planned_status
    h["stop_status"] = protection_state
    h["urgency"], h["notes"] = urgency, notes
    return h


URGENCY_RANK = {"BLOCK": 0, "CUT": 1, "CUT-ON-OPEN": 2, "WARN": 3, "OK": 4}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Daily/overnight review of live broker holdings")
    ap.add_argument(
        "--stops", default="",
        help="JSON map {TICKER: planned_or_journal_stop}; intent only, never broker-order evidence",
    )
    ap.add_argument("--json", action="store_true", help="Print full JSON instead of the table")
    ap.add_argument("--out", default="", help="Also write JSON to this path")
    args = ap.parse_args(argv)

    stops = _load_stops(args.stops)

    # Gather everything with stdout redirected to stderr so the moomoo SDK's
    # connection logging never pollutes a --json payload on stdout.
    import contextlib
    rows: list[dict] = []
    broker: dict
    positions: list[dict] | None
    orders: list[dict] | None
    with contextlib.redirect_stdout(sys.stderr):
        broker = fetch_broker_snapshot()
        positions = broker.get("positions")
        orders = broker.get("orders")
        if positions:
            tickers = [p["ticker"] for p in positions]
            snaps = {s["ticker"]: s for s in fetch_snapshots(tickers, host=HOST, port=PORT)}
            for p in positions:
                t = p["ticker"]
                s = snaps.get(t, {})
                tech = analyze(t) or {}
                last = s.get("last") or p["nominal"] or tech.get("close")
                row = {
                    **p,
                    "last": last,
                    "change_pct": s.get("change_pct"),
                    "rvol": s.get("rvol"),
                    "pre_price": s.get("pre_price"), "pre_chg": s.get("pre_chg"),
                    "after_price": s.get("after_price"), "after_chg": s.get("after_chg"),
                    "as_of": s.get("update_time"),
                    "ema8": tech.get("ema8"), "ema21": tech.get("ema21"), "ema50": tech.get("ema50"),
                    # Alex soft stop: a CLOSE below the 21dma means the thesis failed.
                    # It trails, so it is recomputed every run — never a remembered number.
                    "soft_stop_21dma": tech.get("soft_stop_21dma"),
                    "soft_stop_atr_mult": tech.get("soft_stop_atr_mult"),
                    "sma21_rising": tech.get("sma21_rising"),
                    "atr14": tech.get("atr14"), "dist_21_atr": tech.get("dist_21_atr"),
                    "entry_risk": tech.get("entry_risk"), "rsi14": tech.get("rsi14"),
                    "macd_dir": tech.get("macd_dir"),
                    "pct_gain": round((last - p["avg_cost"]) / p["avg_cost"] * 100, 2) if (last and p["avg_cost"]) else None,
                    "planned_stop": stops.get(t),
                    **reconcile_protection(p, orders),
                }
                rows.append(classify(row))

    rows.sort(key=lambda r: (URGENCY_RANK.get(r["urgency"], 9), -(r.get("R") or -99)))

    position_verified = positions is not None
    order_verified = orders is not None
    report = {
        "schema_version": 2,
        "position_feed_verified": position_verified,
        "order_feed_verified": order_verified,
        "publication_allowed": position_verified and order_verified,
        "new_risk_allowed": (
            position_verified and order_verified
            and not any(row.get("new_risk_block") for row in rows)
        ),
        "summary": {
            state: sum(1 for row in rows if row.get("protection_state") == state)
            for state in (
                "PROTECTED-WORKING", "PROTECTED-QUEUED", "PARTIALLY-PROTECTED",
                "UNPROTECTED", "ORDER-FEED-UNVERIFIED", "HOLD-EXEMPT",
            )
        },
        "holdings": rows,
        "error": broker.get("error"),
    }

    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[holdings] wrote {args.out}", file=sys.stderr)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    elif positions is None:
        print("HOLDINGS REVIEW ABORTED — live positions unavailable. Start OpenD and retry.", file=sys.stderr)
    elif orders is None:
        print("HOLDINGS REVIEW ABORTED — broker order feed unverified. Never claim protection.", file=sys.stderr)
    elif not positions:
        print("No open US holdings (position and order feeds verified).")
    else:
        # Human-readable table
        as_of = next((r["as_of"] for r in rows if r.get("as_of")), "n/a")
        print(f"OPEN HOLDINGS REVIEW  (live as-of {as_of})")
        print(f"{'TKR':<6}{'qty':>5}{'avg':>9}{'last':>9}{'gain%':>7}{'Rplan':>7} "
              f"{'BROKER PROTECTION':<22}{'broker trig':>12}{'plan':>10} {'PLAN':<11} URGENCY / notes")
        for r in rows:
            print(
                f"{r['ticker']:<6}{r['qty']:>5.0f}{r['avg_cost']:>9.2f}{(r['last'] or 0):>9.2f}"
                f"{(r.get('pct_gain') or 0):>7.1f}{(r.get('planned_R') if r.get('planned_R') is not None else 0):>7.1f} "
                f"{r['protection_state']:<22}{(r.get('broker_stop_trigger') or 0):>12.2f}"
                f"{(r.get('planned_stop') or 0):>10.2f} {r['planned_stop_status']:<11} {r['urgency']}"
            )
            for note in r["notes"]:
                print(f"        - {note}")
        print("\nBROKER PROTECTION comes only from live active broker orders. PLAN is journal intent")
        print("and can explain R/discipline, but it never proves the position is protected.")

    if not report["publication_allowed"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
