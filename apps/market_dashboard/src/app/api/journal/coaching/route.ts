import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { getUsdMyrRate } from "@/lib/equity-currency";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function toNum(value: unknown): number {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function pct(n: number): number {
  return Math.round(n * 10) / 10;
}

function avg(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function mode(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    const v = value?.trim();
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function gradeFromScore(score: number | null): "A" | "B" | "C" | null {
  if (score == null) return null;
  if (score >= 7) return "A";
  if (score >= 5) return "B";
  return "C";
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const now = new Date();
  const from90 = new Date(now);
  from90.setUTCDate(from90.getUTCDate() - 90);
  const from30 = new Date(now);
  from30.setUTCDate(from30.getUTCDate() - 30);
  const from60 = new Date(now);
  from60.setUTCDate(from60.getUTCDate() - 60);

  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId },
    select: { fixedFxRate: true },
  });
  const fixedRate = connection?.fixedFxRate != null ? Number(connection.fixedFxRate) : null;
  const liveRate = await getUsdMyrRate();
  const conversionRate = fixedRate ?? liveRate;

  const trades = await prisma.tradeRecord.findMany({
    where: {
      userId,
      tradeDate: { gte: from90 },
      OR: [{ state: "CLOSE" }, { state: null, pnl: { not: null } }],
    },
    orderBy: { tradeDate: "desc" },
    select: {
      tradeDate: true,
      pnl: true,
      pnlUsd: true,
      verdictScore: true,
      pnlSource: true,
    },
  });

  const usd = (t: (typeof trades)[number]): number | null =>
    t.pnlUsd != null ? toNum(t.pnlUsd) : conversionRate != null && t.pnl != null ? toNum(t.pnl) / conversionRate : null;
  const valuedTrades = trades
    .map((t) => ({ trade: t, usd: usd(t) }))
    .filter((row): row is { trade: (typeof trades)[number]; usd: number } => row.usd != null);
  const wins = valuedTrades.filter((row) => row.usd > 0);
  const losses = valuedTrades.filter((row) => row.usd <= 0);
  const avgWin = avg(wins.map((row) => row.usd));
  const avgLoss = avg(losses.map((row) => Math.abs(row.usd)));
  const winRate = valuedTrades.length ? pct((wins.length / valuedTrades.length) * 100) : 0;
  const avgRR = avgLoss > 0 ? avgWin / avgLoss : 0;
  const breakevenWinRate = avgWin + avgLoss > 0 ? (avgLoss / (avgWin + avgLoss)) * 100 : 50;
  const targetWinRate = Math.min(65, Math.max(40, Math.ceil(breakevenWinRate + 8)));
  const targetRR = avgRR >= 1.8 ? 1.8 : 2.0;

  const recentTrades = valuedTrades.filter((row) => row.trade.tradeDate && row.trade.tradeDate >= from30);
  const recentWinRate = recentTrades.length
    ? pct((recentTrades.filter((row) => row.usd > 0).length / recentTrades.length) * 100)
    : null;
  const grades = trades.map((t) => gradeFromScore(t.verdictScore)).filter((g): g is "A" | "B" | "C" => !!g);
  const gradeCounts = {
    A: grades.filter((g) => g === "A").length,
    B: grades.filter((g) => g === "B").length,
    C: grades.filter((g) => g === "C").length,
  };

  const entries = await prisma.journalEntry.findMany({
    where: { userId, createdAt: { gte: from90 } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      setupType: true,
      weakestDimension: true,
      patternNote: true,
      compositeScore: true,
    },
  });
  const topWeakness = mode(entries.map((e) => e.weakestDimension));
  const topSetup = mode(entries.map((e) => e.setupType));
  const avgComposite = avg(entries.map((e) => toNum(e.compositeScore)).filter((n) => n > 0));
  const patternNote = entries.find((e) => e.patternNote)?.patternNote ?? null;

  const held = await prisma.aListCandidate.findMany({
    where: {
      userId,
      isHeld: true,
      OR: [{ entryFillAt: { gte: from60 } }, { updatedAt: { gte: from60 } }],
    },
    select: {
      entryFillAt: true,
      updatedAt: true,
      onBook: true,
      entryGrade: true,
      realizedRLogged: true,
    },
  });
  const heldDate = (row: (typeof held)[number]) => row.entryFillAt ?? row.updatedAt;
  const recentHeld = held.filter((h) => heldDate(h) >= from30);
  const priorHeld = held.filter((h) => heldDate(h) < from30);
  const onBookRate = (rows: typeof held) =>
    rows.length ? pct((rows.filter((r) => r.onBook === true).length / rows.length) * 100) : null;
  const recentOnBook = onBookRate(recentHeld);
  const priorOnBook = onBookRate(priorHeld);
  const recentAEntries = recentHeld.filter((h) => h.entryGrade === "A").length;

  const mistakes: string[] = [];
  if (topWeakness) mistakes.push(`Recurring weak dimension: ${topWeakness}.`);
  if (gradeCounts.C > gradeCounts.A) mistakes.push(`C-grade entries outnumber A-grade entries (${gradeCounts.C} vs ${gradeCounts.A}).`);
  if (avgRR > 0 && avgRR < 1.5) mistakes.push(`Average R:R is ${avgRR.toFixed(2)}, below the 1.8-2.0 target zone.`);
  if (!mistakes.length) mistakes.push("No repeated mistake is dominant yet; keep collecting clean scored trade reviews.");

  const plan: string[] = [
    `Only press full size when the setup clears the A/B bar; keep C-grade ideas as watchlist-only until the entry improves.`,
    `Target win rate ${targetWinRate}% with average R:R near ${targetRR.toFixed(1)}; below that, reduce frequency before increasing size.`,
    topWeakness
      ? `Pre-trade checklist focus: write one sentence proving ${topWeakness} is acceptable before entry.`
      : "Pre-trade checklist focus: write entry thesis, invalidation, and market regime before entry.",
  ];
  if (recentOnBook != null) {
    plan.push(`Keep recent on-book discipline above 70%; current recent rate is ${recentOnBook}%.`);
  }

  const adoption =
    recentOnBook == null
      ? "No recent HELD tracker adoption data yet."
      : priorOnBook == null
        ? `Recent on-book discipline is ${recentOnBook}% across ${recentHeld.length} held trade(s).`
        : recentOnBook >= priorOnBook
          ? `Plan adoption improving: on-book discipline rose from ${priorOnBook}% to ${recentOnBook}%.`
          : `Plan adoption slipping: on-book discipline fell from ${priorOnBook}% to ${recentOnBook}%.`;

  return NextResponse.json({
    generatedAt: now.toISOString(),
    periodDays: 90,
    current: {
      trades: valuedTrades.length,
      winRate,
      recentWinRate,
      avgRR: Math.round(avgRR * 100) / 100,
      avgComposite: Math.round(avgComposite * 100) / 100,
      gradeCounts,
      topSetup,
    },
    target: {
      winRate: targetWinRate,
      avgRR: targetRR,
    },
    improvement: {
      summary:
        valuedTrades.length === 0
          ? "No closed trades in the last 90 days; coaching will sharpen once the journal has recent realized outcomes."
          : `Recent edge is ${winRate}% win rate with ${avgRR.toFixed(2)} average R:R. The next improvement is selection quality, not more activity.`,
      mistakes,
      plan,
      adoption,
      patternNote,
      recentAEntries,
    },
  });
}
