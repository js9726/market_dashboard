"""
theme_radar.py
==============
Rank trading THEMES by relative strength vs SPY, and flag which names sit in the
operator's tradeable extension zone.

Why this exists
---------------
From 2026-07-21 to 2026-08-04 the morning brief produced SIX consecutive EMPTY GO
lists while cybersecurity ran +40% to +102% over three months (SPY +7.3%). `CIBR`
was already in `fetch_opend_live.py`'s default ticker list the whole time — the
quote was fetched every morning and discarded, because `sectorsThemes` only ever
carried sector ETFs (XLK/SMH/XLF...). A sector ETF is not a theme, and neither is
the screener's `industry` field: "Packaged Software" spans VEEV, TOST, CRWD and ZS,
which trade nothing alike.

This script makes the theme read explicit and mechanical so it cannot be skipped.

Usage
-----
    python theme_radar.py                    # full radar, text output
    python theme_radar.py --json --out r.json
    python theme_radar.py --book OKTA,FFIV   # also bucket the operator's own book

Extension zones come from the operator's own 216-trade record (see SKILL.md 0.8d):
    < 0.5 ATR  -> HALF SIZE + confirmation required   (n=17, PF 0.31)
    0.5-2.5    -> GREEN, full size                    (n=35, PF 1.69-4.31)
    > 2.5 ATR  -> BLOCKED                             (n=6, ZERO wins)
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta

try:
    from _env_loader import load_env as _load_env
    _load_env()
except ImportError:
    pass

# ONE implementation of the extension measure, shared with the index technicals
# tool. Importing it is the point: two hand-rolled copies drifted apart once
# already (see _history below) and the divergence was invisible for weeks.
from compute_index_technicals import ema, extension_atr

# theme -> (proxy ETFs, constituents). Health is deliberately INDICATOR-only.
THEMES: dict[str, tuple[list[str], list[str]]] = {
    "Cybersecurity":   (["CIBR", "HACK"], ["CRWD", "PANW", "ZS", "OKTA", "NET", "FTNT", "S", "CYBR", "TENB", "RBRK"]),
    "Semis / AI":      (["SMH"],          ["NVDA", "AVGO", "AMD", "MRVL", "ALAB", "CRDO", "ARM"]),
    "Software / SaaS": (["IGV"],          ["SNOW", "DDOG", "MDB", "VEEV", "TOST", "U"]),
    "Nuclear / power": (["NLR"],          ["CEG", "LEU", "SMR", "TLN", "VRT"]),
    "Crypto-adjacent": (["WGMI"],         ["HUT", "CIFR", "GLXY", "CRCL", "IREN"]),
    "Quantum / space": ([],               ["IONQ", "RGTI", "ASTS", "RKLB"]),
    "Health (IND.)":   (["XBI", "IBB", "XLV"], ["LLY", "UNH", "VRTX"]),
}
BENCH = "SPY"
INDICATOR_ONLY = {"Health (IND.)"}


# Bars needed before a name is priceable at all (ATR(14) + EMA(21) seed).
MIN_BARS = 25
# Explicit SESSION anchors. The old code used `c.iloc[0]` for the 3M return, which
# silently meant "however long the calendar window happens to be" - about five
# months, not three (Codex audit, 2026-08-12).
SESSIONS_1W, SESSIONS_1M, SESSIONS_3M = 5, 21, 63
# Fail-closed freshness (CLAUDE.md: trading analysis stops on stale data). Wide
# enough for a weekend plus a market holiday, tight enough to catch a dead feed.
MAX_STALE_DAYS = 5


class StaleBars(RuntimeError):
    """Raised when the newest bar OpenD returned is too old to trade on."""

    def __init__(self, ticker: str, bar_date: str, age_days: int):
        super().__init__(
            f"{ticker}: newest daily bar is {bar_date} ({age_days} days old, "
            f"limit {MAX_STALE_DAYS})"
        )
        self.ticker, self.bar_date, self.age_days = ticker, bar_date, age_days


def _history(ctx, ticker: str, start: str, end: str) -> list[dict] | None:
    """
    The FULL daily history for [start, end], following OpenD's forward pagination.

    Returns bar records (same shape as compute_index_technicals.fetch_klines), not
    a DataFrame, so the rest of this module stays plain-list like its sibling.

    `max_count` caps one PAGE, and page 1 holds the OLDEST bars in the window. The
    previous code passed `max_count=90` into a ~105-bar window, never read the
    returned `page_req_key`, and then treated `.iloc[-1]` as "today" - so every
    metric was really computed three weeks in the past. On 2026-09-10 that put
    MDB/RBRK/ZS/TOST in the full-size green zone (+1.35 to +2.09 ATR, their
    2026-08-19 values) while all four were actually BELOW their 21EMA.
    """
    from moomoo import KLType, AuType, RET_OK

    bars: list[dict] = []
    key = None
    while True:
        ret = ctx.request_history_kline(
            "US." + ticker, start=start, end=end,
            ktype=KLType.K_DAY, autype=AuType.QFQ,
            max_count=1000, page_req_key=key,
        )
        if ret[0] != RET_OK:
            return None
        df = ret[1]
        if df is not None and len(df):
            bars.extend(df.to_dict("records"))
        key = ret[2] if len(ret) > 2 else None
        if not key:
            break
    return bars or None


def _metrics(ctx, ticker: str, start: str, end: str, today: date) -> dict | None:
    try:
        bars = _history(ctx, ticker, start, end)
    except Exception:
        return None
    if bars is None or len(bars) < MIN_BARS:
        return None

    closes = [float(b["close"]) for b in bars]
    highs = [float(b["high"]) for b in bars]
    lows = [float(b["low"]) for b in bars]

    as_of = str(bars[-1]["time_key"])[:10]
    try:
        age = (today - date.fromisoformat(as_of)).days
    except ValueError:
        return None
    if age > MAX_STALE_DAYS:
        raise StaleBars(ticker, as_of, age)

    def back(n: int) -> float | None:
        """Return over n completed sessions, or None when history is too short."""
        if len(closes) <= n:
            return None
        return round((closes[-1] / closes[-1 - n] - 1) * 100, 2)

    ext = extension_atr(highs, lows, closes, 21, 14)
    e21 = ema(closes, 21)
    rising = None
    if len(e21) > 6 and e21[-1] is not None and e21[-6] is not None:
        rising = bool(e21[-1] > e21[-6])

    return {
        "ticker": ticker,
        "as_of": as_of,
        "last": round(closes[-1], 2),
        "w1": back(SESSIONS_1W),
        "m1": back(SESSIONS_1M),
        "m3": back(SESSIONS_3M),
        # SIGNED. Negative = below the 21EMA, which is never the green zone.
        "ext_atr": round(ext, 2) if ext is not None else None,
        "ema21_rising": rising,
    }


def zone(ext: float | None) -> str:
    """
    Size gate from the operator's 216-trade record. `ext` is SIGNED, so anything
    below the 21EMA lands in HALF-SIZE - never GREEN.
    """
    if ext is None:
        return "n/a"
    if ext > 2.5:
        return "BLOCKED"
    if ext < 0.5:          # includes every negative reading (price under the 21EMA)
        return "HALF-SIZE"
    return "GREEN"


def _rel(a: float | None, b: float | None) -> float | None:
    """Relative return vs the benchmark; None if either leg is unknown."""
    return None if (a is None or b is None) else round(a - b, 2)


def _by_m1(r: dict) -> float:
    """Sort key: unknown 1M return sinks to the bottom instead of raising."""
    return -(r["m1"] if r["m1"] is not None else -1e9)


def _pct(v: float | None) -> str:
    return f"{v:>+8.2f}%" if v is not None else f"{'n/a':>9s}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--book", help="comma-separated tickers you actually hold")
    a = ap.parse_args()

    from moomoo import OpenQuoteContext
    end = date.today()
    start = end - timedelta(days=150)
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    s, e = start.strftime("%Y-%m-%d"), end.strftime("%Y-%m-%d")

    def _fail_stale(exc: StaleBars) -> int:
        ctx.close()
        print(f"FAIL-CLOSED (stale feed): {exc}", file=sys.stderr)
        print("  Producer: moomoo OpenD daily klines on 127.0.0.1:11111.", file=sys.stderr)
        print("  Repair the feed and re-run. Do not report a theme read.", file=sys.stderr)
        return 2

    try:
        bench = _metrics(ctx, BENCH, s, e, end)
    except StaleBars as exc:
        return _fail_stale(exc)
    if not bench:
        ctx.close()
        print("FAIL-CLOSED: could not price the benchmark. Do not report a theme read.",
              file=sys.stderr)
        return 2

    out: list[dict] = []
    try:
        for theme, (proxies, names) in THEMES.items():
            rows = [m for m in (_metrics(ctx, t, s, e, end) for t in proxies + names) if m]
            if not rows:
                continue
            prox = [r for r in rows if r["ticker"] in proxies]
            head = prox[0] if prox else rows[0]
            rel_1m = _rel(head["m1"], bench["m1"])
            rel_3m = _rel(head["m3"], bench["m3"])
            # Fail-closed: an unknown relative return is not evidence of leadership.
            leading = bool(rel_1m is not None and rel_1m > 0
                           and rel_3m is not None and rel_3m > 0
                           and head["ema21_rising"])
            tradeable = [r for r in rows
                         if r["ticker"] not in proxies and zone(r["ext_atr"]) == "GREEN"]
            out.append({
                "theme": theme,
                "proxy": head["ticker"],
                "as_of": head["as_of"],
                "rel_1m": rel_1m,
                "rel_3m": rel_3m,
                "status": ("INDICATOR" if theme in INDICATOR_ONLY
                           else "LEADING" if leading else "LAGGING"),
                "tradeable_green": sorted(
                    ({"ticker": r["ticker"], "ext_atr": r["ext_atr"], "m1": r["m1"]}
                     for r in tradeable), key=_by_m1),
                "all_extended": bool(rows) and not tradeable,
                "names": sorted(rows, key=_by_m1),
            })
    except StaleBars as exc:
        return _fail_stale(exc)
    ctx.close()
    out.sort(key=lambda t: (t["status"] != "LEADING",
                            -(t["rel_1m"] if t["rel_1m"] is not None else -1e9)))

    payload = {"as_of": bench["as_of"],
               "benchmark": {"ticker": BENCH,
                             **{k: bench[k] for k in ("as_of", "m1", "m3")}},
               "themes": out}

    if a.book:
        held = [t.strip().upper() for t in a.book.split(",") if t.strip()]
        # AUTOMATIC: Finviz classifies every ticker. No hand-maintained list, so a
        # name can never silently fall through as "unthemed" (Jie, 2026-08-05).
        try:
            from finviz_classify import classify, industry_performance
            cls = classify(held)
            perf = {r["industry"]: r for r in industry_performance()}
        except Exception as e:
            print(f"finviz classify unavailable: {e}", file=sys.stderr)
            cls, perf = {}, {}
        by_ind: dict[str, list[str]] = {}
        for t in held:
            ind = (cls.get(t) or {}).get("industry") or "UNCLASSIFIED"
            by_ind.setdefault(ind, []).append(t)
        ranked = sorted(perf.values(), key=lambda r: -r["perf_1m"])
        rank_of = {r["industry"]: i + 1 for i, r in enumerate(ranked)}
        payload["book"] = {
            "held": held,
            "by_industry": {
                ind: {
                    "tickers": ts,
                    "perf_1w": perf.get(ind, {}).get("perf_1w"),
                    "perf_1m": perf.get(ind, {}).get("perf_1m"),
                    "rank": rank_of.get(ind),
                    "of": len(ranked) or None,
                }
                for ind, ts in by_ind.items()
            },
            # curated overlay only ADDS resolution; it never gates coverage
            "theme_overlay": {
                th: [t for t in held if t in names or t in px]
                for th, (px, names) in THEMES.items()
                if any(t in names or t in px for t in held)
            },
            "top_industries": [
                {k: r[k] for k in ("industry", "perf_1w", "perf_1m")} for r in ranked[:5]
            ],
        }

    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2)
    if a.json:
        print(json.dumps(payload, indent=2))
        return 0

    print(f"\n  THEME RADAR  |  session {bench['as_of']}  |  benchmark {BENCH}: "
          f"1M {_pct(bench['m1']).strip()}  3M {_pct(bench['m3']).strip()}\n")
    print(f"  {'theme':18s}{'proxy':7s}{'rel 1M':>9s}{'rel 3M':>9s}  {'status':10s} tradeable (0.5-2.5 ATR)")
    print("  " + "-" * 92)
    for t in out:
        g = ", ".join(f"{x['ticker']}({x['ext_atr']})" for x in t["tradeable_green"][:5]) or "— none in zone —"
        print(f"  {t['theme']:18s}{t['proxy']:7s}{_pct(t['rel_1m'])}{_pct(t['rel_3m'])}  {t['status']:10s} {g}")
    print()
    for t in out:
        if t["status"] == "LEADING" and t["all_extended"]:
            print(f"  WAIT: {t['theme']} is leading but every name is >2.5 ATR extended. "
                  f"Do not chase — wait for a pullback into the green zone.")
    if payload.get("book"):
        b = payload["book"]
        print(f"\n  YOUR BOOK (auto-classified via Finviz — no manual list): {', '.join(b['held'])}")
        for ind, v in sorted(b["by_industry"].items(),
                             key=lambda kv: (kv[1]["rank"] is None, kv[1]["rank"] or 999)):
            r = f"#{v['rank']}/{v['of']}" if v["rank"] else "unranked"
            m = f"{v['perf_1m']:+.1f}% 1M" if v["perf_1m"] is not None else "no perf"
            print(f"    {ind[:38]:39s} {', '.join(v['tickers']):20s} {r:>9s}  {m}")
        if b["theme_overlay"]:
            print("    overlay:", "; ".join(f"{k}: {', '.join(v)}" for k, v in b["theme_overlay"].items()))
        print("\n  TOP INDUSTRIES NOW:")
        held_inds = set(b["by_industry"])
        for r in b["top_industries"]:
            mark = "  <- you hold this" if r["industry"] in held_inds else ""
            print(f"    {r['industry'][:38]:39s} {r['perf_1w']:+7.2f}% 1W {r['perf_1m']:+7.2f}% 1M{mark}")
        missing = [r["industry"] for r in b["top_industries"] if r["industry"] not in held_inds]
        if missing:
            print(f"    NOT in your book but top-ranked: {', '.join(missing[:3])}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
