/**
 * GET/POST /api/screeners/refresh
 *
 * Recomputes the 5 TV screeners via the TradingView scanner (server-side) and
 * upserts the snapshot into Postgres. The reliable screener path — any
 * scheduler can hit it (Vercel cron, external uptime cron, bridge daemon),
 * none depending on GitHub Actions cron firing.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>` OR `?key=<BRIEF_INGEST_KEY>`.
 * Query: ?force=1 to recompute even if today's snapshot is < 5 min old.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchScreeners } from "@/server/screener-scanner";

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
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

  if (!force) {
    const existing = await prisma.screenerSnapshot.findUnique({ where: { bucketDate: today } });
    if (existing && Date.now() - existing.refreshedAt.getTime() < FRESH_WINDOW_MS) {
      return NextResponse.json({ ok: true, skipped: "already fresh", refreshedAt: existing.refreshedAt.toISOString() });
    }
  }

  let file, durationMs;
  try {
    ({ file, durationMs } = await fetchScreeners());
  } catch (e) {
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }

  const totalHits = file.screeners.reduce((n, s) => n + s.hits.length, 0);
  if (totalHits === 0) {
    return NextResponse.json({ error: "0 hits — TV may have rate-limited; not overwriting" }, { status: 502 });
  }

  const row = await prisma.screenerSnapshot.upsert({
    where: { bucketDate: today },
    create: { bucketDate: today, snapshot: file as object, source: "tv-scanner", durationMs },
    update: { snapshot: file as object, source: "tv-scanner", durationMs, refreshedAt: new Date() },
  });

  return NextResponse.json({
    ok: true, bucketDate: today.toISOString().slice(0, 10), durationMs, totalHits,
    marketOpen: file.market_was_open, refreshedAt: row.refreshedAt.toISOString(),
  });
}

export const GET = handle;
export const POST = handle;
