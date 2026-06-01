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
export function lowestLow(candles: Candle[], idx: number, n: number): number | null {
  const start = Math.max(0, idx - n + 1);
  const slice = candles.slice(start, idx + 1);
  if (slice.length === 0) return null;
  return Math.min(...slice.map((c) => c.low));
}
