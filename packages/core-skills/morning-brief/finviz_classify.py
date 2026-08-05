"""
finviz_classify.py
==================
Automatic ticker -> (sector, industry) classification + live industry-performance
ranking, both from Finviz. No hand-maintained ticker lists.

Why this exists
---------------
theme_radar.py v1 bucketed the operator's book using a HARDCODED theme->ticker dict.
Jie flagged the obvious flaw: any ticker missing from that dict silently falls through
as "unthemed" — the exact stale-manual-list failure that caused the original
cybersecurity blind spot. Finviz already classifies every listed ticker and already
ranks ~145 industries by performance, so the classification should be derived, never
typed.

Two layers, deliberately:
  1. AUTOMATIC (this file)  — Finviz sector/industry per ticker + industry perf ranking.
                              Complete coverage, zero maintenance.
  2. OVERLAY (theme_radar)  — a small curated map for cases where a Finviz industry is
                              too coarse to be actionable. "Software - Infrastructure"
                              bundles CRWD/ZS/PANW/NET with plenty of non-cyber names,
                              so "cybersecurity" cannot be expressed as one industry.
Layer 1 guarantees nothing is ever dropped. Layer 2 only ever ADDS resolution.

Cache: classifications are stable, so they persist to finviz_cache.json (default 30d).

Usage
-----
    python finviz_classify.py --tickers OKTA,FFIV,MTLS
    python finviz_classify.py --industries          # ranked industry performance
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

try:
    import requests
    from bs4 import BeautifulSoup
    _OK = True
except ImportError:
    _OK = False

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
CACHE = Path(__file__).with_name("finviz_cache.json")
CACHE_DAYS = 30


def _load_cache() -> dict:
    if CACHE.exists():
        try:
            return json.loads(CACHE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_cache(c: dict) -> None:
    try:
        CACHE.write_text(json.dumps(c, indent=1), encoding="utf-8")
    except Exception:
        pass


def classify(tickers: list[str], throttle: float = 0.4) -> dict[str, dict]:
    """ticker -> {sector, industry, country}. Cached; misses return None fields."""
    if not _OK:
        print("requests/beautifulsoup4 missing — cannot classify.", file=sys.stderr)
        return {t: {"sector": None, "industry": None, "country": None} for t in tickers}

    cache = _load_cache()
    fresh_after = (datetime.now() - timedelta(days=CACHE_DAYS)).isoformat()
    out: dict[str, dict] = {}
    dirty = False

    for t in tickers:
        t = t.upper().strip()
        hit = cache.get(t)
        if hit and hit.get("fetched_at", "") > fresh_after:
            out[t] = {k: hit.get(k) for k in ("sector", "industry", "country")}
            continue
        rec = {"sector": None, "industry": None, "country": None}
        try:
            r = requests.get(f"https://finviz.com/quote.ashx?t={t}", headers=UA, timeout=15)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, "html.parser")
                cats = soup.select("a.quote-header_category")
                vals = []
                for a in cats:
                    href = a.get("href", "")
                    txt = a.get("title") or a.get_text(strip=True)
                    if "f=sec_" in href:
                        rec["sector"] = txt
                    elif "f=ind_" in href:
                        rec["industry"] = txt
                    elif "f=geo_" in href:
                        rec["country"] = txt
                    vals.append(txt)
                if not rec["sector"] and len(vals) >= 2:
                    rec["sector"], rec["industry"] = vals[0], vals[1]
            time.sleep(throttle)
        except Exception as e:
            print(f"  finviz classify {t}: {e}", file=sys.stderr)
        cache[t] = {**rec, "fetched_at": datetime.now().isoformat()}
        dirty = True
        out[t] = rec

    if dirty:
        _save_cache(cache)
    return out


def industry_performance() -> list[dict]:
    """All Finviz industries ranked by 1-month performance (desc).

    Finviz moved the groups table to a client-rendered JSON blob embedded in the page;
    the legacy `tr.table-light-row-cp` selectors now match ZERO rows. (This is the same
    breakage still present in `apps/market_dashboard_backend/scripts/build_data.py`
    `fetch_finviz_industry_performance()`, which fails silently to an empty dict.)
    Parse the embedded JSON instead.
    """
    if not _OK:
        return []
    url = "https://finviz.com/groups.ashx?g=industry&v=210&o=name&st=d1"
    try:
        html = requests.get(url, headers=UA, timeout=20).text
    except Exception as e:
        print(f"finviz industry perf error: {e}", file=sys.stderr)
        return []

    rows: list[dict] = []
    seen: set[str] = set()
    for m in re.finditer(
        r'\{"ticker":"(?P<slug>[^"]+)","label":"(?P<label>[^"]+)"'
        r'.*?"perfT":(?P<d>-?[\d.]+),"perfW":(?P<w>-?[\d.]+),"perfM":(?P<m>-?[\d.]+)'
        r',"perfQ":(?P<q>-?[\d.]+)',
        html,
    ):
        label = m.group("label").encode().decode("unicode_escape")
        if label in seen:
            continue
        seen.add(label)
        rows.append({
            "industry": label,
            "slug": m.group("slug"),
            "perf_1d": float(m.group("d")),
            "perf_1w": float(m.group("w")),
            "perf_1m": float(m.group("m")),
            "perf_3m": float(m.group("q")),
        })
    if not rows:
        print("finviz: parsed 0 industries — markup changed again, FAIL CLOSED",
              file=sys.stderr)
    rows.sort(key=lambda x: -x["perf_1m"])
    return rows


def universe(screeners_json: str | None = None, extra: list[str] | None = None) -> list[str]:
    """Every ticker worth classifying: live broker holdings + screener hits + extras.

    Classifying 3 holdings is near-useless (Jie, 2026-08-05). The signal is in where the
    whole CANDIDATE POOL clusters by industry — that is what reveals a theme before it is
    obvious in an index.
    """
    out: set[str] = set(t.upper() for t in (extra or []))

    # live broker holdings (best-effort; never fail the whole run on a broker miss)
    try:
        from moomoo import OpenSecTradeContext, TrdMarket, SecurityFirm, TrdEnv
        c = OpenSecTradeContext(filter_trdmarket=TrdMarket.US, host="127.0.0.1",
                                port=11111, security_firm=SecurityFirm.FUTUMY)
        r, d = c.position_list_query(trd_env=TrdEnv.REAL)
        if r == 0:
            out |= {str(x).replace("US.", "").upper() for x in d["code"].tolist()}
        c.close()
    except Exception as e:
        print(f"  (holdings unavailable: {e})", file=sys.stderr)

    # screener hits
    for cand in ([screeners_json] if screeners_json else []) + [
        "tv_screeners.json",
        "../../../apps/market_dashboard_backend/data/tv_screeners.json",
    ]:
        try:
            fp = Path(__file__).with_name(cand) if not Path(cand).is_absolute() else Path(cand)
            if not fp.exists():
                fp = Path(cand)
            if not fp.exists():
                continue
            blob = json.loads(fp.read_text(encoding="utf-8"))
            for sc in blob.get("screeners", []):
                for row in (sc.get("rows") or sc.get("hits") or []):
                    t = row.get("ticker")
                    if t and t.isalpha() and len(t) <= 5:
                        out.add(t.upper())
            break
        except Exception:
            continue
    return sorted(out)


def cluster(tickers: list[str]) -> list[dict]:
    """Group tickers by Finviz industry and rank the groups by live 1M performance."""
    cls = classify(tickers)
    perf = {r["industry"]: r for r in industry_performance()}
    ranked = sorted(perf.values(), key=lambda r: -r["perf_1m"])
    rank_of = {r["industry"]: i + 1 for i, r in enumerate(ranked)}
    buckets: dict[str, list[str]] = {}
    for t, v in cls.items():
        buckets.setdefault(v.get("industry") or "UNCLASSIFIED", []).append(t)
    rows = [{
        "industry": ind,
        "n": len(ts),
        "tickers": sorted(ts),
        "rank": rank_of.get(ind),
        "of": len(ranked) or None,
        "perf_1w": perf.get(ind, {}).get("perf_1w"),
        "perf_1m": perf.get(ind, {}).get("perf_1m"),
    } for ind, ts in buckets.items()]
    # densest clusters first, then strongest industry
    rows.sort(key=lambda r: (-r["n"], -(r["perf_1m"] if r["perf_1m"] is not None else -999)))
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers")
    ap.add_argument("--industries", action="store_true")
    ap.add_argument("--auto", action="store_true",
                    help="classify the FULL universe: holdings + screener hits")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.industries:
        rows = industry_performance()
        if a.json:
            print(json.dumps(rows, indent=2))
            return 0
        print(f"\n  {len(rows)} industries ranked by 1M performance\n")
        print(f"  {'industry':42s}{'1D':>8s}{'1W':>8s}{'1M':>8s}")
        print("  " + "-" * 66)
        for r in rows[:12]:
            print(f"  {r['industry'][:41]:42s}{r['perf_1d']:>7.2f}%{r['perf_1w']:>7.2f}%{r['perf_1m']:>7.2f}%")
        print("  ...")
        for r in rows[-5:]:
            print(f"  {r['industry'][:41]:42s}{r['perf_1d']:>7.2f}%{r['perf_1w']:>7.2f}%{r['perf_1m']:>7.2f}%")
        print()
        return 0

    if a.auto:
        uni = universe(extra=(a.tickers or "").split(",") if a.tickers else None)
        print(f"\n  UNIVERSE: {len(uni)} tickers (holdings + screener hits)\n")
        rows = cluster(uni)
        if a.json:
            print(json.dumps(rows, indent=2))
            return 0
        print(f"  {'industry':40s}{'n':>3s}{'rank':>9s}{'1W':>8s}{'1M':>8s}  tickers")
        print("  " + "-" * 100)
        for r in rows[:18]:
            rk = f"#{r['rank']}/{r['of']}" if r["rank"] else "—"
            w = f"{r['perf_1w']:+.1f}%" if r["perf_1w"] is not None else "—"
            m = f"{r['perf_1m']:+.1f}%" if r["perf_1m"] is not None else "—"
            print(f"  {r['industry'][:39]:40s}{r['n']:>3d}{rk:>9s}{w:>8s}{m:>8s}  {', '.join(r['tickers'][:7])}")
        print()
        hot = [r for r in rows if r["rank"] and r["rank"] <= 15 and r["n"] >= 2]
        if hot:
            print("  CLUSTERS IN TOP-15 INDUSTRIES (candidate pool agreeing with the tape):")
            for r in hot:
                print(f"    #{r['rank']:<3d} {r['industry'][:36]:37s} {r['n']} names: {', '.join(r['tickers'][:8])}")
            print()
        return 0

    if not a.tickers:
        ap.error("pass --tickers, --industries or --auto")
    res = classify([t for t in a.tickers.split(",") if t.strip()])
    if a.json:
        print(json.dumps(res, indent=2))
        return 0
    print()
    for t, v in res.items():
        print(f"  {t:7s} {str(v['sector']):26s} {str(v['industry'])}")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
