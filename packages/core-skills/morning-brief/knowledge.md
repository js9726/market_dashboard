# Morning Brief - Editorial Format Notes

This skill encodes the dashboard's pre-market briefing format. There is no upstream wiki page; the format itself (9 sections, scoped CSS classes, trader-style framework) is the knowledge.

## Sections (in order)

1. Index Snapshot
2. Overnight Asia & Europe - The Why
3. Pre-Market Movers
4. Earnings on Deck
5. Fed & Macro Calendar - This Week
6. Analyst Upgrades / Downgrades
7. My Watchlist
8. What to Watch - Market Mood (editorial closer)

## Style rules

- Scoped CSS - every class is prefixed `.brief` so the snippet doesn't bleed into surrounding dashboard styles.
- Numbers are color-coded: `b-up` (green), `b-down` (red), `b-neutral` (grey).
- Each data point cites its source inline via `<span class="b-cite">`.
- "(data unavailable at generation time)" is the only acceptable substitute for missing data - never fabricate.

## Trader-style framework

Seven trader lenses are referenced in pre-market movers and the Section 8 closer. The handles match `_shared/trader-profiles.json`, but the brief uses short editorial summaries kept inline in `prompt.md` rather than the full `styleLong` text. This is intentional, since the brief is a fast read, not an analysis.
