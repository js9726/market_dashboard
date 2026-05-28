/**
 * GET /api/a-list/today
 *
 * Returns today's A-list candidates (or the most recent trading day's set if
 * no candidates exist for today yet).
 *
 * Auth: NextAuth session — owner or allowed role.
 *
 * Query params:
 *   ?date=YYYY-MM-DD     override "today" — useful for historical drill-in
 *
 * Response:
 *   {
 *     pickDate: "2026-05-28",
 *     candidates: [
 *       { id, ticker, setup, entry, stop, target, rrr, score, verdict,
 *         rvol, thesis, traderLens, sector, industry, status,
 *         day14: { mfe, mae, mfeR, maeR, score, outcome, verdict } | null,
 *         createdAt, updatedAt }
 *     ]
 *   }
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");

  // Resolve target date — explicit ?date= or fall back to most recent pickDate
  let pickDate: Date;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    pickDate = new Date(`${dateParam}T00:00:00.000Z`);
  } else {
    const latest = await prisma.aListCandidate.findFirst({
      where: { operatorLabel: "JS" },
      orderBy: { pickDate: "desc" },
      select: { pickDate: true },
    });
    if (!latest) {
      return NextResponse.json({ pickDate: null, candidates: [] });
    }
    pickDate = latest.pickDate;
  }

  const rows = await prisma.aListCandidate.findMany({
    where: { operatorLabel: "JS", pickDate },
    orderBy: [{ day0Score: "desc" }, { ticker: "asc" }],
  });

  const candidates = rows.map((r) => ({
    id: r.id,
    ticker: r.ticker,
    setup: r.setupClassification,
    screenSource: r.screenSource,
    sector: r.sector,
    industry: r.industry,
    entry: r.entryZone?.toNumber() ?? null,
    stop: r.stop?.toNumber() ?? null,
    target: r.target?.toNumber() ?? null,
    rrr: r.rrr?.toNumber() ?? null,
    score: r.day0Score,
    verdict: r.day0Verdict,
    rvol: r.day0Rvol?.toNumber() ?? null,
    thesis: r.day0Thesis,
    traderLens: r.day0TraderLens,
    briefProvider: r.day0BriefProvider,
    briefBucketAt: r.day0BriefBucketAt?.toISOString() ?? null,
    day0Price: r.day0Price?.toNumber() ?? null,
    status: r.status,
    convertedTradeId: r.convertedTradeId,
    day14: r.day14ComputedAt
      ? {
          mfe: r.day14Mfe?.toNumber() ?? null,
          mae: r.day14Mae?.toNumber() ?? null,
          mfeR: r.day14MfeR?.toNumber() ?? null,
          maeR: r.day14MaeR?.toNumber() ?? null,
          score: r.day14Score?.toNumber() ?? null,
          outcome: r.day14Outcome,
          verdict: r.day14Verdict,
          computedAt: r.day14ComputedAt.toISOString(),
        }
      : null,
    tags: r.tags,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return NextResponse.json({
    pickDate: pickDate.toISOString().slice(0, 10),
    count: candidates.length,
    candidates,
  });
}
