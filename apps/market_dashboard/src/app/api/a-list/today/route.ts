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
import { serializeCandidate } from "@/server/alist-serialize";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");

  // Multi-operator: resolve the scope user.
  // - Owners read their own A-list.
  // - Allowed (read-only) viewers see the FIRST owner's A-list (shared view).
  // - Pending/denied get nothing.
  let scopeUserId = session.user.id;
  const role = (session.user as { role?: string }).role;
  if (role !== "owner") {
    const owner = await prisma.user.findFirst({
      where: { role: "owner" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (!owner) return NextResponse.json({ pickDate: null, candidates: [] });
    scopeUserId = owner.id;
  }

  // Resolve target date — explicit ?date= or fall back to most recent pickDate
  let pickDate: Date;
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    pickDate = new Date(`${dateParam}T00:00:00.000Z`);
  } else {
    const latest = await prisma.aListCandidate.findFirst({
      where: { userId: scopeUserId },
      orderBy: { pickDate: "desc" },
      select: { pickDate: true },
    });
    if (!latest) {
      return NextResponse.json({ pickDate: null, candidates: [] });
    }
    pickDate = latest.pickDate;
  }

  const rows = await prisma.aListCandidate.findMany({
    where: { userId: scopeUserId, pickDate },
    orderBy: [{ day0Score: "desc" }, { ticker: "asc" }],
  });

  const candidates = rows.map(serializeCandidate);

  return NextResponse.json({
    pickDate: pickDate.toISOString().slice(0, 10),
    count: candidates.length,
    candidates,
  });
}
