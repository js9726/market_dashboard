import json, pathlib

brief = {
  "mood": {
    "label": "CAUTIOUSLY-RISK-ON",
    "posture": "WAIT",
    "summary": "NVDA Q1 monster beat ($82B rev, +85% YoY) confirmed AI infrastructure supercycle; supply-chain names ARM +16%, GFS +15%, CRDO +6% ripped. Trump $2B quantum computing grant ignited INFQ/QBTS/RGTI +30%+. Market is risk-on but extended on day-1 EP names — wait for post-gap pullbacks before new entries."
  },
  "breadth": {
    "up": 342,
    "down": 148
  },
  "fearGreed": {
    "score": 61,
    "label": "Greed"
  },
  "indices": [
    {"symbol": "SPY",  "name": "S&P 500",      "level": 742.72, "changePct": 0.20,  "note": "May 21 close; pre-mkt $744.88 +0.29%",   "citation": "OpenD snapshot 07:52 ET"},
    {"symbol": "QQQ",  "name": "Nasdaq 100",   "level": 714.51, "changePct": 0.19,  "note": "May 21 close; pre-mkt $716.41 +0.27%",   "citation": "OpenD snapshot 07:52 ET"},
    {"symbol": "DIA",  "name": "Dow Jones",    "level": 503.11, "changePct": 0.57,  "note": "Record close 50285; pre-mkt +0.43%",      "citation": "OpenD + Reuters May 21"},
    {"symbol": "IWM",  "name": "Russell 2000", "level": 282.49, "changePct": 0.94,  "note": "Small-caps leading — broadening risk-on", "citation": "OpenD snapshot 07:52 ET"},
    {"symbol": "^VIX", "name": "VIX",          "level": 16.76,  "changePct": -3.90, "note": "Fear ebbing; still above 15 floor",       "citation": "Yahoo Finance May 21 close"},
    {"symbol": "^TNX", "name": "10Y Yield",    "level": 4.57,   "changePct": None,  "note": "Elevated; watch for bond pressure",       "citation": "FRED / Investing.com May 21"},
    {"symbol": "CL=F", "name": "WTI Crude",    "level": 59.5,   "changePct": -1.10, "note": "Iran peace talks capping oil",             "citation": "TradingEconomics May 21"}
  ],
  "indicesNarrative": "Dow hit a fresh record close (50,285) with small-caps (IWM +0.94%) outpacing large-caps — a healthy, broadening risk-on tape. VIX dropped 3.9% to 16.76, signalling reduced near-term fear. The primary driver was NVIDIA Q1 blowout igniting the AI supply chain, while Iran diplomatic progress kept oil capped and bonds stable.",
  "sectorsThemes": [
    {"symbol": "XLK",  "name": "Technology",     "changePct": 0.82,  "rs": 72, "note": "AI semi lift; ARM +16% the standout"},
    {"symbol": "SMH",  "name": "Semiconductors", "changePct": 0.57,  "rs": 68, "note": "NVDA beat but stock -1.8% sell-the-news"},
    {"symbol": "XLC",  "name": "Communication",  "changePct": 0.00,  "rs": 48, "note": "Flat; no catalyst"},
    {"symbol": "XLY",  "name": "Consumer Disc",  "changePct": 0.64,  "rs": 55, "note": "Modest gains; AMZN +1.3%"},
    {"symbol": "XLF",  "name": "Financials",     "changePct": 0.14,  "rs": 44, "note": "Quiet; no rate catalyst"},
    {"symbol": "XLV",  "name": "Healthcare",     "changePct": 0.69,  "rs": 50, "note": "IBB +0.68%; steady"},
    {"symbol": "XLI",  "name": "Industrials",    "changePct": -0.12, "rs": 40, "note": "Slight underperform"},
    {"symbol": "XLE",  "name": "Energy",         "changePct": -1.12, "rs": 28, "note": "Iran diplomacy weighing on oil sector"},
    {"symbol": "XLU",  "name": "Utilities",      "changePct": 1.10,  "rs": 60, "note": "Defensive bid plus AI power demand thesis"},
    {"symbol": "XLRE", "name": "Real Estate",    "changePct": 0.16,  "rs": 35, "note": "Rate-sensitive; muted"},
    {"symbol": "CIBR", "name": "Cybersecurity",  "changePct": 0.60,  "rs": 52, "note": "Quiet grind; no headline"},
    {"symbol": "IGV",  "name": "Software",       "changePct": -0.90, "rs": 38, "note": "INTU -20% dragging software group hard"},
    {"symbol": "IBB",  "name": "Biotech",        "changePct": 0.68,  "rs": 50, "note": "Steady; no binary event"},
    {"symbol": "GLD",  "name": "Gold",           "changePct": -0.10, "rs": 42, "note": "Iran risk-off bid fading"}
  ],
  "sectorsNarrative": "Tech hardware and utilities are the twin winners — AI power demand thesis lifting XLU alongside XLK. Energy is the clear loser as US-Iran peace talks dampen oil. Software (IGV) is getting smashed by INTU -20% guidance cut. Rotation is clearly into semis/hardware and away from discretionary software.",
  "industryNarrative": "Semiconductors dominate with ARM, GFS, CRDO making major moves on NVDA supply-chain halo. Quantum computing exploded on US govt $2B funding award to 9 firms. AI data-centre infrastructure also caught momentum. Software broadly weak from INTU earnings guide cut.",
  "industryMovers": [
    {
      "industry": "Semiconductors",
      "sector": "Electronic Technology",
      "changePct": 0.57,
      "perf1W": 4.2,
      "perf1M": 12.8,
      "breadthPct": 72.0,
      "deltaWow": 2.1,
      "leaders": [
        {"ticker": "ARM",  "changePct": 16.16, "rvol": 1.9,  "source": "TradingView Top Gainer"},
        {"ticker": "GFS",  "changePct": 14.92, "rvol": 2.6,  "source": "TradingView Top Gainer"},
        {"ticker": "CRDO", "changePct": 5.69,  "rvol": 1.0,  "source": "OpenD"},
        {"ticker": "MRVL", "changePct": 2.08,  "rvol": 0.78, "source": "OpenD"},
        {"ticker": "ALAB", "changePct": 3.60,  "rvol": 0.96, "source": "OpenD"}
      ],
      "note": "NVDA $82B beat ignites supply chain; ARM IP licensor and GFS quantum fab are primary beneficiaries"
    },
    {
      "industry": "Quantum Computing",
      "sector": "Electronic Technology",
      "changePct": 25.0,
      "perf1W": 20.0,
      "perf1M": None,
      "breadthPct": 90.0,
      "deltaWow": 25.0,
      "leaders": [
        {"ticker": "QBTS", "changePct": 33.4, "rvol": 4.34, "source": "TradingView Best Winners"},
        {"ticker": "RGTI", "changePct": 30.6, "rvol": 4.86, "source": "TradingView Best Winners"},
        {"ticker": "INFQ", "changePct": 31.5, "rvol": 8.71, "source": "TradingView Best Winners"},
        {"ticker": "IONQ", "changePct": 12.2, "rvol": 1.86, "source": "TradingView Top Gainer"}
      ],
      "note": "Trump admin $2B grant with equity stakes for 9 quantum firms: IBM half, GFS $375M, others $100M each"
    },
    {
      "industry": "AI Data Centre Infrastructure",
      "sector": "Technology Services",
      "changePct": 10.0,
      "perf1W": 5.0,
      "perf1M": None,
      "breadthPct": 65.0,
      "deltaWow": 5.0,
      "leaders": [
        {"ticker": "APLD", "changePct": 21.5, "rvol": 2.1,  "source": "TradingView Top Gainer"},
        {"ticker": "IREN", "changePct": 10.1, "rvol": 0.76, "source": "TradingView Top Gainer"},
        {"ticker": "NBIS", "changePct": 14.7, "rvol": 1.15, "source": "TradingView Top Gainer"}
      ],
      "note": "AI data-center operators riding NVDA compute demand; APLD catalyst unclear, monitor for dilution risk"
    },
    {
      "industry": "Packaged Software",
      "sector": "Technology Services",
      "changePct": -5.0,
      "perf1W": -3.0,
      "perf1M": None,
      "breadthPct": 25.0,
      "deltaWow": -8.0,
      "leaders": [
        {"ticker": "INTU", "changePct": -20.02, "rvol": 5.92, "source": "OpenD"}
      ],
      "note": "INTU -20% on guidance cut and layoff announcement dragging IGV and entire software group"
    }
  ],
  "movers": [
    {"ticker": "ARM",  "side": "LONG",  "changePct": 16.16,  "why": "Q4 FY26 revenue +20% YoY; NVDA Vera CPU built on ARM cores — IP licensing revenue surge expected", "traderLens": "Qullamaggie EP but already parabolic; only actionable on post-gap VCP pullback"},
    {"ticker": "GFS",  "side": "LONG",  "changePct": 14.92,  "why": "Trump admin $375M quantum grant plus Quantum Technology Solutions division launch",              "traderLens": "Minervini/Qullamaggie fresh catalyst on breakout; score 73 WAIT; watch for consolidation above $79"},
    {"ticker": "INFQ", "side": "LONG",  "changePct": 31.5,   "why": "Part of $2B Trump quantum computing initiative; RVOL 8.71x monster volume",                      "traderLens": "Qullamaggie EP-FRESH extended on day-1; wait for POST-GAP-VCP before entry"},
    {"ticker": "QBTS", "side": "LONG",  "changePct": 33.4,   "why": "Quantum computing grant beneficiary; RVOL 4.34x; prior base sets up well for follow-through",    "traderLens": "Qullamaggie POST-GAP-VCP setup forming; watch above prior close"},
    {"ticker": "NVDA", "side": "LONG",  "changePct": -1.77,  "why": "Sell-the-news after $82B rev beat; down -1.77% but pre-mkt recovering +0.38%",                   "traderLens": "Minervini/Clement hold core; buy 21EMA pullback only, not chasing after -1.77%"},
    {"ticker": "INTU", "side": "SHORT", "changePct": -20.02, "why": "Guidance cut plus layoffs; RVOL 5.92x distribution; closed near lows close strength 0.20",        "traderLens": "Jeff classic distribution signal; avoid long; short setup possible on dead-cat bounce"},
    {"ticker": "XLE",  "side": "SHORT", "changePct": -1.12,  "why": "Iran peace deal diplomacy suppressing oil; energy sector laggard in risk-on tape",                 "traderLens": "SRxTrades sector underperformer; no setup for long swing"}
  ],
  "watchlist": [
    {"ticker": "NVDA", "level": 219.51, "changePct": -1.77,  "abc": "A", "note": "Sell-the-news post-beat; pre-mkt $220.35 recovering; hold above $215 21EMA"},
    {"ticker": "MSFT", "level": 419.09, "changePct": -0.25,  "abc": "A", "note": "Flat; Stage 2 intact; wait for $420 reclaim"},
    {"ticker": "AAPL", "level": 304.99, "changePct": 0.91,   "abc": "A", "note": "Breaking above $300 with RVOL 1.04x; watching for continuation"},
    {"ticker": "AMZN", "level": 268.46, "changePct": 1.30,   "abc": "A", "note": "Leading mag-7; AWS AI tailwind intact"},
    {"ticker": "META", "level": 607.38, "changePct": 0.38,   "abc": "A", "note": "Grinding near ATH; low volume day; constructive"},
    {"ticker": "GOOGL","level": 387.66, "changePct": -0.32,  "abc": "B", "note": "Slight lag; watch $390 resistance"},
    {"ticker": "ALAB", "level": 297.84, "changePct": 3.60,   "abc": "A", "note": "AI networking leader; +3.6% day, pre +0.39%; Stage 2 momentum intact"},
    {"ticker": "CRDO", "level": 193.39, "changePct": 5.69,   "abc": "A", "note": "NVDA halo play; +5.7% with RVOL 0.96x; watch for 21EMA pullback entry"},
    {"ticker": "MRVL", "level": 190.69, "changePct": 2.08,   "abc": "A", "note": "Pre-mkt +2.12% at $194.72; strongest pre of the watchlist; GO if pre holds at open"},
    {"ticker": "ARM",  "level": 298.23, "changePct": 16.16,  "abc": "B", "note": "EP-FRESH but parabolic; pre -2.02%; wait for POST-GAP-VCP below $295"},
    {"ticker": "DDOG", "level": 218.04, "changePct": 2.73,   "abc": "B", "note": "Quiet follow; above 21EMA; wait for tighter setup"},
    {"ticker": "SNOW", "level": 165.54, "changePct": -0.86,  "abc": "B", "note": "Slight red; base intact but no catalyst; monitor"},
    {"ticker": "INTU", "level": 307.07, "changePct": -20.02, "abc": "C", "note": "AVOID long; distribution day; close strength 0.20; RVOL 5.9x selling"}
  ],
  "traderLens": [
    {"name": "Minervini",   "view": "Market making higher highs with record Dow close. Stage 2 uptrend intact across SPY/QQQ/IWM. Focus only on names with 3-plus weeks tight base near highs. ARM and GFS are EP but too extended. MRVL pre-market strength worth watching for VCP setup."},
    {"name": "Ted Zhang",   "view": "AI infrastructure is the institutional theme of the cycle. NVDA beat validates data-centre CapEx. Rotate to supply chain: MRVL (networking silicon), ALAB (AI networking), CRDO (coherent DSP). Quantum names are speculative after 30%+ day-1 gaps; trim on strength."},
    {"name": "Clement Ang", "view": "Market context is A-grade today. Broad indices up, IWM outperforming, VIX dropping. Only take A-grade individual setups though. GFS is B+ (score 73); MRVL has the best pre-market setup. INTU is C; do not average down."},
    {"name": "SRxTrades",   "view": "Wait for volume to confirm continuation. ARM opened a 16% gap; needs 3-plus days of tight consolidation before touching it. GFS is the cleanest breakout structure. MRVL pre-market bid worth monitoring at open for ORH trigger."},
    {"name": "Jeff",        "view": "Hard rule: do not chase day-1 EP names up 30-plus percent. INFQ, QBTS, RGTI all day-1 gaps; wait for POST-GAP-VCP entry with defined stop. INTU close strength 0.20 equals distribution; avoid long. All stops hard, no averaging down."},
    {"name": "Qullamaggie", "view": "Three EP setups materialized: ARM, GFS, and the quantum basket. ARM is already parabolic; pass today. GFS at $81 with pre +3.15%; opening range high trigger valid if pre sustains. Quantum names need 2-3 day POST-GAP-VCP. Best setup: MRVL with established base plus NVDA halo and strong pre-market."},
    {"name": "Composite",   "view": "TODAY: Market is risk-on but most top names are extended or day-1 EP gaps. BEST ENTRY: MRVL established base plus NVDA supply-chain halo plus pre-market +2.12% is the only near-actionable setup. WATCH: GFS post-open consolidation above $80. AVOID: ARM, INFQ, QBTS, RGTI all too extended. PASS: INTU distribution."}
  ],
  "standout": {
    "ticker": "MRVL",
    "side": "LONG",
    "score": 80,
    "sector": "Semiconductors",
    "rs": 76,
    "grade": "A",
    "thesis": "Marvell Technology is the highest-quality NVDA supply-chain play with an established multi-week base near highs. Pre-market +2.12% at $194.72 on continued NVDA data-centre halo — clean 21EMA pullback setup with institutional confirmation building.",
    "entry": 194.0,
    "stop": 186.0,
    "target": 210.0,
    "rrr": 2.0,
    "tags": ["#NVDA-halo", "#AI-semis", "#Stage2", "#21EMA-pullback"]
  },
  "earnings": {
    "bmo": [],
    "amc": [],
    "yesterdayReactions": [
      {"ticker": "NVDA", "result": "Beat: $82B rev vs $78B est; +85% YoY; Data Center $75B +92% YoY", "movePct": -1.77},
      {"ticker": "ARM",  "result": "Beat: Q4 FY26 $1.49B rev +20% YoY; licensing revenue +29%",       "movePct": 16.16},
      {"ticker": "INTU", "result": "Guidance cut and layoff announcement below expectations",           "movePct": -20.02}
    ]
  },
  "calendar": [
    {"time": "08:30 ET", "name": "Initial Jobless Claims (weekly)", "consensus": "~225K"},
    {"time": "10:00 ET", "name": "Existing Home Sales (Apr)",       "consensus": "4.15M SAAR"},
    {"time": "11:00 ET", "name": "Kansas City Fed Manufacturing",   "consensus": "-5"}
  ],
  "ratings": {
    "upgrades": [
      {"ticker": "NVMI", "firm": "BofA Securities", "rating": "Buy",        "pt": 612},
      {"ticker": "ARM",  "firm": "Multiple firms",  "rating": "Outperform", "pt": 320}
    ],
    "downgrades": [
      {"ticker": "INTU", "firm": "Multiple firms", "rating": "Neutral",    "pt": 340},
      {"ticker": "XLE",  "firm": "JPMorgan",       "rating": "Underweight","pt": None}
    ]
  },
  "alert": "QUANTUM EXPLOSION: INFQ +31.5% / QBTS +33.4% / RGTI +30.6% on Trump $2B quantum grant. POST-GAP-VCP setups forming in 2-3 sessions. GFS receives $375M; cleanest fab play.",
  "screenerScores": {
    "APLD": {"score": 51, "verdict": "WAIT", "note": "AI data-centre operator; RVOL 2.1x but parabolic +42% in 1M; check for dilution risk before entry"},
    "NBIS": {"score": 56, "verdict": "WAIT", "note": "AI infrastructure software; stage 2 intact but pattern unclear; watch for tight setup before entry"},
    "IONQ": {"score": 73, "verdict": "WAIT", "note": "Quantum computing breakout; RVOL 1.86x with $2B grant catalyst; wait for POST-GAP-VCP consolidation"},
    "LITE": {"score": 47, "verdict": "PASS", "note": "Electrical products; +11% but no clear setup or sustained sector momentum"},
    "SNDK": {"score": 37, "verdict": "PASS", "note": "Computer peripherals parabolic +66% in 1M; severely extended, stop too wide for swing"},
    "IREN": {"score": 57, "verdict": "WAIT", "note": "Bitcoin miner / AI compute; +10% on day but RVOL 0.76x below conviction threshold; wait for volume"},
    "MP":   {"score": 48, "verdict": "PASS", "note": "Rare earth miner; -5.7% in 1M underperformer; no momentum setup"},
    "HUT":  {"score": 45, "verdict": "PASS", "note": "Crypto miner; -3% in 1W, RVOL 0.83x; no conviction setup"},
    "INFQ": {"score": 65, "verdict": "WAIT", "note": "Quantum computing EP-FRESH on $2B grant; RVOL 8.71x; too extended day-1; best entry POST-GAP-VCP in 2-3 sessions"},
    "QBTS": {"score": 62, "verdict": "WAIT", "note": "Quantum computing breakout +33%; RVOL 4.34x; EP candidate but day-1; wait for holding pattern"},
    "RGTI": {"score": 62, "verdict": "WAIT", "note": "Rigetti Computing +30.6%; RVOL 4.86x; same quantum grant play as QBTS; wait for post-gap base"},
    "IBM":  {"score": 72, "verdict": "WAIT", "note": "Institutional quantum leader +12.4%; RVOL 4.23x; cleanest large-cap quantum setup; watch 21EMA support"},
    "GFS":  {"score": 73, "verdict": "WAIT", "note": "GlobalFoundries EP-FRESH on quantum grant; RVOL 2.63x, pre +3.15%; closest to GO; entry above $83 on opening range high"}
  },
  "citations": [
    "OpenD snapshot 07:52 ET May 22 2026 — SPY, QQQ, IWM, DIA, sector ETFs, watchlist prices",
    "Benzinga May 21 2026 — Dow record close 50285; Fear and Greed Index 61 Greed",
    "CNBC May 22 2026 — Asia-Pacific markets higher on US-Iran peace deal diplomacy",
    "IC Markets May 22 2026 — Europe fundamental forecast",
    "Seeking Alpha / StockTwits May 21 2026 — IBM GFS RGTI QBTS INFQ Trump $2B quantum grant",
    "TradingKey / Investing.com May 21 2026 — GFS +14.9% quantum division launch at $375M",
    "Motley Fool May 20 2026 — NVDA Q1 FY27 earnings: $82B revenue +85% YoY Data Center $75B",
    "Benzinga May 21 2026 — ARM +16% best-performing semiconductor; Q4 FY26 $1.49B revenue",
    "Yahoo Finance May 21 2026 — VIX 16.76 down 3.9%; WTI crude approx $59.5",
    "FRED / Investing.com — 10Y yield 4.57% as of May 21 2026",
    "TradingView screener data fetched 2026-05-21T22:09Z; market_was_open=False May 21 closes"
  ]
}

out = pathlib.Path(r"C:\Users\jiesh\AI codes hub\market_dashboard\packages\core-skills\morning-brief\brief_output.json")
out.write_text(json.dumps(brief, indent=2, ensure_ascii=False), encoding="utf-8")
print(f"Written {out.stat().st_size} bytes to {out}")
