const EPS = 1e-9;

let fxCache: { rate: number; at: number } | null = null;

export type DisplayCurrency = "USD" | "MYR";

export function normalizeCurrencyCode(currencyCode: string | null | undefined): string {
  const c = currencyCode?.trim().toUpperCase();
  return c || "USD";
}

export function moneyToUsd(value: unknown, currencyCode: string | null | undefined, fxUsdMyr: number | null): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;

  const currency = normalizeCurrencyCode(currencyCode);
  if (currency === "USD") return round2(n);
  if (currency === "MYR" && fxUsdMyr != null && fxUsdMyr > EPS) return round2(n / fxUsdMyr);
  return null;
}

export function usdToDisplay(valueUsd: number, currency: DisplayCurrency, fxUsdMyr: number | null): number {
  if (currency === "MYR" && fxUsdMyr != null && fxUsdMyr > EPS) return round2(valueUsd * fxUsdMyr);
  return round2(valueUsd);
}

export function convertEquitySnapshotToUsd(
  snapshot: {
    totalAssets: unknown;
    cash: unknown;
    marketVal: unknown;
    currencyCode: string | null | undefined;
  },
  fxUsdMyr: number | null,
): { totalAssetsUsd: number; cashUsd: number; marketValUsd: number } | null {
  const totalAssetsUsd = moneyToUsd(snapshot.totalAssets, snapshot.currencyCode, fxUsdMyr);
  const cashUsd = moneyToUsd(snapshot.cash, snapshot.currencyCode, fxUsdMyr);
  const marketValUsd = moneyToUsd(snapshot.marketVal, snapshot.currencyCode, fxUsdMyr);
  if (totalAssetsUsd == null || cashUsd == null || marketValUsd == null) return null;
  return { totalAssetsUsd, cashUsd, marketValUsd };
}

export async function getUsdMyrRate(): Promise<number | null> {
  if (fxCache && Date.now() - fxCache.at < 3_600_000) return fxCache.rate;
  try {
    const r = await fetch("https://api.frankfurter.app/latest?from=USD&to=MYR", {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const j = await r.json();
      const rate = Number(j?.rates?.MYR);
      if (Number.isFinite(rate) && rate > 0) {
        fxCache = { rate, at: Date.now() };
        return rate;
      }
    }
  } catch {
    // Keep fail-closed behavior: reuse warm cache only, otherwise callers must
    // avoid converting non-USD amounts.
  }
  return fxCache?.rate ?? null;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
