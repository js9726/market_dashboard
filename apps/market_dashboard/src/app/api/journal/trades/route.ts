import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = 50;
  const symbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const side = searchParams.get("side") ?? "";
  const result = searchParams.get("result") ?? "";
  const stateFilter = searchParams.get("state") ?? "";

  const OPEN_STATES = ["OPEN", "SEMI-OPEN", "PLANNING"];

  const where = {
    userId: userScopeId,
    ...(symbol ? { ticker: { contains: symbol } } : {}),
    ...(side ? { side } : {}),
    ...(stateFilter ? { state: stateFilter } : {}),
    ...(result === "win"
      ? { pnl: { gt: 0 }, NOT: { state: { in: OPEN_STATES } } }
      : result === "loss"
      ? { pnl: { lte: 0 }, NOT: { state: { in: OPEN_STATES } } }
      : result === "open"
      ? { OR: [{ state: { in: OPEN_STATES } }, { state: null, pnl: null }] }
      : {}),
  };

  const [total, trades] = await Promise.all([
    prisma.tradeRecord.count({ where }),
    prisma.tradeRecord.findMany({
      where,
      orderBy: { tradeDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true, ticker: true, tradeDate: true, buyPrice: true, quantity: true,
        exitPrice: true, side: true, fees: true, pnl: true, notes: true,
        proposedEntry: true, proposedSL: true, proposedTP: true,
        rrr: true, riskPct: true, rewardPct: true, positionPct: true,
        currency: true, platform: true, industry: true, strategy: true,
        state: true,
        verdict: true, verdictScore: true, verdictGeneratedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    trades,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
