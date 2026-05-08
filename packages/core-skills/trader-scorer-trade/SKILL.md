---
name: trader-scorer-trade
description: Per-trade SEPA-rubric review — seven trader personas score one trade on Entry / Risk / Setup, returning structured JSON for the Review tab.
when-to-use: When the user opens a trade's review modal in the dashboard, or in batch via the journal sync flow.
---

# Trader Scorer — Trade Review

Given a single open or closed trade, this skill produces a SEPA-rubric review:
- Entry quality (0–4), Risk management (0–3), Setup alignment (0–3) → /10 per trader
- Best-match trader, weakest dimension, bull case, bear case
- Suggested entry plan with 4-tranche exit
- Overall weighted verdict + 1–2 sentence lesson

## Inputs
See `schema.json` → `input`. The full set of trade fields the dashboard captures (entry, exit, plan, risk, notes).

## Outputs
See `schema.json` → `output`. The structured review JSON written to `Trade.verdict` and `TradeVerdictHistory.verdict`.

## Knowledge source
- `_shared/trader-profiles.json` — seven trader handles, names, `styleShort`, and `dimensions`.
- The SEPA rubric (Entry / Risk / Setup scoring) is editorial; encoded in the system prompt (`knowledge.md`).
