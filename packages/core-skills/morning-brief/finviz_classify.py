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
Only successful lookups are cached. A failed lookup falls back to the last good record.

Failure is never silent. Every Finviz miss raises FinvizUnavailable, whose `kind` says
why: bot_check, http, network, markup or dependency. Since 2026-09-30 finviz.com has
answered python-requests with Cloudflare's "Just a moment..." challenge (HTTP 403,
cf-mitigated: challenge) on every URL. That is a bot-check, not a markup change.

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
GROUPS_URL = "https://finviz.com/groups.ashx?g=industry&v=210&o=name&st=d1"
GROUP_ROW = re.compile(
    r'\{"ticker":"(?P<slug>[^"]+)","label":"(?P<label>[^"]+)"'
    r'.*?"perfT":(?P<d>-?[\d.]+),"perfW":(?P<w>-?[\d.]+),"perfM":(?P<m>-?[\d.]+)'
    r',"perfQ":(?P<q>-?[\d.]+)'
)


class FinvizUnavailable(RuntimeError):
    """Finviz served no usable data. `kind` is bot_check, http, network, markup or
    dependency; the message names the URL and what to do next."""

    def __init__(self, kind: str, detail: str):
        super().__init__(detail)
        self.kind = kind


def _is_bot_check(html: str) -> bool:
    """Cloudflare's managed-challenge interstitial, served instead of the page."""
    return "<title>Just a moment...</title>" in html or "/cdn-cgi/challenge-platform/" in html


def _fetch(url: str, timeout: int = 20) -> str:
    """GET a Finviz page, or raise FinvizUnavailable naming the exact failure."""
    if not _OK:
        raise FinvizUnavailable("dependency", "requests/beautifulsoup4 not installed")
    try:
        r = requests.get(url, headers=UA, timeout=timeout)
    except requests.RequestException as e:
        raise FinvizUnavailable("network", f"network error fetching {url}: {e}") from e
    if r.headers.get("cf-mitigated") == "challenge" or _is_bot_check(r.text):
        raise FinvizUnavailable(
            "bot_check",
            f"Cloudflare bot-check on {url} (HTTP {r.status_code}, "
            f"cf-mitigated={r.headers.get('cf-mitigated')}): Finviz served the "
            "'Just a moment...' challenge instead of data. Not a markup or URL change; "
            "scripts cannot pass it. Read the table via Chrome MCP.")
    if r.status_code != 200:
        raise FinvizUnavailable("http", f"HTTP {r.status_code} from {url}")
    return r.text


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


_EMPTY = {"sector": None, "industry": None, "country": None}


def _parse_quote(html: str, ticker: str) -> dict:
    """{sector, industry, country} from a quote page's header category links."""
    rec = dict(_EMPTY)
    vals = []
    for a in BeautifulSoup(html, "html.parser").select("a.quote-header_category"):
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
    if not rec["industry"]:
        raise FinvizUnavailable(
            "markup", f"quote page for {ticker} has no sector/industry links "
                      "(unlisted ticker or markup change)")
    return rec


def classify(tickers: list[str], throttle: float = 0.4) -> dict[str, dict]:
    """ticker -> {sector, industry, country}. Cached for CACHE_DAYS.

    A failed lookup never touches the cache. It returns the last good record (or None
    fields) plus "error" naming the failure. On 2026-10-20 a blocked run cached nulls
    with a fresh timestamp over good records, which would have served them for 30 days.
    After a bot-check the remaining lookups are skipped: every Finviz URL is challenged.
    """
    cache = _load_cache()
    fresh_after = (datetime.now() - timedelta(days=CACHE_DAYS)).isoformat()
    out: dict[str, dict] = {}
    dirty = False
    blocked: FinvizUnavailable | None = None

    for t in tickers:
        t = t.upper().strip()
        hit = cache.get(t) or {}
        # null records left by the 2026-10-20 bot-check are misses, never answers
        last_good = ({k: hit.get(k) for k in ("sector", "industry", "country")}
                     if hit.get("industry") else None)
        if last_good and hit.get("fetched_at", "") > fresh_after:
            out[t] = last_good
            continue
        if blocked:
            out[t] = {**(last_good or _EMPTY), "error": f"skipped after {blocked}"}
            continue
        try:
            html = _fetch(f"https://finviz.com/quote.ashx?t={t}", timeout=15)
            time.sleep(throttle)
            rec = _parse_quote(html, t)
        except FinvizUnavailable as e:
            if e.kind in ("bot_check", "dependency"):
                blocked = e
            print(f"  finviz classify {t} [{e.kind}]: {e}", file=sys.stderr)
            out[t] = {**(last_good or _EMPTY), "error": str(e)}
            continue
        cache[t] = {**rec, "fetched_at": datetime.now().isoformat()}
        dirty = True
        out[t] = rec

    if dirty:
        _save_cache(cache)
    return out


def parse_industry_performance(html: str) -> list[dict]:
    """Industries from a groups page, ranked by 1-month performance (desc).

    Finviz renders the groups table client-side from JSON embedded in the page
    (`FinvizInitGroupsPerformance([...])`); the legacy `tr.table-light-row-cp` rows no
    longer exist. Raises FinvizUnavailable instead of returning an empty list, so a
    blocked or changed page can never read as a flat market.
    """
    if _is_bot_check(html):
        raise FinvizUnavailable(
            "bot_check", "page is Cloudflare's 'Just a moment...' challenge, not the "
                         "groups table. Read the table via Chrome MCP.")
    rows: list[dict] = []
    seen: set[str] = set()
    for m in GROUP_ROW.finditer(html):
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
        title = re.search(r"<title>(.*?)</title>", html, re.S)
        raise FinvizUnavailable(
            "markup", f"groups page ({len(html)} bytes, title "
                      f"{title.group(1).strip()[:60] if title else None!r}) has no "
                      "FinvizInitGroupsPerformance JSON rows. Markup changed; fix the "
                      "parser or read the table via Chrome MCP.")
    rows.sort(key=lambda x: -x["perf_1m"])
    return rows


def industry_performance() -> list[dict]:
    """All Finviz industries ranked by 1-month performance (desc), live.

    Raises FinvizUnavailable with the specific reason. Never returns an empty list.
    """
    return parse_industry_performance(_fetch(GROUPS_URL))


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

    # operator WATCHLIST — the gap that mattered. On 2026-08-05 the screener universe
    # held 47 tickers and NONE of CRWD/NET/DDOG/PANW/ZS/OKTA/TENB/S/HPE/FFIV, while
    # cybersecurity was the #1 industry. Holdings + screener alone CANNOT see the theme.
    # watchlist.json is a CACHE refreshed by Step 0.0 via Chrome MCP, never a hand list.
    try:
        wl = Path(__file__).with_name("watchlist.json")
        if wl.exists():
            blob = json.loads(wl.read_text(encoding="utf-8"))
            out |= {t.upper() for t in blob.get("tickers", [])}
            from datetime import date
            upd = blob.get("updated")
            if upd:
                age = (date.today() - date.fromisoformat(upd)).days
                if age > 3:
                    print(f"  WARNING: watchlist.json is {age}d stale — refresh via Chrome MCP "
                          f"(Step 0.0). Theme coverage may be incomplete.", file=sys.stderr)
    except Exception as e:
        print(f"  (watchlist unavailable: {e})", file=sys.stderr)

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
    try:
        return _run(ap, a)
    except FinvizUnavailable as e:
        print(f"finviz unavailable [{e.kind}]: {e}", file=sys.stderr)
        return 2


def _run(ap: argparse.ArgumentParser, a: argparse.Namespace) -> int:
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
