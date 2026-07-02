---
name: trader-primetrading
description: Score a trade through Alex Desjardins (@PrimeTrading_) lens — 21dma-structure pullbacks, no breakouts, liquid leaders only, soft structural stops. Knowledge body authored from his published swing-trading system, scans, and trading-psychology notes.
when-to-use: When the unified trade-review pipeline needs PrimeTrading_'s score (one of seven trader-persona scores). Also usable standalone via Claude Code when a single-trader read is wanted.
---

# Trader · @PrimeTrading_ (Alex Desjardins)

Scores a single trade against Alex Desjardins's published methodology: momentum + price action with the **21dma-structure** as the primary anchor, pullback-only entries, concentrated baskets of liquid leaders, soft structure-based stops.

## Inputs
See `schema.json` → `input`. Same trade shape used by `trader-scorer-trade` plus an optional `snapshot` block (price, distance to 21dma, RS rank, ATR, earnings days) so the scoring can be exact rather than inferred.

## Outputs
See `schema.json` → `output`. A single trader-review object:
- `entry_score` (0–4), `risk_score` (0–3), `setup_score` (0–3)
- `total_score` (0–10), `verdict` ∈ {GREAT ENTRY, GOOD ENTRY, ACCEPTABLE, POOR ENTRY, MISTAKE}
- 2–3 sentence `note` from Alex's perspective citing his rules
- `flags` — list of any specific violations (e.g., "extended >1×ATR from 21dma", "earnings within 7d", "below 21dma")

## Knowledge source
- `knowledge.md` — distilled from `jie_wiki/wiki/`:
  - `alex-swing-trading-system.md` (master framework)
  - `alex-scans-traderslab.md` (scan filters, RS composite, Liquid Leaders criteria)
  - `alex-trading-psychology.md` (discretion vs rules, drawdown handling)
  - `21dma-structure.md` (4 core behaviors, entry zone, stop logic)

## Mirror
A trimmed copy of `knowledge.md` is kept at `jie_wiki/wiki/persona-primetrading.md` for browsing alongside the source wiki pages. The skill does NOT read the wiki at runtime (SaaS portability rule); the runtime artifact is the committed `knowledge.md`.
