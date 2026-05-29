/**
 * GET /api/screeners
 *
 * Latest TV screener snapshot from Postgres (DB-backed path). useTvScreeners
 * reads this first, falling back to the static tv_screeners.json file.
 * Public read (screener data is non-sensitive, same as the static file).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = await prisma.screenerSnapshot.findFirst({ orderBy: { refreshedAt: "desc" } });
  if (!row) {
    return NextResponse.json({ _meta: { source: "none" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const snapshot = row.snapshot as Record<string, unknown>;
  return NextResponse.json(
    { ...snapshot, _meta: { source: row.source, refreshedAt: row.refreshedAt.toISOString(), ageMs: Date.now() - row.refreshedAt.getTime(), durationMs: row.durationMs } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
