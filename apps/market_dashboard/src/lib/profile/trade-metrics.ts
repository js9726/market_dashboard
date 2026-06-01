import type { CompositeInput } from "@/lib/profile/composite";

export interface TradeMetricRecord {
  state?: string | null;
  pnl: unknown;
  buyPrice?: unknown;
  quantity?: unknown;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function toFiniteNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function isClosedTradeRecord(trade: TradeMetricRecord): boolean {
  const state = typeof trade.state === "string" ? trade.state.trim().toUpperCase() : "";
  if (state) return state === "CLOSE";
  return toFiniteNumber(trade.pnl) != null;
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function maxDrawdownFromPnlSequence(pnls: number[]): number {
  let equity = 0;
  let peak = 0;
  let worstDd = 0;

  for (const pnl of pnls) {
    equity += pnl;
    if (equity > peak) peak = equity;

    const denominator = peak > 0 ? peak : Math.abs(equity);
    const drawdown = denominator > 0 ? (peak - equity) / denominator : 0;
    worstDd = Math.max(worstDd, clamp(drawdown, 0, 1));
  }

  return worstDd;
}

export function compositeInputFromTrades(trades: TradeMetricRecord[]): CompositeInput {
  const pnls: number[] = [];
  const pctReturns: number[] = [];
  let wins = 0;

  for (const trade of trades) {
    if (!isClosedTradeRecord(trade)) continue;

    const pnl = toFiniteNumber(trade.pnl);
    if (pnl == null) continue;
    pnls.push(pnl);
    if (pnl > 0) wins++;

    const buyPrice = toFiniteNumber(trade.buyPrice);
    const quantity = toFiniteNumber(trade.quantity);
    if (buyPrice != null && quantity != null && buyPrice > 0 && quantity !== 0) {
      const cost = buyPrice * Math.abs(quantity);
      if (cost > 0) pctReturns.push(pnl / cost);
    }
  }

  return {
    closedTrades: pnls.length,
    wins,
    totalPnl: pnls.reduce((a, b) => a + b, 0),
    maxDrawdownPct: maxDrawdownFromPnlSequence(pnls),
    pnlStdDevPct: stddev(pctReturns),
  };
}
