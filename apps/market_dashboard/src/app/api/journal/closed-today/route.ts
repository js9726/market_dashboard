/**
 * GET /api/journal/closed-today
 *
 * Returns trades that have CLOSED and do NOT yet have an AI JournalEntry —
 * the input set for the post-close journaler (journal_close.yml → Claude SDK).
 *
 * "Closed" = TradeRecord.pnl is not null (a realised P/L exists). We don't
 * hard-filter to literally today so that trades closed over a weekend / while
 * the journaler was down still get picked up on the next run (idempotent: once
 * a JournalEntry exists, the trade drops out of this list).
 *
 * Auth: session (owner) OR `Authorization: Bearer <BRIEF_INGEST_KEY>` (cron).
 *
 * Query:
 *   ?lookbackDays=5   only trades whose tradeDate/updatedAt is within N days
 *                     (default 5 — covers a long weekend + holiday gap)
 *   ?userId=<id>      machine callers target a specific owner (defaults to
 *                     the earliest owner-role user)
 *
 * Response:
 *   { count, trades: [{ id, ticker, side, buyPrice, exitPrice, quantity,
 *       pnl, fees, tradeDate, industry, strategy, proposedEntry, proposedSL,
 *       proposedTP, rrr, notes }] }
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

async function resolveScope(req: Request): Promise<{ userId: string } | { error: string; status: number }> {
  const expected = process.env.BRIEF_INGEST_KEY;
  const authHeader = req.headers.get("authorization");
  if (expected && authHeader === `Bearer ${expected}`) {
    const url = new URL(req.url);
    const explicit = url.searchParams.get("userId");
    if (explicit) return { userId: explicit };
    const owner = await prisma.user.findFirst({
      where: { role: "owner" }, select: { id: true }, orderBy: { createdAt: "asc" },
    });
    if (!owner) return { error: "no owner user", status: 503 };
    return { userId: owner.id };
  }
  const session = await auth();
  if (!session?.user?.id) return { error: "Unauthorized", status: 401 };
  return { userId: session.user.id };
}

export async function GET(req: Request) {
  const scope = await resolveScope(req);
  if ("error" in scope) {
    return NextResponse.json({ error: scope.error }, { status: scope.status });
  }

  const url = new URL(req.url);
  const lookbackDays = Math.min(parseInt(url.searchParams.get("lookbackDays") ?? "5"), 30);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);

  const rows = await prisma.tradeRecord.findMany({
    where: {
      userId: scope.userId,
      pnl: { not: null },             // realised P/L = closed
      journalEntry: null,             // not yet AI-journaled
      OR: [
        { tradeDate: { gte: since } },
        { syncedAt: { gte: since } },
      ],
    },
    orderBy: { tradeDate: "desc" },
    take: 50,
  });

  const trades = rows.map((t) => ({
    id: t.id,
    ticker: t.ticker,
    side: t.side,
    buyPrice: t.buyPrice?.toNumber() ?? null,
    exitPrice: t.exitPrice?.toNumber() ?? null,
    quantity: t.quantity?.toNumber() ?? null,
    pnl: t.pnl?.toNumber() ?? null,
    fees: t.fees?.toNumber() ?? null,
    tradeDate: t.tradeDate?.toISOString() ?? null,
    industry: t.industry,
    strategy: t.strategy,
    proposedEntry: t.proposedEntry?.toNumber() ?? null,
    proposedSL: t.proposedSL?.toNumber() ?? null,
    proposedTP: t.proposedTP?.toNumber() ?? null,
    rrr: t.rrr?.toNumber() ?? null,
    notes: t.notes,
  }));

  return NextResponse.json({ count: trades.length, trades });
}
