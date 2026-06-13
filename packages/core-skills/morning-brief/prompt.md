You are generating a morning market brief for {date_str} for an active swing trader based in Malaysia (MYT = UTC+8).

PRE-FETCHED LIVE DATA — treat every value here as AUTHORITATIVE. Never override with web search.
Rules:
  • breadth.up   MUST equal the `advance` figure shown below — copy it exactly, never null if provided.
  • breadth.down MUST equal the `decline` figure shown below — copy it exactly, never null if provided.
  • indices[].level / changePct MUST come from the Indices block below where available.
  • sectorsThemes[].changePct / rs MUST come from the "Sector ETFs" block below where available.
  • watchlist[].level / changePct MUST come from the "Watchlist live prices" block below where available.
  • fearGreed.score / fearGreed.label MUST come from the Fear & Greed line below if provided.

{live_data_block}

Search the web ONLY for data NOT covered above: overnight Asia/Europe recap, earnings catalysts, analyst upgrades/downgrades, top pre-market movers with specific catalysts, macro events not in the events block. Then return ONE strict JSON object. No markdown fences, no explanation, no commentary outside the JSON.

OUTPUT SHAPE — every field is required unless marked optional. If you cannot find data for a field, return null (or [] for arrays) — never fabricate.

```json
{
  "mood": {
    "label": "RISK-ON" | "RISK-OFF" | "CHOPPY" | "TRENDING" | "CAUTIOUSLY-RISK-ON" | "CAUTIOUSLY-RISK-OFF",
    "posture": "GO" | "WAIT" | "PASS" | "RAISE-THE-BAR",
    "summary": "1-2 sentence read on today's tape — what's the single most important thing"
  },
  "breadth": {
    "up": <int|null>,        // # of advancing in your reference universe
    "down": <int|null>       // # of declining
  },
  "fearGreed": {
    "score": <0-100|null>,
    "label": "Extreme Fear" | "Fear" | "Neutral" | "Greed" | "Extreme Greed" | null
  },
  "indices": [
    { "symbol": "SPY", "name": "S&P 500", "level": <number|null>, "changePct": <number|null>, "note": "futures or live", "citation": "Source: Reuters 07:12 ET" }
    // include SPY, QQQ, DIA, IWM, ^VIX, ^TNX (10Y yield), CL=F (oil) where relevant
  ],
  "indicesNarrative": "1-3 sentences interpreting the index action — leadership, breadth, what's driving the tape",
  "technicals": {
    // Per-index daily-bar technicals — copy values from index_technicals.json verbatim.
    // Provided by compute_index_technicals.py at Step 0.5 of the skill.
    // Used by the dashboard to colour the entry-risk badge on each index card.
    "SPY": {
      "close": <number>, "atr14": <number>, "atr_pct": <number>,
      "ema21": <number>, "ema50": <number>, "ma200": <number|null>,
      "dist_21_atr": <number>, "dist_50_atr": <number>, "dist_200_atr": <number|null>,
      "rsi14": <number>, "macd": <number>, "macd_signal": <number>, "macd_hist": <number>,
      "macd_dir": "RISING"|"FALLING"|"FLAT",
      "curving_down": <bool>, "bear_cross_imminent": <bool>,
      "overbought": <bool>, "oversold": <bool>,
      "entry_risk": "EXTREME-EXTENDED"|"EXTENDED"|"FAIR"|"AT-MA"|"OVERSOLD-PB"|"UNKNOWN"
    }
    // repeat for QQQ, DIA, and any extras (IWM, SMH)
  },
  "technicalsNarrative": "1-3 sentences interpreting the per-index ATR/RSI/MACD picture. State which index is safest to enter (FAIR/AT-MA) vs dangerous (EXTREME-EXTENDED). Reference MACD curving-down or bear-cross-imminent if true. The dashboard renders entry-risk badges from these values — never fabricate.",
  "sectorsThemes": [
    { "symbol": "XLK", "name": "Technology", "changePct": <number|null>, "rs": <0-100|null>, "note": "1-line read" }
    // include relevant sector ETFs: XLK, SMH, XLC, XLY, XLF, XLV, XLI, XLE, XLP, XLU, XLB, XLRE
    // plus thematic: CIBR, IGV, IBB if topical
  ],
  "sectorsNarrative": "1-2 sentences — what's the rotation story",
  "industryNarrative": "1-2 sentences on the strongest and weakest industry groups below the sector layer",
  "industryMovers": [
    {
      "industry": "Semiconductors",
      "sector": "Technology",
      "changePct": <number|null>,
      "perf1W": <number|null>,
      "perf1M": <number|null>,
      "breadthPct": <number|null>,
      "deltaWow": <number|null>,
      "leaders": [
        { "ticker": "NVDA", "changePct": <number|null>, "rvol": <number|null>, "source": "TradingView Top Gainer" }
      ],
      "note": "1-line trader read on what is driving this industry"
    }
  ],
  "movers": [
    { "ticker": "NVDA", "side": "LONG" | "SHORT", "changePct": 5.2, "why": "earnings beat / upgrade / FDA / etc.", "traderLens": "Which trader style fits this setup (Minervini, Qullamaggie, etc.)" }
    // top 5 gainers + top 3 losers, with catalyst
  ],
  "watchlist": [
    { "ticker": "NVDA", "level": <number|null>, "changePct": <number|null>, "abc": "A"|"B"|"C"|null, "note": "Stage 2, near pivot, vol confirming" }
    // include all watchlist tickers passed in the prompt
  ],
  "traderLens": [
    { "name": "Minervini",   "view": "view on market structure / stage" },
    { "name": "Ted Zhang",   "view": "sector rotation play" },
    { "name": "Clement Ang", "view": "market context / entry grade" },
    { "name": "SRxTrades",   "view": "technical setup quality" },
    { "name": "Jeff",        "view": "discipline / rule reminder" },
    { "name": "Qullamaggie", "view": "breakout / EP momentum quality" },
    { "name": "Composite",   "view": "synthesised view — what should the trader actually DO today" }
  ],
  "standout": {
    "ticker": "NVDA" | null,
    "side": "LONG" | "SHORT" | null,
    "score": <0-100|null>,
    "sector": "Semis" | null,
    "rs": <0-100|null>,
    "grade": "A" | "B" | "C" | null,
    "thesis": "1-2 sentence setup description",
    "entry": <number|null>,
    "stop": <number|null>,
    "target": <number|null>,
    "rrr": <number|null>,
    "tags": ["#breakout", "#momentum"]
  },
  "earnings": {
    "bmo": [{ "ticker": "ABC", "consensus": "EPS $1.23 / Rev $4.5B" }],
    "amc": [{ "ticker": "XYZ", "consensus": "..." }],
    "yesterdayReactions": [{ "ticker": "TGT", "result": "beat 5%", "movePct": 3.2 }]
  },
  "calendar": [
    { "time": "08:30 ET", "name": "CPI YoY", "consensus": "3.2%" }
  ],
  "ratings": {
    "upgrades":   [{ "ticker": "AAPL", "firm": "Morgan Stanley", "rating": "Overweight", "pt": 250 }],
    "downgrades": [{ "ticker": "MSFT", "firm": "Goldman", "rating": "Neutral", "pt": 380 }]
  },
  "alert": "<short banner text|null>",
  "news": [
    {
      "headline": "Fed holds rates, signals one cut in 2026",
      "impact": "HIGH",                       // HIGH | MED | LOW — market-moving weight
      "tickers": ["SPY", "QQQ", "TLT"],       // tickers most affected (null if broad-macro)
      "source": "Reuters 08:30 ET — https://reuters.com/...",  // publisher + link
      "time": "08:30 ET"                       // when it broke (human or ISO)
    }
    // 3–6 of the single most market-moving items overnight + pre-market.
    // HIGH = moves the whole tape or a major sector (Fed, CPI/jobs, megacap
    // guidance cut, geopolitical shock, big M&A). MED = notable single-name or
    // group catalyst. Skip LOW-impact noise. Each item MUST be web-grounded
    // with a real source link — fabricated headlines are dropped.
  ],
  "screenerScores": {
    "TICKER": {
      "score": <0-100|null>,
      "verdict": "GO" | "WAIT" | "PASS" | null,
      "note": "1-sentence trader-lens read on the setup quality"
    }
    /* include ALL screener tickers that do NOT already have a score field in tv_screeners.json */
    /* GO = score >= 80 (strong momentum setup)  WAIT = 50-79  PASS = < 50 */
  },
  "citations": [
    "Reuters 07:12 ET — overnight Asia note",
    "Bloomberg 08:01 ET — Fed speakers"
  ]
}
```

TRADER STYLE FRAMEWORK (use to colour `traderLens` and `movers[].traderLens`):
- **Minervini**: Stage 2 uptrends, VCP, tight bases near highs, high RS. Won't buy in weak markets.
- **Ted Zhang**: Sector rotation, institutional flow.
- **Clement Ang**: Market context first; only A-grade setups in confirmed uptrends. Sits out chop.
- **SRxTrades**: Volume confirmation. Never chases. Waits for clean pivot entries.
- **Jeff**: Mechanical discipline, hard stops. No averaging down.
- **Qullamaggie**: Momentum breakouts + episodic pivots; ORH trigger, LOD stop, volume expansion.
- **Composite**: synthesised view — what should the trader actually DO today.

WATCHLIST: {watchlist_str}

SCREENER TICKERS TO SCORE: {screener_unscored_str}
These tickers appeared in today's TV screener run but were NOT auto-scored by the daily pipeline.
For each: apply the 7-trader composite lens (same framework as `traderLens`). Emit each in `screenerScores`
with `score` as a 0–100 integer (composite × 10), a `verdict` label, and a 1-sentence `note`.
Use the screener data already provided in `{live_data_block}` — no extra web search needed for these.

WEB-SEARCH BUDGET (session-bounded run): make AT MOST 4 web searches, run SEQUENTIALLY — never many parallel WebSearch calls at once. Batch related lookups: (a) overnight Asia/Europe + index futures + VIX + 10Y yield + oil; (b) top pre-market movers + their catalysts; (c) today's earnings (BMO/AMC) + high-importance economic calendar; (d) the most market-moving overnight/pre-market headlines + notable analyst rating changes. The wiki trader-style rubric (below) and screener scoring need NO web search — apply them from this skill + the pre-fetched data; do not degrade them.

SECTIONS — use pre-fetched data where provided; web-search only what is missing:
0. Index technicals: use the INDEX TECHNICALS block from {live_data_block} verbatim — copy each field into `technicals.<symbol>`. Write `technicalsNarrative` interpreting:
   - Which index has the WORST entry-risk (EXTREME-EXTENDED) — DO NOT chase that one
   - Which index is FAIR or AT-MA — entries there are higher quality
   - If RSI > 70: call out OVERBOUGHT; if MACD curving_down OR bear_cross_imminent: warn about momentum cooling
   - If indices are extended, posture should be `WAIT` or `TRIM_TIGHTEN`, NOT `GO`
1. Index snapshot: use Indices block above for SPY/QQQ/DIA/IWM/TLT daily%; web-search for VIX level, 10Y yield, oil price, and overnight futures direction
2. Overnight Asia + Europe: web-search — one "why" line per region; add a `note` on the relevant index entry
3. Sector ETFs: use "Sector ETFs" block for changePct/RS; add narrative interpretation
4. Industry movers: use "Top industry ETFs" block + web-search for leaders and one-line catalyst
5. Pre-market movers: web-search for top 5 gainers + 3 losers with specific catalyst (ticker, %, why)
6. Earnings on deck: web-search for BMO + AMC today and yesterday's reactions
7. Macro calendar: use events block if populated; web-search for any additional high-importance events today + tomorrow
8. Analyst upgrades/downgrades: web-search for top 3 of each today
9. Watchlist: use "Watchlist live prices" block for level/changePct; add 1-line setup note per ticker
10. Mood/posture: synthesise from all data above — state the single most important variable
11. Screener scores: score every unscored ticker listed in SCREENER TICKERS TO SCORE using the trader framework. Emit verdict as "GO" (score ≥ 80) / "WAIT" (50-79) / "PASS" (< 50) — never use BUY/HOLD/AVOID here
12. High-impact news: web-search for the 3–6 most market-moving news items from overnight + pre-market and emit them in `news`. Rank by impact (HIGH > MED), tag the affected `tickers`, and include a real `source` link for each. These feed the daily-journal "high-impact news" widget — only include items you can ground with a live citation; fabricated headlines are dropped.

RULES:
- Every numeric value must come from a real, recent web result — never fabricate.
- If something is unavailable, write `null` and add an entry to `citations` explaining ("data unavailable at generation time").
- NEWS GROUNDING (enforced post-generation): `earnings`, `ratings`, `calendar`, and `news` are dropped automatically unless `citations` includes a real live source citation (calendar also passes if a live events feed was supplied above). Placeholder citations such as "data unavailable" do not count. If you cannot cite a real source for an earnings result, analyst rating, economic event, or news headline, set that field to `null` (or omit the item from `news`) — do NOT invent it. Ungrounded sections are withheld and shown as "Unavailable", so fabricating them only loses you the section.
- Output ONLY the JSON object. The first character of your response MUST be `{`. The last character MUST be `}`.
- No prose. No markdown. No code fences.
