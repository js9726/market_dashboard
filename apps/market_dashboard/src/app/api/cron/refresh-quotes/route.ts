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

// Yahoo /v7/finance/quote started returning 401 to anonymous clients in 2025.
// The /v8/finance/chart/<symbol> endpoint still works without auth and exposes
// all the same fields in chart.result[0].meta. One request per symbol.
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

type YahooQuote = {
  symbol: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  regularMarketPreviousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
};

type YahooChartMeta = {
  symbol?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
};

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const ingestKey = process.env.BRIEF_INGEST_KEY;
  const liveQuoteKey = process.env.LIVE_QUOTE_INGEST_KEY;
  const authHeader = req.headers.get("authorization") ?? "";
  const urlSecret = new URL(req.url).searchParams.get("secret");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (ingestKey && urlSecret === ingestKey) return true;
  if (liveQuoteKey && authHeader === `Bearer ${liveQuoteKey}`) return true;
  if (liveQuoteKey && urlSecret === liveQuoteKey) return true;
  // Vercel cron also sets `x-vercel-cron-signature` — accept any non-empty value
  // since the cron path is privately scheduled and not user-discoverable.
  if (req.headers.get("x-vercel-cron-signature")) return true;
  return false;
}

async function fetchOneYahoo(symbol: string): Promise<YahooQuote | null> {
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardBot/1.0)" },
  });
  if (!res.ok) {
    throw new Error(`Yahoo chart ${symbol} HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    chart?: { result?: Array<{ meta?: YahooChartMeta }>; error?: unknown };
  };
  if (json.chart?.error) {
    throw new Error(`Yahoo chart error ${symbol}: ${JSON.stringify(json.chart.error)}`);
  }
  const meta = json.chart?.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) return null;

  const prevClose = meta.chartPreviousClose ?? meta.previousClose;
  const changePct =
    prevClose != null && prevClose > 0
      ? ((meta.regularMarketPrice - prevClose) / prevClose) * 100
      : undefined;

  return {
    symbol,
    regularMarketPrice: meta.regularMarketPrice,
    regularMarketChangePercent: changePct,
    regularMarketPreviousClose: prevClose,
    regularMarketDayHigh: meta.regularMarketDayHigh,
    regularMarketDayLow: meta.regularMarketDayLow,
    regularMarketVolume: meta.regularMarketVolume,
  };
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

  // 3. Fetch one quote per symbol (Yahoo chart endpoint is per-symbol).
  // Run them in parallel with a soft concurrency cap (don't hammer Yahoo).
  const allQuotes: YahooQuote[] = [];
  const errors: string[] = [];
  const CONCURRENCY = 6;

  for (let i = 0; i < yahooSymbols.length; i += CONCURRENCY) {
    const batch = yahooSymbols.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(fetchOneYahoo));
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        if (r.value) allQuotes.push(r.value);
      } else {
        errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
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
