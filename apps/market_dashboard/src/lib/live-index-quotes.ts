export interface LiveIndexQuote {
  symbol: string;
  price: number;
  changePct: number | null;
  volume: number | null;
  source: string;
  observedAt: Date;
  timeframe?: string | null;
}

interface PolygonSnapshotResult {
  ticker?: string;
  value?: number;
  last_updated?: number;
  timeframe?: string;
  session?: {
    change_percent?: number;
    volume?: number;
  };
}

interface YahooChartResult {
  chart?: {
    result?: Array<{
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketTime?: number;
        regularMarketVolume?: number;
      };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
  };
}

const INDEX_MAP: Array<{ symbol: string; polygonTicker: string; yahooTicker: string }> = [
  { symbol: "SPX", polygonTicker: "I:SPX", yahooTicker: "^GSPC" },
  { symbol: "NDX", polygonTicker: "I:NDX", yahooTicker: "^NDX" },
  { symbol: "DJI", polygonTicker: "I:DJI", yahooTicker: "^DJI" },
  { symbol: "RUT", polygonTicker: "I:RUT", yahooTicker: "^RUT" },
  { symbol: "VIX", polygonTicker: "I:VIX", yahooTicker: "^VIX" },
];

const CACHE_MS = 15_000;

let cache:
  | {
      expiresAt: number;
      rows: LiveIndexQuote[];
    }
  | null = null;

function polygonTimestampToDate(value: number | null | undefined): Date {
  if (!value) return new Date();
  const millis = value > 1_000_000_000_000_000 ? Math.floor(value / 1_000_000) : value;
  return new Date(millis);
}

function lastFinite(values: Array<number | null> | null | undefined): number | null {
  if (!Array.isArray(values)) return null;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const value = values[i];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

async function fetchPolygonIndex(symbol: string, polygonTicker: string, apiKey: string): Promise<LiveIndexQuote | null> {
  const url = new URL("https://api.polygon.io/v3/snapshot/indices");
  url.searchParams.set("ticker", polygonTicker);
  url.searchParams.set("limit", "1");
  url.searchParams.set("apiKey", apiKey);

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as { results?: PolygonSnapshotResult[] };
  const result = payload.results?.find((row) => row.ticker === polygonTicker) ?? payload.results?.[0];
  if (typeof result?.value !== "number") return null;

  return {
    symbol,
    price: result.value,
    changePct: typeof result.session?.change_percent === "number" ? result.session.change_percent : null,
    volume: typeof result.session?.volume === "number" ? result.session.volume : null,
    source: `polygon${result.timeframe ? `-${result.timeframe.toLowerCase()}` : ""}`,
    observedAt: polygonTimestampToDate(result.last_updated),
    timeframe: result.timeframe ?? null,
  };
}

async function fetchYahooIndex(symbol: string, yahooTicker: string): Promise<LiveIndexQuote | null> {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooTicker)}`);
  url.searchParams.set("range", "1d");
  url.searchParams.set("interval", "1m");

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardBot/1.0)",
    },
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as YahooChartResult;
  const result = payload.chart?.result?.[0];
  const meta = result?.meta;
  const close = lastFinite(result?.indicators?.quote?.[0]?.close);
  const price =
    typeof meta?.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : close;
  if (price == null) return null;

  const prevClose =
    typeof meta?.chartPreviousClose === "number" && Number.isFinite(meta.chartPreviousClose)
      ? meta.chartPreviousClose
      : typeof meta?.previousClose === "number" && Number.isFinite(meta.previousClose)
        ? meta.previousClose
        : null;
  const lastTimestamp = Array.isArray(result?.timestamp) ? result.timestamp.at(-1) : null;
  const observedAt =
    typeof meta?.regularMarketTime === "number"
      ? new Date(meta.regularMarketTime * 1000)
      : typeof lastTimestamp === "number"
        ? new Date(lastTimestamp * 1000)
        : null;
  if (!observedAt || Number.isNaN(observedAt.getTime())) return null;

  return {
    symbol,
    price,
    changePct: prevClose && prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : null,
    volume:
      typeof meta?.regularMarketVolume === "number" && Number.isFinite(meta.regularMarketVolume)
        ? meta.regularMarketVolume
        : null,
    source: "yahoo-chart",
    observedAt,
    timeframe: "real-time",
  };
}

export async function getLiveIndexQuotes(): Promise<LiveIndexQuote[]> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.rows;

  const apiKey = process.env.POLYGON_API_KEY;
  const polygonRows = apiKey
    ? (
        await Promise.all(INDEX_MAP.map((item) => fetchPolygonIndex(item.symbol, item.polygonTicker, apiKey)))
      ).filter((row): row is LiveIndexQuote => row != null)
    : [];
  const bySymbol = new Map(polygonRows.map((row) => [row.symbol, row]));
  const missing = INDEX_MAP.filter((item) => !bySymbol.has(item.symbol));
  const yahooRows = (
    await Promise.all(missing.map((item) => fetchYahooIndex(item.symbol, item.yahooTicker)))
  ).filter((row): row is LiveIndexQuote => row != null);
  for (const row of yahooRows) bySymbol.set(row.symbol, row);

  const rows = Array.from(bySymbol.values());

  cache = {
    expiresAt: now + CACHE_MS,
    rows,
  };

  return rows;
}
