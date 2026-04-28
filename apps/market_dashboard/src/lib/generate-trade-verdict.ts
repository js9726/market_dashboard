import { prisma } from "@/lib/prisma";
import { callLLM, type LLMTier } from "@/utils/llm-router";
import { TRADER_PROFILES } from "@/lib/trader-profiles";
import type { Prisma } from "@prisma/client";

export type VerdictResult = {
  review: Record<string, unknown>;
  providerUsed: string;
  modelUsed: string;
  note?: string;
};

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

export const tradeReviewSystemPrompt = `You are an expert trading coach reviewing trades using the SEPA scoring rubric.
For each trader, score three dimensions: Entry Quality (0–4), Risk Management (0–3), Setup Alignment (0–3). Max = 10.
Use your knowledge of the stock (sector, industry, fundamentals, recent catalysts, technical context at the trade date) to make the review accurate.
Return ONLY valid JSON — no markdown fences, no extra text.`;

export function parseNumeric(value?: string | null): number | null {
  return value == null || value === "" ? null : parseFloat(value);
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

  const hasPlan = trade.proposedEntry || trade.proposedSL || trade.proposedTP;
  const planSection = hasPlan
    ? `
Pre-trade plan:
- Planned entry: ${parseNumeric(trade.proposedEntry) != null ? "$" + parseNumeric(trade.proposedEntry)!.toFixed(2) : "N/A"}
- Stop loss: ${parseNumeric(trade.proposedSL) != null ? "$" + parseNumeric(trade.proposedSL)!.toFixed(2) : "N/A"}${parseNumeric(trade.riskPct) != null ? " (risk: " + parseNumeric(trade.riskPct)!.toFixed(1) + "%)" : ""}
- Target: ${parseNumeric(trade.proposedTP) != null ? "$" + parseNumeric(trade.proposedTP)!.toFixed(2) : "N/A"}${parseNumeric(trade.rewardPct) != null ? " (reward: " + parseNumeric(trade.rewardPct)!.toFixed(1) + "%)" : ""}${parseNumeric(trade.rrr) != null ? " (RRR: " + parseNumeric(trade.rrr)!.toFixed(2) + ")" : ""}
- Position size: ${parseNumeric(trade.positionPct) != null ? parseNumeric(trade.positionPct)!.toFixed(1) + "%" : "N/A"}`
    : "";

  const traderList = TRADER_PROFILES.map(
    (t) => `${t.handle}\nStyle: ${t.style}\nDimensions: ${t.dimensions}`
  ).join("\n\n");

  return `Review this ${isOpen ? "open" : "closed"} trade.

TRADE DETAILS:
- Ticker: ${trade.ticker}
- Date: ${trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "N/A"}
- Side: ${trade.side ?? "Long"}
- Entry: $${buyPrice?.toFixed(2) ?? "N/A"}
- Exit: ${parseNumeric(trade.exitPrice) != null ? "$" + parseNumeric(trade.exitPrice)!.toFixed(2) : "Still open"}
- Quantity: ${trade.quantity ?? "N/A"}
- Fees: ${parseNumeric(trade.fees) != null ? "$" + parseNumeric(trade.fees)!.toFixed(2) : "N/A"}
- P&L: ${isOpen ? "Open position" : `$${pnlNum! >= 0 ? "+" : ""}${pnlNum!.toFixed(2)} (${pnlPct}%)`}
- Strategy: ${trade.strategy ?? "N/A"}
- Industry: ${trade.industry ?? "N/A"}
- Platform: ${trade.platform ?? "N/A"}
- Notes: ${trade.notes ?? "None"}
${planSection}

Using your knowledge of ${trade.ticker} around ${trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString("en-US") : "the trade date"}, infer the stock's sector, industry, fundamental quality, recent catalysts, and technical structure at that time.

TRADER PROFILES:
${traderList}

Score each trader using Entry Quality (0–4) + Risk Management (0–3) + Setup Alignment (0–3) = total /10.

Return ONLY this JSON (no markdown):
{
  "ticker": "${trade.ticker}",
  "sector": "<inferred sector>",
  "industry": "<inferred industry>",
  "market_cap_tier": "<Large/Mid/Small/Micro>",
  "is_open": ${isOpen},
  "trader_reviews": [
    {
      "handle": "@markminervini",
      "entry_score": <0-4>,
      "risk_score": <0-3>,
      "setup_score": <0-3>,
      "total_score": <0-10>,
      "verdict": "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
      "note": "<2-3 sentences from this trader's perspective>"
    }
  ],
  "best_match": "<handle of trader whose style this most resembles>",
  "weakest_dimension": "<Entry Quality | Risk Management | Setup Alignment>",
  "bull_case": ["<reason 1>", "<reason 2>", "<reason 3>"],
  "bear_case": ["<risk 1>", "<risk 2>", "<risk 3>"],
  "entry_plan": {
    "ideal_entry": "<price or condition>",
    "stop_loss": "<price or condition>",
    "target_1": "<price or condition>",
    "target_2": "<price or condition>",
    "position_size": "<% of portfolio recommendation>",
    "batch_sells": [
      { "tranche": "25%", "at": "<price/condition>" },
      { "tranche": "25%", "at": "<price/condition>" },
      { "tranche": "25%", "at": "<price/condition>" },
      { "tranche": "25%", "at": "<price/condition>" }
    ]
  },
  "overall_score": <0-10 weighted average>,
  "overall_verdict": "<GREAT ENTRY | GOOD ENTRY | ACCEPTABLE | POOR ENTRY | MISTAKE>",
  "lesson": "<1-2 sentence key takeaway>"
}`;
}

export async function generateTradeVerdict(
  tradeId: string,
  userId: string,
  opts: { provider?: string; tier?: LLMTier } = {}
): Promise<VerdictResult> {
  const dbTrade = await prisma.trade.findUnique({
    where: { id: tradeId, userId },
  });
  if (!dbTrade || !dbTrade.buyPrice) throw new Error("Trade not found or missing buy price");

  const tradeData: TradePromptInput = {
    ticker: dbTrade.ticker,
    tradeDate: dbTrade.tradeDate,
    side: dbTrade.side,
    buyPrice: dbTrade.buyPrice.toString(),
    exitPrice: dbTrade.exitPrice?.toString(),
    quantity: dbTrade.quantity?.toString(),
    fees: dbTrade.fees?.toString(),
    pnl: dbTrade.pnl?.toString() ?? null,
    notes: dbTrade.notes,
    strategy: dbTrade.strategy,
    industry: dbTrade.industry,
    platform: dbTrade.platform,
    proposedEntry: dbTrade.proposedEntry?.toString(),
    proposedSL: dbTrade.proposedSL?.toString(),
    proposedTP: dbTrade.proposedTP?.toString(),
    rrr: dbTrade.rrr?.toString(),
    riskPct: dbTrade.riskPct?.toString(),
    rewardPct: dbTrade.rewardPct?.toString(),
    positionPct: dbTrade.positionPct?.toString(),
  };

  const prompt = buildPrompt(tradeData);
  const out: { providerUsed?: string; modelUsed?: string; note?: string } = {};
  const raw = await callLLM(prompt, tradeReviewSystemPrompt, { maxTokens: 6000, ...opts }, out);

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const review = JSON.parse(cleaned) as Record<string, unknown>;

  const overallScore = typeof review.overall_score === "number" ? review.overall_score : null;
  const providerUsed = out.providerUsed ?? "unknown";
  const modelUsed = out.modelUsed ?? "unknown";

  await prisma.$transaction([
    prisma.tradeVerdictHistory.create({
      data: {
        tradeId,
        ticker: dbTrade.ticker,
        tradeDate: dbTrade.tradeDate,
        model: modelUsed,
        provider: providerUsed,
        verdict: review as Prisma.InputJsonValue,
        score: overallScore,
      },
    }),
    prisma.trade.update({
      where: { id: tradeId },
      data: {
        verdict: review as Prisma.InputJsonValue,
        verdictScore: overallScore,
        verdictGeneratedAt: new Date(),
      },
    }),
  ]);

  return { review, providerUsed, modelUsed, note: out.note };
}
