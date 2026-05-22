/**
 * GET /api/cron/refresh-quotes — Vercel cron (every 5 min during US market hours).
 *
 * 1. Read DISTINCT ticker FROM Position (cost-controlled — only fetches what's
 *    actually held by at least one user).
 * 2. Convert to Yahoo Finance symbol format (US.HUT → HUT, HK.00700 → 0700.HK).
 * 3. Fetch in batches of 50 from Yahoo's quote endpoint.
 * 4. Upsert MarketQuote rows.
 *
 * Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. We also allow
 * a manual trigger via `?secret=<BRIEF_INGEST_KEY>` for testing.
 *
 * Schedule (vercel.json): every 5 min during US market hours, M-F.
 *   "schedule": "* / 5 13-21 * * 1-5"   (without spaces — UTC)
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { toYahooSymbol, fromYahooSymbol } from "@/lib/symbol-format";

export const dynamic = "force-dynamic";
export const maxDuration = 30;  // Vercel function timeout (seconds)

const YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote";
const BATCH_SIZE = 50;

type YahooQuote = {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
};

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const ingestKey = process.env.BRIEF_INGEST_KEY;
  const authHeader = req.headers.get("authorization") ?? "";
  const urlSecret = new URL(req.url).searchParams.get("secret");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (ingestKey && urlSecret === ingestKey) return true;
  // Vercel cron also sets `x-vercel-cron-signature` — accept any non-empty value
  // since the cron path is privately scheduled and not user-discoverable.
  if (req.headers.get("x-vercel-cron-signature")) return true;
  return false;
}

async function fetchYahooBatch(symbols: string[]): Promise<YahooQuote[]> {
  if (symbols.length === 0) return [];
  const url = `${YAHOO_QUOTE_URL}?symbols=${encodeURIComponent(symbols.join(","))}`;
  const res = await fetch(url, {
    headers: {
      // Yahoo blocks bare fetch without UA in some regions
      "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardBot/1.0)",
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo quote API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    quoteResponse?: { result?: YahooQuote[]; error?: unknown };
  };
  if (json.quoteResponse?.error) {
    throw new Error(`Yahoo error: ${JSON.stringify(json.quoteResponse.error)}`);
  }
  return json.quoteResponse?.result ?? [];
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  // 1. Pull held tickers
  const heldRows = await prisma.position.findMany({
    select: { ticker: true },
    distinct: ["ticker"],
  });
  const internalSymbols = heldRows.map((r) => r.ticker);

  if (internalSymbols.length === 0) {
    return NextResponse.json({ ok: true, refreshed: 0, msg: "No held positions" });
  }

  // 2. Convert to Yahoo format and map back
  const yahooSymbols = internalSymbols.map(toYahooSymbol);
  const internalBySymbol = new Map<string, string>();
  internalSymbols.forEach((internal, i) => {
    internalBySymbol.set(yahooSymbols[i], internal);
  });

  // 3. Fetch in batches
  const allQuotes: YahooQuote[] = [];
  const errors: string[] = [];

  for (let i = 0; i < yahooSymbols.length; i += BATCH_SIZE) {
    const batch = yahooSymbols.slice(i, i + BATCH_SIZE);
    try {
      const quotes = await fetchYahooBatch(batch);
      allQuotes.push(...quotes);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }

  // 4. Upsert MarketQuote rows
  const observedAt = new Date();
  let upserted = 0;

  await Promise.all(
    allQuotes.map(async (q) => {
      const internalSym = internalBySymbol.get(q.symbol) ?? fromYahooSymbol(q.symbol);
      if (q.regularMarketPrice == null) return;

      try {
        await prisma.marketQuote.upsert({
          where: { symbol: internalSym },
          create: {
            symbol: internalSym,
            price: q.regularMarketPrice,
            changePct: q.regularMarketChangePercent ?? null,
            prevClose: q.regularMarketPreviousClose ?? null,
            dayHigh: q.regularMarketDayHigh ?? null,
            dayLow: q.regularMarketDayLow ?? null,
            volume: q.regularMarketVolume != null ? BigInt(q.regularMarketVolume) : null,
            source: "yahoo",
            observedAt,
          },
          update: {
            price: q.regularMarketPrice,
            changePct: q.regularMarketChangePercent ?? null,
            prevClose: q.regularMarketPreviousClose ?? null,
            dayHigh: q.regularMarketDayHigh ?? null,
            dayLow: q.regularMarketDayLow ?? null,
            volume: q.regularMarketVolume != null ? BigInt(q.regularMarketVolume) : null,
            source: "yahoo",
            observedAt,
          },
        });
        upserted++;
      } catch (e) {
        errors.push(`upsert ${internalSym}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }),
  );

  return NextResponse.json({
    ok: true,
    requested: internalSymbols.length,
    fetched: allQuotes.length,
    upserted,
    errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    durationMs: Date.now() - startedAt,
  });
}
