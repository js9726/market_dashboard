/**
 * Pure fill→episode math for the trade reconciler (no prisma imports so it
 * unit-tests hermetically). An EPISODE is one position lifecycle: flat →
 * position → flat, built from the immutable TradeFill log.
 */

export const QTY_EPS = 1e-6;
export const MATCH_WINDOW_DAYS = 3;

export interface FillLike {
  id: string;
  ticker: string; // broker form, e.g. "US.MCHP"
  side: string; // BUY | SELL
  qty: number;
  price: number;
  fees: number | null;
  currency: string | null;
  executedAt: Date;
  tradeRecordId: string | null;
}

export interface Episode {
  ticker: string; // plain, e.g. "MCHP"
  fillIds: string[];
  openedAt: Date;
  closedAt: Date | null; // null = position still open
  buyQty: number;
  sellQty: number;
  avgBuy: number;
  avgSell: number;
  fees: number;
  /** sell notional − buy notional − fees; only meaningful when closed. */
  realized: number | null;
  /** true when every fill is USD (or a US.* ticker with no currency tag). */
  usdSafe: boolean;
}

export function plainTicker(t: string): string {
  return t.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
}

/** Group one ticker's fills (sorted by executedAt asc) into episodes. */
export function buildEpisodes(fills: FillLike[]): Episode[] {
  const episodes: Episode[] = [];
  let current: Episode | null = null;
  let net = 0;

  for (const f of fills) {
    const qty = Math.abs(f.qty);
    if (qty < QTY_EPS) continue;
    const signed = f.side.toUpperCase() === "SELL" ? -qty : qty;

    if (!current) {
      current = {
        ticker: plainTicker(f.ticker),
        fillIds: [],
        openedAt: f.executedAt,
        closedAt: null,
        buyQty: 0,
        sellQty: 0,
        avgBuy: 0,
        avgSell: 0,
        fees: 0,
        realized: null,
        usdSafe: true,
      };
      net = 0;
    }

    current.fillIds.push(f.id);
    current.fees += f.fees ?? 0;
    const usd = f.currency === "USD" || (f.currency == null && /^US\./i.test(f.ticker));
    if (!usd) current.usdSafe = false;

    if (signed > 0) {
      current.avgBuy = (current.avgBuy * current.buyQty + f.price * qty) / (current.buyQty + qty);
      current.buyQty += qty;
    } else {
      current.avgSell = (current.avgSell * current.sellQty + f.price * qty) / (current.sellQty + qty);
      current.sellQty += qty;
    }
    net += signed;

    if (Math.abs(net) < QTY_EPS) {
      current.closedAt = f.executedAt;
      current.realized =
        current.sellQty * current.avgSell - current.buyQty * current.avgBuy - current.fees;
      episodes.push(current);
      current = null;
    }
  }

  if (current) episodes.push(current); // trailing open episode
  return episodes;
}

/** Prisma-free shape of a TradeRecord candidate for canonical matching. */
export interface CanonicalCandidate {
  id: string;
  ticker: string;
  state: string | null;
  source: string;
  notes: string | null;
  connectionId: string | null;
  brokerOrderId: string | null;
  quantity: number | null;
  tradeDate: Date | null;
  executedAt: Date | null;
  platform: string | null;
  hasVerdict: boolean;
}

function recordDate(r: CanonicalCandidate): Date | null {
  return r.tradeDate ?? r.executedAt;
}

export function inWindow(r: CanonicalCandidate, ep: Episode): boolean {
  const rd = recordDate(r);
  if (!rd) return false;
  const lo = ep.openedAt.getTime() - MATCH_WINDOW_DAYS * 86400e3;
  const hi = (ep.closedAt ?? ep.openedAt).getTime() + MATCH_WINDOW_DAYS * 86400e3;
  return rd.getTime() >= lo && rd.getTime() <= hi;
}

export function qtyMatches(r: CanonicalCandidate, ep: Episode): boolean {
  return r.quantity != null && Math.abs(r.quantity - ep.buyQty) < QTY_EPS + 1e-9;
}

/** Auto-created bridge stopgap rows ("position:<ticker>") with no user content. */
export function isStopgap(r: CanonicalCandidate): boolean {
  return r.source === "BRIDGE" && (r.brokerOrderId?.startsWith("position:") ?? false) && !r.notes;
}

/**
 * Pick the canonical journal row for a closed episode. User-authored rows
 * (sheet/manual) win over bridge rows; quantity+date matches win over
 * date-only. Deterministic tie-break: non-stopgap first, then lowest id.
 */
export function pickCanonical(
  candidates: CanonicalCandidate[],
  ep: Episode,
): CanonicalCandidate | null {
  const windowed = candidates.filter((r) => inWindow(r, ep));
  const tiers = [
    windowed.filter((r) => (r.source === "SHEET" || r.source === "MANUAL") && qtyMatches(r, ep)),
    windowed.filter((r) => r.source === "SHEET" || r.source === "MANUAL"),
    windowed.filter((r) => qtyMatches(r, ep)),
    windowed,
  ];
  for (const tier of tiers) {
    if (tier.length === 1) return tier[0];
    if (tier.length > 1) {
      const nonStopgap = tier.filter((r) => !isStopgap(r));
      const pool = nonStopgap.length > 0 ? nonStopgap : tier;
      return [...pool].sort((a, b) => a.id.localeCompare(b.id))[0];
    }
  }
  return null;
}
