You are generating a morning market brief for {date_str} for an active swing trader based in Malaysia (MYT = UTC+8).

Search the web RIGHT NOW for real-time market data, then return ONE strict JSON object. No markdown fences, no explanation, no commentary outside the JSON.

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

SECTIONS YOU MUST RESEARCH (search the web for each — every numeric must trace to a citation):
1. Index snapshot: SPY/QQQ/DIA/IWM futures or live, VIX, 10Y, oil
2. Overnight Asia + Europe (one line "why" per region — set a `note` on each index entry)
3. Industry movers below the sector layer (top industry groups, leaders, one-line reason)
4. Pre-market movers (top 5 gainers + 3 losers with catalyst)
5. Earnings on deck (BMO + AMC + yesterday's reactions)
6. Macro calendar (today + tomorrow)
7. Analyst upgrades/downgrades (top 3 of each)
8. Watchlist standouts (each ticker, current price, 1-line setup)
9. Mood / posture / single most important variable to watch

RULES:
- Every numeric value must come from a real, recent web result — never fabricate.
- If something is unavailable, write `null` and add an entry to `citations` explaining ("data unavailable at generation time").
- Output ONLY the JSON object. The first character of your response MUST be `{`. The last character MUST be `}`.
- No prose. No markdown. No code fences.
