/**
 * screener-scanner.ts — server-side TradingView screener fetch + algo scoring.
 *
 * Ports tv_screener_fetch.py to TypeScript so the 5 daily screeners refresh
 * inside a Vercel serverless function (proven to reach scanner.tradingview.com
 * — same endpoint breadth uses) instead of GitHub Actions, whose cron skipped
 * today and left the screener stale during market hours.
 *
 * - Reads the query configs from tv-screeners.config.json (copied from the
 *   Python source of truth).
 * - Fetches all 5 screeners in parallel.
 * - Computes the deterministic 4-stage algo score + pattern + verdict for each
 *   hit (faithful port of the Python _algo_score). No DeepSeek call — the algo
 *   score is what the dashboard needs; AI verdicts can be layered on later.
 *
 * Output matches tv_screeners.json (types/tv-screener.ts):
 *   { fetched_at, market_was_open, screeners: [{ id, name, tv_url, hits[] }] }
 */
import config from "./tv-screeners.config.json";

const SCANNER_URL = "https://scanner.tradingview.com/america/scan";

interface ScreenerCfg {
  id: string;
  name: string;
  tv_url?: string;
  query: { filter?: unknown[]; sort?: unknown; range?: number[]; [k: string]: unknown };
}
const COLUMNS: string[] = (config as { columns_to_fetch: string[] }).columns_to_fetch;
const SCREENERS: ScreenerCfg[] = (config as { screeners: ScreenerCfg[] }).screeners;

async function fetchOne(cfg: ScreenerCfg): Promise<Record<string, unknown>[]> {
  const body = { ...cfg.query, columns: COLUMNS };
  try {
    const res = await fetch(SCANNER_URL, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[screener:${cfg.id}] HTTP ${res.status}`);
      return [];
    }
    const json = (await res.json()) as { data?: { s: string; d: unknown[] }[] };
    return (json.data ?? []).map((row) => {
      const sym = row.s ?? "";
      const ticker = sym.includes(":") ? sym.split(":")[1] : sym;
      const exchange = sym.includes(":") ? sym.split(":")[0] : null;
      const mapped: Record<string, unknown> = { ticker, exchange };
      COLUMNS.forEach((col, i) => { mapped[col] = row.d?.[i] ?? null; });
      const score = algoScore(mapped);
      return { ...mapped, ...score };
    });
  } catch (e) {
    console.error(`[screener:${cfg.id}] fetch failed:`, e);
    return [];
  }
}

/** Faithful TS port of tv_screener_fetch.py _algo_score (4-stage, deterministic). */
function algoScore(h: Record<string, unknown>): {
  score: number; verdict: string; pattern: string;
  stages: { s1_trend: number; s2_pattern: number; s3_timing: number; s4_risk: number };
} {
  const num = (k: string): number => {
    const v = h[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const perf_1m = num("Perf.1M");
  const perf_1w = num("Perf.W");
  const chg_day = num("change");
  const rvol = num("relative_volume_10d_calc");
  const mcap = num("market_cap_basic");
  const premarket_chg = num("premarket_change");
  const high_d = num("high"), low_d = num("low"), close_d = num("close");

  // ── S1: trend / RS ──
  let s1: number;
  if (perf_1m > 80) s1 = 5;
  else if (perf_1m > 50) s1 = 10;
  else if (perf_1m > 25) s1 = 18;
  else if (perf_1m > 10) s1 = 22;
  else if (perf_1m > 2) s1 = 15;
  else if (perf_1m > -5) s1 = 8;
  else if (perf_1m > -20) s1 = 4;
  else s1 = 1;
  const prior_1m_trend = perf_1m - perf_1w;
  if (perf_1w > 5 && perf_1m > 5 && perf_1m < 60 && prior_1m_trend > 3) s1 = Math.min(25, s1 + 3);

  // ── S2: pattern ──
  const is_ep = chg_day > 8 && perf_1m < 15 && rvol > 2.5;
  const is_breakout = chg_day > 3 && chg_day < 20 && perf_1m > 8 && perf_1m < 50 && rvol > 1.5;
  const is_pullback = Math.abs(chg_day) < 5 && perf_1m > 5 && rvol >= 0.8;
  const is_parabolic = perf_1m > 70 || (chg_day > 25 && perf_1m > 30);
  const is_stage4 = perf_1m < -15;
  let s2: number;
  if (is_parabolic) s2 = 3;
  else if (is_stage4) s2 = 5;
  else if (is_ep) s2 = 22;
  else if (is_breakout) s2 = 20;
  else if (is_pullback) s2 = 18;
  else s2 = 10;
  if (rvol >= 3) s2 = Math.min(25, s2 + 3);
  else if (rvol >= 2) s2 = Math.min(25, s2 + 1);
  else if (rvol < 1) s2 = Math.max(0, s2 - 4);

  // ── S3: timing ──
  let s3: number;
  if (Math.abs(chg_day) > 30) s3 = 2;
  else if (Math.abs(chg_day) > 20) s3 = 6;
  else if (Math.abs(chg_day) > 15) s3 = 10;
  else if (Math.abs(chg_day) > 10) s3 = 16;
  else if (Math.abs(chg_day) > 5) s3 = 22;
  else if (Math.abs(chg_day) > 1) s3 = 18;
  else s3 = 12;
  if (is_ep && rvol >= 3 && Math.abs(chg_day) >= 10 && Math.abs(chg_day) <= 25) s3 = Math.max(s3, 20);
  if (premarket_chg > 5 && chg_day >= 0) {
    const fade = premarket_chg - chg_day;
    if (fade > 25) s3 = Math.max(0, s3 - 8);
    else if (fade > 15) s3 = Math.max(0, s3 - 6);
  }
  if (high_d > low_d && low_d > 0 && close_d > 0 && Math.abs(chg_day) > 5) {
    const range_pct = (high_d - low_d) / close_d;
    if (range_pct > 0.02) {
      const cs = (close_d - low_d) / (high_d - low_d);
      if (cs < 0.35) s3 = Math.max(0, s3 - 5);
      else if (cs < 0.5) s3 = Math.max(0, s3 - 3);
    }
  }

  // ── S4: risk ──
  let s4 = 0;
  if (mcap >= 10e9) s4 += 10;
  else if (mcap >= 2e9) s4 += 8;
  else if (mcap >= 500e6) s4 += 5;
  else if (mcap >= 300e6) s4 += 3;
  if (rvol >= 4) s4 += 10;
  else if (rvol >= 3) s4 += 8;
  else if (rvol >= 2) s4 += 5;
  else if (rvol >= 1) s4 += 2;
  if (perf_1m > 80) s4 = Math.max(0, s4 - 8);
  else if (perf_1m > 60) s4 = Math.max(0, s4 - 5);
  else if (perf_1m > 40) s4 = Math.max(0, s4 - 2);
  s4 = Math.min(25, s4);

  const raw = Math.round(s1 + s2 + s3 + s4);
  const pattern = is_parabolic ? "PARABOLIC" : is_ep ? "EP" : is_breakout ? "BREAKOUT"
    : is_pullback ? "PULLBACK" : is_stage4 ? "STAGE4-BOUNCE" : "UNCLEAR";
  // Verdict thresholds match prompt.md: GO >=80, WAIT 50-79, PASS <50.
  const verdict = raw >= 80 ? "GO" : raw >= 50 ? "WAIT" : "PASS";
  return {
    score: raw, verdict, pattern,
    stages: { s1_trend: Math.round(s1), s2_pattern: Math.round(s2), s3_timing: Math.round(s3), s4_risk: Math.round(s4) },
  };
}

export interface ScreenerFile {
  fetched_at: string;
  market_was_open: boolean;
  score_source: string;
  screeners: { id: string; name: string; tv_url?: string; hits: Record<string, unknown>[] }[];
}

/** US regular session: 13:30–20:00 UTC, Mon–Fri (approx, ignores holidays). */
function marketOpenNow(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return mins >= 13 * 60 + 30 && mins <= 20 * 60;
}

export async function fetchScreeners(): Promise<{ file: ScreenerFile; durationMs: number }> {
  const started = Date.now();
  const results = await Promise.all(
    SCREENERS.map(async (cfg) => ({
      id: cfg.id, name: cfg.name, tv_url: cfg.tv_url,
      hits: await fetchOne(cfg),
    })),
  );
  const file: ScreenerFile = {
    fetched_at: new Date().toISOString(),
    market_was_open: marketOpenNow(),
    score_source: "algo-tv-scanner",
    screeners: results,
  };
  return { file, durationMs: Date.now() - started };
}
