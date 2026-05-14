/**
 * GET /api/watchlist/export
 *
 * Machine-auth endpoint for cli_run.py and the morning-brief CLI tool.
 * Returns the owner's watchlist tickers as a flat array.
 *
 * Auth: Authorization: Bearer <BRIEF_INGEST_KEY>
 * Response: { tickers: string[], updatedAt: string | null }
 *
 * Reads tickers for the user whose email matches OWNER_EMAIL env var.
 * Returns an empty array (not 404) when the watchlist is empty — CLI
 * callers can decide their own fallback.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    return NextResponse.json({ tickers: [], updatedAt: null });
  }

  const owner = await prisma.user.findUnique({
    where: { email: ownerEmail },
    select: {
      watchlist: {
        select: { ticker: true, addedAt: true },
        orderBy: { addedAt: "desc" },
      },
    },
  });

  const rows = owner?.watchlist ?? [];
  const tickers = rows.map((r) => r.ticker);
  const updatedAt = rows[0]?.addedAt?.toISOString() ?? null;

  return NextResponse.json({ tickers, updatedAt });
}
