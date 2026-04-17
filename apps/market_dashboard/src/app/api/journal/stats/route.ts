import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
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

  const userId = session.user.id;

  const trades = await prisma.trade.findMany({
    where: { userId },
    orderBy: { tradeDate: "asc" },
  });

  const closed = trades.filter((t) => t.pnl !== null);
  const totalPnl = closed.reduce((s, t) => s + toNum(t.pnl), 0);
  const wins = closed.filter((t) => toNum(t.pnl) > 0);
  const losses = closed.filter((t) => toNum(t.pnl) <= 0);
  const winRate = closed.length ? wins.length / closed.length : 0;
  const avgWin = wins.length ? wins.reduce((s, t) => s + toNum(t.pnl), 0) / wins.length : 0;
  const avgLoss = losses.length ? losses.reduce((s, t) => s + toNum(t.pnl), 0) / losses.length : 0;
  const profitFactor = losses.length && avgLoss !== 0
    ? wins.reduce((s, t) => s + toNum(t.pnl), 0) / Math.abs(losses.reduce((s, t) => s + toNum(t.pnl), 0))
    : 0;
  const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;
  const avgRR = avgLoss !== 0 ? avgWin / Math.abs(avgLoss) : 0;
  const bestTrade = closed.length ? Math.max(...closed.map((t) => toNum(t.pnl))) : 0;
  const worstTrade = closed.length ? Math.min(...closed.map((t) => toNum(t.pnl))) : 0;

  // Equity curve + max drawdown
  let cumulative = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve: { date: string; cumulative: number }[] = [];
  for (const t of closed) {
    cumulative += toNum(t.pnl);
    if (cumulative > peak) peak = cumulative;
    const dd = peak - cumulative;
    if (dd > maxDrawdown) maxDrawdown = dd;
    equityCurve.push({
      date: t.tradeDate ? t.tradeDate.toISOString().slice(0, 10) : "",
      cumulative: Math.round(cumulative * 100) / 100,
    });
  }

  // Sharpe ratio (annualised, daily P&L)
  const dailyMap: Record<string, number> = {};
  for (const t of closed) {
    const d = t.tradeDate ? t.tradeDate.toISOString().slice(0, 10) : "unknown";
    dailyMap[d] = (dailyMap[d] ?? 0) + toNum(t.pnl);
  }
  const dailyPnls = Object.values(dailyMap);
  const meanDaily = dailyPnls.length ? dailyPnls.reduce((a, b) => a + b, 0) / dailyPnls.length : 0;
  const std = stdDev(dailyPnls);
  const sharpe = std > 0 ? (meanDaily / std) * Math.sqrt(252) : 0;

  // Current streak
  let streak = 0;
  if (closed.length) {
    const last = closed[closed.length - 1];
    const isWin = toNum(last.pnl) > 0;
    for (let i = closed.length - 1; i >= 0; i--) {
      if ((toNum(closed[i].pnl) > 0) === isWin) streak++;
      else break;
    }
    if (!isWin) streak = -streak;
  }

  // Monthly summary
  const monthlyMap: Record<string, { pnl: number; trades: number; wins: number }> = {};
  for (const t of closed) {
    const m = t.tradeDate ? t.tradeDate.toISOString().slice(0, 7) : "unknown";
    if (!monthlyMap[m]) monthlyMap[m] = { pnl: 0, trades: 0, wins: 0 };
    monthlyMap[m].pnl += toNum(t.pnl);
    monthlyMap[m].trades += 1;
    if (toNum(t.pnl) > 0) monthlyMap[m].wins += 1;
  }
  const monthlyData = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, pnl: Math.round(v.pnl * 100) / 100 }));

  // Calendar data
  const calendarData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, pnl]) => ({
      date,
      pnl: Math.round(pnl * 100) / 100,
      trades: closed.filter((t) => t.tradeDate?.toISOString().slice(0, 10) === date).length,
    }));

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
    equityCurve,
    monthlyData,
    calendarData,
  });
}
