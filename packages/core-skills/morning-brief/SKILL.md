---
name: morning-brief
description: Generate a daily HTML morning market brief via live web search across Gemini, OpenAI, and/or Claude.
when-to-use: Daily pre-market run (CI cron, Mon–Fri 8:30 AM ET) or manual refresh of the dashboard's Brief tab.
---

# Morning Brief

Renders the multi-provider morning-brief prompt that produces a 9-section HTML market briefing for an active trader. Provider invocation (Gemini Search Grounding, OpenAI web_search_preview, Claude web search beta) stays in the CLI caller because each SDK has different web-search tool wiring.

## Inputs
See `schema.json` → `input`. Two values vary per call: `date_str` (long-form date, e.g. "Wednesday, April 29, 2026") and `watchlist` (string array of tickers).

## Outputs
The `build_prompt` handler returns a prompt string. The actual provider responses are HTML snippets written to `morning_brief_<provider>.html` — outside this skill's contract because each provider has bespoke tool calls.

## Knowledge source
None — this skill encodes the dashboard's editorial format, not a wiki page. Trader-style references in the prompt are derived from `_shared/trader-profiles.json` content but kept inline for byte-equality with the legacy script.
