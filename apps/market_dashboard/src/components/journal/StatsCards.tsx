"use client";

type Stats = {
  totalPnl: number;
  totalTrades: number;
  openTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRR: number;
  maxDrawdown: number;
  sharpe: number;
  bestTrade: number;
  worstTrade: number;
  currentStreak: number;
};

type CardProps = { label: string; value: string; positive?: boolean | null };

function Card({ label, value, positive }: CardProps) {
  const color =
    positive === true
      ? "text-[var(--gain-fg)]"
      : positive === false
        ? "text-[var(--loss-fg)]"
        : "text-[var(--fg-1)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-3)]">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function fmt(n: number, prefix = "$") {
  return `${n >= 0 ? "+" : ""}${prefix}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function StatsCards({ stats }: { stats: Stats }) {
  const streakLabel =
    stats.currentStreak > 0
      ? `${stats.currentStreak}W streak`
      : stats.currentStreak < 0
        ? `${Math.abs(stats.currentStreak)}L streak`
        : "—";

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Card label="Total P&L" value={fmt(stats.totalPnl)} positive={stats.totalPnl >= 0} />
        <Card label="Total Trades" value={`${stats.totalTrades} (${stats.openTrades} open)`} />
        <Card label="Win Rate" value={`${stats.winRate}%`} positive={stats.winRate >= 50} />
        <Card label="Profit Factor" value={stats.profitFactor.toFixed(2)} positive={stats.profitFactor >= 1} />
        <Card label="Avg R:R" value={stats.avgRR.toFixed(2)} positive={stats.avgRR >= 1} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Card label="Max Drawdown" value={`-$${stats.maxDrawdown.toLocaleString("en-US", { minimumFractionDigits: 2 })}`} positive={false} />
        <Card label="Sharpe Ratio" value={stats.sharpe.toFixed(2)} positive={stats.sharpe >= 1} />
        <Card label="Expectancy" value={fmt(stats.expectancy)} positive={stats.expectancy >= 0} />
        <Card label="Best Trade" value={fmt(stats.bestTrade)} positive={true} />
        <Card label="Worst Trade" value={fmt(stats.worstTrade)} positive={false} />
        <Card label="Streak" value={streakLabel} positive={stats.currentStreak > 0 ? true : stats.currentStreak < 0 ? false : null} />
      </div>
      <div className="grid max-w-xs grid-cols-2 gap-3">
        <Card label="Avg Win" value={fmt(stats.avgWin)} positive={true} />
        <Card label="Avg Loss" value={fmt(stats.avgLoss)} positive={false} />
      </div>
    </div>
  );
}
