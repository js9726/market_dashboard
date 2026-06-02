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

## Fixed (2026-06-02, continued from Codex handoff)

- **CNN Fear & Greed (shipped):** the bare `User-Agent` was rejected with HTTP
  418, so `build_data.py` returned `fear_greed: null`. `fetch_cnn_fear_greed()`
  now sends full browser headers (UA + Accept + Referer + Origin + Sec-Fetch-*)
  and retries once. On failure it returns a structured **fail-closed** object
  (`{value:null, label:"Unavailable", status:"unavailable", source:"cnn", as_of:null, error}`)
  instead of bare `null`. The `MarketMetricsDashboard` Fear & Greed card now
  branches on the value (not the truthy object) and renders an explicit
  "Unavailable · source: cnn" state — never a fake red gauge. The spurious
  `_BS4_AVAILABLE` gate (this endpoint is JSON, not HTML) was removed. Verified
  live: score 56.5 "greed"; `tsc --noEmit` clean. The freshness gate leaves F&G
  unchecked (sentiment is non-core), so an unavailable reading degrades
  gracefully without failing the routine.

## Next Workflow Fixes

- Tighten AI brief/news validation after generation so provider output may not
  label simulated news, ratings, or calendars as current market news. Missing
  news must render as unavailable/stale with source metadata, not invented
  context.
