import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserIdAndQuota, incrementScanCount } from "@/lib/auth-helpers";
import { callLLM } from "@/utils/llm-router";
import {
  buildPrompt,
  tradeReviewSystemPrompt,
  generateTradeVerdict,
  type TradePromptInput,
} from "@/lib/generate-trade-verdict";
import {
  materializeOpenPositionTradeRecords,
  OPEN_TRADE_STATES,
  plainTicker,
} from "@/lib/trades/position-trade-records";

function tickerFromSyntheticPositionId(tradeId: string): string | null {
  if (!tradeId.startsWith("pos-")) return null;
  const rest = tradeId.slice(4);
  const lastDash = rest.lastIndexOf("-");
  const ticker = lastDash > 0 ? rest.slice(0, lastDash) : rest;
  return ticker ? plainTicker(ticker) : null;
}

export async function POST(request: Request) {
  try {
    const guard = await requireUserIdAndQuota();
    if (guard.error) return guard.error;
    const userId = guard.userId;

    const body = await request.json();
    const tradeId: string | undefined = body.tradeId;
    const force: boolean = body.force === true;
    const provider: string | undefined = body.provider;
    const style: "trader-debate" | "agent-pipeline" =
      body.style === "agent-pipeline" ? "agent-pipeline" : "trader-debate";

    // tradeId path: fetch from DB, check cache, generate and save verdict
    if (tradeId) {
      let resolvedTradeId = tradeId;
      const syntheticTicker = tickerFromSyntheticPositionId(tradeId);
      if (syntheticTicker) {
        await materializeOpenPositionTradeRecords(userId, { symbol: syntheticTicker });
        const materialized = await prisma.tradeRecord.findFirst({
          where: {
            userId,
            ticker: syntheticTicker,
            OR: [{ state: { in: [...OPEN_TRADE_STATES] } }, { state: null, pnl: null }],
          },
          select: { id: true },
          orderBy: { tradeDate: "desc" },
        });
        if (materialized) resolvedTradeId = materialized.id;
      }

      const dbTrade = await prisma.tradeRecord.findUnique({
        where: { id: resolvedTradeId, userId },
      });
      if (!dbTrade) {
        return NextResponse.json({ error: "Trade not found" }, { status: 404 });
      }

      // Cache check applies only when not switching styles. The cached `Trade.verdict`
      // field doesn't store its style, so a force=false request for the OTHER style
      // re-runs (and overwrites the cache). Always-fresh agent-pipeline runs are
      // the safer default until we add style-aware caching. Cache hits do NOT consume quota.
      if (!force && dbTrade.verdict && style === "trader-debate") {
        return NextResponse.json({ ...(dbTrade.verdict as Record<string, unknown>), _meta: { style: "trader-debate" } });
      }

      const result = await generateTradeVerdict(resolvedTradeId, userId, { provider, style });
      // Successful LLM run + DB write: charge the quota
      await incrementScanCount(userId);
      return NextResponse.json({
        ...result.review,
        _meta: {
          providerUsed: result.providerUsed,
          modelUsed: result.modelUsed,
          style: result.style,
          providerNote: result.note,
        },
      });
    }

    // Ad-hoc path: caller supplies trade data directly (no DB save)
    const tradeData: TradePromptInput = body.trade;
    if (!tradeData?.ticker || !tradeData?.buyPrice) {
      return NextResponse.json(
        { error: "trade.ticker and trade.buyPrice are required" },
        { status: 400 }
      );
    }

    const prompt = buildPrompt(tradeData);
    const out: { providerUsed?: string; modelUsed?: string; note?: string } = {};
    const raw = await callLLM(prompt, tradeReviewSystemPrompt, { maxTokens: 6000, provider }, out);

    let review: Record<string, unknown>;
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      review = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error(
        "[/api/analysis/trade-review ad-hoc] LLM returned invalid JSON for ticker=%s. Error: %s. Raw output (first 500 chars): %s",
        tradeData.ticker,
        parseErr instanceof Error ? parseErr.message : String(parseErr),
        raw.slice(0, 500)
      );
      return NextResponse.json(
        { error: "AI returned invalid JSON. Please try again." },
        { status: 500 }
      );
    }

    // Successful ad-hoc run: charge the quota
    await incrementScanCount(userId);

    return NextResponse.json({
      ...review,
      _meta: { providerUsed: out.providerUsed, modelUsed: out.modelUsed, providerNote: out.note },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
