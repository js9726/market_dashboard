import fs from "node:fs/promises";
import path from "node:path";
import type { MarketSnapshot, TickerRow } from "@/types/market-dashboard";

const SNAPSHOT_PATH = path.join(process.cwd(), "public", "market-dashboard", "snapshot.json");
const SCANNER_URL = "https://scanner.tradingview.com/america/scan";
const CACHE_MS = Number(process.env.MARKET_SNAPSHOT_CACHE_MS ?? 5 * 60 * 1000);
const MAX_SYMBOLS_PER_REQUEST = 450;

const TV_COLUMNS = [
  "name",
  "close",
  "change",
  "volume",
  "relative_volume_10d_calc",
  "Perf.W",
  "Perf.1M",
  "price_52_week_high",
  "open",
  "exchange",
] as const;

type TvColumn = (typeof TV_COLUMNS)[number];

const COLUMN_INDEX: Record<TvColumn, number> = TV_COLUMNS.reduce(
  (acc, col, index) => {
    acc[col] = index;
    return acc;
  },
  {} as Record<TvColumn, number>,
);

const DEFAULT_EXCHANGES = ["AMEX", "NASDAQ", "NYSE", "CBOE"];
const EXCHANGE_OVERRIDES: Record<string, string[]> = {
  IBIT: ["NASDAQ", "AMEX", "CBOE", "NYSE"],
  QQQ: ["NASDAQ", "AMEX", "CBOE", "NYSE"],
  QQQE: ["NASDAQ", "AMEX", "CBOE", "NYSE"],
};

interface TvScanRow {
  s?: string;
  d?: unknown[];
}

interface TvScanResponse {
  data?: TvScanRow[];
}

interface LiveQuote {
  ticker: string;
  exchange: string | null;
  close: number | null;
  daily: number | null;
  intra: number | null;
  week: number | null;
  month: number | null;
  rvol: number | null;
  off52wHighPct: number | null;
  volume: number | null;
}

interface LiveSnapshotResult {
  snapshot: MarketSnapshot;
  meta: {
    source: string;
    refreshedAt: string;
    ageMs: number;
    baseBuiltAt: string;
    overlayCount: number;
    missingTickers: string[];
    durationMs: number;
    message?: string;
  };
}

let cache: { at: number; result: LiveSnapshotResult } | null = null;

export async function getLiveMarketSnapshot(): Promise<LiveSnapshotResult> {
  if (cache && Date.now() - cache.at < CACHE_MS) {
    const refreshedAt = cache.result.meta.refreshedAt;
    return {
      ...cache.result,
      meta: {
        ...cache.result.meta,
        ageMs: Date.now() - new Date(refreshedAt).getTime(),
      },
    };
  }

  const started = Date.now();
  const baseline = await readBaselineSnapshot();
  const tickers = uniqueTickers(baseline);
  let refreshError: string | undefined;
  let quotes = new Map<string, LiveQuote>();
  try {
    quotes = await fetchTradingViewQuotes(tickers);
  } catch (error) {
    refreshError = error instanceof Error ? error.message : "TradingView refresh failed";
  }
  const refreshedAt = new Date().toISOString();
  const missingTickers = tickers.filter((ticker) => !quotes.has(ticker));
  const snapshot = overlayQuotes(baseline, quotes, refreshedAt);
  const result: LiveSnapshotResult = {
    snapshot,
    meta: {
      source: quotes.size > 0 ? "tradingview-live-overlay" : "static-snapshot-fallback",
      refreshedAt: quotes.size > 0 ? refreshedAt : baseline.built_at,
      ageMs: Date.now() - new Date(quotes.size > 0 ? refreshedAt : baseline.built_at).getTime(),
      baseBuiltAt: baseline.built_at,
      overlayCount: quotes.size,
      missingTickers,
      durationMs: Date.now() - started,
      message: refreshError,
    },
  };
  cache = { at: Date.now(), result };
  return result;
}

async function readBaselineSnapshot(): Promise<MarketSnapshot> {
  const raw = await fs.readFile(SNAPSHOT_PATH, "utf8");
  return JSON.parse(raw) as MarketSnapshot;
}

function uniqueTickers(snapshot: MarketSnapshot): string[] {
  const out = new Set<string>();
  for (const rows of Object.values(snapshot.groups ?? {})) {
    for (const row of rows) {
      if (row.ticker) out.add(row.ticker);
    }
  }
  return Array.from(out).sort();
}

async function fetchTradingViewQuotes(tickers: string[]): Promise<Map<string, LiveQuote>> {
  const candidates = buildCandidates(tickers);
  const chunks = chunk(candidates, MAX_SYMBOLS_PER_REQUEST);
  const rows = (
    await Promise.all(
      chunks.map(async (symbols) => {
        const body = {
          filter: [],
          options: { lang: "en" },
          markets: ["america"],
          symbols: { query: { types: [] }, tickers: symbols.map((entry) => entry.symbol) },
          columns: TV_COLUMNS,
          range: [0, symbols.length],
        };

        const res = await fetch(SCANNER_URL, {
          method: "POST",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Content-Type": "application/json",
            Accept: "application/json, text/plain, */*",
            Origin: "https://www.tradingview.com",
            Referer: "https://www.tradingview.com/",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        if (!res.ok) throw new Error(`TradingView scanner HTTP ${res.status}`);
        const json = (await res.json()) as TvScanResponse;
        return json.data ?? [];
      }),
    )
  ).flat();

  const priorityBySymbol = new Map(candidates.map((entry, index) => [entry.symbol, index]));
  const quotes = new Map<string, LiveQuote & { priority: number }>();
  for (const row of rows) {
    const symbol = row.s ?? "";
    const tickerFromSymbol = symbol.includes(":") ? symbol.split(":")[1] : symbol;
    const ticker = stringAt(row.d, "name") ?? tickerFromSymbol;
    if (!ticker) continue;

    const priority = priorityBySymbol.get(symbol) ?? Number.MAX_SAFE_INTEGER;
    const existing = quotes.get(ticker);
    if (existing && existing.priority <= priority) continue;

    const quote = parseQuote(ticker, symbol, row.d ?? []);
    quotes.set(ticker, { ...quote, priority });
  }

  const clean = new Map<string, LiveQuote>();
  for (const [ticker, quote] of Array.from(quotes.entries())) {
    clean.set(ticker, {
      ticker: quote.ticker,
      exchange: quote.exchange,
      close: quote.close,
      daily: quote.daily,
      intra: quote.intra,
      week: quote.week,
      month: quote.month,
      rvol: quote.rvol,
      off52wHighPct: quote.off52wHighPct,
      volume: quote.volume,
    });
  }
  return clean;
}

function buildCandidates(tickers: string[]): { symbol: string }[] {
  const out: { symbol: string }[] = [];
  const seen = new Set<string>();
  for (const ticker of tickers) {
    const exchanges = EXCHANGE_OVERRIDES[ticker] ?? DEFAULT_EXCHANGES;
    for (const exchange of exchanges) {
      const symbol = `${exchange}:${ticker}`;
      if (!seen.has(symbol)) {
        seen.add(symbol);
        out.push({ symbol });
      }
    }
  }
  return out;
}

function parseQuote(ticker: string, symbol: string, data: unknown[]): LiveQuote {
  const close = numberAt(data, "close");
  const open = numberAt(data, "open");
  const high52 = numberAt(data, "price_52_week_high");
  const exchange = stringAt(data, "exchange") ?? (symbol.includes(":") ? symbol.split(":")[0] : null);

  return {
    ticker,
    exchange,
    close,
    daily: round(numberAt(data, "change"), 2),
    intra: close != null && open != null && open > 0 ? round(((close - open) / open) * 100, 2) : null,
    week: round(numberAt(data, "Perf.W"), 2),
    month: round(numberAt(data, "Perf.1M"), 2),
    rvol: round(numberAt(data, "relative_volume_10d_calc"), 2),
    off52wHighPct:
      close != null && high52 != null && high52 > 0
        ? round(Math.min(0, ((close - high52) / high52) * 100), 2)
        : null,
    volume: numberAt(data, "volume"),
  };
}

function overlayQuotes(
  baseline: MarketSnapshot,
  quotes: Map<string, LiveQuote>,
  refreshedAt: string,
): MarketSnapshot {
  if (quotes.size === 0) return baseline;

  const groups: Record<string, TickerRow[]> = {};
  for (const [groupName, rows] of Object.entries(baseline.groups ?? {})) {
    groups[groupName] = rows.map((row) => {
      const quote = quotes.get(row.ticker);
      if (!quote) return row;
      return {
        ...row,
        daily: quote.daily ?? row.daily,
        intra: quote.intra ?? row.intra,
        "5d": quote.week ?? row["5d"],
        "20d": quote.month ?? row["20d"],
        rvol: quote.rvol ?? row.rvol ?? null,
        off_52w_high_pct: quote.off52wHighPct ?? row.off_52w_high_pct ?? null,
        close: quote.close,
        price: quote.close,
        volume: quote.volume,
        exchange: quote.exchange,
      };
    });
  }

  return {
    ...baseline,
    built_at: refreshedAt,
    groups,
    column_ranges: computeColumnRanges(groups),
  };
}

function computeColumnRanges(groups: Record<string, TickerRow[]>): MarketSnapshot["column_ranges"] {
  const out: MarketSnapshot["column_ranges"] = {};
  for (const [groupName, rows] of Object.entries(groups)) {
    out[groupName] = {
      daily: rangeFor(rows, "daily"),
      intra: rangeFor(rows, "intra"),
      "5d": rangeFor(rows, "5d"),
      "20d": rangeFor(rows, "20d"),
    };
  }
  return out;
}

function rangeFor(rows: TickerRow[], key: "daily" | "intra" | "5d" | "20d"): [number, number] {
  const values = rows
    .map((row) => row[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!values.length) return [0, 0];
  return [Math.min(...values), Math.max(...values)];
}

function numberAt(data: unknown[], column: TvColumn): number | null {
  const value = data[COLUMN_INDEX[column]];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringAt(data: unknown[] | undefined, column: TvColumn): string | null {
  const value = data?.[COLUMN_INDEX[column]];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function round(value: number | null, decimals: number): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
