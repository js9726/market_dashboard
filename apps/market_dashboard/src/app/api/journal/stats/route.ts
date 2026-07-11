import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { getUsdMyrRate } from "@/lib/equity-currency";
import { buildJournalCalendarData } from "@/lib/journal/calendar-data";
import { prisma } from "@/lib/prisma";
import { isClosedTradeRecord } from "@/lib/profile/trade-metrics";
import { NextResponse } from "next/server";
import { Decimal } from "@prisma/client/runtime/library";

function toNum(d: Decimal | null | undefined): number {
  return d ? parseFloat(d.toString()) : 0;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const userId = scopeUserId(session)!;

  const trades = await prisma.tradeRecord.findMany({
    where: { userId },
    orderBy: { tradeDate: "asc" },
  });

  // Report all money in USD. Prefer persisted pnlUsd; else reverse the sheet's
  // fixed MYR rate; last-resort raw pnl (tallied in unconvertedCount so the UI
  // can flag "set your fixed rate"). See lib/currency.ts.
  const connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId },
    select: { fixedFxRate: true },
  });
  const fixedRate = connection?.fixedFxRate != null ? Number(connection.fixedFxRate) : null;
  const liveRate = await getUsdMyrRate();
  const conversionRate = fixedRate ?? liveRate;
  const usdVal = (t: typeof trades[0]): number | null =>
    t.pnlUsd != null
      ? toNum(t.pnlUsd)
      : conversionRate != null && t.pnl != null
        ? toNum(t.pnl) / conversionRate
        : null;

  // Use state as primary source; fall back to pnl for trades without state
  const isClosed = (t: typeof trades[0]) => isClosedTradeRecord(t);
  const closed = trades.filter(isClosed);
  const valued = closed
    .map((t) => ({ trade: t, usd: usdVal(t) }))
    .filter((row): row is { trade: typeof trades[0]; usd: number } => row.usd != null);
  const unconvertedCount = closed.filter((t) => t.pnl != null && t.pnlUsd == null && conversionRate == null).length;
  const totalPnl = valued.reduce((s, row) => s + row.usd, 0);
  const wins = valued.filter((row) => row.usd > 0);
  const losses = valued.filter((row) => row.usd <= 0);
  const winRate = valued.length ? wins.length / valued.length : 0;
  const avgWin = wins.length ? wins.reduce((s, row) => s + row.usd, 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, row) => s + row.usd, 0) / losses.length : 0;
  const profitFactor = losses.length && avgLoss !== 0
    ? wins.reduce((s, row) => s + row.usd, 0) / Math.abs(losses.reduce((s, row) => s + row.usd, 0))
    : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;
  const avgRR = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
  const bestTrade = valued.length ? Math.max(...valued.map((row) => row.usd)) : 0;
  const worstTrade = valued.length ? Math.min(...valued.map((row) => row.usd)) : 0;

  // Equity curve + max drawdown
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve: { date: string; cumulative: number }[] = [];
  for (const { trade, usd } of valued) {
    cumulative += usd;
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
    equityCurve.push({
      date: trade.tradeDate ? trade.tradeDate.toISOString().slice(0, 10) : "",
      cumulative: Math.round(cumulative * 100) / 100,
    });
  }

  // Sharpe ratio (annualised, daily P&L)
  const dailyMap: Record<string, number> = {};
  for (const { trade, usd } of valued) {
    const d = trade.tradeDate ? trade.tradeDate.toISOString().slice(0, 10) : "unknown";
    dailyMap[d] = (dailyMap[d] ?? 0) + usd;
  }
  const dailyPnls = Object.values(dailyMap);
  const meanDaily = dailyPnls.length ? dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length : 0;
  const std = stdDev(dailyPnls);
  const sharpe = std > 0 ? (meanDaily / std) * Math.sqrt(252) : 0;

  // Current streak
  let streak = 0;
  if (valued.length) {
    const last = valued[valued.length - 1];
    const isWin = last.usd > 0;
    for (let i = valued.length - 1; i >= 0; i--) {
      if ((valued[i].usd > 0) === isWin) streak++;
      else break;
    }
    if (!isWin) streak = -streak;
  }

  // Monthly summary
  const monthlyMap: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const { trade, usd } of valued) {
    const m = trade.tradeDate ? trade.tradeDate.toISOString().slice(0, 7) : "unknown";
    if (!monthlyMap[m]) monthlyMap[m] = { pnl: 0, trades: 0, wins: 0 };
    monthlyMap[m].pnl += usd;
    monthlyMap[m].trades += 1;
    if (usd > 0) monthlyMap[m].wins += 1;
  }
  const monthlyData = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, pnl: Math.round(v.pnl * 100) / 100 }));

  // Calendar is an activity surface, not only a realized-P&L chart. Open broker
  // trades stay visible while their unrealized P&L remains excluded from totals.
  const calendarData = buildJournalCalendarData(trades.map((trade) => ({
    id: trade.id,
    ticker: trade.ticker,
    state: trade.state,
    occurredAt: trade.tradeDate ?? trade.executedAt,
    closed: isClosed(trade),
    usdPnl: isClosed(trade) ? usdVal(trade) : null,
  })));

  return NextResponse.json({
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalTrades: closed.length,
    openTrades: trades.length - closed.length,
    winRate: Math.round(winRate * 1000) / 10,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    profitFactor: Math.round(profitFactor * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
    avgRR: Math.round(avgRR * 100) / 100,
    maxDrawdown: Math.round(maxDrawdown * 100) / 100,
    sharpe: Math.round(sharpe * 100) / 100,
    bestTrade: Math.round(bestTrade * 100) / 100,
    worstTrade: Math.round(worstTrade * 100) / 100,
    currentStreak: streak,
    unconvertedCount,
    fxUsdMyr: liveRate,
    equityCurve,
    monthlyData,
    calendarData,
  });
}
