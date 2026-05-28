/**
 * GET /api/a-list/history
 *
 * Paginated A-list history with filters. Powers the /a-list dashboard page.
 *
 * Auth: NextAuth session — owner or allowed role.
 *
 * Query params:
 *   ?from=YYYY-MM-DD    inclusive lower bound on pickDate (default: 90 days ago)
 *   ?to=YYYY-MM-DD      inclusive upper bound on pickDate (default: today)
 *   ?ticker=NVDA        filter by ticker (case-insensitive prefix match)
 *   ?sector=Technology  filter by sector (exact match)
 *   ?setup=EP-FRESH     filter by setup classification
 *   ?status=ACTIVE      filter by status (ACTIVE|EXPIRED|HIT_TARGET|STOPPED_OUT|MANUALLY_CLOSED|CONVERTED)
 *   ?outcome=HIT_TARGET filter by day14Outcome
 *   ?minScore=80        minimum day0Score
 *   ?sort=date|score|outcome   sort field (default: date desc)
 *   ?limit=50           page size (max 200, default 50)
 *   ?cursor=<id>        opaque pagination cursor (next page)
 *
 * Response:
 *   {
 *     count: number,
 *     nextCursor: string | null,
 *     items: [ <same shape as /today> ]
 *   }
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const qp = url.searchParams;

  // ── Parse filters ────────────────────────────────────────────────────
  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 90);

  const from = qp.get("from") && /^\d{4}-\d{2}-\d{2}$/.test(qp.get("from")!)
    ? new Date(`${qp.get("from")}T00:00:00.000Z`)
    : new Date(defaultFrom.toISOString().slice(0, 10) + "T00:00:00.000Z");
  const to = qp.get("to") && /^\d{4}-\d{2}-\d{2}$/.test(qp.get("to")!)
    ? new Date(`${qp.get("to")}T00:00:00.000Z`)
    : new Date(today.toISOString().slice(0, 10) + "T00:00:00.000Z");

  const where: Prisma.AListCandidateWhereInput = {
    operatorLabel: "JS",
    pickDate: { gte: from, lte: to },
  };

  const ticker = qp.get("ticker");
  if (ticker) where.ticker = { startsWith: ticker.toUpperCase() };

  const sector = qp.get("sector");
  if (sector) where.sector = sector;

  const setup = qp.get("setup");
  if (setup) where.setupClassification = setup;

  const status = qp.get("status");
  if (status) where.status = status;

  const outcome = qp.get("outcome");
  if (outcome) where.day14Outcome = outcome;

  const minScore = qp.get("minScore");
  if (minScore && !Number.isNaN(parseInt(minScore))) {
    where.day0Score = { gte: parseInt(minScore) };
  }

  // ── Sort ─────────────────────────────────────────────────────────────
  const sortParam = qp.get("sort") ?? "date";
  let orderBy: Prisma.AListCandidateOrderByWithRelationInput[];
  if (sortParam === "score") {
    orderBy = [{ day0Score: "desc" }, { pickDate: "desc" }];
  } else if (sortParam === "outcome") {
    orderBy = [{ day14Score: "desc" }, { pickDate: "desc" }];
  } else {
    orderBy = [{ pickDate: "desc" }, { day0Score: "desc" }];
  }

  // ── Pagination ───────────────────────────────────────────────────────
  const limit = Math.min(parseInt(qp.get("limit") ?? "50"), 200);
  const cursor = qp.get("cursor");

  const rows = await prisma.aListCandidate.findMany({
    where,
    orderBy,
    take: limit + 1, // fetch one extra to know if there's a next page
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((r) => ({
    id: r.id,
    pickDate: r.pickDate.toISOString().slice(0, 10),
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
  }));

  return NextResponse.json({
    count: items.length,
    nextCursor: hasMore ? rows[limit - 1].id : null,
    items,
  });
}
