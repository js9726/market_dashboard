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
  1. position_list_query (US / REAL) -> open holdings (qty>0) with avg_cost
  2. fetch_opend_live.fetch_snapshots -> live last / prev / RVOL / pre / after
  3. compute_index_technicals.analyze -> EMA8/21/50, ATR14, extension, entry_risk
  4. overlay journaled stops (--stops) -> exact R, after-hours R, stop-status
  5. classify urgency (CUT / WARN / OK) and print a table (+ optional --json)

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


def fetch_positions() -> list[dict] | None:
    """Return open US positions (qty>0) from the live REAL account, or None if
    OpenD/trade context is unreachable (fail-closed — caller must STOP, not guess)."""
    if not _port_alive(HOST, PORT):
        print(f"[holdings] OpenD {HOST}:{PORT} unreachable — STOP and start OpenD.", file=sys.stderr)
        return None
    try:
        from moomoo import OpenSecTradeContext, TrdMarket, SecurityFirm, TrdEnv, RET_OK
    except ImportError:
        print("[holdings] moomoo SDK not installed — pip install moomoo-api", file=sys.stderr)
        return None

    firm_name = os.environ.get("OPEND_SECURITY_FIRM", "FUTUMY")
    env_name = os.environ.get("OPEND_TRD_ENV", "REAL")
    sec_firm = getattr(SecurityFirm, firm_name, SecurityFirm.FUTUMY)
    trd_env = getattr(TrdEnv, env_name, TrdEnv.REAL)

    ctx = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host=HOST, port=PORT,
                              security_firm=sec_firm)
    kwargs = dict(trd_env=trd_env, refresh_cache=True)
    acc_id = os.environ.get("OPEND_ACC_ID")
    if acc_id:
        kwargs["acc_id"] = int(acc_id)
    try:
        ret, df = ctx.position_list_query(**kwargs)
    finally:
        ctx.close()
    if ret != RET_OK:
        print(f"[holdings] position_list_query error: {df}", file=sys.stderr)
        return None

    out = []
    for _, r in df.iterrows():
        qty = float(r.get("qty", 0) or 0)
        if qty <= 0:
            continue  # closed/zero rows (broker keeps them transiently)
        code = str(r.get("code", ""))
        out.append({
            "ticker": code.replace("US.", ""),
            "qty": qty,
            # average_cost = original un-diluted entry (use for R). cost_price/
            # diluted_cost are netted by realized P&L and would inflate R wildly.
            "avg_cost": float(r.get("average_cost", r.get("cost_price", 0)) or 0),
            "diluted_cost": float(r.get("diluted_cost", 0) or 0),
            "nominal": float(r.get("nominal_price", 0) or 0),
            "unrealized_pl": float(r.get("unrealized_pl", 0) or 0),
            "realized_pl": float(r.get("realized_pl", 0) or 0),
            "today_pl_val": float(r.get("today_pl_val", 0) or 0),
            "pl_ratio_avg_cost": float(r.get("pl_ratio_avg_cost", 0) or 0),
        })
    return out


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


def classify(h: dict) -> dict:
    """Attach stop-status + urgency to one holding row."""
    last = h.get("last")
    after = h.get("after_price")
    stop = h.get("stop")
    atr = h.get("atr14")
    e8 = h.get("ema8")

    status, urgency, notes = "NO-STOP", "OK", []
    if stop and last:
        one_r = h["avg_cost"] - stop  # initial risk/share = entry - stop
        if one_r:
            # R's of profit (journal convention): (current - entry) / initial risk.
            h["R"] = round((last - h["avg_cost"]) / one_r, 2)
            if after:
                h["R_afterhours"] = round((after - h["avg_cost"]) / one_r, 2)
        # Regular-session break is the real signal; after-hours break is a heads-up.
        if last < stop:
            status, urgency = "BROKEN", "CUT"
            notes.append(f"last ${last:.2f} < stop ${stop:.2f} (regular-session break)")
        elif after and after < stop:
            status, urgency = "AH-BROKEN", "CUT-ON-OPEN"
            notes.append(f"after-hours ${after:.2f} < stop ${stop:.2f} - decide on the open, don't chase the AH print")
        elif atr and (last - stop) <= 0.3 * atr:
            status, urgency = "THREATENED", "WARN"
            notes.append(f"within 0.3 ATR of stop ${stop:.2f}")
        else:
            status, urgency = "INTACT", "OK"
    # MA-structure heads-up (works even without a journaled stop)
    if e8 and last and last < e8:
        notes.append(f"below 8EMA ${e8:.2f} (trail/structure soft-stop)")
        if urgency == "OK":
            urgency = "WARN"
    h["stop_status"], h["urgency"], h["notes"] = status, urgency, notes
    return h


URGENCY_RANK = {"CUT": 0, "CUT-ON-OPEN": 1, "WARN": 2, "OK": 3}


def main(argv=None):
    ap = argparse.ArgumentParser(description="Daily/overnight review of live broker holdings")
    ap.add_argument("--stops", default="", help="JSON map {TICKER: journaled_stop} (path or inline)")
    ap.add_argument("--json", action="store_true", help="Print full JSON instead of the table")
    ap.add_argument("--out", default="", help="Also write JSON to this path")
    args = ap.parse_args(argv)

    stops = _load_stops(args.stops)

    # Gather everything with stdout redirected to stderr so the moomoo SDK's
    # connection logging never pollutes a --json payload on stdout.
    import contextlib
    rows: list[dict] = []
    positions: list[dict] | None
    with contextlib.redirect_stdout(sys.stderr):
        positions = fetch_positions()
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
                    "atr14": tech.get("atr14"), "dist_21_atr": tech.get("dist_21_atr"),
                    "entry_risk": tech.get("entry_risk"), "rsi14": tech.get("rsi14"),
                    "macd_dir": tech.get("macd_dir"),
                    "pct_gain": round((last - p["avg_cost"]) / p["avg_cost"] * 100, 2) if (last and p["avg_cost"]) else None,
                    "stop": stops.get(t),
                }
                rows.append(classify(row))

    if positions is None:
        # Fail-closed: the freshness gate forbids analysing on missing live data.
        print("HOLDINGS REVIEW ABORTED — live broker data unavailable. Start OpenD and retry.", file=sys.stderr)
        sys.exit(2)
    if not positions:
        print("No open US holdings.")
        return

    rows.sort(key=lambda r: (URGENCY_RANK.get(r["urgency"], 9), -(r.get("R") or -99)))

    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"[holdings] wrote {args.out}", file=sys.stderr)
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return

    # Human-readable table
    as_of = next((r["as_of"] for r in rows if r.get("as_of")), "n/a")
    print(f"OPEN HOLDINGS REVIEW  (live as-of {as_of})")
    print(f"{'TKR':<6}{'qty':>5}{'avg':>9}{'last':>9}{'day%':>7}{'AH%':>7}{'gain%':>7}"
          f"{'R':>6}{'21ATR':>7}{'risk':>16}  {'STOP':>8} {'STATUS':<11} URGENCY / notes")
    for r in rows:
        ah = r.get("after_chg")
        print(
            f"{r['ticker']:<6}{r['qty']:>5.0f}{r['avg_cost']:>9.2f}{(r['last'] or 0):>9.2f}"
            f"{(r.get('change_pct') or 0):>7.2f}{(ah if ah is not None else 0):>7.2f}"
            f"{(r.get('pct_gain') or 0):>7.1f}{(r.get('R') if r.get('R') is not None else 0):>6.1f}"
            f"{(r.get('dist_21_atr') if r.get('dist_21_atr') is not None else 0):>7.2f}"
            f"{str(r.get('entry_risk') or ''):>16}  {(r.get('stop') or 0):>8.2f} "
            f"{r['stop_status']:<11} {r['urgency']}"
        )
        for n in r["notes"]:
            print(f"        - {n}")


if __name__ == "__main__":
    main()
