/**
 * journal-pivot.ts — shared aggregation core for journal analytics
 * (TradesViz-platform P2/P3). One implementation feeds BOTH:
 *   - GET /api/analytics/pivot (the Explore UI)
 *   - POST /api/coach (the AI coach's evidence)
 * so the coach's numbers and the on-screen numbers can never disagree.
 *
 * Rules preserved from the pivot route:
 *   - CLOSED trades only (pnl != null).
 *   - USD-true money: prefer pnlUsd; raw pnl only when already USD; non-USD
 *     unconverted rows are counted but excluded from money metrics.
 *   - tag/mistake are Json string arrays → a trade contributes to every group.
 */
import { prisma } from "@/lib/prisma";

export const PIVOT_DIMENSIONS = [
  "ticker",
  "side",
  "strategy",
  "source",
  "platform",
  "industry",
  "currency",
  "tag",
  "mistake",
  "dow",
  "month",
] as const;
export type PivotDimension = (typeof PIVOT_DIMENSIONS)[number];

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((s) => s.trim());
}

export type PivotTradeRow = {
  ticker: string;
  side: string | null;
  strategy: string | null;
  source: string | null;
  platform: string | null;
  industry: string | null;
  currencyCode: string | null;
  currency: string | null;
  pnl: unknown;
  pnlUsd: unknown;
  tags: unknown;
  mistakes: unknown;
  tradeDate: Date | null;
  executedAt: Date | null;
  rrr: unknown;
};

/** USD-true P&L, or null when it can't be trusted in a USD sum. */
export function usdPnl(t: PivotTradeRow): number | null {
  const converted = num(t.pnlUsd);
  if (converted != null) return converted;
  const raw = num(t.pnl);
  if (raw == null) return null;
  const code = (t.currencyCode ?? t.currency ?? "").toUpperCase();
  if (code === "" || code === "USD") return raw;
  return null;
}

export function keysFor(dim: PivotDimension, t: PivotTradeRow): string[] {
  const when = t.tradeDate ?? t.executedAt;
  switch (dim) {
    case "ticker":
      return [t.ticker || "(unknown)"];
    case "side":
      return [t.side || "(unset)"];
    case "strategy":
      return [t.strategy || "(untagged)"];
    case "source":
      return [t.source || "(unknown)"];
    case "platform":
      return [t.platform || "(unknown)"];
    case "industry":
      return [t.industry || "(unknown)"];
    case "currency":
      return [(t.currencyCode ?? t.currency ?? "USD").toUpperCase()];
    case "tag": {
      const tags = strList(t.tags);
      return tags.length ? tags : ["(untagged)"];
    }
    case "mistake": {
      const m = strList(t.mistakes);
      return m.length ? m : ["(none logged)"];
    }
    case "dow":
      return [when ? DOW[when.getUTCDay()] : "(no date)"];
    case "month":
      return [when ? when.toISOString().slice(0, 7) : "(no date)"];
  }
}

export interface PivotGroup {
  key: string;
  count: number;
  pricedCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  avgRrr: number | null;
  best: number | null;
  worst: number | null;
}

export interface PivotResult {
  groupBy: PivotDimension;
  rows: PivotGroup[];
  totals: {
    trades: number;
    measuredTrades: number;
    totalPnl: number;
    winRate: number | null;
    unconvertedExcluded: number;
  };
  dataQuality: { weekendDated: number; weekendSample: string[] };
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function loadClosedTrades(userId: string, from?: Date | null, to?: Date | null): Promise<PivotTradeRow[]> {
  return (await prisma.tradeRecord.findMany({
    where: {
      userId,
      pnl: { not: null },
      // Reconciler-marked duplicate episodes must not double-count (":dup").
      // NULL-SAFE: sheet rows have brokerOrderId null; bare NOT{endsWith}
      // drops them (SQL three-valued logic), so allow nulls explicitly.
      OR: [{ brokerOrderId: null }, { NOT: { brokerOrderId: { endsWith: ":dup" } } }],
      ...(from || to
        ? { OR: [{ tradeDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }] }
        : {}),
    },
    select: {
      ticker: true,
      side: true,
      strategy: true,
      source: true,
      platform: true,
      industry: true,
      currencyCode: true,
      currency: true,
      pnl: true,
      pnlUsd: true,
      tags: true,
      mistakes: true,
      tradeDate: true,
      executedAt: true,
      rrr: true,
    },
  })) as unknown as PivotTradeRow[];
}

/** Group pre-loaded trades by one dimension with the full metric set. */
export function computePivot(trades: PivotTradeRow[], groupBy: PivotDimension): PivotResult {
  type Acc = {
    key: string;
    count: number;
    wins: number;
    losses: number;
    scratch: number;
    grossWin: number;
    grossLoss: number;
    totalPnl: number;
    pricedCount: number;
    best: number | null;
    worst: number | null;
    rrrSum: number;
    rrrCount: number;
  };
  const acc = new Map<string, Acc>();
  let unconvertedExcluded = 0;
  let overallPnl = 0;
  let overallWins = 0;
  let overallPriced = 0;
  let weekendDated = 0;
  const weekendSample: string[] = [];

  for (const t of trades) {
    const when = t.tradeDate ?? t.executedAt;
    if (when && (when.getUTCDay() === 0 || when.getUTCDay() === 6)) {
      weekendDated++;
      if (weekendSample.length < 15) weekendSample.push(`${t.ticker} ${when.toISOString().slice(0, 10)}`);
    }
    const p = usdPnl(t);
    if (p == null) unconvertedExcluded++;
    for (const key of keysFor(groupBy, t)) {
      let a = acc.get(key);
      if (!a) {
        a = { key, count: 0, wins: 0, losses: 0, scratch: 0, grossWin: 0, grossLoss: 0, totalPnl: 0, pricedCount: 0, best: null, worst: null, rrrSum: 0, rrrCount: 0 };
        acc.set(key, a);
      }
      a.count++;
      const r = num(t.rrr);
      if (r != null) {
        a.rrrSum += r;
        a.rrrCount++;
      }
      if (p == null) continue;
      a.pricedCount++;
      a.totalPnl += p;
      if (p > 0) {
        a.wins++;
        a.grossWin += p;
      } else if (p < 0) {
        a.losses++;
        a.grossLoss += Math.abs(p);
      } else {
        a.scratch++;
      }
      a.best = a.best == null ? p : Math.max(a.best, p);
      a.worst = a.worst == null ? p : Math.min(a.worst, p);
    }
    if (p != null) {
      overallPnl += p;
      overallPriced++;
      if (p > 0) overallWins++;
    }
  }

  const rows: PivotGroup[] = Array.from(acc.values()).map((a) => {
    const decided = a.wins + a.losses;
    return {
      key: a.key,
      count: a.count,
      pricedCount: a.pricedCount,
      wins: a.wins,
      losses: a.losses,
      winRate: decided > 0 ? r2((a.wins / decided) * 100) : null,
      totalPnl: r2(a.totalPnl),
      avgPnl: a.pricedCount > 0 ? r2(a.totalPnl / a.pricedCount) : null,
      expectancy: a.pricedCount > 0 ? r2(a.totalPnl / a.pricedCount) : null,
      profitFactor: a.grossLoss > 0 ? r2(a.grossWin / a.grossLoss) : a.grossWin > 0 ? null : 0,
      avgRrr: a.rrrCount > 0 ? r2(a.rrrSum / a.rrrCount) : null,
      best: a.best == null ? null : r2(a.best),
      worst: a.worst == null ? null : r2(a.worst),
    };
  });

  return {
    groupBy,
    rows,
    totals: {
      trades: trades.length,
      measuredTrades: overallPriced,
      totalPnl: r2(overallPnl),
      winRate: overallPriced > 0 ? r2((overallWins / overallPriced) * 100) : null,
      unconvertedExcluded,
    },
    dataQuality: { weekendDated, weekendSample },
  };
}
