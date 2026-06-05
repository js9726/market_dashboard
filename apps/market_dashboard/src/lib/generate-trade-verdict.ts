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
} from "@/lib/agent-moderator/handler";
import { buildTradeSnapshot } from "@/lib/trade-snapshot";
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

export function coerceScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 10) / 10;
  if (typeof value !== "string") return null;
  const match = value.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.round(parsed * 10) / 10 : null;
}

export function extractOverallScore(review: unknown, style: ReviewStyle): number | null {
  if (!review || typeof review !== "object") return null;
  const payload = review as Record<string, unknown>;
  if (style === "trader-debate") return coerceScore(payload.overall_score);
  const moderator = payload.moderator as { confidence?: unknown } | undefined;
  const confidence = coerceScore(moderator?.confidence);
  if (confidence == null) return null;
  return confidence > 10 && confidence <= 100 ? Math.round(confidence) / 10 : confidence;
}

// snapshotFromTrade was a v0 all-null stub. Entry-date market context now comes
// from buildTradeSnapshot() (src/lib/trade-snapshot.ts), keyed on the trade's
// entry date so the rubric can score against the regime + theme at trade time.
// Technical fields (RSI/MACD/EMA/ADX) remain null — a later PR populates them.

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
      snapshot: await buildTradeSnapshot({
        ticker: dbTrade.ticker,
        tradeDate: dbTrade.tradeDate,
        industry: dbTrade.industry,
      }),
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

  // DeepSeek sometimes follows the example schema literally and returns
  // numeric scores as strings. Coerce them before writing the visible grade.
  const overallScore = extractOverallScore(review, style);
  if (overallScore != null && style === "trader-debate") {
    review.overall_score = overallScore;
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
