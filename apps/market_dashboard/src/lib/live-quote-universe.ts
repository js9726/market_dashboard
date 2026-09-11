import rawUniverse from "../../../../packages/live-quote-universe.json";

interface QuoteUniverseManifest {
  changeBasis: string;
  indices: string[];
  sectors: Array<{ symbol: string; label: string }>;
  defaultWatchlist: string[];
}

const manifest = rawUniverse as QuoteUniverseManifest;

function normalizeSymbols(symbols: readonly string[], group: string): string[] {
  const normalized = symbols.map((symbol) => symbol.trim().toUpperCase());
  if (normalized.some((symbol) => !/^[A-Z^][A-Z0-9.^/-]*$/.test(symbol))) {
    throw new Error(`Invalid symbol in live quote ${group}`);
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Duplicate symbol in live quote ${group}`);
  }
  return normalized;
}

export const LIVE_QUOTE_CHANGE_BASIS = manifest.changeBasis;
export const LIVE_QUOTE_INDEX_SYMBOLS = normalizeSymbols(manifest.indices, "indices");
export const LIVE_QUOTE_SECTORS = manifest.sectors.map((sector) => ({
  symbol: normalizeSymbols([sector.symbol], "sectors")[0],
  label: sector.label,
}));
export const LIVE_QUOTE_DEFAULT_WATCHLIST = normalizeSymbols(
  manifest.defaultWatchlist,
  "default watchlist",
);

/**
 * Product-level quote contract shared by the bridge, live tape and brief
 * snapshot. Callers may add user-specific symbols, but cannot remove the
 * symbols the dashboard promises to keep fresh.
 */
export function requiredLiveQuoteSymbols(additional: readonly string[] = []): string[] {
  return Array.from(new Set([
    ...LIVE_QUOTE_INDEX_SYMBOLS,
    ...LIVE_QUOTE_SECTORS.map((sector) => sector.symbol),
    ...LIVE_QUOTE_DEFAULT_WATCHLIST,
    ...normalizeSymbols(additional, "additional symbols"),
  ]));
}
