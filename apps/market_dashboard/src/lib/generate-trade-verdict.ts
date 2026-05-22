import { prisma } from "@/lib/prisma";
import { callLLM, type LLMTier } from "@/utils/llm-router";
import {
  buildPrompt,
  parseNumeric,
  SYSTEM_PROMPT as tradeReviewSystemPrompt,
  type TradePromptInput,
} from "@/lib/trader-scorer-trade/handler";
import {
  buildPrompt as buildAgentModeratorPrompt,
  SYSTEM_PROMPT as agentModeratorSystemPrompt,
  type ModeratorPromptInput,
  type SnapshotInput,
} from "@/lib/agent-moderator/handler";
import type { Prisma } from "@prisma/client";

export type ReviewStyle = "trader-debate" | "agent-pipeline";

export type VerdictResult = {
  review: Record<string, unknown>;
  providerUsed: string;
  modelUsed: string;
  style: ReviewStyle;
  note?: string;
};

export { buildPrompt, parseNumeric, tradeReviewSystemPrompt, type TradePromptInput };

function snapshotFromTrade(): SnapshotInput {
  // v0: sparse snapshot — only what's directly on the Trade row.
  // PR 2 (build_data.py extension) will enrich this with yfinance technicals.
  return {
    currentPrice: null,
    rsi14: null,
    macdSignal: null,
    emaHierarchy: null,
    adx: null,
    volumeRatio: null,
    atrPct: null,
    earningsDays: null,
    halts90d: null,
  };
}

export async function generateTradeVerdict(
  tradeId: string,
  userId: string,
  opts: { provider?: string; tier?: LLMTier; style?: ReviewStyle } = {}
): Promise<VerdictResult> {
  const dbTrade = await prisma.tradeRecord.findUnique({
    where: { id: tradeId, userId },
  });
  if (!dbTrade || !dbTrade.buyPrice) throw new Error("Trade not found or missing buy price");

  const style: ReviewStyle = opts.style ?? "trader-debate";

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

  let prompt: string;
  let systemPrompt: string;

  if (style === "agent-pipeline") {
    const moderatorInput: ModeratorPromptInput = {
      mode: "trade",
      ticker: dbTrade.ticker,
      snapshot: snapshotFromTrade(),
      trade: {
        tradeDate: dbTrade.tradeDate?.toISOString() ?? null,
        side: dbTrade.side,
        buyPrice: dbTrade.buyPrice.toString(),
        exitPrice: dbTrade.exitPrice?.toString() ?? null,
        quantity: dbTrade.quantity?.toString() ?? null,
        pnl: dbTrade.pnl?.toString() ?? null,
        notes: dbTrade.notes,
        proposedEntry: dbTrade.proposedEntry?.toString() ?? null,
        proposedSL: dbTrade.proposedSL?.toString() ?? null,
        proposedTP: dbTrade.proposedTP?.toString() ?? null,
      },
    };
    prompt = buildAgentModeratorPrompt(moderatorInput);
    systemPrompt = agentModeratorSystemPrompt;
  } else {
    prompt = buildPrompt(tradeData);
    systemPrompt = tradeReviewSystemPrompt;
  }

  const out: { providerUsed?: string; modelUsed?: string; note?: string } = {};
  const raw = await callLLM(prompt, systemPrompt, { maxTokens: 6000, provider: opts.provider, tier: opts.tier }, out);

  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const review = JSON.parse(cleaned) as Record<string, unknown>;

  // Score field differs by style: trader-debate uses overall_score,
  // agent-pipeline uses moderator.confidence.
  let overallScore: number | null = null;
  if (style === "trader-debate") {
    overallScore = typeof review.overall_score === "number" ? review.overall_score : null;
  } else {
    const moderator = review.moderator as { confidence?: number } | undefined;
    overallScore = typeof moderator?.confidence === "number" ? moderator.confidence : null;
  }

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
        style,
        kind: "day-0",  // initial scoring; /api/cron/rescore-day14 adds day-14-rescore rows later
        verdict: review as Prisma.InputJsonValue,
        score: overallScore,
      },
    }),
    prisma.tradeRecord.update({
      where: { id: tradeId },
      data: {
        verdict: review as Prisma.InputJsonValue,
        verdictScore: overallScore,
        verdictGeneratedAt: new Date(),
      },
    }),
  ]);

  return { review, providerUsed, modelUsed, style, note: out.note };
}
