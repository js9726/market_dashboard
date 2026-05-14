/**
 * POST /api/live-quotes/ingest
 *
 * Machine-only endpoint. Called by:
 *   - The local moomoo OpenD daemon (Python `live_quote_daemon.py`) — every 15 s
 *     while the user's PC is on, with `source: "moomoo"`.
 *   - The Yahoo fallback workflow (`.github/workflows/yahoo_fallback_quotes.yml`)
 *     — every 5 min during US market hours, with `source: "yahoo"`. The
 *     workflow first checks /api/live-quotes/last-update and skips if moomoo
 *     posted within the last 2 min.
 *
 * Auth: `Authorization: Bearer <LIVE_QUOTE_INGEST_KEY>`.
 *
 * Body:
 *   {
 *     mode?: "primary" | "fallback",   // fallback = skip if a fresher row exists
 *     quotes: [
 *       { symbol, price, changePct?, volume?, source: "moomoo"|"yahoo", observedAt: ISO },
 *       ...
 *     ]
 *   }
 *
 * Upserts each quote by symbol primary key. Returns counts. When mode is
 * "fallback", a row is skipped if the existing row was observed within the
 * last 90 s — this lets the Yahoo workflow safely run while moomoo is also
 * pushing without overwriting fresher local-tier data.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface IncomingQuote {
  symbol?: unknown;
  price?: unknown;
  changePct?: unknown;
  volume?: unknown;
  source?: unknown;
  observedAt?: unknown;
}

function authorized(req: Request): boolean {
  const expected = process.env.LIVE_QUOTE_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { quotes?: IncomingQuote[]; mode?: string };
  try {
    body = (await req.json()) as { quotes?: IncomingQuote[]; mode?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.quotes)) {
    return NextResponse.json({ error: "quotes[] required" }, { status: 400 });
  }

  const fallback = body.mode === "fallback";
  const FRESH_MS = 90 * 1000;

  let written = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const q of body.quotes) {
    const symbol = typeof q.symbol === "string" ? q.symbol : null;
    const price = typeof q.price === "number" ? q.price : null;
    const source = typeof q.source === "string" ? q.source : null;
    const observedAtStr = typeof q.observedAt === "string" ? q.observedAt : null;

    if (!symbol || price == null || !source || !observedAtStr) {
      skipped += 1;
      errors.push(`bad row: ${JSON.stringify(q).slice(0, 100)}`);
      continue;
    }

    try {
      if (fallback) {
        const existing = await prisma.liveQuote.findUnique({ where: { symbol } });
        if (existing && Date.now() - existing.observedAt.getTime() < FRESH_MS) {
          skipped += 1;
          continue;
        }
      }
      await prisma.liveQuote.upsert({
        where: { symbol },
        create: {
          symbol,
          price,
          changePct: typeof q.changePct === "number" ? q.changePct : null,
          volume: typeof q.volume === "number" ? BigInt(Math.round(q.volume)) : null,
          source,
          observedAt: new Date(observedAtStr),
        },
        update: {
          price,
          changePct: typeof q.changePct === "number" ? q.changePct : null,
          volume: typeof q.volume === "number" ? BigInt(Math.round(q.volume)) : null,
          source,
          observedAt: new Date(observedAtStr),
        },
      });
      written += 1;
    } catch (e) {
      skipped += 1;
      errors.push(`${symbol}: ${(e as Error).message.slice(0, 100)}`);
    }
  }

  return NextResponse.json({ written, skipped, errors: errors.slice(0, 10) });
}
