"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { tierInfo, type Tier } from "@/lib/profile/tiers";

interface CompositeOutputDto {
  score: number | null;
  tier: Tier;
  components: {
    winRate: number | null;
    winRateScore: number;
    drawdownScore: number;
    consistencyScore: number;
    pnlScore: number;
  };
  metrics: {
    closedTrades: number;
    wins: number;
    totalPnl: number;
    maxDrawdownPct: number;
    pnlStdDevPct: number;
  };
}

interface LeaderboardRowDto {
  rank: number;
  username: string;
  name: string | null;
  image: string | null;
  bio: string | null;
  dashboardTagline: string | null;
  composite: CompositeOutputDto;
}

interface Response {
  generatedAt: string;
  count: number;
  rows: LeaderboardRowDto[];
}

function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${(value * 100).toFixed(decimals)}%`;
}

function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  const sign = value >= 0 ? "+" : "-";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function TierPill({ tier }: { tier: Tier }) {
  const info = tierInfo(tier);
  return (
    <span
      className="inline-flex items-center rounded px-2 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.1em]"
      style={{
        background: tier === "unranked" ? "var(--bg-raised)" : `${info.color}22`,
        color: tier === "unranked" ? "var(--fg-3)" : info.color,
      }}
    >
      {info.label}
    </span>
  );
}

export default function LeaderboardTable() {
  const [data, setData] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/leaderboard", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<Response>;
      })
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Leaderboard</p>
          <p className="t-caption">
            Ranked by composite score (consistency + drawdown control + win-rate weighted above raw P&amp;L).
            Minimum 10 closed trades to rank.
          </p>
        </div>
        <p className="t-caption t-mono">
          {loading ? "Loading..." : error ? `Unavailable: ${error}` : `${data?.count ?? 0} ranked`}
        </p>
      </div>

      {error ? <p className="t-body-small text-[var(--loss-fg)]">Failed to load: {error}</p> : null}

      {!loading && !error && (data?.rows?.length ?? 0) === 0 ? (
        <p className="t-body-small text-[var(--fg-3)]">
          No one has enabled their public profile yet. Visit your{" "}
          <Link href="/dashboard/profile" className="text-[var(--accent)] underline">profile</Link>
          {" "}and flip the toggle.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
            <tr className="border-b border-[var(--line)]">
              <th className="py-2 pr-3 font-bold">Rank</th>
              <th className="px-3 py-2 font-bold">Trader</th>
              <th className="px-3 py-2 text-right font-bold">Score</th>
              <th className="px-3 py-2 font-bold">Tier</th>
              <th className="px-3 py-2 text-right font-bold">Win Rate</th>
              <th className="px-3 py-2 text-right font-bold">Trades</th>
              <th className="px-3 py-2 text-right font-bold">P&amp;L</th>
              <th className="px-3 py-2 text-right font-bold">Max DD</th>
              <th className="py-2 pl-3 font-bold">Bio</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((row) => (
              <tr key={row.username} className="border-b border-[var(--line)] last:border-0">
                <td className="py-2 pr-3 t-mono text-[var(--fg-2)]">#{row.rank}</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/profile/${row.username}`}
                    className="flex flex-col"
                    title={`Open ${row.username}'s public profile`}
                  >
                    <span className="t-ticker text-[var(--accent)] hover:underline">@{row.username}</span>
                    <span className="t-caption">{row.dashboardTagline ?? row.name ?? ""}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {row.composite.score != null ? row.composite.score.toFixed(1) : "-"}
                </td>
                <td className="px-3 py-2">
                  <TierPill tier={row.composite.tier} />
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatPct(row.composite.components.winRate)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">
                  {row.composite.metrics.closedTrades}
                </td>
                <td className={`px-3 py-2 text-right font-mono ${row.composite.metrics.totalPnl >= 0 ? "gain" : "loss"}`}>
                  {formatUsd(row.composite.metrics.totalPnl)}
                </td>
                <td className="px-3 py-2 text-right font-mono">
                  {formatPct(row.composite.metrics.maxDrawdownPct)}
                </td>
                <td className="max-w-[240px] truncate py-2 pl-3 t-caption" title={row.bio ?? ""}>
                  {row.bio ?? "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
