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
import {
  getLatestBreadthRow,
  isBreadthRowFresh,
  refreshBreadthSnapshot,
  serializeBreadthRow,
} from "@/server/breadth-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  let row = await getLatestBreadthRow();
  let autoRefreshed = false;

  if (!isBreadthRowFresh(row)) {
    try {
      row = await refreshBreadthSnapshot("tv-scanner-read-refresh");
      autoRefreshed = true;
    } catch (error) {
      console.error("[breadth] stale row refresh failed:", error);
      if (!row) {
        return NextResponse.json(
          { error: "breadth refresh failed", detail: String(error) },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        {
          error: "breadth refresh failed; refusing to serve stale snapshot",
          refreshedAt: row.refreshedAt.toISOString(),
          ageMs: Date.now() - row.refreshedAt.getTime(),
          detail: String(error),
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (!row) {
    return NextResponse.json(
      { _meta: { source: "none", message: "no breadth snapshot yet" } },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(serializeBreadthRow(row, { autoRefreshed }), {
    headers: { "Cache-Control": "no-store" },
  });
}
