You are simulating how 7 professional traders would assess today's market conditions ({date_str}).
Analyse the market snapshot below and produce a JSON verdict for each trader.

## Market snapshot
{market_context}

## Trader profiles
{trader_profiles_block}

## Task
For each of the 7 traders ({handles_list}), produce a verdict based on their specific style and the market data above.

- `verdict` must be exactly one of:
  - `YES` - enter new positions now
  - `WAIT` - stand aside
  - `SELECTIVE` - only the very best setups
  - `NO` - close longs / avoid
- `note` must be 1-2 tight sentences (<=180 chars) in that trader's voice - specific, actionable, referencing the actual data.
- Be consistent: the same snapshot should yield the same verdict if run again.

## Output
Return ONLY a raw JSON object - no markdown fences, no explanation, no preamble.
The JSON must match this exact schema:

{schema_example}

Rules:
- Include all 7 trader handles - no additions, no omissions.
- `open_positions` and `planning_entries` must be empty arrays - do not fabricate user portfolio data.
- Verdict labels must be uppercase: `YES | WAIT | SELECTIVE | NO`.
- Notes must not exceed 200 characters each.
