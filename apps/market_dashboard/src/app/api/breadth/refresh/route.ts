/**
 * GET/POST /api/breadth/refresh
 *
 * Recomputes market breadth via the TradingView scanner and upserts the
 * snapshot into Postgres. The dashboard-bridge daemon can hit this whenever
 * the local bridge knows the market data should be fresh.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>` OR `?key=<BRIEF_INGEST_KEY>`.
 *
 * Query:
 *   ?force=1   recompute even if the latest snapshot is < 10 min old
 */
import { NextResponse } from "next/server";
import {
  getLatestBreadthRow,
  isBreadthRowFresh,
  refreshBreadthSnapshot,
} from "@/server/breadth-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FRESH_WINDOW_MS = 10 * 60 * 1000;

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${expected}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("key") === expected;
}

type RefreshSnapshotPayload = {
  market?: {
    advance?: number;
    decline?: number;
    new_highs?: number;
    new_lows?: number;
    universe_size?: number;
  };
  sectors?: unknown[];
  industries?: unknown[];
};

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";

  if (!force) {
    const existing = await getLatestBreadthRow();
    if (existing && isBreadthRowFresh(existing, Date.now(), FRESH_WINDOW_MS)) {
      return NextResponse.json({
        ok: true,
        skipped: "already fresh",
        refreshedAt: existing.refreshedAt.toISOString(),
        ageMs: Date.now() - existing.refreshedAt.getTime(),
      });
    }
  }

  let row;
  try {
    row = await refreshBreadthSnapshot("tv-scanner");
  } catch (e) {
    console.error("[breadth/refresh] fetch failed:", e);
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }

  const snapshot = row.snapshot as RefreshSnapshotPayload;
  const m = snapshot.market;
  if (m && (m.advance ?? 0) + (m.decline ?? 0) < (m.universe_size ?? 0) * 0.4) {
    console.warn("[breadth/refresh] low coverage - TV may have rate-limited");
  }

  return NextResponse.json({
    ok: true,
    bucketDate: row.bucketDate.toISOString().slice(0, 10),
    durationMs: row.durationMs,
    advance: m?.advance ?? 0,
    decline: m?.decline ?? 0,
    new_highs: m?.new_highs ?? 0,
    new_lows: m?.new_lows ?? 0,
    universe: m?.universe_size ?? 0,
    sectors: snapshot.sectors?.length ?? 0,
    industries: snapshot.industries?.length ?? 0,
    refreshedAt: row.refreshedAt.toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
