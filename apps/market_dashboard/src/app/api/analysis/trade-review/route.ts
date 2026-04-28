import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { callLLM } from "@/utils/llm-router";
import {
  buildPrompt,
  tradeReviewSystemPrompt,
  generateTradeVerdict,
  type TradePromptInput,
} from "@/lib/generate-trade-verdict";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const tradeId: string | undefined = body.tradeId;
    const force: boolean = body.force === true;
    const provider: string | undefined = body.provider;

    // tradeId path: fetch from DB, check cache, generate and save verdict
    if (tradeId) {
      const dbTrade = await prisma.trade.findUnique({
        where: { id: tradeId, userId: session.user.id },
      });
      if (!dbTrade) {
        return NextResponse.json({ error: "Trade not found" }, { status: 404 });
      }

      // Return cached verdict if not forcing a rerun
      if (!force && dbTrade.verdict) {
        return NextResponse.json({ ...(dbTrade.verdict as Record<string, unknown>), _meta: {} });
      }

      const result = await generateTradeVerdict(tradeId, session.user.id, { provider });
      return NextResponse.json({
        ...result.review,
        _meta: { providerUsed: result.providerUsed, modelUsed: result.modelUsed, providerNote: result.note },
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
    const raw = await callLLM(prompt, tradeReviewSystemPrompt, { maxTokens: 3000, provider }, out);

    let review: Record<string, unknown>;
    try {
      const cleaned = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      review = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ...review,
      _meta: { providerUsed: out.providerUsed, modelUsed: out.modelUsed, providerNote: out.note },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
