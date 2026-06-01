/**
 * GET /api/leaderboard
 *
 * Returns all users with publicProfileEnabled=true + a non-null username,
 * ranked by composite score descending. Aggregates closed-trade stats per
 * user in one query and computes the composite score in TypeScript so the
 * weights stay in one place (lib/profile/composite.ts).
 *
 * Auth: requires a session (any role) — public profiles are visible to
 * fellow signed-in users at /dashboard/leaderboard. Unsigned visitors get
 * a redirect to /login via middleware.
 *
 * Standard deviation note: SQL doesn't give us per-trade-% returns directly
 * because pnl is in account currency, not %. We approximate consistency via
 * the std-dev of `pnl / buyPrice / quantity` for trades that have all three.
 */
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { computeComposite, type LeaderboardRow } from "@/lib/profile/composite";
import { compositeInputFromTrades } from "@/lib/profile/trade-metrics";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all public-profile users + their closed-trade pnl in one go.
  // We pull pnl rows (not just an aggregate) so we can compute drawdown
  // and stddev properly — the per-trade list per user stays small (<<1k).
  const users = await prisma.user.findMany({
    where: { publicProfileEnabled: true, username: { not: null } },
    select: {
      id: true,
      username: true,
      name: true,
      image: true,
      bio: true,
      dashboardTagline: true,
      tradeRecords: {
        where: { pnl: { not: null } },
        select: { state: true, pnl: true, buyPrice: true, quantity: true, tradeDate: true },
        orderBy: { tradeDate: "asc" },
      },
    },
  });

  const aggregated: { row: LeaderboardRow }[] = users.map((u) => {
    const composite = computeComposite(compositeInputFromTrades(u.tradeRecords));
    return {
      row: {
        username: u.username!,
        name: u.name,
        image: u.image,
        bio: u.bio,
        dashboardTagline: u.dashboardTagline,
        rank: 0, // assigned after sort
        composite,
      },
    };
  });

  // Sort: ranked users first (by score desc), then unranked (by trade count desc).
  aggregated.sort((a, b) => {
    const aRanked = a.row.composite.score != null;
    const bRanked = b.row.composite.score != null;
    if (aRanked && !bRanked) return -1;
    if (!aRanked && bRanked) return 1;
    if (aRanked && bRanked) {
      return (b.row.composite.score ?? 0) - (a.row.composite.score ?? 0);
    }
    return b.row.composite.metrics.closedTrades - a.row.composite.metrics.closedTrades;
  });

  const rows: LeaderboardRow[] = aggregated.map((a, i) => ({
    ...a.row,
    rank: i + 1,
  }));

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    count: rows.length,
    rows,
  });
}
