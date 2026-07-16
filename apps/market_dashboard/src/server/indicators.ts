/**
 * indicators.ts — pure TA helpers for the position path tracker.
 * No I/O; deterministic; unit-testable. Used by /api/cron/track-positions.
 */

export interface Candle {
  date: string; // YYYY-MM-DD (session date, UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

/**
 * EMA series aligned to `closes`. Each output[i] is the EMA through close[i],
 * or null until `period` samples exist. Seeded with the SMA of the first window.
 */
export function emaSeries(closes: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < closes.length; i++) {
    if (i + 1 < period) {
      out.push(null);
      continue;
    }
    if (prev == null) {
      const seed = closes.slice(i + 1 - period, i + 1).reduce((a, b) => a + b, 0) / period;
      prev = seed;
      out.push(seed);
      continue;
    }
    prev = closes[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

/**
 * Wilder ATR series aligned to `candles`. output[i] is ATR through candle[i],
 * null until `period`+1 samples. True range uses the prior close.
 */
export function atrSeries(candles: Candle[], period = 14): (number | null)[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) {
      tr.push(c.high - c.low);
      continue;
    }
    const pc = candles[i - 1].close;
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc)));
  }
  const out: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      out.push(null);
      continue;
    }
    if (prev == null) {
      prev = tr.slice(i + 1 - period, i + 1).reduce((a, b) => a + b, 0) / period;
      out.push(prev);
      continue;
    }
    prev = (prev * (period - 1) + tr[i]) / period;
    out.push(prev);
  }
  return out;
}

/** Lowest low across the last `n` candles ending at (and including) index `idx`. */
/**
 * Wilder RSI series aligned to `closes` (null until `period`+1 samples exist).
 * Mirrors compute_index_technicals.py so the dashboard and the brief agree.
 */
export function rsiSeries(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = closes.map(() => null);
  if (closes.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain += Math.max(d, 0);
    avgLoss += Math.max(-d, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  const rsiOf = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = rsiOf(avgGain, avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = rsiOf(avgGain, avgLoss);
  }
  return out;
}

export type EntryRisk = "EXTREME-EXTENDED" | "EXTENDED" | "FAIR" | "AT-MA" | "OVERSOLD-PB" | "UNKNOWN";

/**
 * Classify location by distance from the 21EMA in ATR units. Same rubric as
 * compute_index_technicals.py (morning-brief Step 0.5) — keep the two in sync.
 *   >= +3 EXTREME-EXTENDED | +2..+3 EXTENDED | +0.5..+2 FAIR | -0.5..+0.5 AT-MA | <= -0.5 OVERSOLD-PB
 */
export function classifyEntryRisk(dist21Atr: number | null): EntryRisk {
  if (dist21Atr == null || !Number.isFinite(dist21Atr)) return "UNKNOWN";
  if (dist21Atr >= 3) return "EXTREME-EXTENDED";
  if (dist21Atr >= 2) return "EXTENDED";
  if (dist21Atr >= 0.5) return "FAIR";
  if (dist21Atr >= -0.5) return "AT-MA";
  return "OVERSOLD-PB";
}

export function lowestLow(candles: Candle[], idx: number, n: number): number | null {
  const start = Math.max(0, idx - n + 1);
  const slice = candles.slice(start, idx + 1);
  if (slice.length === 0) return null;
  return Math.min(...slice.map((c) => c.low));
}
