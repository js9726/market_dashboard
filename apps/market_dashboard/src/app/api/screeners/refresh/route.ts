/**
 * GET/POST /api/screeners/refresh
 *
 * Recomputes the TV screeners via the TradingView scanner and upserts the
 * snapshot into Postgres. Shares the same helper used by /api/screeners and
 * /api/cron/refresh-screeners so all paths write the same shape.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>` OR `?key=<BRIEF_INGEST_KEY>`.
 * Query: ?force=1 to recompute even if the latest snapshot is < 5 min old.
 */
import { NextResponse } from "next/server";
import {
  getLatestScreenerRow,
  isScreenerRowFresh,
  refreshScreenerSnapshot,
} from "@/server/screener-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_WINDOW_MS = 5 * 60 * 1000;

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  if (req.headers.get("authorization") === `Bearer ${expected}`) return true;
  return new URL(req.url).searchParams.get("key") === expected;
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const force = new URL(req.url).searchParams.get("force") === "1";

  if (!force) {
    const existing = await getLatestScreenerRow();
    if (existing && isScreenerRowFresh(existing, Date.now(), FRESH_WINDOW_MS)) {
      return NextResponse.json({
        ok: true,
        skipped: "already fresh",
        refreshedAt: existing.refreshedAt.toISOString(),
      });
    }
  }

  let result;
  try {
    result = await refreshScreenerSnapshot("tv-scanner");
  } catch (e) {
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    bucketDate: result.row.bucketDate.toISOString().slice(0, 10),
    durationMs: result.row.durationMs,
    totalHits: result.totalHits,
    recCandidates: result.recCandidates,
    marketOpen: result.file.market_was_open,
    refreshedAt: result.row.refreshedAt.toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
