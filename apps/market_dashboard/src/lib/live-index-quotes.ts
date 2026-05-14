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

const POLYGON_INDEX_MAP: Array<{ symbol: string; polygonTicker: string }> = [
  { symbol: "SPX", polygonTicker: "I:SPX" },
  { symbol: "NDX", polygonTicker: "I:NDX" },
  { symbol: "DJI", polygonTicker: "I:DJI" },
  { symbol: "RUT", polygonTicker: "I:RUT" },
  { symbol: "VIX", polygonTicker: "I:VIX" },
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

export async function getLiveIndexQuotes(): Promise<LiveIndexQuote[]> {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) return [];

  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.rows;

  const rows = (
    await Promise.all(POLYGON_INDEX_MAP.map((item) => fetchPolygonIndex(item.symbol, item.polygonTicker, apiKey)))
  ).filter((row): row is LiveIndexQuote => row != null);

  cache = {
    expiresAt: now + CACHE_MS,
    rows,
  };

  return rows;
}
