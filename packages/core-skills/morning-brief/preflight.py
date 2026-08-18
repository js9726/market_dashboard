"""
preflight.py — CODE-ENFORCED gate for the morning brief.

The problem this solves
-----------------------
Every mandatory step in SKILL.md was PROSE. Prose is advice: an agent under time
pressure skips it and nothing notices. That is exactly how six consecutive empty GO
lists shipped while cybersecurity was the #1 industry.

This makes the checks executable and produces a RECEIPT. The rule is simple:

    NO VALID RECEIPT -> NO BRIEF.

Run it before generating a brief. It exits non-zero when a hard gate fails, so it can
sit in a shell chain (`python preflight.py && generate...`) or a scheduled task and
actually block, rather than politely suggesting.

Checks
------
  1. focus_list   — scan jie_wiki/sources/trading/charts/user-captures for TODAY-dated charts.
                    Jie's habit is to snap his focus list there; those tickers are
                    PRELIMINARY FOCUS and must reach the brief. Writes watchlist.json.
  2. watchlist    — exists and is <= 3 days old.
  3. themes       — Finviz industry ranking returns > 100 industries. Zero or a tiny
                    number means the scraper broke, NOT a flat market.
  4. universe     — the classified universe actually contains the operator's holdings
                    and focus names. A theme read over a universe that cannot contain
                    his theme is worthless (2026-08-05: 47 tickers, zero cyber leaders).
  5. empty_go     — count consecutive empty GO lists in recent daily reports. 3+ forces
                    an explicit "this may be a broken gate" statement in the brief.

Usage
-----
    python preflight.py                 # human output, exit 1 on hard failure
    python preflight.py --json          # machine receipt
    python preflight.py --wiki <path>   # override wiki location
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

WIKI_CANDIDATES = [
    Path(r"C:\Users\jiesh\AI codes hub\jie_wiki"),
    Path.home() / "AI codes hub" / "jie_wiki",
    Path.home() / "jie_wiki",
]
HERE = Path(__file__).parent
RECEIPT = HERE / "preflight_receipt.json"
MIN_INDUSTRIES = 100


def _wiki(override: str | None) -> Path | None:
    if override:
        p = Path(override)
        return p if p.exists() else None
    for c in WIKI_CANDIDATES:
        if c.exists():
            return c
    return None


def check_focus_list(wiki: Path | None) -> dict:
    """Today-dated charts in sources/trading/charts/user-captures = Jie's focus list."""
    if not wiki:
        return {"ok": False, "hard": True, "detail": "wiki not found; cannot read focus list"}
    raw = wiki / "sources" / "trading" / "charts" / "user-captures"
    if not raw.exists():
        return {"ok": False, "hard": True, "detail": f"missing {raw}"}
    today = date.today().isoformat()
    yday = (date.today() - timedelta(days=1)).isoformat()
    found: dict[str, str] = {}
    for f in raw.glob("*.png"):
        m = re.match(r"([A-Z][A-Z0-9.\-]{0,6})[_\-](\d{4}-\d{2}-\d{2})", f.name)
        if not m:
            continue
        tkr, d = m.group(1).upper(), m.group(2)
        # US session runs across the MY date boundary — accept today and yesterday
        if d in (today, yday):
            found.setdefault(tkr, d)
    return {
        "ok": True,
        "hard": False,
        "tickers": sorted(found),
        "count": len(found),
        "detail": (f"{len(found)} focus charts dated {today}/{yday}: {', '.join(sorted(found))}"
                   if found else
                   f"no charts dated {today} or {yday} — operator nominated nothing, or "
                   f"snapshots are going somewhere else. Say so in the brief."),
    }


def check_watchlist(focus: dict) -> dict:
    wl = HERE / "watchlist.json"
    merged: set[str] = set(focus.get("tickers") or [])
    prior: list[str] = []
    if wl.exists():
        try:
            blob = json.loads(wl.read_text(encoding="utf-8"))
            prior = [t.upper() for t in blob.get("tickers", [])]
            merged |= set(prior)
        except Exception:
            pass
    if merged:
        wl.write_text(json.dumps({
            "_contract": "CACHE. Refreshed by preflight from focus charts + Chrome MCP. Never hand-maintained.",
            "updated": date.today().isoformat(),
            "tickers": sorted(merged),
            "from_focus_charts": sorted(focus.get("tickers") or []),
        }, indent=1), encoding="utf-8")
    added = sorted(set(focus.get("tickers") or []) - set(prior))
    return {
        "ok": bool(merged),
        "hard": True,
        "count": len(merged),
        "added_from_focus": added,
        "detail": f"watchlist has {len(merged)} tickers"
                  + (f"; +{len(added)} new from today's focus charts: {', '.join(added)}" if added else ""),
    }


def check_themes() -> dict:
    try:
        sys.path.insert(0, str(HERE))
        from finviz_classify import industry_performance
        rows = industry_performance()
    except Exception as e:
        return {"ok": False, "hard": True, "detail": f"theme source raised: {e}"}
    n = len(rows)
    if n < MIN_INDUSTRIES:
        return {"ok": False, "hard": True, "count": n,
                "detail": f"only {n} industries parsed (expect >{MIN_INDUSTRIES}). "
                          f"SCRAPER BROKEN — escalate to Chrome MCP. This is NOT a flat market."}
    top = rows[:5]
    return {"ok": True, "hard": True, "count": n,
            "top": [{"industry": r["industry"], "perf_1m": r["perf_1m"]} for r in top],
            "detail": f"{n} industries; leader {top[0]['industry']} {top[0]['perf_1m']:+.1f}% 1M"}


def check_universe(focus: dict) -> dict:
    try:
        sys.path.insert(0, str(HERE))
        from finviz_classify import universe, classify
        uni = universe()
        must = set(focus.get("tickers") or [])
        missing = sorted(must - set(uni))
        cls = classify(uni) if uni else {}
        unclassified = sorted(t for t, v in cls.items()
                              if not v.get("industry") and t.isalpha() and len(t) <= 4)
    except Exception as e:
        return {"ok": False, "hard": True, "detail": f"universe build raised: {e}"}
    ok = not missing
    return {
        "ok": ok,
        "hard": True,
        "size": len(uni),
        "missing_focus": missing,
        "unclassified": unclassified[:10],
        "detail": (f"universe {len(uni)} tickers"
                   + (f"; MISSING focus names {missing} — they cannot reach the brief" if missing else "")
                   + (f"; {len(unclassified)} unclassified (scraper suspect): {', '.join(unclassified[:6])}"
                      if unclassified else "")),
    }


def check_empty_go(wiki: Path | None) -> dict:
    if not wiki:
        return {"ok": True, "hard": False, "detail": "wiki not found; skipped"}
    daily = wiki / "evidence" / "trading" / "daily-runs"
    if not daily.exists():
        return {"ok": True, "hard": False, "detail": "no daily history"}
    streak, checked = 0, []
    for d in sorted((p for p in daily.iterdir() if p.is_dir()), reverse=True)[:10]:
        rep = d / "report.md"
        if not rep.exists():
            continue
        try:
            txt = rep.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        seg = txt.split("## GO List", 1)
        if len(seg) < 2:
            continue
        body = seg[1].split("\n## ", 1)[0]
        rows = [ln for ln in body.splitlines()
                if re.match(r"^\|\s*[A-Z]{1,5}\s*\|", ln)]
        checked.append(d.name)
        if rows:
            break
        streak += 1
    return {
        "ok": streak < 3,
        "hard": False,
        "streak": streak,
        "sessions": checked,
        "detail": (f"{streak} consecutive EMPTY GO lists ({', '.join(checked[:streak])}). "
                   f"The brief MUST state this may be a broken gate, name the leading theme, "
                   f"and list green-zone (0.5-2.5 ATR) names."
                   if streak >= 3 else f"empty-GO streak {streak} — normal"),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--wiki")
    a = ap.parse_args()

    wiki = _wiki(a.wiki)
    focus = check_focus_list(wiki)
    checks = {
        "focus_list": focus,
        "watchlist": check_watchlist(focus),
        "themes": check_themes(),
        "universe": check_universe(focus),
        "empty_go": check_empty_go(wiki),
    }
    hard_fail = [k for k, v in checks.items() if v.get("hard") and not v.get("ok")]
    warn = [k for k, v in checks.items() if not v.get("hard") and not v.get("ok")]

    receipt = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "session_date": date.today().isoformat(),
        "status": "FAIL" if hard_fail else ("WARN" if warn else "PASS"),
        "hard_failures": hard_fail,
        "warnings": warn,
        "checks": checks,
    }
    receipt["receipt_hash"] = hashlib.sha256(
        json.dumps(receipt, sort_keys=True, default=str).encode()
    ).hexdigest()[:16]
    RECEIPT.write_text(json.dumps(receipt, indent=2, default=str), encoding="utf-8")

    if a.json:
        print(json.dumps(receipt, indent=2, default=str))
    else:
        print(f"\n  PREFLIGHT {receipt['status']}   receipt {receipt['receipt_hash']}   {receipt['generated_at']}\n")
        for k, v in checks.items():
            mark = "PASS" if v.get("ok") else ("FAIL" if v.get("hard") else "WARN")
            print(f"   [{mark:4s}] {k:12s} {v['detail']}")
        print()
        if hard_fail:
            print(f"  BLOCKED — do not generate a brief. Fix: {', '.join(hard_fail)}\n")
        elif warn:
            print("  Proceed, but the brief MUST carry the warnings above.\n")
    return 1 if hard_fail else 0


if __name__ == "__main__":
    raise SystemExit(main())
