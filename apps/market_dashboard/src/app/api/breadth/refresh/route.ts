/**
 * GET/POST /api/breadth/refresh
 *
 * Recomputes market breadth via the TradingView scanner and upserts the
 * snapshot into Postgres. This is the RELIABLE breadth path — any scheduler
 * can hit it, and they're redundant:
 *   - Vercel Cron (vercel.json) — cloud, 24/7, no PC needed
 *   - External uptime cron (cron-job.org / UptimeRobot) — zero-dependency backup
 *   - dashboard-bridge daemon (local) — when PC is on
 *   - GH Actions — legacy backup
 *
 * Whoever fires first wins; the rest see "already fresh" and skip the recompute.
 * No git commit, no Vercel rebuild — the dashboard reads the new row instantly.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>` OR `?key=<BRIEF_INGEST_KEY>`
 * (the query-param form lets dumb external cron pingers authenticate via URL).
 *
 * Query:
 *   ?force=1   recompute even if today's snapshot is < 10 min old
 *
 * GET and POST both work (uptime monitors usually only do GET).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchBreadth } from "@/server/breadth-scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // serverless: allow up to 60s for the scanner

const FRESH_WINDOW_MS = 10 * 60 * 1000; // 10 min

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${expected}`) return true;
  const url = new URL(req.url);
  return url.searchParams.get("key") === expected;
}

async function handle(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

  // Skip recompute if a fresh snapshot already exists (redundant-trigger guard).
  if (!force) {
    const existing = await prisma.marketBreadthSnapshot.findUnique({
      where: { bucketDate: today },
    });
    if (existing && Date.now() - existing.refreshedAt.getTime() < FRESH_WINDOW_MS) {
      return NextResponse.json({
        ok: true,
        skipped: "already fresh",
        refreshedAt: existing.refreshedAt.toISOString(),
        ageMs: Date.now() - existing.refreshedAt.getTime(),
      });
    }
  }

  let snapshot, durationMs;
  try {
    ({ snapshot, durationMs } = await fetchBreadth());
  } catch (e) {
    console.error("[breadth/refresh] fetch failed:", e);
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }

  // Sanity: adv+dec should be a meaningful fraction of universe (else TV rate-limited)
  const m = snapshot.market;
  if (m.advance + m.decline < m.universe_size * 0.4) {
    console.warn("[breadth/refresh] low coverage — TV may have rate-limited");
  }

  const row = await prisma.marketBreadthSnapshot.upsert({
    where: { bucketDate: today },
    create: { bucketDate: today, snapshot: snapshot as object, source: "tv-scanner", durationMs },
    update: { snapshot: snapshot as object, source: "tv-scanner", durationMs, refreshedAt: new Date() },
  });

  return NextResponse.json({
    ok: true,
    bucketDate: today.toISOString().slice(0, 10),
    durationMs,
    advance: m.advance,
    decline: m.decline,
    new_highs: m.new_highs,
    new_lows: m.new_lows,
    universe: m.universe_size,
    sectors: snapshot.sectors.length,
    refreshedAt: row.refreshedAt.toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
