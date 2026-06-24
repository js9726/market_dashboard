import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { getUsdMyrRate } from "@/lib/equity-currency";
import { prisma } from "@/lib/prisma";
import { brokerKey, isOpenishTrade, plainTicker } from "@/lib/trades/position-trade-records";
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

function dateKey(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
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
  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId } },
    select: {
      ticker: true,
      openedAt: true,
      brokerAccountId: true,
      brokerAccount: { select: { alias: true } },
    },
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
  const isClosed = (t: typeof trades[0]) =>
    t.state ? t.state.toUpperCase() === "CLOSE" : t.pnl !== null;
  const isOpenTrade = (t: typeof trades[0]) => isOpenishTrade(t.state, t.pnl);
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
    const d = dateKey(trade.tradeDate) ?? "unknown";
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
    const m = dateKey(trade.tradeDate)?.slice(0, 7) ?? "unknown";
    if (!monthlyMap[m]) monthlyMap[m] = { pnl: 0, trades: 0, wins: 0 };
    monthlyMap[m].pnl += usd;
    monthlyMap[m].trades += 1;
    if (usd > 0) monthlyMap[m].wins += 1;
  }
  const monthlyData = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, pnl: Math.round(v.pnl * 100) / 100 }));

  // Calendar trade counts should reflect execution entries, including open
  // broker positions. P&L remains closed/valued only.
  const tradeCountByDay: Record<string, number> = {};
  for (const trade of trades) {
    const d = dateKey(trade.tradeDate);
    if (!d) continue;
    tradeCountByDay[d] = (tradeCountByDay[d] ?? 0) + 1;
  }

  const representedOpenPositions = new Set<string>();
  for (const trade of trades.filter(isOpenTrade)) {
    const ticker = plainTicker(trade.ticker);
    representedOpenPositions.add(`${ticker}|${brokerKey(trade.platform)}`);
    if (trade.brokerAccountId) representedOpenPositions.add(`${ticker}|acct:${trade.brokerAccountId}`);
  }
  let syntheticOpenPositions = 0;
  for (const position of positions) {
    const ticker = plainTicker(position.ticker);
    if (
      representedOpenPositions.has(`${ticker}|${brokerKey(position.brokerAccount.alias)}`) ||
      representedOpenPositions.has(`${ticker}|acct:${position.brokerAccountId}`)
    ) {
      continue;
    }
    const d = dateKey(position.openedAt);
    if (!d) continue;
    tradeCountByDay[d] = (tradeCountByDay[d] ?? 0) + 1;
    syntheticOpenPositions++;
  }

  const calendarDates = Array.from(new Set([...Object.keys(dailyMap), ...Object.keys(tradeCountByDay)]));
  const calendarData = calendarDates
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({
      date,
      pnl: dailyMap[date] == null ? null : Math.round(dailyMap[date] * 100) / 100,
      trades: tradeCountByDay[date] ?? 0,
    }));
  const totalTradeEntries = trades.length + syntheticOpenPositions;

  return NextResponse.json({
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalTrades: totalTradeEntries,
    openTrades: trades.filter((t) => !isClosed(t)).length + syntheticOpenPositions,
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
