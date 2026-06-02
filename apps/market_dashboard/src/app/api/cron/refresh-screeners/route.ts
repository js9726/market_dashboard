/**
 * /api/cron/refresh-screeners
 *
 * Vercel Cron entry for the TV screeners. Uses the same DB-backed refresh
 * helper as /api/screeners/refresh so cron, bridge, and on-read self-heal all
 * write the same snapshot and REC A-list side effect.
 */
import { NextResponse } from "next/server";
import { refreshScreenerSnapshot } from "@/server/screener-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let result;
  try {
    result = await refreshScreenerSnapshot("tv-scanner-cron");
  } catch (e) {
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    totalHits: result.totalHits,
    recCandidates: result.recCandidates,
    marketOpen: result.file.market_was_open,
    durationMs: result.row.durationMs,
    refreshedAt: result.row.refreshedAt.toISOString(),
  });
}
