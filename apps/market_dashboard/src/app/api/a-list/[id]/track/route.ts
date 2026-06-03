/**
 * GET /api/a-list/[id]/track — the day-0->14 price path for one candidate.
 * Powers the AListDetailPanel drill-in (close vs 8/21-EMA, stop + EMA-break
 * markers, running MFE/MAE in R). Multi-tenant: only the candidate owner may
 * read this path.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { getOperatorUserId } from "@/server/operator";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const userScopeId = scopeUserId(session)!;

  const cand = await prisma.aListCandidate.findUnique({
    where: { id },
    select: { userId: true, isHeld: true },
  });
  if (!cand) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Visibility: the caller's own row, OR a shared REC pick (operator-owned,
  // not held). Mirrors /api/a-list/today + /history.
  let allowed = cand.userId === userScopeId;
  if (!allowed && !cand.isHeld) {
    const operatorId = await getOperatorUserId();
    allowed = operatorId != null && cand.userId === operatorId;
  }
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rows = await prisma.positionDailyTrack.findMany({
    where: { candidateId: id },
    orderBy: { dayIndex: "asc" },
  });

  return NextResponse.json({
    track: rows.map((r) => ({
      dayIndex: r.dayIndex,
      sessionDate: r.sessionDate.toISOString().slice(0, 10),
      open: r.open?.toNumber() ?? null,
      high: r.high?.toNumber() ?? null,
      low: r.low?.toNumber() ?? null,
      close: r.close?.toNumber() ?? null,
      ema8: r.ema8?.toNumber() ?? null,
      ema21: r.ema21?.toNumber() ?? null,
      atr14: r.atr14?.toNumber() ?? null,
      closeBelow8ema: r.closeBelow8ema,
      closeBelow21ema: r.closeBelow21ema,
      hardStopHitLogged: r.hardStopHitLogged,
      hardStopHitAtr: r.hardStopHitAtr,
      runMfeR: r.runMfeR?.toNumber() ?? null,
      runMaeR: r.runMaeR?.toNumber() ?? null,
    })),
  });
}
