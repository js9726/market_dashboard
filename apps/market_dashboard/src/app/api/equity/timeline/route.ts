/**
 * GET /api/equity/timeline
 *
 * Returns the user's daily equity timeline from EquitySnapshot rows
 * populated by the dashboard-bridge daemon (Phase 4).
 *
 * Phase 6 of pre-open CI + journal revamp plan.
 *
 * Auth: NextAuth session. Approved users read only their own equity timeline.
 *
 * Query params:
 *   ?from=YYYY-MM-DD     default: 90 days ago
 *   ?to=YYYY-MM-DD       default: today
 *   ?accountId=...       optional: scope to one broker account (default: all)
 *
 * Response:
 *   {
 *     count: number,
 *     accounts: [ { id, alias, currency } ],
 *     points: [
 *       { date, totalAssets, cash, marketVal, unrealizedPl, equityPctChange }
 *     ]
 *   }
 *
 * If user has multiple broker accounts, points are aggregated per day (sum
 * across accounts in their local currencies — multi-currency normalisation
 * is deferred to the frontend display layer).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const url = new URL(req.url);
  const qp = url.searchParams;

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 90);

  const from = qp.get("from") && /^\d{4}-\d{2}-\d{2}$/.test(qp.get("from")!)
    ? new Date(`${qp.get("from")}T00:00:00.000Z`)
    : new Date(defaultFrom.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const to = qp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(qp.get("to")!)
    ? new Date(`${qp.get("to")}T00:00:00.000Z`)
    : new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z");

  const accountId = qp.get("accountId");

  // Resolve user's accounts (for label display).
  const accounts = await prisma.userBrokerAccount.findMany({
    where: { userId: userScopeId, isActive: true },
    include: { preset: true },
    orderBy: { createdAt: "asc" },
  });

  // Fetch snapshots in range.
  const snapshots = await prisma.equitySnapshot.findMany({
    where: {
      userId: userScopeId,
      snapshotDate: { gte: from, lte: to },
      ...(accountId ? { brokerAccountId: accountId } : {}),
    },
    orderBy: { snapshotDate: "asc" },
  });

  // Aggregate per day (sum across accounts in local currency for now).
  const byDate = new Map<string, {
    totalAssets: number;
    cash: number;
    marketVal: number;
    unrealizedPl: number;
    equityPctChange: number | null;
  }>();

  for (const s of snapshots) {
    const dateKey = s.snapshotDate.toISOString().slice(0, 10);
    const cur = byDate.get(dateKey) ?? {
      totalAssets: 0, cash: 0, marketVal: 0, unrealizedPl: 0, equityPctChange: null,
    };
    cur.totalAssets += Number(s.totalAssets);
    cur.cash += Number(s.cash);
    cur.marketVal += Number(s.marketVal);
    cur.unrealizedPl += Number(s.unrealizedPl ?? 0);
    // For pct change, take the latest computed (per-account avg if multi)
    if (s.equityPctChange != null) {
      cur.equityPctChange = Number(s.equityPctChange);
    }
    byDate.set(dateKey, cur);
  }

  const points = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      totalAssets: Number(v.totalAssets.toFixed(2)),
      cash: Number(v.cash.toFixed(2)),
      marketVal: Number(v.marketVal.toFixed(2)),
      unrealizedPl: Number(v.unrealizedPl.toFixed(2)),
      equityPctChange: v.equityPctChange,
    }));

  return NextResponse.json({
    count: points.length,
    accounts: accounts.map((a) => ({
      id: a.id,
      alias: a.alias,
      currency: a.displayCurrency ?? a.preset.currency,
    })),
    points,
  });
}
