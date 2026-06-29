---
name: trader-scorer-stock
description: Per-ticker fundamental + technical analysis through 7 trader-style lenses. Returns score (1–10), verdict, and entry plan.
when-to-use: When the user submits a ticker on the Stock Analysis tab.
---

# Trader Scorer — Stock Analysis

Given a Yahoo Finance summary blob, this skill produces a catalyst-first ticker read plus seven-trader scoring:
- ELI12 company explanation and professional summary
- Hot theme, catalysts, significant fundamentals, big-move reasons, and source gaps
- Last 3 months news/events, insider/institutional activity, peer/sector trend, upcoming catalysts, and analyst changes
- Per-trader score (1–10) + verdict (STRONG BUY → STRONG AVOID) + 2–3 sentence note
- Suggested entry plan (zone, stop, target, R/R, batching)
- Bulls / bears bullets, composite score, best-match trader

## Inputs
See `schema.json` → `input`. The pre-formatted `stock_context` block built from `yahoo-finance2` `quoteSummary` plus the raw display fields used to seed the JSON example.

## Outputs
See `schema.json` → `output`. JSON consumed by the Stock Analysis tab.

## Knowledge source
- `_shared/trader-profiles.json` — seven trader handles + `styleShort`.
- The trader-style framework is editorial; encoded in the system prompt (`knowledge.md`).
