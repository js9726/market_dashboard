/**
 * GET /api/analytics/pivot — "group my trades by ANY field and measure them"
 * (TradesViz-platform P2-🄺).
 *
 * The pivot-grid backbone the platform was missing: TradesViz lets a trader ask
 * "what's my expectancy by day-of-week / by setup / by tag / by broker?" — this
 * is the server side of that. Group journal trades by one dimension and return
 * the full metric set per group, sorted by the requested metric.
 *
 * Query:
 *   ?groupBy=ticker|side|strategy|source|platform|industry|currency|tag|mistake|dow|month|hour
 *   ?from=YYYY-MM-DD & ?to=YYYY-MM-DD   (optional; on trade date)
 *   ?sort=totalPnl|count|winRate|expectancy|profitFactor   (default totalPnl)
 *   ?minCount=N   (default 1 — hide thin groups)
 *
 * Response: { groupBy, from, to, dimensions[], rows[], totals, note }
 *
 * Correctness notes:
 *   - CLOSED trades only (pnl != null). Open trades have no realized outcome and
 *     would corrupt win-rate/expectancy.
 *   - P&L is currency-normalised: prefers `pnlUsd` (the FX-converted truth) and
 *     falls back to raw `pnl` ONLY when the trade is already USD or has no rate.
 *     Rows whose currency is non-USD and unconverted are counted in
 *     `totals.unconvertedExcluded` and left OUT of money metrics rather than
 *     silently mixing MYR into a USD sum (the currency-truth rule).
 *   - `tag` / `mistake` are Json arrays: a trade contributes to EVERY tag group
 *     it carries, so group counts can exceed the trade count (documented in note).
 *
 * Auth: session; strictly the caller's OWN trades (multi-tenant rule, access.ts).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DIMENSIONS = [
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
type Dimension = (typeof DIMENSIONS)[number];

const SORTS = ["totalPnl", "count", "winRate", "expectancy", "profitFactor"] as const;
type SortKey = (typeof SORTS)[number];

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** String list out of a Json column that should hold string[]. */
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((s) => s.trim());
}

type Row = {
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

/** The USD-true P&L for a trade, or null when it can't be trusted in a USD sum. */
function usdPnl(t: Row): number | null {
  const converted = num(t.pnlUsd);
  if (converted != null) return converted;
  const raw = num(t.pnl);
  if (raw == null) return null;
  const code = (t.currencyCode ?? t.currency ?? "").toUpperCase();
  // No explicit currency, or already USD → the raw number is USD.
  if (code === "" || code === "USD") return raw;
  return null; // non-USD and unconverted — excluded from money metrics
}

function keysFor(dim: Dimension, t: Row): string[] {
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

type Acc = {
  key: string;
  count: number;
  wins: number;
  losses: number;
  scratch: number;
  grossWin: number;
  grossLoss: number; // positive magnitude
  totalPnl: number;
  pricedCount: number; // trades that contributed to money metrics
  best: number | null;
  worst: number | null;
  rrrSum: number;
  rrrCount: number;
};

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const qp = new URL(req.url).searchParams;
  const groupByRaw = (qp.get("groupBy") ?? "strategy") as Dimension;
  const groupBy: Dimension = (DIMENSIONS as readonly string[]).includes(groupByRaw) ? groupByRaw : "strategy";
  const sortRaw = (qp.get("sort") ?? "totalPnl") as SortKey;
  const sort: SortKey = (SORTS as readonly string[]).includes(sortRaw) ? sortRaw : "totalPnl";
  const minCount = Math.max(1, parseInt(qp.get("minCount") ?? "1", 10) || 1);
  const fromStr = qp.get("from");
  const toStr = qp.get("to");
  const from = fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr) ? new Date(`${fromStr}T00:00:00.000Z`) : null;
  const to = toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr) ? new Date(`${toStr}T23:59:59.999Z`) : null;

  const trades = (await prisma.tradeRecord.findMany({
    where: {
      userId,
      pnl: { not: null }, // closed only
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
  })) as unknown as Row[];

  const acc = new Map<string, Acc>();
  let unconvertedExcluded = 0;
  let overallPnl = 0;
  let overallWins = 0;
  let overallPriced = 0;
  // Data quality: trades whose recorded date lands on a weekend. Markets are
  // shut Sat/Sun, so these are source-sheet date errors, NOT trading days. They
  // are NOT silently dropped (that would hide the problem) — they are counted
  // and surfaced so a day-of-week read isn't taken at face value.
  let weekendDated = 0;
  const weekendTickers: string[] = [];

  for (const t of trades) {
    const when = t.tradeDate ?? t.executedAt;
    if (when && (when.getUTCDay() === 0 || when.getUTCDay() === 6)) {
      weekendDated++;
      if (weekendTickers.length < 15) weekendTickers.push(`${t.ticker} ${when.toISOString().slice(0, 10)}`);
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
      if (p == null) continue; // counted, but not money-measured
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

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows = Array.from(acc.values())
    .filter((a) => a.count >= minCount)
    .map((a) => {
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
        // Expectancy == average realised P&L per measured trade (USD).
        expectancy: a.pricedCount > 0 ? r2(a.totalPnl / a.pricedCount) : null,
        profitFactor: a.grossLoss > 0 ? r2(a.grossWin / a.grossLoss) : a.grossWin > 0 ? null : 0,
        avgRrr: a.rrrCount > 0 ? r2(a.rrrSum / a.rrrCount) : null,
        best: a.best == null ? null : r2(a.best),
        worst: a.worst == null ? null : r2(a.worst),
      };
    })
    .sort((x, y) => {
      const pick = (o: typeof x) => {
        const v = o[sort as keyof typeof o];
        return typeof v === "number" ? v : -Infinity;
      };
      return pick(y) - pick(x);
    });

  const multiCount = groupBy === "tag" || groupBy === "mistake";
  return NextResponse.json({
    groupBy,
    sort,
    from: fromStr ?? null,
    to: toStr ?? null,
    dimensions: DIMENSIONS,
    sorts: SORTS,
    rows,
    totals: {
      trades: trades.length,
      measuredTrades: overallPriced,
      totalPnl: r2(overallPnl),
      winRate: overallPriced > 0 ? r2((overallWins / overallPriced) * 100) : null,
      unconvertedExcluded,
    },
    dataQuality: {
      weekendDated,
      weekendSample: weekendTickers,
      // Only a day-of-week read is actually distorted by a bad weekday.
      warning:
        weekendDated > 0 && groupBy === "dow"
          ? `${weekendDated} trade(s) are dated Saturday/Sunday in the source sheet — markets are shut, so those are recorded-date errors, not trading days. They are shown (not dropped) but the Sat/Sun rows are not real sessions; fix the dates at source and re-sync.`
          : null,
    },
    note: [
      "Closed trades only (realized P&L).",
      "P&L is USD-true: non-USD trades without an FX rate are counted but excluded from money metrics.",
      multiCount ? "A trade contributes to every tag/mistake it carries, so group counts can exceed trade count." : null,
      groupBy === "dow" ? "Grouped by ENTRY date (tradeDate), which is what 'which day do I trade badly' means." : null,
    ]
      .filter(Boolean)
      .join(" "),
  });
}
