/**
 * GET /api/live-quotes
 *
 * Returns all rows in LiveQuote, overlaid with server-fetched Polygon index
 * snapshots for SPX/NDX/DJI/RUT/VIX when POLYGON_API_KEY is configured. Adds
 * a per-row staleness flag (stale = no update in >2 min). Used by the
 * Conviction Desk's live tape (indices, sectors, watchlist).
 *
 * Auth: requires a signed-in user.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getLiveIndexQuotes } from "@/lib/live-index-quotes";

export const dynamic = "force-dynamic";

const STALE_MS = 2 * 60 * 1000;

interface ApiQuoteRow {
  symbol: string;
  price: number;
  changePct: number | null;
  volume: number | null;
  source: string;
  observedAt: Date;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [dbRows, liveIndexRows] = await Promise.all([
    prisma.liveQuote.findMany({ orderBy: { symbol: "asc" } }).catch((error) => {
      console.error("[/api/live-quotes] LiveQuote DB read failed:", error);
      return [];
    }),
    getLiveIndexQuotes().catch((error) => {
      console.error("[/api/live-quotes] Polygon index fetch failed:", error);
      return [];
    }),
  ]);

  const bySymbol = new Map<string, ApiQuoteRow>();
  for (const row of dbRows) {
    bySymbol.set(row.symbol, {
      symbol: row.symbol,
      price: Number(row.price),
      changePct: row.changePct == null ? null : Number(row.changePct),
      volume: row.volume == null ? null : Number(row.volume),
      source: row.source,
      observedAt: row.observedAt,
    });
  }
  for (const row of liveIndexRows) {
    bySymbol.set(row.symbol, row);
  }

  const rows = Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
  const now = Date.now();

  // Determine the freshest source actively writing (moomoo wins if recent;
  // else yahoo). Helpful for the UI to badge "moomoo live" vs "yahoo delayed".
  let freshestSource: string | null = null;
  let freshestAt = 0;
  for (const r of rows) {
    const t = r.observedAt.getTime();
    if (t > freshestAt) {
      freshestAt = t;
      freshestSource = r.source;
    }
  }

  return NextResponse.json(
    {
      activeSource: freshestSource,
      activeSourceAt: freshestAt ? new Date(freshestAt).toISOString() : null,
      quotes: rows.map((r) => ({
        symbol: r.symbol,
        price: r.price,
        changePct: r.changePct,
        volume: r.volume,
        source: r.source,
        observedAt: r.observedAt.toISOString(),
        stale: now - r.observedAt.getTime() > STALE_MS,
      })),
    },
    { headers: { "Cache-Control": "private, max-age=15" } },
  );
}
