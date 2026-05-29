/**
 * GET /api/breadth
 *
 * Returns the latest market breadth snapshot from Postgres (DB-backed path).
 * The useBreadth() hook reads this first, falling back to the static
 * breadth.json file if the DB has no row yet (backwards compat).
 *
 * Public read (no auth) — breadth is non-sensitive market data, same as the
 * static breadth.json which is served unauthenticated from /market-dashboard/.
 *
 * Response: the BreadthSnapshot JSON + a `_meta` block with freshness info.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const row = await prisma.marketBreadthSnapshot.findFirst({
    orderBy: { refreshedAt: "desc" },
  });

  if (!row) {
    return NextResponse.json(
      { _meta: { source: "none", message: "no breadth snapshot yet" } },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  const snapshot = row.snapshot as Record<string, unknown>;
  return NextResponse.json(
    {
      ...snapshot,
      _meta: {
        source: row.source,
        refreshedAt: row.refreshedAt.toISOString(),
        ageMs: Date.now() - row.refreshedAt.getTime(),
        durationMs: row.durationMs,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
