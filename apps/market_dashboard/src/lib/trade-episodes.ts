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

export interface SellOnlyBasis {
  ticker: string;
  openedAt: Date;
  buyQty: number;
  avgBuy: number;
}

export interface EpisodeRecordIdentity {
  ticker: string;
  quantity: number | null;
  buyPrice: number | null;
  tradeDate: Date | null;
  executedAt: Date | null;
  state: string | null;
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

/**
 * Recover a closure when the broker API supplied only the exit fills but a
 * prior position snapshot preserved the entry quantity and average cost.
 * This is common with IBKR because the live socket exposes recent executions,
 * not the older opening fill. Fail closed unless the USD sells exactly flatten
 * the preserved quantity.
 */
export function buildSellOnlyClosure(fills: FillLike[], basis: SellOnlyBasis): Episode | null {
  if (
    fills.length === 0 ||
    !Number.isFinite(basis.buyQty) ||
    basis.buyQty <= QTY_EPS ||
    !Number.isFinite(basis.avgBuy) ||
    basis.avgBuy <= 0
  ) return null;

  const ordered = [...fills].sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());
  if (ordered.some((fill) => fill.side.toUpperCase() !== "SELL" || fill.executedAt < basis.openedAt)) {
    return null;
  }
  const sellQty = ordered.reduce((sum, fill) => sum + Math.abs(fill.qty), 0);
  if (Math.abs(sellQty - basis.buyQty) > Math.max(QTY_EPS, basis.buyQty * 0.001)) return null;

  const usdSafe = ordered.every((fill) =>
    fill.currency === "USD" || (fill.currency == null && /^US\./i.test(fill.ticker))
  );
  if (!usdSafe) return null;

  const sellNotional = ordered.reduce((sum, fill) => sum + Math.abs(fill.qty) * fill.price, 0);
  const fees = ordered.reduce((sum, fill) => sum + (fill.fees ?? 0), 0);
  const avgSell = sellNotional / sellQty;
  return {
    ticker: plainTicker(basis.ticker),
    fillIds: ordered.map((fill) => fill.id),
    openedAt: basis.openedAt,
    closedAt: ordered[ordered.length - 1].executedAt,
    buyQty: basis.buyQty,
    sellQty,
    avgBuy: basis.avgBuy,
    avgSell,
    fees,
    realized: sellNotional - basis.buyQty * basis.avgBuy - fees,
    usdSafe: true,
  };
}

/** Match a legacy/unlinked journal row back to its immutable fill episode. */
export function pickEpisodeForRecord(
  episodes: Episode[],
  record: EpisodeRecordIdentity,
): Episode | null {
  const anchor = record.executedAt ?? record.tradeDate;
  if (!anchor) return null;
  const ticker = plainTicker(record.ticker).replace(/\.KL$/i, "");
  const openState = ["OPEN", "SEMI-OPEN", "PLANNING"].includes(record.state?.toUpperCase() ?? "");
  const windowMs = MATCH_WINDOW_DAYS * 86_400_000;

  const candidates = episodes
    .filter((episode) => episode.ticker.replace(/\.KL$/i, "") === ticker)
    .map((episode) => {
      const distance = Math.abs(episode.openedAt.getTime() - anchor.getTime());
      if (distance > windowMs) return null;
      const quantityMatches = record.quantity != null &&
        Math.abs(episode.buyQty - record.quantity) <= Math.max(QTY_EPS, Math.abs(record.quantity) * 0.001);
      const priceMatches = record.buyPrice != null &&
        Math.abs(episode.avgBuy - record.buyPrice) <= Math.max(0.01, Math.abs(record.buyPrice) * 0.001);
      const sameDay = episode.openedAt.toISOString().slice(0, 10) === anchor.toISOString().slice(0, 10);
      const lifecycleMatches = openState === (episode.closedAt == null);
      const score = (sameDay ? 8 : 0) + (quantityMatches ? 4 : 0) + (priceMatches ? 3 : 0) + (lifecycleMatches ? 1 : 0);
      return { episode, distance, score };
    })
    .filter((candidate): candidate is { episode: Episode; distance: number; score: number } => candidate != null)
    .sort((left, right) => right.score - left.score || left.distance - right.distance ||
      left.episode.openedAt.getTime() - right.episode.openedAt.getTime());

  return candidates[0]?.episode ?? null;
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
  buyPrice: number | null;
  tradeDate: Date | null;
  executedAt: Date | null;
  platform: string | null;
  brokerAccountId: string | null;
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

/**
 * Auto-created bridge stopgap rows ("position:<ticker>") with no user content.
 * materializeOpenPositionTradeRecords stamps its rows with a fixed auto-note —
 * that note is machine content, not user content.
 */
const AUTO_NOTE_PREFIX = "Auto-created from live broker position";
export function isStopgap(r: CanonicalCandidate): boolean {
  if (r.source !== "BRIDGE" || !(r.brokerOrderId?.startsWith("position:") ?? false)) return false;
  return !r.notes || r.notes.startsWith(AUTO_NOTE_PREFIX);
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
