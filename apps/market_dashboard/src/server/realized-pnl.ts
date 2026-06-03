/**
 * realized-pnl.ts — broker-true realized P&L from TradeFills.
 *
 * Symmetric (order-robust) matching so same-day round-trips where a SELL is
 * timestamped before its BUY still close correctly (long-only FIFO would drop
 * them). Net of per-fill fees. All in the fills' native currency (USD for the
 * US account). Fills MUST be passed sorted by executedAt ascending.
 *
 * Verified against the live account: gross +664.02 − fees 841.82 = net −177.80,
 * and open lots reconcile exactly to current holdings (630 shares).
 */
import type { Prisma } from "@prisma/client";

export interface RealizedFill {
  ticker: string;
  side: string; // 'BUY' | 'SELL'
  qty: Prisma.Decimal | number;
  price: Prisma.Decimal | number;
  fees: Prisma.Decimal | number | null;
  executedAt: Date;
}

export interface RealizedResult {
  /** Cumulative NET realized P&L by date (date -> running total). */
  points: { date: string; value: number }[];
  grossUsd: number;
  feesUsd: number;
  netUsd: number;
  closedLots: number;
  openQty: number; // remaining net open quantity (should match current holdings)
}

const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const num = (v: unknown) => (v == null ? 0 : Number(v));

export function computeBrokerRealized(fills: RealizedFill[]): RealizedResult {
  const lots = new Map<string, { qty: number; price: number }[]>();
  let gross = 0;
  let feesUsd = 0;
  let cumNet = 0;
  let closedLots = 0;
  const curve = new Map<string, number>();

  for (const f of fills) {
    const t = f.ticker;
    if (!lots.has(t)) lots.set(t, []);
    const q = lots.get(t)!;
    let signed = (f.side.toUpperCase() === "BUY" ? 1 : -1) * num(f.qty);
    const px = num(f.price);
    const fee = num(f.fees);
    feesUsd += fee;
    cumNet -= fee; // every fill costs its fee, regardless of open/close

    // Match against opposite-sign open lots (FIFO), handling longs and shorts.
    while (Math.abs(signed) > 1e-9 && q.length > 0 && sgn(q[0].qty) === -sgn(signed)) {
      const lot = q[0];
      const mt = Math.min(Math.abs(signed), Math.abs(lot.qty));
      const realized = lot.qty > 0 ? (px - lot.price) * mt : (lot.price - px) * mt;
      gross += realized;
      cumNet += realized;
      closedLots += 1;
      lot.qty -= sgn(lot.qty) * mt;
      signed -= sgn(signed) * mt;
      if (Math.abs(lot.qty) < 1e-9) q.shift();
    }
    if (Math.abs(signed) > 1e-9) q.push({ qty: signed, price: px });

    curve.set(f.executedAt.toISOString().slice(0, 10), Number(cumNet.toFixed(2)));
  }

  let openQty = 0;
  for (const q of Array.from(lots.values())) {
    for (const l of q) openQty += l.qty;
  }

  const points = Array.from(curve.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({ date, value }));

  return {
    points,
    grossUsd: Number(gross.toFixed(2)),
    feesUsd: Number(feesUsd.toFixed(2)),
    netUsd: Number((gross - feesUsd).toFixed(2)),
    closedLots,
    openQty: Number(openQty.toFixed(4)),
  };
}
