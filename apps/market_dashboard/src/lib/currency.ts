/**
 * currency.ts — single source of truth for reporting trade P&L in USD.
 *
 * The operator's Google Sheet converts P&L + position value to MYR using ONE
 * fixed rate; prices stay native (USD for US names). Brokers (MooMoo / IBKR)
 * report in USD. This module reconciles both to USD via a fixed authority ladder
 * so every surface (trade log, stats, equity, coaching) aggregates one currency.
 *
 * Authority ladder (resolveTradeUsd):
 *   1. broker fills present        → computeBrokerRealized() net USD   (pnlSource="broker")
 *   2. sheet base currency is USD  → raw P&L is already USD            (pnlSource="native-usd")
 *   3. non-USD base + fixed rate   → raw P&L ÷ rate                    (pnlSource="sheet-fixed-rate")
 *   4. non-USD base + no rate      → null + badge, never assume 1:1    (pnlSource="unconverted")
 *
 * `resolveTradeUsd` / `detectFixedRate` are called server-side (API routes).
 * `formatUsd` / `pnlSourceBadge` are client-safe display helpers — the only
 * non-type import (computeBrokerRealized) is a pure function, so client bundles
 * tree-shake it away.
 */
import { computeBrokerRealized, type RealizedFill } from "@/server/realized-pnl";

export type PnlSource = "broker" | "native-usd" | "sheet-fixed-rate" | "unconverted";

export interface ResolveInput {
  ticker: string;
  /** Raw P&L from the sheet, denominated in `sheetBaseCurrency`. null = open. */
  rawPnl: number | null;
  /** This trade's broker fills. Empty if none matched. Sorted internally. */
  fills?: RealizedFill[];
  /** Base-currency-per-USD fixed rate the sheet used (e.g. 4.7). null/0 = unknown. */
  fixedRate?: number | null;
  /** Currency the sheet's P&L column is denominated in. Default "MYR". */
  sheetBaseCurrency?: string;
}

export interface ResolveResult {
  pnlUsd: number | null;
  fxRate: number | null;
  pnlSource: PnlSource;
  /** Resolved reporting currency — "USD" unless unconverted (then the base). */
  currencyCode: string;
}

const EPS = 1e-9;
const round2 = (n: number) => Number(n.toFixed(2));

export function resolveTradeUsd(input: ResolveInput): ResolveResult {
  const fills = input.fills ?? [];
  const fixedRate = input.fixedRate ?? null;
  const base = (input.sheetBaseCurrency ?? "MYR").toUpperCase();
  const rawPnl = input.rawPnl;

  // 1) Broker truth — realized USD from this trade's own fills (FIFO, net of fees).
  if (fills.length > 0) {
    const r = computeBrokerRealized(
      [...fills].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime()),
    );
    // Only realized once lots actually close; an all-open position stays null.
    return {
      pnlUsd: r.closedLots > 0 ? round2(r.netUsd) : null,
      fxRate: null,
      pnlSource: "broker",
      currencyCode: "USD",
    };
  }

  // Open / unrealized sheet trade — nothing to convert yet.
  if (rawPnl == null) {
    const usd = base === "USD";
    return { pnlUsd: null, fxRate: usd ? 1 : null, pnlSource: usd ? "native-usd" : "unconverted", currencyCode: usd ? "USD" : base };
  }

  // 2) Sheet base already USD.
  if (base === "USD") {
    return { pnlUsd: round2(rawPnl), fxRate: 1, pnlSource: "native-usd", currencyCode: "USD" };
  }

  // 3) Non-USD base with a known fixed rate → reverse the sheet's conversion.
  if (fixedRate != null && fixedRate > EPS) {
    return { pnlUsd: round2(rawPnl / fixedRate), fxRate: fixedRate, pnlSource: "sheet-fixed-rate", currencyCode: "USD" };
  }

  // 4) Fail-closed: unknown rate — never assume 1:1.
  return { pnlUsd: null, fxRate: null, pnlSource: "unconverted", currencyCode: base };
}

/**
 * Best-effort detection of the sheet's fixed (base-per-USD) rate: median of
 * |sheetPnl| / |brokerUsd| across trades reconciled to a broker. Seeds the
 * editable Settings field — the operator can correct it. Returns null when
 * there are no broker-anchored samples (caller must then require manual input).
 */
export function detectFixedRate(samples: { sheetAbs: number; usdAbs: number }[]): number | null {
  const ratios = samples
    .filter((s) => Math.abs(s.usdAbs) > 1 && Math.abs(s.sheetAbs) > 1)
    .map((s) => Math.abs(s.sheetAbs) / Math.abs(s.usdAbs))
    .filter((r) => Number.isFinite(r) && r > 0.5 && r < 50) // sane FX band
    .sort((a, b) => a - b);
  if (ratios.length === 0) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return Number(median.toFixed(4));
}

/** Format a USD amount with sign, e.g. "+$1,234.56" / "-$1,234.56" / "—". */
export function formatUsd(value: number | null | undefined, opts: { sign?: boolean } = {}): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const signed = opts.sign !== false;
  const prefix = signed ? (value >= 0 ? "+" : "-") : value < 0 ? "-" : "";
  return `${prefix}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** UI label + tooltip for a pnlSource provenance badge. */
export function pnlSourceBadge(source: string | null | undefined): { label: string; title: string } | null {
  switch (source) {
    case "broker":
      return { label: "broker", title: "Broker-true realized P&L (USD) from MooMoo/IBKR fills" };
    case "sheet-fixed-rate":
      return { label: "FX", title: "Converted from the sheet's MYR using the fixed rate" };
    case "native-usd":
      return { label: "USD", title: "Sheet value already in USD" };
    case "unconverted":
      return { label: "set rate", title: "No fixed rate set — value not converted. Set the rate in Settings." };
    default:
      return null;
  }
}
