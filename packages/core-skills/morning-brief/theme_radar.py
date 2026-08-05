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


def _metrics(ctx, ticker: str, start: str, end: str) -> dict | None:
    from moomoo import KLType, AuType
    try:
        ret = ctx.request_history_kline(
            "US." + ticker, start=start, end=end,
            ktype=KLType.K_DAY, autype=AuType.QFQ, max_count=90,
        )
    except Exception:
        return None
    if ret[0] != 0:
        return None
    df = ret[1]
    if df is None or len(df) < 25:
        return None
    c = df["close"]
    ema21 = c.ewm(span=21).mean()
    tr = ((df["high"] - df["low"])
          .combine((df["high"] - c.shift()).abs(), max)
          .combine((df["low"] - c.shift()).abs(), max))
    atr = tr.rolling(14).mean().iloc[-1]
    if atr != atr or not atr:
        return None
    last = c.iloc[-1]
    return {
        "ticker": ticker,
        "last": round(float(last), 2),
        "w1": round(float(last / c.iloc[-6] - 1) * 100, 2),
        "m1": round(float(last / c.iloc[-22] - 1) * 100, 2),
        "m3": round(float(last / c.iloc[0] - 1) * 100, 2),
        "ext_atr": round(float((last - ema21.iloc[-1]) / atr), 2),
        "ema21_rising": bool(ema21.iloc[-1] > ema21.iloc[-6]),
    }


def zone(ext: float | None) -> str:
    if ext is None:
        return "n/a"
    if ext > 2.5:
        return "BLOCKED"
    if ext < 0.5:
        return "HALF-SIZE"
    return "GREEN"


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

    bench = _metrics(ctx, BENCH, s, e)
    if not bench:
        ctx.close()
        print("FAIL-CLOSED: could not price the benchmark. Do not report a theme read.",
              file=sys.stderr)
        return 2

    out: list[dict] = []
    for theme, (proxies, names) in THEMES.items():
        rows = [m for m in (_metrics(ctx, t, s, e) for t in proxies + names) if m]
        if not rows:
            continue
        prox = [r for r in rows if r["ticker"] in proxies]
        head = prox[0] if prox else rows[0]
        rel_1m = head["m1"] - bench["m1"]
        rel_3m = head["m3"] - bench["m3"]
        leading = rel_1m > 0 and rel_3m > 0 and head["ema21_rising"]
        tradeable = [r for r in rows if r["ticker"] not in proxies and zone(r["ext_atr"]) == "GREEN"]
        out.append({
            "theme": theme,
            "proxy": head["ticker"],
            "rel_1m": round(rel_1m, 2),
            "rel_3m": round(rel_3m, 2),
            "status": ("INDICATOR" if theme in INDICATOR_ONLY
                       else "LEADING" if leading else "LAGGING"),
            "tradeable_green": sorted(
                ({"ticker": r["ticker"], "ext_atr": r["ext_atr"], "m1": r["m1"]}
                 for r in tradeable), key=lambda r: -r["m1"]),
            "all_extended": bool(rows) and not tradeable,
            "names": sorted(rows, key=lambda r: -r["m1"]),
        })
    ctx.close()
    out.sort(key=lambda t: (t["status"] != "LEADING", -t["rel_1m"]))

    payload = {"benchmark": {"ticker": BENCH, **{k: bench[k] for k in ("m1", "m3")}},
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

    print(f"\n  THEME RADAR  |  benchmark {BENCH}: 1M {bench['m1']:+.2f}%  3M {bench['m3']:+.2f}%\n")
    print(f"  {'theme':18s}{'proxy':7s}{'rel 1M':>9s}{'rel 3M':>9s}  {'status':10s} tradeable (0.5-2.5 ATR)")
    print("  " + "-" * 92)
    for t in out:
        g = ", ".join(f"{x['ticker']}({x['ext_atr']})" for x in t["tradeable_green"][:5]) or "— none in zone —"
        print(f"  {t['theme']:18s}{t['proxy']:7s}{t['rel_1m']:>+8.2f}%{t['rel_3m']:>+8.2f}%  {t['status']:10s} {g}")
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
