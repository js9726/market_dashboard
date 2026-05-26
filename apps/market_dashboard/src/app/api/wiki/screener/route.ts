/**
 * GET /api/wiki/screener
 *
 * Returns daily screener picks (WikiScreenerPick rows). Lightweight rows —
 * no full LLM verdict per ticker — used to compute conversion rate
 * (screener → journaled trade) and surface missed setups.
 *
 * Query params:
 *   ?operator=JS|XX|...   filter to one operator (defaults to all)
 *   ?since=YYYY-MM-DD     only show picks on or after this date (defaults to 60d ago)
 *   ?source=name          filter to one screener source
 */
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const OPERATOR_RE = /^[A-Z]{2,8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SIXTY_DAYS_MS = 60 * 24 * 60 * 60 * 1000;

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
  const since = sinceRaw && DATE_RE.test(sinceRaw)
    ? new Date(`${sinceRaw}T00:00:00Z`)
    : new Date(Date.now() - SIXTY_DAYS_MS);
  const screenSource = url.searchParams.get("source") || undefined;

  try {
    const picks = await prisma.wikiScreenerPick.findMany({
      where: {
        ...(operatorLabel ? { operatorLabel } : {}),
        ...(screenSource ? { screenSource } : {}),
        pickDate: { gte: since },
      },
      orderBy: [{ pickDate: "desc" }, { operatorLabel: "asc" }, { ticker: "asc" }],
      take: 1000,
    });

    const operatorSet = new Set<string>();
    const sourceSet = new Set<string>();
    const bySource: Record<string, number> = {};
    let converted = 0;
    for (const p of picks) {
      operatorSet.add(p.operatorLabel);
      sourceSet.add(p.screenSource);
      bySource[p.screenSource] = (bySource[p.screenSource] ?? 0) + 1;
      if (p.convertedTradeId) converted += 1;
    }

    return NextResponse.json({
      operators: Array.from(operatorSet).sort(),
      sources: Array.from(sourceSet).sort(),
      counts: {
        total: picks.length,
        converted,
        // Conversion rate as a percentage; 0 if no picks.
        conversionPct: picks.length > 0 ? Math.round((converted / picks.length) * 1000) / 10 : 0,
        bySource,
      },
      picks: picks.map((p) => ({
        operatorLabel: p.operatorLabel,
        date: p.pickDate.toISOString().slice(0, 10),
        ticker: p.ticker,
        setupClassification: p.setupClassification,
        screenSource: p.screenSource,
        notes: p.notes,
        sourceUrl: p.sourceUrl,
        convertedTradeId: p.convertedTradeId,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `screener query failed: ${msg}` }, { status: 500 });
  }
}
