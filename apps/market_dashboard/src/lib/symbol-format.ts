/**
 * Symbol format conversion between moomoo/internal and Yahoo Finance.
 *
 * Internal storage uses moomoo's prefix format:
 *   US.HUT, HK.00700, SG.D05, SH.600519, SZ.000001, MY.1155
 *
 * Yahoo Finance uses suffix format:
 *   HUT, 0700.HK, D05.SI, 600519.SS, 000001.SZ, 1155.KL
 *
 * Used by /api/cron/refresh-quotes to fetch quotes for held tickers.
 */

export function toYahooSymbol(internalSymbol: string): string {
  const [prefix, ticker] = internalSymbol.split(".", 2);
  if (!ticker) return internalSymbol;  // unprefixed — pass through

  switch (prefix.toUpperCase()) {
    case "US":
      return ticker;
    case "HK":
      // Pad to 4 digits for Yahoo HK (e.g., "700" -> "0700.HK")
      return `${ticker.padStart(4, "0")}.HK`;
    case "MY":
      // Bursa Malaysia (TradesViz-platform P0): Yahoo uses the 4-digit Bursa
      // stock code + .KL (e.g., MY.1155 → "1155.KL" Maybank). Warrant/board
      // suffixes pass through as-is.
      return `${/^\d+$/.test(ticker) ? ticker.padStart(4, "0") : ticker}.KL`;
    case "SG":
      return `${ticker}.SI`;
    case "SH":
      return `${ticker}.SS`;
    case "SZ":
      return `${ticker}.SZ`;
    case "TW":
      return `${ticker}.TW`;
    case "LON":
      return `${ticker}.L`;
    default:
      // Fail closed (TradesViz-platform P0): an unknown market prefix must NOT
      // silently fetch a same-named US ticker — that returns a plausible but
      // WRONG price. Return the unmapped internal symbol so Yahoo 404s and the
      // position surfaces as unpriced/stale instead of mispriced.
      console.warn(`[symbol-format] unknown market prefix "${prefix}" in "${internalSymbol}" — not mapped to Yahoo`);
      return internalSymbol;
  }
}

export function fromYahooSymbol(yahooSymbol: string): string {
  if (yahooSymbol.endsWith(".HK")) {
    return `HK.${yahooSymbol.slice(0, -3)}`;
  }
  if (yahooSymbol.endsWith(".KL")) return `MY.${yahooSymbol.slice(0, -3)}`;
  if (yahooSymbol.endsWith(".SI")) return `SG.${yahooSymbol.slice(0, -3)}`;
  if (yahooSymbol.endsWith(".SS")) return `SH.${yahooSymbol.slice(0, -3)}`;
  if (yahooSymbol.endsWith(".SZ")) return `SZ.${yahooSymbol.slice(0, -3)}`;
  if (yahooSymbol.endsWith(".TW")) return `TW.${yahooSymbol.slice(0, -3)}`;
  if (yahooSymbol.endsWith(".L")) return `LON.${yahooSymbol.slice(0, -2)}`;
  // No suffix — assume US
  return `US.${yahooSymbol}`;
}
