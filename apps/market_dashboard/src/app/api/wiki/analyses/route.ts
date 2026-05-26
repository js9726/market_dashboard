/**
 * GET /api/wiki/analyses
 *
 * Returns chat ad-hoc analyses (WikiTradeVerdict rows where intent='analysis').
 * These are scored tickers the user asked about in chat — separate from
 * journaled trades so they don't pollute the monthly audit rollup.
 *
 * Query params:
 *   ?operator=JS|XX|...   filter to one operator (defaults to all)
 *   ?since=YYYY-MM-DD     only show analyses on or after this date
 */
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const OPERATOR_RE = /^[A-Z]{2,8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const operatorRaw = url.searchParams.get("operator");
  const operatorLabel = operatorRaw && OPERATOR_RE.test(operatorRaw.toUpperCase())
    ? operatorRaw.toUpperCase()
    : undefined;
  const sinceRaw = url.searchParams.get("since");
  const since = sinceRaw && DATE_RE.test(sinceRaw) ? new Date(`${sinceRaw}T00:00:00Z`) : undefined;

  try {
    const rows = await prisma.wikiTradeVerdict.findMany({
      where: {
        intent: "analysis",
        ...(operatorLabel ? { operatorLabel } : {}),
        ...(since ? { tradeDate: { gte: since } } : {}),
      },
      orderBy: [{ tradeDate: "desc" }, { operatorLabel: "asc" }, { ticker: "asc" }],
      take: 500,
    });

    const operatorSet = new Set<string>();
    for (const r of rows) operatorSet.add(r.operatorLabel);

    return NextResponse.json({
      operators: Array.from(operatorSet).sort(),
      count: rows.length,
      analyses: rows.map((r) => {
        const d0 = (r.day0Json ?? {}) as Record<string, unknown>;
        const date = r.tradeDate.toISOString().slice(0, 10);
        const op = encodeURIComponent(r.operatorLabel);
        return {
          operatorLabel: r.operatorLabel,
          date,
          ticker: r.ticker,
          setupClassification: (d0.setup_classification as string | undefined) ?? null,
          compositeScore: (d0.composite_technical_score as number | undefined) ?? null,
          bestStyleMatch: (d0.best_style_match as string | undefined) ?? null,
          weakestDimension: (d0.weakest_dimension as string | undefined) ?? null,
          predictedOutcome: (d0.predicted_outcome as string | undefined) ?? null,
          predictedExit: (d0.predicted_exit_price as number | undefined) ?? null,
          predictedStop: (d0.predicted_stop_price as number | undefined) ?? null,
          verdictUrl: `/api/wiki/trades/${date}/${r.ticker}/day0?operator=${op}`,
          ingestedAt: r.ingestedAt.toISOString(),
        };
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `analyses query failed: ${msg}` }, { status: 500 });
  }
}
