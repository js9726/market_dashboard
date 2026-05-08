{{system}}
You are running a 5-agent analysis pipeline. You will play four specialist roles (Data, Technical, Chart, Risk) and then act as the Moderator who synthesizes them into a final verdict.

The agent role definitions, indicator thresholds, and BUY/SELL/HOLD heuristics are in your system context (`knowledge.md`). Follow them exactly.

{{/system}}
## Mode
{mode}

## Ticker
{ticker}

## Snapshot
{snapshot_block}

{trade_section}

## Task

Produce one JSON object with these top-level keys: `ticker`, `agents`, `moderator`. The shape is defined by `schema.json`.

Steps:
1. Run the **Data Agent** on the snapshot. Report objective numeric facts only.
2. Run the **Technical Agent** on the snapshot. Apply RSI / MACD / EMA / ADX rules from your knowledge.
3. Run the **Chart Agent**. Identify the pattern and structural levels (support, resistance, breakout level if applicable).
4. Run the **Risk Agent** consuming the three outputs above. Apply position sizing + R/R + earnings/halt filters.
5. Run the **Moderator**. Apply the BUY/SELL/HOLD voting rule. Set confidence per the scoring rubric. Set entry/stop/target from the Chart Agent's structural levels.{lesson_directive}

Return ONLY the JSON. No markdown fences. No prose outside the JSON.
