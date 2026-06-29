Analyze this stock through 7 trader style lenses and return a catalyst-first JSON object.

{stock_context}

## Trader profiles
{trader_profiles_block}

## Catalyst-first requirements
Lead with the reasons this stock can make a large future move: earnings, sales, guidance, product launches, analyst upgrades/downgrades, insider buying from executives, partnerships, regulatory events, and sector/news catalysts.

Use only the fetched stock context for dated news, links, insider activity, institutional activity, analyst actions, and upcoming dates. If a field is not visible in the fetched source, return an empty array or an explanatory unverified flag. Do not invent URLs or dates.

Return ONLY this JSON structure (no markdown, no explanation):
{schema_example}
