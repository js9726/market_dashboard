/**
 * breadth-scanner.ts — server-side market breadth via TradingView scanner.
 *
 * Ports breadth_fast.py to TypeScript so breadth can be computed inside a
 * Vercel serverless function (no Python runtime, no 5000-ticker scan, no
 * yfinance rate limits). Each metric is ONE scanner call returning totalCount.
 *
 * Calls are parallelized (capped concurrency) so the whole snapshot completes
 * in ~5-8s — within serverless timeouts. This is what makes breadth ACTUALLY
 * reliable: a single endpoint any scheduler can hit, finishing fast.
 *
 * Output matches BreadthSnapshot (types/breadth.ts).
 */

const SCANNER_URL = "https://scanner.tradingview.com/america/scan";
const MCAP_FLOOR = 100_000_000;

const STOCK = { left: "type", operation: "in_range", right: ["stock"] };
const MCAP = { left: "market_cap_basic", operation: "greater", right: MCAP_FLOOR };

const TV_SECTORS = [
  "Electronic Technology", "Technology Services", "Finance", "Health Technology",
  "Consumer Non-Durables", "Consumer Services", "Retail Trade", "Energy Minerals",
  "Producer Manufacturing", "Commercial Services", "Transportation", "Utilities",
  "Process Industries", "Industrial Services", "Non-Energy Minerals",
  "Communications", "Distribution Services", "Consumer Durables",
  "Health Services", "Miscellaneous",
];

type Filter = { left: string; operation: string; right: unknown };

async function scanCount(filters: Filter[], retries = 2): Promise<number | null> {
  const payload = {
    filter: [...filters, STOCK],
    options: { lang: "en" },
    range: [0, 1],
    columns: ["name"],
    markets: ["america"],
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(SCANNER_URL, {
        method: "POST",
        headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { totalCount?: number };
      return json.totalCount ?? 0;
    } catch (e) {
      if (attempt === retries) {
        console.error("[breadth-scanner] scan failed:", e);
        return null;
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return null;
}

/** Run an array of count-tasks with bounded concurrency. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await fn(items[cur]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const GT = (l: string, r: unknown): Filter => ({ left: l, operation: "greater", right: r });
const LT = (l: string, r: unknown): Filter => ({ left: l, operation: "less", right: r });
const EGT = (l: string, r: unknown): Filter => ({ left: l, operation: "egreater", right: r });
const ELT = (l: string, r: unknown): Filter => ({ left: l, operation: "eless", right: r });

export interface BreadthSnapshot {
  built_at: string;
  as_of: string;
  generated_by: string;
  mcap_floor: number;
  universe_size: number;
  market: {
    new_highs: number; new_lows: number; advance: number; decline: number;
    stage_counts: Record<"1" | "2" | "3" | "4", number>; universe_size: number;
  };
  momentum: {
    up_from_open: number; down_from_open: number;
    up_on_volume: number; down_on_volume: number;
    up_4pct: number; down_4pct: number;
  };
  sectors: { sector: string; n: number; pct_above_50sma: number }[];
  industries: never[];
}

export async function fetchBreadth(): Promise<{ snapshot: BreadthSnapshot; durationMs: number }> {
  const started = Date.now();

  // ── Scalar market + momentum metrics (run all in parallel) ──────────────
  const scalarTasks: Record<string, Filter[]> = {
    universe: [MCAP],
    advance: [GT("change", 0), MCAP],
    decline: [LT("change", 0), MCAP],
    new_highs: [EGT("close", "price_52_week_high"), MCAP],
    new_lows: [ELT("close", "price_52_week_low"), MCAP],
    stage2: [GT("close", "SMA50"), GT("SMA50", "SMA200"), MCAP],
    stage4: [LT("close", "SMA50"), LT("SMA50", "SMA200"), MCAP],
    stage1: [LT("close", "SMA50"), GT("SMA50", "SMA200"), MCAP],
    stage3: [GT("close", "SMA50"), LT("SMA50", "SMA200"), MCAP],
    up_from_open: [GT("close", "open"), MCAP],
    down_from_open: [LT("close", "open"), MCAP],
    up_on_volume: [GT("change", 0), GT("relative_volume_10d_calc", 1.0), MCAP],
    down_on_volume: [LT("change", 0), GT("relative_volume_10d_calc", 1.0), MCAP],
    up_4pct: [EGT("change", 4), MCAP],
    down_4pct: [ELT("change", -4), MCAP],
  };
  const keys = Object.keys(scalarTasks);
  const scalarResults = await mapLimit(keys, 8, (k) => scanCount(scalarTasks[k]));
  const v: Record<string, number> = {};
  keys.forEach((k, i) => { v[k] = scalarResults[i] ?? 0; });

  // ── Sector breadth (n + above-50SMA per sector, parallelized) ───────────
  const sectorTasks = TV_SECTORS.flatMap((sec) => {
    const sf: Filter = { left: "sector", operation: "in_range", right: [sec] };
    return [{ sec, kind: "n" as const, filters: [sf, MCAP] },
            { sec, kind: "above" as const, filters: [sf, GT("close", "SMA50"), MCAP] }];
  });
  const sectorResults = await mapLimit(sectorTasks, 8, (t) => scanCount(t.filters));
  const sectorMap = new Map<string, { n: number; above: number }>();
  sectorTasks.forEach((t, i) => {
    const cur = sectorMap.get(t.sec) ?? { n: 0, above: 0 };
    if (t.kind === "n") cur.n = sectorResults[i] ?? 0;
    else cur.above = sectorResults[i] ?? 0;
    sectorMap.set(t.sec, cur);
  });
  const sectors = Array.from(sectorMap.entries())
    .filter(([, x]) => x.n > 0)
    .map(([sector, x]) => ({
      sector, n: x.n,
      pct_above_50sma: Math.round((x.above / x.n) * 1000) / 10,
    }))
    .sort((a, b) => b.pct_above_50sma - a.pct_above_50sma);

  const now = new Date().toISOString();
  const snapshot: BreadthSnapshot = {
    built_at: now, as_of: now, generated_by: "tv-scanner",
    mcap_floor: MCAP_FLOOR, universe_size: v.universe,
    market: {
      new_highs: v.new_highs, new_lows: v.new_lows,
      advance: v.advance, decline: v.decline,
      stage_counts: { "1": v.stage1, "2": v.stage2, "3": v.stage3, "4": v.stage4 },
      universe_size: v.universe,
    },
    momentum: {
      up_from_open: v.up_from_open, down_from_open: v.down_from_open,
      up_on_volume: v.up_on_volume, down_on_volume: v.down_on_volume,
      up_4pct: v.up_4pct, down_4pct: v.down_4pct,
    },
    sectors,
    industries: [],
  };
  return { snapshot, durationMs: Date.now() - started };
}
