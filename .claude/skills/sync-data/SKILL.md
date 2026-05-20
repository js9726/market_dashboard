---
name: sync-data
description: Refresh market data end-to-end — runs build_data.py → morning_brief.py → npm run sync:market → grep for bare NaN. Use when the dashboard data looks stale or before previewing the brief locally.
---

# sync-data

Run the full data refresh pipeline and verify each step. Treat any non-zero exit code or unsanitized JSON as failure.

## Steps (run sequentially, abort on failure)

1. **Backend: build_data.py**
   ```bash
   cd "apps/market_dashboard_backend"
   python scripts/build_data.py --out-dir data
   ```
   Expect exit 0. Confirm `data/snapshot.json` exists and `data/charts/` has fresh PNGs.

2. **Backend: morning_brief.py** (non-fatal — continue on error)
   ```bash
   python scripts/morning_brief.py --out-dir data
   ```
   Confirm at least one `data/morning_brief_*.html` exists.

3. **NaN sanity check (LRN-001)**
   ```bash
   grep -c '\bNaN\b' apps/market_dashboard_backend/data/snapshot.json
   ```
   Must be **0**. If non-zero, halt — the sanitize step is broken; do not proceed.

4. **Frontend sync**
   ```bash
   cd "apps/market_dashboard"
   npm run sync:market
   ```
   Confirm `public/market-dashboard/snapshot.json` and `public/market-dashboard/morning_brief_*.html` are present and match backend timestamps.

5. **JSON parse validation**
   ```bash
   node -e "JSON.parse(require('fs').readFileSync('public/market-dashboard/snapshot.json','utf8')); console.log('OK')"
   ```
   Must print `OK`.

## Output

Print a summary table:
```
Step                  Status   Notes
build_data.py         ✓        snapshot 234KB, 18 charts
morning_brief.py      ✓        gemini, claude (openai skipped — no key)
NaN check             ✓        0 occurrences
sync:market           ✓        files copied
JSON parse            ✓        valid
```

If any step fails, print the failing step + stderr and stop.

## Reference
- Constraints: `.learnings/LEARNINGS.md` LRN-001 (numpy NaN survives if `.item()` not called)
- Plan: `C:\Users\jiesh\.claude\plans\locked-in-at-95-lexical-galaxy.md` § 5
