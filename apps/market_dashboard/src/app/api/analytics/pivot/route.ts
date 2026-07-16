/**
 * GET /api/analytics/pivot — "group my trades by ANY field and measure them"
 * (TradesViz-platform P2-🄺).
 *
 * Thin HTTP wrapper over src/server/journal-pivot.ts — the SAME aggregation
 * core the AI coach (/api/coach) uses for its evidence, so the coach's numbers
 * and the Explore screen can never disagree.
 *
 * Query:
 *   ?groupBy=ticker|side|strategy|source|platform|industry|currency|tag|mistake|dow|month
 *   ?from=YYYY-MM-DD & ?to=YYYY-MM-DD   (optional; on trade date)
 *   ?sort=totalPnl|count|winRate|expectancy|profitFactor   (default totalPnl)
 *   ?minCount=N   (default 1)
 *
 * Auth: session; strictly the caller's OWN trades (multi-tenant rule).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import {
  PIVOT_DIMENSIONS,
  type PivotDimension,
  type PivotGroup,
  computePivot,
  loadClosedTrades,
} from "@/server/journal-pivot";

export const dynamic = "force-dynamic";

const SORTS = ["totalPnl", "count", "winRate", "expectancy", "profitFactor"] as const;
type SortKey = (typeof SORTS)[number];

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const qp = new URL(req.url).searchParams;
  const groupByRaw = (qp.get("groupBy") ?? "strategy") as PivotDimension;
  const groupBy: PivotDimension = (PIVOT_DIMENSIONS as readonly string[]).includes(groupByRaw)
    ? groupByRaw
    : "strategy";
  const sortRaw = (qp.get("sort") ?? "totalPnl") as SortKey;
  const sort: SortKey = (SORTS as readonly string[]).includes(sortRaw) ? sortRaw : "totalPnl";
  const minCount = Math.max(1, parseInt(qp.get("minCount") ?? "1", 10) || 1);
  const fromStr = qp.get("from");
  const toStr = qp.get("to");
  const from = fromStr && /^\d{4}-\d{2}-\d{2}$/.test(fromStr) ? new Date(`${fromStr}T00:00:00.000Z`) : null;
  const to = toStr && /^\d{4}-\d{2}-\d{2}$/.test(toStr) ? new Date(`${toStr}T23:59:59.999Z`) : null;

  const trades = await loadClosedTrades(userId, from, to);
  const pivot = computePivot(trades, groupBy);

  const pick = (o: PivotGroup): number => {
    const v = o[sort as keyof PivotGroup];
    return typeof v === "number" ? v : -Infinity;
  };
  const rows = pivot.rows.filter((r) => r.count >= minCount).sort((a, b) => pick(b) - pick(a));

  const multiCount = groupBy === "tag" || groupBy === "mistake";
  return NextResponse.json({
    groupBy,
    sort,
    from: fromStr ?? null,
    to: toStr ?? null,
    dimensions: PIVOT_DIMENSIONS,
    sorts: SORTS,
    rows,
    totals: pivot.totals,
    dataQuality: {
      ...pivot.dataQuality,
      warning:
        pivot.dataQuality.weekendDated > 0 && groupBy === "dow"
          ? `${pivot.dataQuality.weekendDated} trade(s) are dated Saturday/Sunday in the source sheet — markets are shut, so those are recorded-date errors, not trading days. They are shown (not dropped) but the Sat/Sun rows are not real sessions; fix the dates at source and re-sync.`
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
