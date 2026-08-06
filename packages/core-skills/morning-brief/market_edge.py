"""
market_edge.py — "where are my stats right now?"

Answers the ⑦ Market Edge checklist for Jie, splitting every signal into:
  AUTO   — this script measures it live and gives you the answer
  MANUAL — no free API; prints the exact URL to look at, and what to look for

Run before ticking the checklist:

    python market_edge.py            # human table
    python market_edge.py --json     # machine payload

Design note: three of the four "market edge" factors (MAs hold / volume dries up /
RS holds while market drops) are **per-NAME tests, not market-wide**. They belong to a
candidate, not to the tape. Pass --ticker to evaluate them for one name:

    python market_edge.py --ticker RBRK
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta

sys.stdout.reconfigure(encoding="utf-8")

MANUAL = [
    ("MCO hooked up from oversold", "$NYMO McClellan Oscillator",
     "https://stockcharts.com/h-sc/ui?s=$NYMO",
     "Look for the line turning UP from below -50/-100. The HOOK is the signal, not the extreme."),
    ("MCO stretched", "$NYMO — read the LEVEL, not a sigma",
     "https://stockcharts.com/h-sc/ui?s=$NYMO",
     "Use levels, not sigma: > +40 stretched, > +60 strong extreme, < -40 washed out, "
     "0 +/- 20 neutral. Sigma is unreliable here — the ratio-adjusted NYMO sigma cannot be "
     "measured from a free feed, so any 'x sigma' figure is a back-derivation, not a "
     "measurement (flagged 2026-08-06). Alex's '+1.6 sigma' corresponded to NYMO ~23."),
    ("MCSI above zero and rising", "$NYSI McClellan Summation",
     "https://stockcharts.com/h-sc/ui?s=$NYSI",
     "Above zero AND sloping up = the move has staying power."),
    ("% stocks above 5dma > 75%", "MEASURE IT — no 5-day series exists",
     "run: python breadth_ma.py",
     "StockCharts publishes $SPXA50R (50-DAY), NOT 5-day. Pointing at it for a 5-day "
     "question is the wrong metric (error made 2026-08-06). breadth_ma.py measures the real "
     "5/20/50-day figures off one TradingView scanner call; its 50-day agreed with $SPXA50R "
     "to 0.3pp on first run, which validates it."),
    ("Follow-Through Day confirmed", "index price+volume",
     "https://www.investors.com/market-trend/stock-market-today/",
     "Day 4-7 of an attempted rally, index +1.25%+ on HIGHER volume than prior day."),
    ("Proliferation (many names)", "your own screener count",
     "run: python finviz_classify.py --auto",
     "Many names clustering in top industries = proliferation. A couple = narrow."),
    ("Major event within 24h", "economic calendar",
     "https://www.forexfactory.com/calendar",
     "CPI / PCE / NFP / FOMC. Blocks new automated risk 60min before -> 30min after."),
]


def auto_signals(ticker: str | None = None) -> list[dict]:
    from moomoo import OpenQuoteContext, KLType, AuType
    out: list[dict] = []
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    start = (date.today() - timedelta(days=120)).strftime("%Y-%m-%d")
    end = date.today().strftime("%Y-%m-%d")

    def bars(t):
        try:
            r, df = ctx.request_history_kline("US." + t, start=start, end=end,
                                              ktype=KLType.K_DAY, autype=AuType.QFQ,
                                              max_count=120)[:2]
            return df if r == 0 and df is not None and len(df) >= 25 else None
        except Exception:
            return None

    # --- indices above a RISING 21-day ---
    rows = []
    for t in ("SPY", "QQQ", "IWM"):
        d = bars(t)
        if d is None:
            continue
        c = d["close"]; e = c.ewm(span=21).mean()
        rows.append((t, c.iloc[-1] > e.iloc[-1] and e.iloc[-1] > e.iloc[-6]))
    ok = bool(rows) and all(v for _, v in rows)
    out.append({"signal": "Indices above rising 21-day", "value": "YES" if ok else "NO",
                "detail": ", ".join(f"{t}:{'ok' if v else 'FAIL'}" for t, v in rows),
                "source": "AUTO (OpenD)"})

    # --- QQQE (equal weight) reclaimed 21dma-structure ---
    d = bars("QQQE")
    if d is not None:
        c = d["close"]; e = c.ewm(span=21).mean()
        ok = c.iloc[-1] > e.iloc[-1] and e.iloc[-1] > e.iloc[-6]
        out.append({"signal": "QQQE reclaimed 21dma-structure", "value": "YES" if ok else "NO",
                    "detail": f"QQQE {c.iloc[-1]:.2f} vs 21EMA {e.iloc[-1]:.2f}",
                    "source": "AUTO (OpenD)"})

    # --- theme performing (ex-health) ---
    try:
        sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent))
        from finviz_classify import industry_performance
        ind = industry_performance()
        if ind:
            top = ind[0]
            health = {"Biotechnology", "Drug Manufacturers - General", "Medical Devices"}
            lead_non_health = next((r for r in ind if r["industry"] not in health), top)
            out.append({"signal": "Theme performing (ex-health)",
                        "value": "YES" if lead_non_health["perf_1m"] > 0 else "NO",
                        "detail": f"#1 {lead_non_health['industry']} {lead_non_health['perf_1m']:+.1f}% 1M "
                                  f"(of {len(ind)} industries)",
                        "source": "AUTO (Finviz)"})
    except Exception as e:
        out.append({"signal": "Theme performing (ex-health)", "value": "?",
                    "detail": f"finviz unavailable: {e}", "source": "AUTO (failed)"})

    # --- per-NAME tests ---
    if ticker:
        d = bars(ticker)
        if d is None:
            out.append({"signal": f"[{ticker}] per-name tests", "value": "?",
                        "detail": "no data", "source": "AUTO (OpenD)"})
        else:
            c = d["close"]; v = d["volume"]
            e21 = c.ewm(span=21).mean()
            holds = c.tail(5).min() > e21.tail(5).min() * 0.99
            dry = v.tail(3).mean() < v.tail(20).mean()
            spy = bars("SPY")
            rs = None
            if spy is not None:
                n = min(10, len(c) - 1, len(spy) - 1)
                stock_ret = c.iloc[-1] / c.iloc[-n] - 1
                spy_ret = spy["close"].iloc[-1] / spy["close"].iloc[-n] - 1
                rs = stock_ret > spy_ret
            out += [
                {"signal": f"[{ticker}] Pullback HOLDS the MAs", "value": "YES" if holds else "NO",
                 "detail": f"5d low {c.tail(5).min():.2f} vs 21EMA {e21.iloc[-1]:.2f}", "source": "AUTO"},
                {"signal": f"[{ticker}] Volume DRIES UP", "value": "YES" if dry else "NO",
                 "detail": f"3d avg {v.tail(3).mean()/1e6:.1f}M vs 20d {v.tail(20).mean()/1e6:.1f}M", "source": "AUTO"},
                {"signal": f"[{ticker}] RS vs SPY (10d)", "value": "YES" if rs else "NO",
                 "detail": f"stock {stock_ret*100:+.1f}% vs SPY {spy_ret*100:+.1f}%" if rs is not None else "n/a",
                 "source": "AUTO"},
            ]
    ctx.close()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticker", help="also run the 3 per-NAME edge tests for this ticker")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    auto = auto_signals(a.ticker)
    manual = [{"signal": s, "value": "MANUAL", "detail": what, "source": url, "look_for": look}
              for s, what, url, look in MANUAL]

    if a.json:
        print(json.dumps({"auto": auto, "manual": manual}, indent=2))
        return 0

    print(f"\n  MARKET EDGE — status {date.today().isoformat()}\n")
    print("  AUTO-MEASURED (this script just checked these)")
    print("  " + "-" * 92)
    for r in auto:
        print(f"   {r['value']:>6s}  {r['signal'][:44]:46s} {r['detail'][:40]}")
    print()
    print("  MANUAL — no free API. Open the link, read the one thing named.")
    print("  " + "-" * 92)
    for r in manual:
        print(f"   {r['signal'][:44]:46s} {r['source']}")
        print(f"   {'':46s} -> {r['look_for']}")
    print()
    print("  Then tick ⑦ Market Edge in the tracker. B20 recomputes the REGIME,")
    print("  which drives your risk cap on ① Dashboard. Nothing else needs touching.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
