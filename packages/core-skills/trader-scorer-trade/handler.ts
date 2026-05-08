/**
 * trader-scorer-trade skill — TS handler.
 *
 * Pure prompt builder + system text exporter. The caller in
 * `apps/market_dashboard/src/lib/generate-trade-verdict.ts` keeps
 * the LLM call, JSON parsing, and Prisma persistence.
 */
import {
  SHARED_TRADER_PROFILES,
  type SharedTraderProfile,
} from "../_shared/prompt-loader";

// Keep these constants in sync with prompt.md and knowledge.md. They are
// inlined so Next/Vercel does not need markdown files at runtime.
const PROMPT_TEMPLATE = "Review this {trade_state} trade.\n\n## Trade details\n- Ticker: {ticker}\n- Date: {trade_date}\n- Side: {side}\n- Entry: {entry_price}\n- Exit: {exit_price}\n- Quantity: {quantity}\n- Fees: {fees}\n- P&L: {pnl_summary}\n- Strategy: {strategy}\n- Industry: {industry}\n- Platform: {platform}\n- Notes: {notes}{plan_section}\n\nUsing your knowledge of {ticker} around {trade_date_human}, infer the stock's sector, industry, fundamental quality, recent catalysts, and technical structure at that time.\n\n## Trader profiles\n{trader_profiles_block}\n\nScore each trader using Entry Quality (0–4) + Risk Management (0–3) + Setup Alignment (0–3) = total /10.\n\nReturn ONLY this JSON (no markdown):\n{schema_example}\n";
export const SYSTEM_PROMPT = "You are an expert trading coach reviewing trades using the SEPA scoring rubric.\n\nFor each trader persona supplied in the user message, score three dimensions:\n\n| Dimension | Range | What it measures |\n|---|---|---|\n| Entry Quality | 0–4 | Was the entry trigger valid for this trader's style? Was timing right? |\n| Risk Management | 0–3 | Was the stop placement appropriate? Was position size disciplined? |\n| Setup Alignment | 0–3 | Did the underlying setup match this trader's required conditions? |\n\nThe three sum to a per-trader total out of 10. The overall trade score is a weighted average across the 7 traders.\n\nUse your knowledge of the stock (sector, industry, fundamentals, recent catalysts, technical context at the trade date) to make the review accurate.\n\nVerdict labels (per trader and overall):\n`GREAT ENTRY` (≥9) | `GOOD ENTRY` (7–8) | `ACCEPTABLE` (5–6) | `POOR ENTRY` (3–4) | `MISTAKE` (≤2)\n\nReturn ONLY valid JSON — no markdown fences, no extra text.";

export type TradePromptInput = {
  ticker: string;
  tradeDate?: string | Date | null;
  side?: string | null;
  buyPrice: string;
  exitPrice?: string | null;
  quantity?: string | null;
  fees?: string | null;
  pnl?: string | null;
  notes?: string | null;
  strategy?: string | null;
  industry?: string | null;
  platform?: string | null;
  proposedEntry?: string | null;
  proposedSL?: string | null;
  proposedTP?: string | null;
  rrr?: string | null;
  riskPct?: string | null;
  rewardPct?: string | null;
  positionPct?: string | null;
};

export function parseNumeric(value?: string | null): number | null {
  return value == null || value === "" ? null : parseFloat(value);
}

function renderProfilesBlock(profiles: SharedTraderProfile[]): string {
  return profiles
    .map((p) => `### ${p.handle} — ${p.name}\nStyle: ${p.styleShort}\nDimensions: ${p.dimensions}`)
    .join("\n\n");
}

function schemaExample(ticker: string, isOpen: boolean): string {
  const example = {
    ticker,
    sector: "<inferred sector>",
    industry: "<inferred industry>",
    market_cap_tier: "<Large/Mid/Small/Micro>",
    is_open: isOpen,
    trader_reviews: [
      {
        handle: "@markminervini",
        entry_score: "<0-4>",
        risk_score: "<0-3>",
        setup_score: "<0-3>",
        total_score: "<0-10>",
        verdict: "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
        note: "<2-3 sentences from this trader's perspective>",
      },
    ],
    best_match: "<handle of trader whose style this most resembles>",
    weakest_dimension: "<Entry Quality | Risk Management | Setup Alignment>",
    bull_case: ["<reason 1>", "<reason 2>", "<reason 3>"],
    bear_case: ["<risk 1>", "<risk 2>", "<risk 3>"],
    entry_plan: {
      ideal_entry: "<price or condition>",
      stop_loss: "<price or condition>",
      target_1: "<price or condition>",
      target_2: "<price or condition>",
      position_size: "<% of portfolio recommendation>",
      batch_sells: [
        { tranche: "25%", at: "<price/condition>" },
        { tranche: "25%", at: "<price/condition>" },
        { tranche: "25%", at: "<price/condition>" },
        { tranche: "25%", at: "<price/condition>" },
      ],
    },
    overall_score: "<0-10 weighted average>",
    overall_verdict: "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
    lesson: "<1-2 sentence key takeaway>",
  };
  return JSON.stringify(example, null, 2);
}

function planSection(trade: TradePromptInput): string {
  const hasPlan = trade.proposedEntry || trade.proposedSL || trade.proposedTP;
  if (!hasPlan) return "";
  const entry = parseNumeric(trade.proposedEntry);
  const sl = parseNumeric(trade.proposedSL);
  const tp = parseNumeric(trade.proposedTP);
  const risk = parseNumeric(trade.riskPct);
  const reward = parseNumeric(trade.rewardPct);
  const rrr = parseNumeric(trade.rrr);
  const pos = parseNumeric(trade.positionPct);
  return `

Pre-trade plan:
- Planned entry: ${entry != null ? "$" + entry.toFixed(2) : "N/A"}
- Stop loss: ${sl != null ? "$" + sl.toFixed(2) : "N/A"}${risk != null ? " (risk: " + risk.toFixed(1) + "%)" : ""}
- Target: ${tp != null ? "$" + tp.toFixed(2) : "N/A"}${reward != null ? " (reward: " + reward.toFixed(1) + "%)" : ""}${rrr != null ? " (RRR: " + rrr.toFixed(2) + ")" : ""}
- Position size: ${pos != null ? pos.toFixed(1) + "%" : "N/A"}`;
}

export function buildPrompt(trade: TradePromptInput): string {
  const isOpen = trade.pnl == null;
  const pnlNum = isOpen ? null : parseNumeric(trade.pnl);
  const buyPrice = parseNumeric(trade.buyPrice);
  const quantity = parseNumeric(trade.quantity);
  const pnlPct =
    pnlNum != null && buyPrice != null && quantity != null
      ? ((pnlNum / (buyPrice * quantity)) * 100).toFixed(2)
      : null;

  const tradeDateHuman = trade.tradeDate
    ? new Date(trade.tradeDate).toLocaleDateString("en-US")
    : "N/A";

  const replacements: Record<string, string> = {
    trade_state: isOpen ? "open" : "closed",
    ticker: trade.ticker,
    trade_date: trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "N/A",
    trade_date_human: trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "the trade date",
    side: trade.side ?? "Long",
    entry_price: `$${buyPrice?.toFixed(2) ?? "N/A"}`,
    exit_price: parseNumeric(trade.exitPrice) != null ? "$" + parseNumeric(trade.exitPrice)!.toFixed(2) : "Still open",
    quantity: trade.quantity ?? "N/A",
    fees: parseNumeric(trade.fees) != null ? "$" + parseNumeric(trade.fees)!.toFixed(2) : "N/A",
    pnl_summary: isOpen ? "Open position" : `$${pnlNum! >= 0 ? "+" : ""}${pnlNum!.toFixed(2)} (${pnlPct}%)`,
    strategy: trade.strategy ?? "N/A",
    industry: trade.industry ?? "N/A",
    platform: trade.platform ?? "N/A",
    notes: trade.notes ?? "None",
    plan_section: planSection(trade),
    trader_profiles_block: renderProfilesBlock(SHARED_TRADER_PROFILES),
    schema_example: schemaExample(trade.ticker, isOpen),
  };

  let out = PROMPT_TEMPLATE;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{${key}}`).join(value);
  }
  // Suppress unused var lint for tradeDateHuman if kept for future use.
  void tradeDateHuman;
  return out;
}
