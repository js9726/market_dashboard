---
name: trader-scorer-market
description: Daily 7-trader market verdict (YES/WAIT/SELECTIVE/NO) on whether today's market conditions warrant new long entries.
when-to-use: Once per trading day after build_data.py produces snapshot.json. Drives the dashboard "Today's Verdict" surface.
---

# Trader Scorer — Market Verdict

Reads a daily market snapshot and asks each of the 7 trader personas to call the day. Output is a JSON verdict per trader plus a verdict source provenance field.

## Inputs
See `schema.json` → `input`. Two values vary per call: `date_str` (ISO date) and `market_context` (the multi-line text summary built from `snapshot.json`).

## Outputs
See `schema.json` → `output`. The same shape consumed today by the Today's Verdict UI: `{ date, traders: [{handle, verdict, note}], open_positions, planning_entries }`.

## Knowledge source
- `_shared/trader-profiles.json` — seven trader handles, names, and `styleLong` text.
- No wiki page; verdict labels are an editorial convention encoded in `prompt.md`.
