Analyze this stock through 7 trader style lenses and return a catalyst-first JSON object.

{stock_context}

## Trader profiles
{trader_profiles_block}

## Catalyst-first requirements
Lead with the reasons this stock can make a large future move: earnings, sales, guidance, product launches, analyst upgrades/downgrades, insider buying from executives, partnerships, regulatory events, and sector/news catalysts.

Use only the fetched stock context for dated news, links, insider activity, institutional activity, analyst actions, and upcoming dates. If a field is not visible in the fetched source, return an empty array or an explanatory unverified flag. Do not invent URLs or dates.

Hard completion gate: every response must fill the catalyst-first fields (ELI12, professional summary, theme/catalysts/fundamentals, recent events, insider/institutional activity, peer/sector trend, next catalysts, analyst changes, big-move reasons, and unverified flags). Do not silently omit unavailable sections.

Medical/biotech/healthcare/FDA-driven names are high-volatility special cases. Treat broad group strength as a rotation/speculation indicator first, not a normal GO reason. State commercial-product vs clinical-stage status where visible, mark binary regulatory/trial risk, require peer/sector confirmation, and downgrade if the move is only theme rotation or if insider selling appears into highs.

Return ONLY this JSON structure (no markdown, no explanation):
{schema_example}
