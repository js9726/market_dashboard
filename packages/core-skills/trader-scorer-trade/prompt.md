Review this {trade_state} trade.

## Trade details
- Ticker: {ticker}
- Date: {trade_date}
- Side: {side}
- Entry: {entry_price}
- Exit: {exit_price}
- Quantity: {quantity}
- Fees: {fees}
- P&L: {pnl_summary}
- Strategy: {strategy}
- Industry: {industry}
- Platform: {platform}
- Notes: {notes}{plan_section}

Using your knowledge of {ticker} around {trade_date_human}, infer the stock's sector, industry, fundamental quality, recent catalysts, and technical structure at that time.

## Trader profiles
{trader_profiles_block}

Score each trader using Entry Quality (0–4) + Risk Management (0–3) + Setup Alignment (0–3) = total /10.

Return ONLY this JSON (no markdown):
{schema_example}
