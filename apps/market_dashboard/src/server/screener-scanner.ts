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

/** Faithful TS port of tv_screener_fetch.py _compute_stages (Conviction model). */
function algoScore(h: Record<string, unknown>): {
  score: number; verdict: string; pattern: string;
  stages: { setup: number; entry: number; theme: number; sentiment: number };
} {
  const num = (k: string): number => {
    const v = h[k];
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  };
  const perf_1m = num("Perf.1M");
  const chg_day = num("change");
  const rvol = num("relative_volume_10d_calc");
  const mcap = num("market_cap_basic");
  const premarket_chg = num("premarket_change");
  const high_d = num("high"), low_d = num("low"), close_d = num("close");
  const A = Math.abs(chg_day);

  const is_ep = chg_day > 8 && perf_1m < 15 && rvol > 2.5;
  const is_breakout = chg_day > 3 && chg_day < 20 && perf_1m > 8 && perf_1m < 50 && rvol > 1.5;
  // Pullback = a small move in an uptrend on NON-surging volume. Contraction is
  // the signal (wiki/a-list-gate-and-screener.md), so there is no low-RVOL floor —
  // the quietest pullbacks are the best ones; a surge would make it a breakout/EP.
  const is_pullback = A < 5 && perf_1m > 5 && rvol < 1.5;
  const is_parabolic = perf_1m > 70 || (chg_day > 25 && perf_1m > 30);
  const is_stage4 = perf_1m < -15;

  // Setup /40
  let setup: number;
  if (is_parabolic) setup = 6;
  else if (is_stage4) setup = 8;
  else if (is_ep) setup = 32;
  else if (is_breakout) setup = 30;
  else if (is_pullback) setup = 26;
  else setup = 14;
  // RVOL is read by setup class (wiki/a-list-gate-and-screener.md). Breakout/EP
  // want a surge; a pullback wants CONTRACTION — low volume on a pullback is the
  // setup forming, not weakness, so reward the dry-up and only fault a HIGH-volume
  // (potential distribution) pullback. Penalising pullback contraction was the bug
  // that dropped names like GFS/NTAP to a poor score.
  if (is_pullback) {
    if (rvol <= 0.7) setup += 4; else if (rvol <= 1.0) setup += 2; else if (rvol > 2) setup -= 4;
  } else {
    if (rvol >= 3) setup += 6; else if (rvol >= 2) setup += 3; else if (rvol < 1) setup -= 6;
  }
  if (perf_1m > 80) setup -= 8; else if (perf_1m > 60) setup -= 4;
  setup = Math.max(0, Math.min(40, setup));

  // Entry /30
  let entry: number;
  if (A > 30) entry = 3;
  else if (A > 20) entry = 7;
  else if (A > 15) entry = 12;
  else if (A > 10) entry = 18;
  else if (A > 5) entry = 27;
  else if (A > 1) entry = 22;
  else entry = 13;
  if (is_ep && rvol >= 3 && A >= 10 && A <= 25) entry = Math.max(entry, 24);
  if (premarket_chg > 5 && chg_day >= 0) {
    const fade = premarket_chg - chg_day;
    if (fade > 25) entry -= 8; else if (fade > 15) entry -= 6;
  }
  if (high_d > low_d && low_d > 0 && close_d > 0 && A > 5) {
    if ((high_d - low_d) / close_d > 0.02) {
      const cs = (close_d - low_d) / (high_d - low_d);
      if (cs < 0.35) entry -= 6; else if (cs < 0.5) entry -= 3;
    }
  }
  entry = Math.max(0, Math.min(30, entry));

  // Theme /20
  let rs_part: number;
  if (perf_1m > 80) rs_part = 5;
  else if (perf_1m > 50) rs_part = 9;
  else if (perf_1m > 25) rs_part = 14;
  else if (perf_1m > 10) rs_part = 12;
  else if (perf_1m > 2) rs_part = 8;
  else if (perf_1m > -5) rs_part = 5;
  else if (perf_1m > -20) rs_part = 3;
  else rs_part = 1;
  let mcap_part: number;
  if (mcap >= 10e9) mcap_part = 6;
  else if (mcap >= 2e9) mcap_part = 5;
  else if (mcap >= 500e6) mcap_part = 3;
  else if (mcap >= 300e6) mcap_part = 2;
  else mcap_part = 0;
  const theme = Math.min(20, rs_part + mcap_part);

  // Sentiment /10 (neutral default; LLM layer overlays real regime/event gate)
  const sentiment = 6;

  const raw = Math.round(setup + entry + theme + sentiment);
  const pattern = is_parabolic ? "PARABOLIC" : is_ep ? "EP" : is_breakout ? "BREAKOUT"
    : is_pullback ? "PULLBACK" : is_stage4 ? "STAGE4-BOUNCE" : "UNCLEAR";
  // Conviction bands (wiki/trader-styles.md): GO >=75, WAIT 50-74, PASS <50.
  const verdict = raw >= 75 ? "GO" : raw >= 50 ? "WAIT" : "PASS";
  return {
    score: raw, verdict, pattern,
    stages: { setup: Math.round(setup), entry: Math.round(entry), theme: Math.round(theme), sentiment: Math.round(sentiment) },
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
