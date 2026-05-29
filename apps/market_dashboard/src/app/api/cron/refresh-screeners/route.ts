/**
 * /api/cron/refresh-screeners
 *
 * Vercel Cron entry (schedule in vercel.json — market hours, weekdays).
 * Recomputes the 5 TV screeners and upserts the Postgres snapshot. Cloud
 * reliability layer — fires regardless of GitHub Actions cron or PC uptime.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchScreeners } from "@/server/screener-scanner";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");
  let file, durationMs;
  try {
    ({ file, durationMs } = await fetchScreeners());
  } catch (e) {
    return NextResponse.json({ error: "scanner failed", detail: String(e) }, { status: 502 });
  }
  const totalHits = file.screeners.reduce((n, s) => n + s.hits.length, 0);
  if (totalHits === 0) {
    return NextResponse.json({ error: "0 hits — not overwriting" }, { status: 502 });
  }
  const row = await prisma.screenerSnapshot.upsert({
    where: { bucketDate: today },
    create: { bucketDate: today, snapshot: file as object, source: "tv-scanner-cron", durationMs },
    update: { snapshot: file as object, source: "tv-scanner-cron", durationMs, refreshedAt: new Date() },
  });
  return NextResponse.json({ ok: true, totalHits, marketOpen: file.market_was_open, durationMs, refreshedAt: row.refreshedAt.toISOString() });
}
