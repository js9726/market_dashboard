"use client";

import { useEffect, useState } from "react";
import StatsCards from "@/components/journal/StatsCards";
import CalendarView from "@/components/journal/CalendarView";
import type { JournalCalendarDay } from "@/lib/journal/calendar-data";

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
  fxUsdMyr: number | null;
  calendarData: JournalCalendarDay[];
};

type Ccy = "USD" | "MYR";
const CCY_KEY = "md-equity-ccy";

export default function EquityJournalOverview() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wantCcy, setWantCcy] = useState<Ccy>("USD");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const c = window.localStorage.getItem(CCY_KEY);
    if (c === "USD" || c === "MYR") setWantCcy(c);
  }, []);

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

  const fx = stats?.fxUsdMyr ?? null;
  const canConvert = fx != null && fx > 0;
  const ccy: Ccy = canConvert ? wantCcy : "USD";
  const symbol = ccy === "MYR" ? "RM" : "$";
  const displayStats = stats ? convertStats(stats, ccy, fx) : null;

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

      {displayStats ? (
        <>
          {stats?.unconvertedCount && stats.unconvertedCount > 0 ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
              <span className="font-semibold text-[var(--warn-500)]">FX conversion needed.</span>{" "}
              {stats.unconvertedCount} closed trade{stats.unconvertedCount === 1 ? "" : "s"} could not be converted because neither a fixed sheet rate nor live USD/MYR was available.
            </div>
          ) : null}
          {!canConvert && wantCcy === "MYR" ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
              <span className="font-semibold text-[var(--warn-500)]">Live USD/MYR unavailable.</span>{" "}
              Journal performance is shown in USD until the rate is available.
            </div>
          ) : null}
          <StatsCards stats={displayStats} currencySymbol={symbol} />
          <div className="pt-2">
            <CalendarView calendarData={displayStats.calendarData} currencySymbol={symbol} />
          </div>
        </>
      ) : null}
    </section>
  );
}

function convertStats(stats: Stats, ccy: Ccy, fx: number | null): Stats {
  if (ccy === "USD" || fx == null || fx <= 0) return stats;
  const moneyKeys: Array<keyof Pick<Stats, "totalPnl" | "avgWin" | "avgLoss" | "expectancy" | "maxDrawdown" | "bestTrade" | "worstTrade">> = [
    "totalPnl",
    "avgWin",
    "avgLoss",
    "expectancy",
    "maxDrawdown",
    "bestTrade",
    "worstTrade",
  ];
  const out: Stats = {
    ...stats,
    calendarData: stats.calendarData.map((d) => ({ ...d, pnl: round2(d.pnl * fx) })),
  };
  for (const key of moneyKeys) out[key] = round2(out[key] * fx);
  return out;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}
