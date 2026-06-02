/**
 * /api/cron/refresh-breadth
 *
 * Vercel cron entry for breadth. Uses the same DB-backed refresh helper as
 * /api/breadth/refresh so cron, bridge, and on-read self-heal all write the
 * same enriched sector/industry snapshot.
 */
import { NextResponse } from "next/server";
import { refreshBreadthSnapshot } from "@/server/breadth-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RefreshSnapshotPayload = {
  market?: {
    advance?: number;
    decline?: number;
    universe_size?: number;
  };
  sectors?: unknown[];
  industries?: unknown[];
};

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let row;
  try {
    row = await refreshBreadthSnapshot("tv-scanner-cron");
  } catch (e) {
    console.error("[cron/refresh-breadth] scanner failed:", e);
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }

  const snapshot = row.snapshot as RefreshSnapshotPayload;
  const m = snapshot.market;

  return NextResponse.json({
    ok: true,
    bucketDate: row.bucketDate.toISOString().slice(0, 10),
    durationMs: row.durationMs,
    advance: m?.advance ?? 0,
    decline: m?.decline ?? 0,
    universe: m?.universe_size ?? 0,
    sectors: snapshot.sectors?.length ?? 0,
    industries: snapshot.industries?.length ?? 0,
    refreshedAt: row.refreshedAt.toISOString(),
  });
}
