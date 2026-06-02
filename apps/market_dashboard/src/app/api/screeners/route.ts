/**
 * GET /api/screeners
 *
 * Latest TV screener snapshot from Postgres (DB-backed path). useTvScreeners
 * reads this first, falling back to the static tv_screeners.json file.
 * Public read (screener data is non-sensitive, same as the static file).
 */
import { NextResponse } from "next/server";
import {
  getLatestScreenerRow,
  isScreenerRowFresh,
  refreshScreenerSnapshot,
  serializeScreenerRow,
} from "@/server/screener-refresh";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  let row = await getLatestScreenerRow();
  let autoRefreshed = false;

  if (!isScreenerRowFresh(row)) {
    try {
      const result = await refreshScreenerSnapshot("tv-scanner-read-refresh");
      row = result.row;
      autoRefreshed = true;
    } catch (error) {
      console.error("[screeners] stale row refresh failed:", error);
      if (!row) {
        return NextResponse.json(
          { error: "screener refresh failed", detail: String(error) },
          { status: 502, headers: { "Cache-Control": "no-store" } },
        );
      }
      return NextResponse.json(
        {
          error: "screener refresh failed; refusing to serve stale snapshot",
          refreshedAt: row.refreshedAt.toISOString(),
          ageMs: Date.now() - row.refreshedAt.getTime(),
          detail: String(error),
        },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  if (!row) {
    return NextResponse.json({ _meta: { source: "none" } }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(serializeScreenerRow(row, { autoRefreshed }), {
    headers: { "Cache-Control": "no-store" },
  });
}
