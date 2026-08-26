import { liveQuoteThresholdsForNow } from "@/lib/freshness";

const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface ObservedQuote {
  symbol: string;
  observedAt: string | Date;
}

export function isLiveQuoteFresh(
  observedAt: string | Date,
  now = new Date(),
): boolean {
  const observedMs = observedAt instanceof Date
    ? observedAt.getTime()
    : new Date(observedAt).getTime();
  if (!Number.isFinite(observedMs)) return false;

  const ageMs = now.getTime() - observedMs;
  if (ageMs < -MAX_FUTURE_CLOCK_SKEW_MS) return false;
  return ageMs < liveQuoteThresholdsForNow(now).staleSec * 1000;
}

/**
 * Selects only fresh rows and resolves duplicates at the same seam. A fresh
 * row for one symbol can never make an older row for another symbol eligible.
 */
export function selectFreshLiveQuotes<T extends ObservedQuote>(
  rows: readonly T[],
  now = new Date(),
): { bySymbol: Map<string, T>; latestObservedAt: Date | null } {
  const bySymbol = new Map<string, T>();
  let latestObservedAt: Date | null = null;

  for (const row of rows) {
    if (!isLiveQuoteFresh(row.observedAt, now)) continue;
    const symbol = row.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const observedAt = row.observedAt instanceof Date ? row.observedAt : new Date(row.observedAt);
    const existing = bySymbol.get(symbol);
    const existingAt = existing
      ? (existing.observedAt instanceof Date ? existing.observedAt : new Date(existing.observedAt))
      : null;
    if (!existingAt || observedAt.getTime() >= existingAt.getTime()) {
      bySymbol.set(symbol, row);
    }
    if (!latestObservedAt || observedAt.getTime() > latestObservedAt.getTime()) {
      latestObservedAt = observedAt;
    }
  }

  return { bySymbol, latestObservedAt };
}
