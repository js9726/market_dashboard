# Knowledge: Alex Desjardins (@PrimeTrading_) — methodology

Source: `wiki/alex-swing-trading-system.md`, `wiki/alex-scans-traderslab.md`, `wiki/alex-trading-psychology.md`, `wiki/21dma-structure.md`
Synced: 2026-05-02

---

# Alex Desjardins (@PrimeTrading_) — methodology

Six core principles: (1) Market phase overrides all setups. (2) Price structure and price action override all indicators. (3) No breakouts — edge is exclusively in pullbacks to 21dma. (4) Early unrealized gains are cushion that funds subsequent adds. (5) Defense is offense — small drawdowns compound; large ones don't recover. (6) Play process, not outcome.

---

## Universe filter

**Liquid Leaders scan** — stock must pass all of the following to be tradeable:

| Filter | Threshold |
|---|---|
| RS Rank | Top composite (Alex's RS composite) |
| Daily liquidity | ≥ $250M |
| Avg daily volume | ≥ 1M shares |
| ADR | 3% – 12% |
| Price | > $5 |
| Market cap | > $10B |
| Excluded sectors | China, HK, Biotech, Defensive, Real Estate, Healthcare, Energy, Financials |

- Active watchlist: 30–40 names in a strong market; FocusList narrows to 5 names per night.
- Breadth proxy: QQQE (equal-weight Nasdaq-100) preferred over QQQ.
- Episodic Pivot additions (opportunistic, outside normal universe): daily liquidity ≥ $20M, market cap > $500M, daily return > 10%, daily closing range > 20%, distance from 52-week high within 20%, relative volume > 2.5x, earnings 7+ days away.

---

## Setup recognition

**The 4 core 21dma behaviors** (these are the only recognized setups):

1. **Pullback into rising 21dma** — healthy trend continuation; primary entry signal.
2. **Reclaim & Backtest** — stock broke below 21dma, reclaimed it, and backtests from above; bullish.
3. **Reject & Higher Low** — price rejected at 21dma but holds a higher low; trend may still be intact; watch, don't necessarily enter.
4. **Reject & Lower Low** — failed reclaim, trend breaking down; reduce/exit exposure.

**Pullback variants within behaviors 1 and 2:**
- "Liquid Leaders 21dma Pullback" is the primary scan-driven entry type.
- Price must be coiling (contraction in last 5 days) before the entry attempt.

**Out of scope — explicitly NOT his style:**
- Breakout entries (breakout chasing is categorically excluded from this system).
- Any setup not anchored to the 21dma structure.
- Entries in stocks not in the Liquid Leaders universe (except Episodic Pivot, which has its own criteria above).

---

## Entry criteria

All of the following must be satisfied (from Liquid Leaders 21dma Pullback scan):

| Check | Threshold |
|---|---|
| Distance from 21ema | 0 to 1× ATR |
| Distance from 50sma | -0.5 to 4× ATR |
| 21ema slope | Advancing (rising) |
| 10wma slope | Advancing (rising) |
| Daily closing range | > 10% |
| Price contraction | Last 5 days |
| Weekly return | < 15% (not extended) |
| Earnings | 7+ days away |

- Charts: daily charts only.
- Session focus: first hour + final 30 minutes.
- The 21dma is treated as a structural zone, not a hard line — price can overshoot before finding support.

---

## Stops & exits

- **Stops are soft and structural** — defined by 21dma-structure, not a fixed percentage of price.
- A close meaningfully below the 21dma-structure signals thesis change; reduce or exit.
- Behavior 4 (Reject & Lower Low) is the primary exit trigger.
- **Trim 1/3 at 2R**; trail remaining 2/3 with the 21dma-structure as a rising stop.
- **Earnings**: exit unless open cushion exceeds the implied move. Never hold through earnings by default.
- No fixed-percent stops. No scaling into losers.

---

## Position sizing & basket structure

- Base risk per trade: **0.25%** (weak/uncertain entry), **0.5%** (confirmed entry), up to **1%** (high conviction).
- Start with 10–20% of risk budget on initial entry; add 2–3 times as the trade proves itself.
- Cushion from early unrealized gains funds adds — no margin required.
- Active basket: 30–40 names in a strong market (concentrated, high-RS names only).

---

## Market timing inputs

| Indicator | Role |
|---|---|
| MCO (McClellan Oscillator) | Short-term overbought/oversold signal |
| MCSI (McClellan Summation Index) | Trend direction and breadth confirmation |
| QQQE | Equal-weight Nasdaq-100; preferred breadth proxy over QQQ |

**Exposure by market phase:**

| Phase | Action |
|---|---|
| Out of Correction | Start light; test with 1–2 names |
| Pullback in Uptrend | Add aggressively |
| Overbought | Stop adding; trim into strength |
| Breakdown | Cut to cash |

---

## Psychology & discretion

Alex's psychological framework reduces to three words: **Patience. Discipline. Conviction.** Rules are not a rigid checklist — experience converts them into a probabilistic lens. Discretion is earned through screen time and past trade analysis, not emotion. Key operating principles: never force trades in choppy or no-setup markets; do not chase extended moves (missing the first 2% of a move is better than chasing and getting stopped out); trim at 2R to manage open heat actively; trail exits with structure rather than predicting trend ends. Hard drawdown guardrails exist — daily/weekly loss limits prevent the trader death spiral of chasing losses with bigger size. The long-term goal is sustainable 50–100% annual returns, not 300–400% YTD spikes followed by blowups.

---

## Anti-patterns

The following behaviors are explicitly contrary to Alex's system. Their presence in a trade is a scoring penalty:

- **Breakout chasing** — buying a stock breaking out above resistance; this system has no breakout entries.
- **Extended entry** — entering when price is more than 1× ATR away from the 21dma.
- **Holding through earnings** — binary event risk; exit unless cushion exceeds implied move.
- **Illiquid names** — any stock below $250M daily liquidity or below $10B market cap (outside Episodic Pivot rules).
- **Fixed-percent stops** — stops must be structural (21dma-based), not arbitrary percentage cuts.
- **Scaling into losers** — adds are only made when the trade proves itself; never average down.
- **Trading broken-market phases** — entering new positions during Breakdown phase; market phase overrides all setups.
- **Excluded sectors** — China/HK, Biotech, Defensive, Real Estate, Healthcare, Energy, Financials.

---

## Scoring guidance

Score a trade against three dimensions using the schema output fields `entry_score` (0–4), `risk_score` (0–3), `setup_score` (0–3), summing to `total_score` (0–10).

**Entry Quality (`entry_score`, 0–4):**
- +1: Price is within 0–1× ATR of the 21dma at entry (`distanceTo21dmaAtr` ≤ 1.0).
- +1: 21ema slope is advancing (`ema21Slope = "rising"`).
- +1: 10wma slope is advancing (`wma10Slope = "rising"`).
- +1: Daily closing range > 10% and price contraction in last 5 days (`dailyClosingRangePct > 10` and `contractionLast5d = true`).
- Score 0 if price is more than 1× ATR from the 21dma (extended entry anti-pattern).

**Risk Management (`risk_score`, 0–3):**
- +1: Earnings are 7+ days away (`earningsDays ≥ 7`).
- +1: Stop is defined structurally (21dma-based, not a fixed percent) — infer from `proposedSL` relative to 21dma proximity.
- +1: Stock passes Liquid Leaders universe filter (market cap Large tier or `rsCompositeRank` in top band, liquidity implied by sector/cap).
- Score 0 on the earnings check if `earningsDays < 7`; flag as `"EARNINGS_RISK"`.

**Setup Alignment (`setup_score`, 0–3):**
- +1: One of the 4 core 21dma behaviors is clearly present (infer from `notes` or price context).
- +1: Not a breakout entry and not an excluded sector.
- +1: Market phase is conducive (Out of Correction or Pullback in Uptrend implied by market context).
- Score 0 for setup alignment if the entry is a breakout; add `"BREAKOUT_ENTRY"` to `flags`.

**Verdict mapping:**
- 9–10: `"GREAT ENTRY"`
- 7–8: `"GOOD ENTRY"`
- 5–6: `"ACCEPTABLE"`
- 3–4: `"POOR ENTRY"`
- 0–2: `"MISTAKE"`

Populate `flags` with any triggered anti-patterns (e.g., `"EXTENDED_ENTRY"`, `"EARNINGS_RISK"`, `"BREAKOUT_ENTRY"`, `"EXCLUDED_SECTOR"`, `"ILLIQUID_NAME"`). The `note` field must cite the specific threshold breached or condition satisfied in one sentence.
