import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, isOwner, scopeUserId } from "@/lib/access";
import { extractOverallScore, generateTradeVerdict } from "@/lib/generate-trade-verdict";
import { incrementScanCount } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { materializeOpenPositionTradeRecords, OPEN_TRADE_STATES } from "@/lib/trades/position-trade-records";
import type { Prisma } from "@prisma/client";

export const maxDuration = 300;

const MAX_BULK_REVIEWS = 300;

type BulkBody = {
  mode?: "filtered" | "all";
  force?: boolean;
  limit?: number;
  filters?: {
    symbol?: string;
    side?: string;
    result?: string;
    state?: string;
  };
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildWhere(userId: string, body: BulkBody): Prisma.TradeRecordWhereInput {
  const filters = body.mode === "all" ? {} : body.filters ?? {};
  const symbol = clean(filters.symbol).toUpperCase();
  const side = clean(filters.side);
  const result = clean(filters.result);
  const state = clean(filters.state);

  return {
    userId,
    buyPrice: { not: null },
    ...(body.force ? {} : { verdictScore: null }),
    ...(symbol ? { ticker: { contains: symbol } } : {}),
    ...(side ? { side } : {}),
    ...(state ? { state } : {}),
    ...(result === "win"
      ? { pnl: { gt: 0 }, NOT: { state: { in: [...OPEN_TRADE_STATES] } } }
      : result === "loss"
      ? { pnl: { lte: 0 }, NOT: { state: { in: [...OPEN_TRADE_STATES] } } }
      : result === "open"
      ? { OR: [{ state: { in: [...OPEN_TRADE_STATES] } }, { state: null, pnl: null }] }
      : {}),
  };
}

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!process.env.DEEPSEEK_API_KEY && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
      return NextResponse.json({ error: "No AI provider is configured" }, { status: 503 });
    }

    const userId = scopeUserId(session)!;
    const body = (await request.json().catch(() => ({}))) as BulkBody;
    const materialized = await materializeOpenPositionTradeRecords(userId, {
      symbol: body.mode === "all" ? undefined : body.filters?.symbol,
    });
    const requestedLimit = typeof body.limit === "number" && Number.isFinite(body.limit)
      ? body.limit
      : MAX_BULK_REVIEWS;
    const limit = Math.max(1, Math.min(MAX_BULK_REVIEWS, Math.floor(requestedLimit)));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { dailyScansUsed: true, dailyScansLimit: true, role: true },
    });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const ownerBulk = isOwner(session) || user.role === "owner";
    const remainingQuota = ownerBulk ? Number.MAX_SAFE_INTEGER : Math.max(0, user.dailyScansLimit - user.dailyScansUsed);
    if (remainingQuota <= 0) {
      return NextResponse.json(
        {
          error: "Daily scan quota exceeded",
          dailyScansUsed: user.dailyScansUsed,
          dailyScansLimit: user.dailyScansLimit,
        },
        { status: 429 },
      );
    }

    const runLimit = Math.min(limit, remainingQuota);
    const where = buildWhere(userId, body);
    const totalMatched = await prisma.tradeRecord.count({ where });
    const candidates = await prisma.tradeRecord.findMany({
      where,
      orderBy: { tradeDate: "desc" },
      take: runLimit,
      select: { id: true, ticker: true, tradeDate: true },
    });
    const skippedForLimit = Math.max(0, totalMatched - limit);
    const quotaBoundMatched = Math.min(totalMatched, limit);
    const skippedForQuota = Math.max(0, quotaBoundMatched - remainingQuota);

    const reviewed: Array<{
      id: string;
      ticker: string;
      tradeDate: string | null;
      score: number | null;
      providerUsed: string;
      modelUsed: string;
    }> = [];
    const errors: Array<{ id: string; ticker: string; error: string }> = [];

    for (const trade of candidates) {
      try {
        const verdict = await generateTradeVerdict(trade.id, userId, {
          provider: "deepseek",
          style: "trader-debate",
        });
        await incrementScanCount(userId);
        const score = extractOverallScore(verdict.review, verdict.style);
        reviewed.push({
          id: trade.id,
          ticker: trade.ticker,
          tradeDate: trade.tradeDate?.toISOString() ?? null,
          score,
          providerUsed: verdict.providerUsed,
          modelUsed: verdict.modelUsed,
        });
      } catch (err) {
        errors.push({
          id: trade.id,
          ticker: trade.ticker,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      provider: "deepseek-preferred",
      mode: body.mode === "all" ? "all" : "filtered",
      limit: runLimit,
      totalMatched,
      selected: candidates.length,
      reviewed: reviewed.length,
      skippedForLimit,
      skippedForQuota,
      materialized,
      errors,
      trades: reviewed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
