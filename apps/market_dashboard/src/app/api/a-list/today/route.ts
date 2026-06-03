/**
 * GET /api/a-list/today
 *
 * Returns today's A-list candidates (or the most recent trading day's set if
 * no candidates exist for today yet).
 *
 * Auth: NextAuth session. Approved users read their own personal A-list.
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
import { Prisma, PrismaClient } from "@prisma/client";
import { serializeCandidate } from "@/server/alist-serialize";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { getOperatorUserId } from "@/server/operator";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");

  // SaaS visibility: REC picks are a SHARED operator resource (every approved
  // user sees the same screener picks); HELD positions are PERSONAL to the
  // caller. For the operator these two collapse to "their own rows" — a no-op
  // for the single owner today, and correct once clients exist.
  const selfId = scopeUserId(session)!;
  const operatorId = (await getOperatorUserId()) ?? selfId;
  const visibility: Prisma.AListCandidateWhereInput = {
    OR: [
      { userId: operatorId, isHeld: false }, // shared REC lane
      { userId: selfId, isHeld: true },      // personal HELD lane
    ],
  };

  // Resolve target date — explicit ?date= or fall back to most recent pickDate
  let pickDate: Date;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    pickDate = new Date(`${dateParam}T00:00:00.000Z`);
  } else {
    const latest = await prisma.aListCandidate.findFirst({
      where: visibility,
      orderBy: { pickDate: "desc" },
      select: { pickDate: true },
    });
    if (!latest) {
      return NextResponse.json({ pickDate: null, candidates: [] });
    }
    pickDate = latest.pickDate;
  }

  const rows = await prisma.aListCandidate.findMany({
    where: { ...visibility, pickDate },
    orderBy: [{ day0Score: "desc" }, { ticker: "asc" }],
  });

  const candidates = rows.map(serializeCandidate);

  return NextResponse.json({
    pickDate: pickDate.toISOString().slice(0, 10),
    count: candidates.length,
    candidates,
  });
}
