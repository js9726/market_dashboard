/** Small pure technical helpers shared by server-side level computation. */

export interface OhlcBar {
  high: number;
  low: number;
  close: number;
}

/**
 * Average True Range over the trailing `period` bars (simple mean of TR).
 * Returns null when there aren't enough bars or values are degenerate.
 */
export function computeAtr(bars: OhlcBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;
  const window = bars.slice(-(period + 1));
  const trs: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prevClose = window[i - 1].close;
    const { high, low } = window[i];
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  if (trs.length < period) return null;
  const atr = trs.reduce((a, b) => a + b, 0) / trs.length;
  return Number.isFinite(atr) && atr > 0 ? atr : null;
}
