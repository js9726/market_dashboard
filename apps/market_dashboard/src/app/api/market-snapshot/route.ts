/**
 * GET /api/market-snapshot
 *
 * Returns the committed market-dashboard snapshot with live TradingView scanner
 * values overlaid for price, day/intraday/weekly/monthly change, RVOL, and
 * distance from 52-week high. This keeps the Market Internals tabs fresh
 * without dirtying generated public artifacts.
 */
import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/server/market-snapshot-live";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export async function GET() {
  try {
    const { snapshot, meta } = await getLiveMarketSnapshot();
    return NextResponse.json(
      { ...snapshot, _meta: meta },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        _meta: {
          source: "error",
          message: error instanceof Error ? error.message : "market snapshot refresh failed",
        },
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
