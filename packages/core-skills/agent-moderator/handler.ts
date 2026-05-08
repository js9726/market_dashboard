/**
 * agent-moderator skill — TS handler.
 *
 * v0: simulates the full 5-agent pipeline (Data, Technical, Chart, Risk, Moderator)
 * in a single LLM call. The caller owns the LLM call, JSON parse, and persistence.
 *
 * Constants below mirror prompt.md and knowledge.md so Next/Vercel does not need
 * to read markdown at runtime.
 */

export type AgentMode = "trade" | "stock";

export type SnapshotInput = {
  currentPrice?: number | null;
  changePctIntraday?: number | null;
  changePct5d?: number | null;
  changePct20d?: number | null;
  atrPct?: number | null;
  rsi14?: number | null;
  macdSignal?: "bullish" | "bearish" | "neutral" | null;
  emaHierarchy?: "bullish" | "bearish" | "mixed" | null;
  adx?: number | null;
  volumeRatio?: number | null;
  marketCapTier?: "Large" | "Mid" | "Small" | "Micro" | null;
  sector?: string | null;
  industry?: string | null;
  earningsDays?: number | null;
  halts90d?: number | null;
};

export type TradeInput = {
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
};

export type ModeratorPromptInput = {
  mode: AgentMode;
  ticker: string;
  snapshot: SnapshotInput;
  trade?: TradeInput | null;
};

export const SYSTEM_PROMPT = [
  "You are running a 5-agent analysis pipeline. You will play four specialist roles (Data, Technical, Chart, Risk) and then act as the Moderator who synthesizes them into a final verdict.",
  "",
  "## Agent roles",
  "",
  "**Data Agent** — objective numeric facts only. No interpretation. Required reads: price, % change (intraday + 5d + 20d), volume vs 20-day average, ATR%, market cap tier, sector / industry, days to next earnings, halts in last 90 days.",
  "",
  "**Technical Agent** — momentum and trend reads. Apply these thresholds:",
  "- RSI(14): <30 oversold | 30–45 weak | 45–55 neutral | 55–70 strong | >70 overbought",
  "- MACD: bullish if MACD > signal line and rising; bearish if below and falling",
  "- EMA hierarchy: bullish if EMA20 > EMA50 > EMA200; bearish if reverse; mixed otherwise",
  "- ADX: <20 weak trend | 20–25 emerging | 25–40 strong | >40 extreme",
  "- Volume vs 20-day avg: 1.5×+ high | <0.5× low",
  "",
  "**Chart Agent** — pattern recognition. Look for: range breakout/breakdown, flag/pennant, cup-and-handle, double top/bottom, head-and-shoulders, gap fill, support/resistance levels, volatility contraction, 21-day MA structure (advancing vs flat).",
  "",
  "**Risk Agent** — consumes Data + Technical + Chart. Rules:",
  "- Position size cap: 5% breakouts | 7.5% proven trends | 2% speculative/small-cap",
  "- Risk per trade: target 1% account; never exceed 2%; stop ≤ ATR × 1.5 from entry",
  "- R/R: ≥1:2 approve | 1:1.5 warn | <1:1.5 reject",
  "- Earnings ≤7 days: downgrade size 50% or reject",
  "- Any halt in last 90 days: warn or reject by cause",
  "",
  "**Moderator** — final synthesis:",
  "- BUY: ≥3 of 4 feeders bullish AND Risk = approved",
  "- SELL: ≥3 of 4 feeders bearish",
  "- HOLD: mixed signals OR Risk = reject",
  "Confidence 0–10: start 5; +1 per bullish feeder beyond third (max +1); +1 if Risk approved with R/R ≥ 1:2.5; +1 if clean structural breakout; +1 if volume > 1.5× avg; −1 per contraindication. Cap [0, 10].",
  "Entry / stop / target MUST come from the Chart Agent's structural levels — do not invent.",
  "",
  "## Output discipline",
  "Return ONLY valid JSON. No markdown fences, no commentary outside the JSON. Numbers as numbers, not strings. Use null for unknown. Keep summary and reasoning short (1–3 sentences).",
].join("\n");

const PROMPT_TEMPLATE = [
  "## Mode",
  "{mode}",
  "",
  "## Ticker",
  "{ticker}",
  "",
  "## Snapshot",
  "{snapshot_block}",
  "{trade_section}",
  "",
  "## Task",
  "Produce one JSON object with these top-level keys: `ticker`, `agents`, `moderator`.",
  "",
  "Steps:",
  "1. Run the Data Agent on the snapshot.",
  "2. Run the Technical Agent on the snapshot.",
  "3. Run the Chart Agent.",
  "4. Run the Risk Agent consuming the three outputs above.",
  "5. Run the Moderator. Apply BUY/SELL/HOLD voting. Set confidence per the rubric. Take entry/stop/target from the Chart Agent.{lesson_directive}",
  "",
  "## Output schema (example shape)",
  "{schema_example}",
  "",
  "Return ONLY the JSON.",
].join("\n");

function fmtNum(v: number | null | undefined, digits = 2, suffix = ""): string {
  return v == null ? "N/A" : `${v.toFixed(digits)}${suffix}`;
}

function snapshotBlock(s: SnapshotInput): string {
  const lines = [
    `- Current price: ${fmtNum(s.currentPrice)}`,
    `- Change: intraday ${fmtNum(s.changePctIntraday, 2, "%")}, 5d ${fmtNum(s.changePct5d, 2, "%")}, 20d ${fmtNum(s.changePct20d, 2, "%")}`,
    `- ATR%: ${fmtNum(s.atrPct, 2, "%")}`,
    `- RSI(14): ${fmtNum(s.rsi14, 1)}`,
    `- MACD signal: ${s.macdSignal ?? "N/A"}`,
    `- EMA hierarchy: ${s.emaHierarchy ?? "N/A"}`,
    `- ADX: ${fmtNum(s.adx, 1)}`,
    `- Volume vs 20-day avg: ${fmtNum(s.volumeRatio, 2, "×")}`,
    `- Market cap tier: ${s.marketCapTier ?? "N/A"}`,
    `- Sector / industry: ${s.sector ?? "N/A"} / ${s.industry ?? "N/A"}`,
    `- Days to next earnings: ${s.earningsDays ?? "N/A"}`,
    `- Halts in last 90d: ${s.halts90d ?? 0}`,
  ];
  return lines.join("\n");
}

function tradeSection(trade: TradeInput | null | undefined): string {
  if (!trade) return "";
  const buy = parseFloat(trade.buyPrice);
  const exit = trade.exitPrice ? parseFloat(trade.exitPrice) : null;
  const pnl = trade.pnl ? parseFloat(trade.pnl) : null;
  const isOpen = pnl == null;
  const dateStr = trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "N/A";
  const lines = [
    "",
    "## Trade",
    `- State: ${isOpen ? "OPEN" : "CLOSED"}`,
    `- Entry date: ${dateStr}`,
    `- Side: ${trade.side ?? "Long"}`,
    `- Buy price: $${isFinite(buy) ? buy.toFixed(2) : "N/A"}`,
    `- Exit price: ${exit != null && isFinite(exit) ? `$${exit.toFixed(2)}` : "Still open"}`,
    `- Quantity: ${trade.quantity ?? "N/A"}`,
    `- P&L: ${pnl != null ? `$${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}` : "Open position"}`,
    `- Planned entry / stop / target: ${trade.proposedEntry ?? "N/A"} / ${trade.proposedSL ?? "N/A"} / ${trade.proposedTP ?? "N/A"}`,
    `- Notes: ${trade.notes ?? "None"}`,
  ];
  return lines.join("\n");
}

function schemaExample(ticker: string, mode: AgentMode): string {
  const example = {
    ticker,
    agents: {
      data: { summary: "<1-2 factual sentences>", facts: { price: 0, volumeRatio: 0 } },
      technical: { summary: "<1-2 sentences>", indicators: { rsi14: 0, macdSignal: "bullish", emaHierarchy: "bullish", adx: 0 } },
      chart: { summary: "<1-2 sentences>", pattern: "<pattern label>", levels: { support: 0, resistance: 0, breakoutLevel: 0 } },
      risk: { summary: "<1-2 sentences>", suggested_size_pct: 0, rr: 0, stop_distance_pct: 0, var_1d_pct: 0, status: "approved" },
    },
    moderator: {
      signal: "BUY",
      confidence: 0,
      consensus: "X/4",
      entry: 0,
      stop: 0,
      target: 0,
      reasoning: "<≤3 sentences synthesizing the 4 feeders>",
      lesson: mode === "trade" ? "<≤2 sentences for the journal>" : null,
    },
  };
  return JSON.stringify(example, null, 2);
}

export function buildPrompt(input: ModeratorPromptInput): string {
  const { mode, ticker, snapshot, trade } = input;
  const replacements: Record<string, string> = {
    mode,
    ticker,
    snapshot_block: snapshotBlock(snapshot),
    trade_section: mode === "trade" ? tradeSection(trade) : "",
    lesson_directive:
      mode === "trade"
        ? " Also produce a 1–2 sentence `lesson` field — be honest if the trade was a mistake."
        : "",
    schema_example: schemaExample(ticker, mode),
  };
  let out = PROMPT_TEMPLATE;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}
