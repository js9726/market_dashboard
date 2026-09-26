#!/usr/bin/env python3
"""measure_tickers.py - completed-bar measurements for named tickers.

The bot-box agents run in a locked-down permission mode and may only execute
allow-listed scripts. This is the one they use to measure a ticker, so it must be
deterministic, read-only and honest about data grade.

    python measure_tickers.py --tickers VEEV,TEAM
    python measure_tickers.py --tickers VEEV --peers IGV,CRM,NOW --source yahoo

Data grade
    full    moomoo OpenD on this machine (127.0.0.1:11111)
    public  Yahoo Finance via yfinance, used when OpenD is unreachable or --source yahoo

Rules this tool enforces rather than leaving to a model:
    * Only COMPLETED daily bars are measured. While the US regular session is open,
      today's bar is reported as live context and never feeds a gate
      (wiki/trading/traders/trader-styles.md, unfinished-bar veto).
    * Extension is (close - prior bar's 21EMA) / prior bar's ATR14, the doctrine's
      definition; >= 2.5 ATR is a veto (inclusive), and base > 18% with >= 1.5 ATR is
      the combined veto.
    * Nothing is estimated. A missing input is null, never a guess.

Output: one JSON document on stdout (or --out FILE). Exit 0 on success, 2 when no
data source is reachable.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
import time
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
VOLUME_GATE = 1.5
EXTENSION_VETO_ATR = 2.5
COMBINED_VETO_ATR = 1.5
COMBINED_VETO_BASE_PCT = 18.0
CLOSE_STRENGTH_REDLIGHT = 0.41
PROXIMITY_FLOOR_PCT = -25.0
LIQUIDITY_FLOOR_MUSD = 20.0


def last_completed_date(now_et: dt.datetime) -> str:
    """ET date of the most recent daily bar that has closed."""
    d = now_et.date()
    if now_et.weekday() < 5 and now_et.time() < dt.time(16, 0):
        d -= dt.timedelta(days=1)
    while d.weekday() >= 5:
        d -= dt.timedelta(days=1)
    return d.isoformat()


# ---------------------------------------------------------------- data sources
def fetch_opend(tickers: list[str], count: int = 300) -> dict[str, list[dict]]:
    from futu import AuType, KLType, OpenQuoteContext, SubType  # type: ignore

    out: dict[str, list[dict]] = {}
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    try:
        for t in tickers:
            code = f"US.{t}"
            for attempt in range(3):
                try:
                    ctx.subscribe([code], [SubType.K_DAY])
                    r = ctx.get_cur_kline(code, count, KLType.K_DAY, AuType.QFQ)
                except Exception as e:  # noqa: BLE001
                    r = (-1, str(e))
                if r[0] == 0:
                    df = r[1]
                    out[t] = [{"d": str(x[0])[:10], "o": float(x[1]), "h": float(x[2]), "l": float(x[3]),
                               "c": float(x[4]), "v": float(x[5])}
                              for x in df[["time_key", "open", "high", "low", "close", "volume"]].values.tolist()]
                    break
                time.sleep(2.0 * (attempt + 1))
            time.sleep(0.6)  # OpenD rate limit
    finally:
        ctx.close()
    return out


def fetch_yahoo(tickers: list[str]) -> dict[str, list[dict]]:
    import contextlib
    import logging

    import yfinance as yf  # type: ignore

    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    out: dict[str, list[dict]] = {}
    for t in tickers:
        # yfinance prints warnings to stdout; keep stdout reserved for the JSON document.
        with contextlib.redirect_stdout(sys.stderr):
            df = yf.Ticker(t).history(period="15mo", interval="1d", auto_adjust=True)
        if df is None or df.empty:
            continue
        out[t] = [{"d": idx.strftime("%Y-%m-%d"), "o": float(r.Open), "h": float(r.High), "l": float(r.Low),
                   "c": float(r.Close), "v": float(r.Volume)} for idx, r in df.iterrows()]
    return out


def opend_reachable() -> bool:
    import socket

    try:
        with socket.create_connection(("127.0.0.1", 11111), timeout=1.5):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------- measurement
def ema_series(vals: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    k, e = 2 / (n + 1), None
    for i, x in enumerate(vals):
        if i + 1 < n:
            out.append(None)
            continue
        e = sum(vals[:n]) / n if e is None else x * k + e * (1 - k)
        out.append(e)
    return out


def atr_series(s: list[dict]) -> list[float | None]:
    trs = [max(s[i]["h"] - s[i]["l"], abs(s[i]["h"] - s[i - 1]["c"]), abs(s[i]["l"] - s[i - 1]["c"]))
           for i in range(1, len(s))]
    out: list[float | None] = [None] * 15
    if len(trs) < 14:
        return [None] * len(s)
    a = sum(trs[:14]) / 14
    out[-1] = a
    for x in trs[14:]:
        a = (a * 13 + x) / 14
        out.append(a)
    return out[: len(s)]


def ret(s: list[dict], n: int) -> float | None:
    return None if len(s) < n + 1 else (s[-1]["c"] / s[-1 - n]["c"] - 1) * 100


def r2(v):
    return None if v is None else round(v, 2)


def measure(t: str, s: list[dict], spy: list[dict], live: dict | None) -> dict:
    if len(s) < 60:
        return {"ticker": t, "error": f"only {len(s)} completed bars"}
    c = [b["c"] for b in s]
    e8, e21 = ema_series(c, 8), ema_series(c, 21)
    e50 = ema_series(c, 50)
    atr = atr_series(s)
    b0, bp = s[-1], s[-2]
    rng = b0["h"] - b0["l"]
    cs = (b0["c"] - b0["l"]) / rng if rng > 0 else None
    avg20 = sum(b["v"] for b in s[-21:-1]) / 20
    rvol = b0["v"] / avg20 if avg20 else None
    prior_e21, prior_atr = e21[-2], atr[-2]
    ext = (b0["c"] - prior_e21) / prior_atr if (prior_e21 and prior_atr) else None
    w10 = s[-10:]
    base10 = (max(b["h"] for b in w10) - min(b["l"] for b in w10)) / min(b["l"] for b in w10) * 100
    hi52 = max(b["h"] for b in s[-252:])
    up = dn = 0.0
    for i in range(len(s) - 50, len(s)):
        if s[i]["c"] > s[i - 1]["c"]:
            up += s[i]["v"]
        elif s[i]["c"] < s[i - 1]["c"]:
            dn += s[i]["v"]
    ud = up / dn if dn else None
    slope = None if e21[-6] is None else ("RISING" if e21[-1] > e21[-6] else "FALLING")
    dv20 = sum(b["v"] * b["c"] for b in s[-20:]) / 20 / 1e6
    prior_hi20 = max(b["h"] for b in s[-21:-1])
    breakout = b0["c"] > prior_hi20 and (rvol or 0) >= VOLUME_GATE
    reclaim = bp["c"] <= (e21[-2] or 0) < b0["c"] and (rvol or 0) >= VOLUME_GATE

    look = spy[-45:]
    peak_d = look[max(range(len(look)), key=lambda i: look[i]["h"])]["d"] if look else None
    spy_by = {b["d"]: i for i, b in enumerate(spy)}
    ex = []
    for i in range(1, len(s)):
        d = s[i]["d"]
        j = spy_by.get(d)
        if peak_d is None or d < peak_d or j is None or j == 0 or spy[j]["c"] >= spy[j - 1]["c"]:
            continue
        ex.append((s[i]["c"] / s[i - 1]["c"] - 1) * 100 - (spy[j]["c"] / spy[j - 1]["c"] - 1) * 100)

    gates = {
        "extension_veto": "FAIL" if (ext is not None and ext >= EXTENSION_VETO_ATR) else ("UNKNOWN" if ext is None else "PASS"),
        "combined_base_veto": "FAIL" if (ext is not None and ext >= COMBINED_VETO_ATR and base10 > COMBINED_VETO_BASE_PCT) else "PASS",
        "volume_trigger": "PASS" if (rvol or 0) >= VOLUME_GATE else "FAIL",
        "close_strength": "FAIL" if (cs is not None and cs < CLOSE_STRENGTH_REDLIGHT and rng / b0["c"] * 100 > 2) else "PASS",
        "proximity": "PASS" if (b0["c"] / hi52 - 1) * 100 >= PROXIMITY_FLOOR_PCT else "FAIL",
        "accumulation": "UNKNOWN" if ud is None else ("PASS" if ud >= 1.0 else "FAIL"),
        "liquidity": "PASS" if dv20 >= LIQUIDITY_FLOOR_MUSD else "FAIL",
        "trend": "UNKNOWN" if slope is None else ("PASS" if slope == "RISING" else "FAIL"),
    }
    low10 = min(b["l"] for b in w10)
    stops = {}
    for name, level in (("last_bar_low", b0["l"]), ("low_10d", low10), ("prior_21ema", prior_e21)):
        if level and prior_atr:
            risk = b0["c"] - level
            stops[name] = {"level": r2(level), "risk_pct": r2(risk / b0["c"] * 100),
                           "risk_atr": r2(risk / prior_atr), "within_1_5_atr": risk / prior_atr <= 1.5}
    return {
        "ticker": t, "bar_date": b0["d"], "bar_complete": True,
        "close": r2(b0["c"]), "chg_pct": r2((b0["c"] / bp["c"] - 1) * 100),
        "close_strength": r2(cs), "range_pct": r2(rng / b0["c"] * 100), "rvol_full_day": r2(rvol),
        "ext_21ema_atr": r2(ext), "base10_pct": r2(base10), "atr_pct": r2(prior_atr / b0["c"] * 100) if prior_atr else None,
        "off_52w_high_pct": r2((b0["c"] / hi52 - 1) * 100), "ud_ratio_50d": r2(ud), "ema21_slope": slope,
        "above_8ema": b0["c"] > (e8[-1] or 0), "above_21ema": b0["c"] > (e21[-1] or 0),
        "above_50ema": None if e50[-1] is None else b0["c"] > e50[-1],
        "dollar_vol_20d_musd": r2(dv20), "prior_high_20d": r2(prior_hi20),
        "vs_spy_5d": r2(None if ret(s, 5) is None or ret(spy, 5) is None else ret(s, 5) - ret(spy, 5)),
        "vs_spy_20d": r2(None if ret(s, 20) is None or ret(spy, 20) is None else ret(s, 20) - ret(spy, 20)),
        "downday_excess_vs_spy": r2(sum(ex) / len(ex)) if ex else None, "downdays_n": len(ex),
        "trigger": "TRIGGERED(breakout)" if breakout else "TRIGGERED(reclaim)" if reclaim else "NOT_TRIGGERED",
        "trigger_note": "proxy: close above prior 20-session high, or 21EMA reclaim, on >= 1.5x; not the dashboard engine",
        "gates": gates, "stop_candidates": stops,
        "live_partial_bar": None if not live else {"date": live["d"], "last": r2(live["c"]),
                                                   "chg_pct": r2((live["c"] / b0["c"] - 1) * 100),
                                                   "note": "UNFINISHED bar: context only, cannot band above WATCH"},
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tickers", required=True, help="comma-separated, e.g. VEEV,TEAM")
    ap.add_argument("--peers", default="", help="comma-separated peer basket, measured the same way")
    ap.add_argument("--source", choices=("auto", "opend", "yahoo"), default="auto")
    ap.add_argument("--out", default="", help="write JSON here instead of stdout")
    a = ap.parse_args()

    names = [t.strip().upper() for t in a.tickers.split(",") if t.strip()]
    peers = [t.strip().upper() for t in a.peers.split(",") if t.strip()]
    wanted = list(dict.fromkeys(["SPY"] + names + peers))

    source = a.source
    if source == "auto":
        source = "opend" if opend_reachable() else "yahoo"
    grade = "full" if source == "opend" else "public"
    try:
        bars = fetch_opend(wanted) if source == "opend" else fetch_yahoo(wanted)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"data source {source} failed: {e}"}), file=sys.stderr)
        return 2
    if "SPY" not in bars:
        print(json.dumps({"error": f"no SPY data from {source}"}), file=sys.stderr)
        return 2

    now_et = dt.datetime.now(ET)
    cutoff = last_completed_date(now_et)
    spy = [b for b in bars["SPY"] if b["d"] <= cutoff]
    rows = []
    for t in names + peers:
        if t not in bars:
            rows.append({"ticker": t, "error": f"no data from {source} (delisted, renamed or unknown symbol?)"})
            continue
        comp = [b for b in bars[t] if b["d"] <= cutoff]
        live = next((b for b in bars[t] if b["d"] > cutoff), None)
        row = measure(t, comp, spy, live)
        row["role"] = "peer" if t in peers and t not in names else "subject"
        rows.append(row)

    doc = {
        "generated_at": now_et.isoformat(timespec="seconds"),
        "data_source": source, "data_grade": grade,
        "grade_note": ("full: moomoo OpenD on this machine" if grade == "full" else
                       "public: Yahoo Finance; chart-only fields (true RS Rating, authenticated chart) are absent, "
                       "so doctrine caps any band from this data at WATCH"),
        "last_completed_bar": cutoff, "rows": rows,
    }
    text = json.dumps(doc, indent=1)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fh:
            fh.write(text)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
