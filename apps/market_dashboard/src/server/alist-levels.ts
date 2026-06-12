/**
 * alist-levels.ts — deterministic auto-levels for REC candidates that arrive
 * without entry/stop (screener-score-only picks). Without a stop there is no
 * 1R, no MFE-R/MAE-R, and no outcome — the row is untrackable.
 *
 * Levels follow the wiki ATR-floor convention: entry = pivot (prior-session
 * high, or last close if above), stop = entry − 1.5×ATR(14), target = +2R.
 * This is market data, not estimation — rows are tagged AUTO-LEVELS so the
 * UI can distinguish them from operator/brief-provided levels. On any fetch
 * failure levels stay null (fail-closed; the UI shows NEEDS-LEVELS).
 */
import yahooFinance from "yahoo-finance2";
import { computeAtr, type OhlcBar } from "@/lib/technical";

export interface AutoLevels {
  entryZone: number;
  stop: number;
  target: number;
  rrr: number;
  atr: number;
}

const ATR_MULT = 1.5;
const TARGET_R = 2;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function levelsFromBars(bars: OhlcBar[], entryHint?: number | null): AutoLevels | null {
  const atr = computeAtr(bars, 14);
  if (atr == null || bars.length < 2) return null;
  const lastClose = bars[bars.length - 1].close;
  const prevHigh = bars[bars.length - 2].high;
  const entry = entryHint ?? Math.max(prevHigh, lastClose);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  const stop = entry - ATR_MULT * atr;
  if (stop <= 0 || stop >= entry) return null;
  return {
    entryZone: round2(entry),
    stop: round2(stop),
    target: round2(entry + TARGET_R * (entry - stop)),
    rrr: TARGET_R,
    atr: round2(atr),
  };
}

/** Fetch ~3 months of daily bars and compute levels. Null on any failure. */
export async function computeAutoLevels(
  ticker: string,
  entryHint?: number | null,
): Promise<AutoLevels | null> {
  try {
    const period1 = new Date(Date.now() - 90 * 86400e3);
    // yahoo-finance2 typing is loose; same cast as cron/rescore-day14.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yf = yahooFinance as any;
    const rows: Array<{ high?: number | null; low?: number | null; close?: number | null }> =
      (await yf.historical(ticker, { period1, period2: new Date(), interval: "1d" })) ?? [];
    const bars: OhlcBar[] = rows
      .filter((q) => q.high != null && q.low != null && q.close != null)
      .map((q) => ({ high: q.high!, low: q.low!, close: q.close! }));
    return levelsFromBars(bars, entryHint);
  } catch (e) {
    console.warn(`[alist-levels] ${ticker} auto-levels failed (left null):`, e);
    return null;
  }
}
