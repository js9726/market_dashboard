/**
 * trader-primetrading skill — TS handler.
 *
 * Pure prompt builder + system prompt exporter. The caller (unified-review
 * pipeline or a one-off script) owns the LLM call, JSON parse, and persistence.
 *
 * Knowledge body (`knowledge.md`) is loaded as the system context. The TS
 * runtime keeps it inlined so Vercel/Next does not need to read markdown
 * at runtime — the canonical source still lives in knowledge.md.
 */

export type SnapshotInput = {
  currentPrice?: number | null;
  distanceTo21dmaAtr?: number | null;
  ema21Slope?: "rising" | "flat" | "falling" | null;
  wma10Slope?: "rising" | "flat" | "falling" | null;
  rsCompositeRank?: number | null;
  atrPct?: number | null;
  dailyClosingRangePct?: number | null;
  contractionLast5d?: boolean | null;
  earningsDays?: number | null;
  marketCapTier?: "Large" | "Mid" | "Small" | "Micro" | null;
};

export type TradeInput = {
  ticker: string;
  tradeDate?: string | Date | null;
  side?: string | null;
  buyPrice: string;
  exitPrice?: string | null;
  quantity?: string | null;
  pnl?: string | null;
  notes?: string | null;
  proposedEntry?: string | null;
  proposedSL?: string | null;
  proposedTP?: string | null;
  snapshot?: SnapshotInput | null;
};

// SYSTEM_PROMPT mirrors knowledge.md. Kept inline for Vercel runtime — keep
// in sync with packages/core-skills/trader-primetrading/knowledge.md when
// the wiki source changes (use /wiki-sync trader-primetrading).
export const SYSTEM_PROMPT = [
  "You are Alex Desjardins (@PrimeTrading_) reviewing a single trade. Apply only his published methodology — momentum + price action with the 21dma-structure as the primary anchor.",
  "",
  "## Universe filter",
  "- Liquid leaders only — concentrated basket of 30–40 names.",
  "- Top-RS composite (multi-timeframe blended rank). Only top RS-composite stocks qualify for Liquid Leaders / Episodic Pivot scans.",
  "- Universe is filtered before any setup is considered. Never trade outside the basket.",
  "",
  "## Setup recognition — 4 core 21dma behaviors",
  "1. Pullback into rising 21dma — primary entry signal.",
  "2. Reclaim & Backtest — broke below, reclaimed, backtests from above.",
  "3. Reject & Higher Low — rejected at 21dma but holds higher low; trend may still be intact.",
  "4. Reject & Lower Low — failed reclaim; reduce/exit exposure.",
  "Breakouts and extended entries are NOT his game.",
  "",
  "## Entry criteria",
  "- Within 0–1× ATR of the 21dma.",
  "- 21ema and 10wma must be advancing (rising slope).",
  "- Daily closing range > 10%.",
  "- Price contraction in the last 5 days.",
  "- Earnings 7+ days away.",
  "",
  "## Stops & exits",
  "- Soft structural stops — based on 21dma-structure, not fixed percent.",
  "- A close meaningfully below the 21dma-structure invalidates the thesis → exit.",
  "- No fixed-percent stops.",
  "",
  "## Position sizing",
  "- Concentrated basket of 30–40 liquid leaders.",
  "- Sizing scales with conviction; max exposure spread across the basket.",
  "",
  "## Market timing",
  "- MCO (McClellan Oscillator) for short-term overbought/oversold.",
  "- MCSI (McClellan Summation Index) confirms breadth/trend direction.",
  "- QQQE (equal-weight Nasdaq-100) preferred over QQQ for breadth.",
  "",
  "## Anti-patterns (zero-score signals)",
  "- Breakout chasing.",
  "- Extended entries >1× ATR above the 21dma.",
  "- Holding through earnings within 7 days.",
  "- Illiquid or non-leader names.",
  "- Fixed-percent stops.",
  "- Averaging down on losers.",
  "",
  "## Scoring rubric (apply through Alex's lens)",
  "- Entry Quality (0–4): within ATR of rising 21dma, closing range >10%, contraction last 5d, earnings clear, liquid+top-RS.",
  "- Risk Management (0–3): structural close-below-21dma stop (full marks); fixed-percent stop (zero).",
  "- Setup Alignment (0–3): one of the 4 core 21dma behaviors (pullback=full marks; rejection=marginal; breakout chase=zero).",
  "",
  "Verdict labels: GREAT ENTRY ≥9 | GOOD ENTRY 7–8 | ACCEPTABLE 5–6 | POOR ENTRY 3–4 | MISTAKE ≤2.",
  "",
  "Return ONLY valid JSON. No markdown fences. Numbers as numbers, not strings. Use empty array for `flags` when there are none.",
].join("\n");

const PROMPT_TEMPLATE = [
  "## Trade to score",
  "- Ticker: {ticker}",
  "- Trade date: {trade_date}",
  "- Side: {side}",
  "- Entry price: {entry_price}",
  "- Exit price: {exit_price}",
  "- P&L: {pnl_summary}",
  "- Quantity: {quantity}",
  "- Planned entry / stop / target: {planned_entry} / {planned_sl} / {planned_tp}",
  "- Notes: {notes}",
  "",
  "## Snapshot",
  "{snapshot_block}",
  "",
  "## Task",
  "Score this trade through Alex's lens. Apply the rubric verbatim from your system context.",
  "",
  "Return ONLY valid JSON in this shape:",
  "{schema_example}",
].join("\n");

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  return v == null ? "N/A" : `${v.toFixed(digits)}${suffix}`;
}

function fmtBool(v: boolean | null | undefined): string {
  return v == null ? "N/A" : v ? "yes" : "no";
}

function snapshotBlock(s: SnapshotInput | null | undefined): string {
  if (!s) return "(no snapshot — infer from general knowledge of the ticker around the trade date)";
  const lines = [
    `- Current price: ${fmtNum(s.currentPrice)}`,
    `- Distance to 21dma (xATR): ${fmtNum(s.distanceTo21dmaAtr, 2)}`,
    `- 21ema slope: ${s.ema21Slope ?? "N/A"}`,
    `- 10wma slope: ${s.wma10Slope ?? "N/A"}`,
    `- RS composite rank: ${fmtNum(s.rsCompositeRank, 0)}`,
    `- ATR%: ${fmtNum(s.atrPct, 2, "%")}`,
    `- Daily closing range: ${fmtNum(s.dailyClosingRangePct, 1, "%")}`,
    `- Contraction last 5d: ${fmtBool(s.contractionLast5d)}`,
    `- Earnings days: ${s.earningsDays ?? "N/A"}`,
    `- Market cap tier: ${s.marketCapTier ?? "N/A"}`,
  ];
  return lines.join("\n");
}

function schemaExample(ticker: string): string {
  const example = {
    handle: "@PrimeTrading_",
    ticker,
    entry_score: "<0-4>",
    risk_score: "<0-3>",
    setup_score: "<0-3>",
    total_score: "<0-10>",
    verdict: "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
    note: "<2-3 sentences from Alex's perspective citing rules he applies>",
    flags: ["<violation 1>", "<violation 2>"],
  };
  return JSON.stringify(example, null, 2);
}

export function buildPrompt(trade: TradeInput): string {
  const buyPrice = parseFloat(trade.buyPrice);
  const exitPrice = trade.exitPrice ? parseFloat(trade.exitPrice) : null;
  const pnlNum = trade.pnl ? parseFloat(trade.pnl) : null;
  const isOpen = pnlNum == null;
  const tradeDateStr = trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "N/A";

  const replacements: Record<string, string> = {
    ticker: trade.ticker,
    trade_date: tradeDateStr,
    trade_date_human: tradeDateStr === "N/A" ? "the trade date" : tradeDateStr,
    side: trade.side ?? "Long",
    entry_price: isFinite(buyPrice) ? `$${buyPrice.toFixed(2)}` : "N/A",
    exit_price: exitPrice != null && isFinite(exitPrice) ? `$${exitPrice.toFixed(2)}` : "Still open",
    pnl_summary: isOpen ? "Open position" : `$${pnlNum >= 0 ? "+" : ""}${pnlNum.toFixed(2)}`,
    quantity: trade.quantity ?? "N/A",
    planned_entry: trade.proposedEntry ?? "N/A",
    planned_sl: trade.proposedSL ?? "N/A",
    planned_tp: trade.proposedTP ?? "N/A",
    notes: trade.notes ?? "None",
    snapshot_block: snapshotBlock(trade.snapshot),
    schema_example: schemaExample(trade.ticker),
  };

  let out = PROMPT_TEMPLATE;
  for (const [k, v] of Object.entries(replacements)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}
