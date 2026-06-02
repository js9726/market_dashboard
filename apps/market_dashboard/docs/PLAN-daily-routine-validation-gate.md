# Daily Routine Validation Gate

**Status:** Active gate for the next build phase
**Created:** 2026-06-02
**Related plan:** `PLAN-pre-open-ci-and-journal-revamp.md`

---

## Finding

Codex validation found a local-only freshness flaw: `start_premarket_routine.bat`
was syncing `snapshot.json` into the dashboard without first running
`build_data.py`. That allowed the dashboard to show fresh TV screeners and
breadth while VIX, indices, RVOL, Theme Radar, and Rotation could remain stale
locally.

## Fix Shipped

- Run `build_data.py --out-dir data` before TV screeners, breadth, and
  `sync:market`.
- Run `check_daily_freshness.py` after `sync:market`; fail the routine if
  backend or public `snapshot.json`, `tv_screeners.json`, or `breadth.json`
  are stale, malformed, missing, or suspiciously empty.
- Use `cli_run.py --provider deepseek-search --post` for the local automated
  brief so the AI/news section has web-search grounding instead of plain
  non-search DeepSeek output.
- Keep TV screeners and breadth fresh through the DB-backed `/api/screeners`
  and `/api/breadth` live paths.
- Commit refreshed static fallback artifacts after manual daily runs when the
  deployment should carry a fresh fallback (`public/market-dashboard/*.json`
  and charts).

## Validated Consumers

| Data producer | Dashboard consumer |
|---|---|
| `build_data.py` / `/api/market-snapshot` | Market Overview, Market Metrics, RVOL Overview, Theme Radar, Rotation Graph |
| `tv_screener_fetch.py` / `/api/screeners` | TV Screener Hits, screener-derived REC candidates |
| `breadth_scan_tv.py` / `/api/breadth` | Market Breadth, Momentum Breadth, Sector Momentum, Industry Rotation |
| `cli_run.py --provider deepseek --post` | Morning Brief provider tab and A-list extraction through brief ingest |
| `push_screener_picks.py --post` | Screener History / wiki screener picks |

## Next Workflow Fixes

- Replace the fragile CNN Fear & Greed-only fetch with a redundant source or a
  fail-closed display state. Current `build_data.py` can return
  `fear_greed: null` when CNN rejects the request.
- Tighten AI brief/news validation after generation so provider output may not
  label simulated news, ratings, or calendars as current market news. Missing
  news must render as unavailable/stale with source metadata, not invented
  context.
