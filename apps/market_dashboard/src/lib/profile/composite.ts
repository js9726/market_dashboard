/**
 * Composite leaderboard score — 0-100, weighted to favour consistency and
 * risk control over raw P&L (per design README §1: "consistency + drawdown
 * + win-rate above raw P&L").
 *
 * Inputs come from closed trades only. The aggregates can be computed in SQL
 * (single roundtrip per user) and passed in here as pure values; that keeps
 * this module unit-testable without a database.
 */

import { RANK_MIN_TRADES, tierForScore, type Tier } from "@/lib/profile/tiers";

export interface CompositeInput {
  /** Number of closed trades (pnl != null). */
  closedTrades: number;
  /** Number of wins (pnl > 0). */
  wins: number;
  /** Sum of all P&L in account-currency units. */
  totalPnl: number;
  /**
   * Max peak-to-trough drawdown expressed as a fraction (0..1).
   * 0.15 = "lost 15% of equity from a prior peak".
   */
  maxDrawdownPct: number;
  /**
   * Standard deviation of per-trade % returns, expressed as a fraction.
   * Larger = less consistent.
   */
  pnlStdDevPct: number;
}

export interface CompositeOutput {
  score: number | null;
  tier: Tier;
  /** Sub-scores for display + tooltip explanation. */
  components: {
    winRate: number | null;
    winRateScore: number;
    drawdownScore: number;
    consistencyScore: number;
    pnlScore: number;
  };
  /** Raw inputs echoed back so the UI can render them next to the tier. */
  metrics: CompositeInput;
}

export const COMPOSITE_WEIGHTS = {
  winRate: 0.40,
  drawdown: 0.30,
  consistency: 0.20,
  pnl: 0.10,
} as const;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Convert each input dimension to a 0-100 sub-score:
 *   winRate     25% → 0, 75% → 100   (linear in between)
 *   drawdown    20% DD → 0, 0% → 100 (linear, inverted)
 *   consistency 33% stddev → 0, 0% → 100 (linear, inverted)
 *   pnl         log10($1 + max(0, totalPnl)) × 25, clamped (so $10k ≈ 100)
 */
export function computeComposite(input: CompositeInput): CompositeOutput {
  const { closedTrades, wins, totalPnl, maxDrawdownPct, pnlStdDevPct } = input;

  if (closedTrades < RANK_MIN_TRADES) {
    return {
      score: null,
      tier: "unranked",
      components: {
        winRate: closedTrades > 0 ? wins / closedTrades : null,
        winRateScore: 0,
        drawdownScore: 0,
        consistencyScore: 0,
        pnlScore: 0,
      },
      metrics: input,
    };
  }

  const winRate = wins / closedTrades;
  const winRateScore = clamp(winRate * 200 - 50, 0, 100);
  const drawdownScore = clamp(100 - maxDrawdownPct * 500, 0, 100);
  const consistencyScore = clamp(100 - pnlStdDevPct * 300, 0, 100);
  const pnlScore = totalPnl > 0
    ? clamp(Math.log10(totalPnl + 1) * 25, 0, 100)
    : 0;

  const score =
    winRateScore * COMPOSITE_WEIGHTS.winRate +
    drawdownScore * COMPOSITE_WEIGHTS.drawdown +
    consistencyScore * COMPOSITE_WEIGHTS.consistency +
    pnlScore * COMPOSITE_WEIGHTS.pnl;

  const rounded = Math.round(score * 10) / 10;

  return {
    score: rounded,
    tier: tierForScore(rounded).key,
    components: {
      winRate,
      winRateScore: Math.round(winRateScore),
      drawdownScore: Math.round(drawdownScore),
      consistencyScore: Math.round(consistencyScore),
      pnlScore: Math.round(pnlScore),
    },
    metrics: input,
  };
}

/**
 * Compact per-row shape used by the leaderboard API. Combines the user's
 * public identity with their composite output.
 */
export interface LeaderboardRow {
  username: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  dashboardTagline: string | null;
  rank: number;          // 1-indexed position in the ranked list
  composite: CompositeOutput;
}
