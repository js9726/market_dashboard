"use client";

import { useEffect, useState } from "react";
import StatsCards from "@/components/journal/StatsCards";
import CalendarView from "@/components/journal/CalendarView";

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
  unconvertedCount?: number;
  calendarData: { date: string; pnl: number; trades: number }[];
};

export default function EquityJournalOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/journal/stats", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: Stats) => {
        if (!cancelled) setStats(data);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-4 px-5">
      <div>
        <p className="t-overline text-[var(--fg-3)]">Journal Performance</p>
        <p className="t-caption">
          USD-normalized sheet and broker outcomes. Calendar and stats moved here so Journal can stay focused on logging.
        </p>
      </div>

      {error ? <p className="t-caption t-mono">Error loading journal stats: {error}</p> : null}
      {!stats && !error ? <p className="t-caption t-mono">Loading journal stats...</p> : null}

      {stats ? (
        <>
          {stats.unconvertedCount && stats.unconvertedCount > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
              <span className="font-semibold text-[var(--warn-500)]">Fixed FX rate needed.</span>{" "}
              {stats.unconvertedCount} closed trade{stats.unconvertedCount === 1 ? "" : "s"} still use raw sheet P&amp;L because no fixed rate is set.
            </div>
          ) : null}
          <StatsCards stats={stats} />
          <div className="pt-2">
            <CalendarView calendarData={stats.calendarData} />
          </div>
        </>
      ) : null}
    </section>
  );
}
