/**
 * /api/cron/refresh-breadth
 *
 * Optional cron entry for breadth. The primary operational path is now the
 * local dashboard-bridge daemon hitting /api/breadth/refresh once post-close.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET
 * is set. Matches the existing /api/cron/rescore-day14 pattern.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchBreadth } from "@/server/breadth-scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

  let snapshot, durationMs;
  try {
    ({ snapshot, durationMs } = await fetchBreadth());
  } catch (e) {
    console.error("[cron/refresh-breadth] scanner failed:", e);
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }

  const m = snapshot.market;
  const row = await prisma.marketBreadthSnapshot.upsert({
    where: { bucketDate: today },
    create: { bucketDate: today, snapshot: snapshot as object, source: "tv-scanner-cron", durationMs },
    update: { snapshot: snapshot as object, source: "tv-scanner-cron", durationMs, refreshedAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    bucketDate: today.toISOString().slice(0, 10),
    durationMs,
    advance: m.advance,
    decline: m.decline,
    universe: m.universe_size,
    sectors: snapshot.sectors.length,
    refreshedAt: row.refreshedAt.toISOString(),
  });
}
