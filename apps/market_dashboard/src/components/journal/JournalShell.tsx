"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SyncButton from "./SyncButton";
import StatsCards from "./StatsCards";
import TradeLog from "./TradeLog";
import CalendarView from "./CalendarView";
import EquityCurve from "./EquityCurve";
import AddTradeModal from "./AddTradeModal";

type Tab = "overview" | "trades" | "calendar" | "equity";

type Connection = {
  id: string;
  spreadsheetId: string;
  sheetTab: string;
  lastSyncedAt: string | null;
};

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
  equityCurve: { date: string; cumulative: number }[];
  calendarData: { date: string; pnl: number; trades: number }[];
};

export default function JournalShell() {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [stats, setStats] = useState<Stats | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetch("/api/journal/connection")
      .then((r) => r.json())
      .then((data: Connection | null) => setConnection(data));
  }, []);

  useEffect(() => {
    if (!connection) return;
    fetch("/api/journal/stats")
      .then((r) => r.json())
      .then((data: Stats) => setStats(data));
  }, [connection]);

  if (connection === undefined) {
    return <div className="py-16 text-center text-slate-500 text-sm">Loading…</div>;
  }

  if (!connection) {
    return (
      <div className="py-16 text-center space-y-4">
        <p className="text-slate-300 text-base">No spreadsheet connected yet.</p>
        <button
          onClick={() => router.push("/journal/connect")}
          className="rounded-lg bg-blue-600 hover:bg-blue-500 px-5 py-2.5 text-sm font-medium transition"
        >
          Connect your Google Sheet →
        </button>
      </div>
    );
  }

  const SUB_TABS: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "trades", label: "Trades" },
    { id: "calendar", label: "Calendar" },
    { id: "equity", label: "Equity Curve" },
  ];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-lg bg-slate-800/80 p-1">
          {SUB_TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                tab === id ? "bg-slate-700 text-white shadow" : "text-slate-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="rounded-lg bg-green-700 hover:bg-green-600 px-3 py-1.5 text-xs font-medium transition"
          >
            + Add Trade
          </button>
          <SyncButton
            lastSyncedAt={connection.lastSyncedAt}
            onSynced={() => {
              fetch("/api/journal/stats").then((r) => r.json()).then((d: Stats) => setStats(d));
              fetch("/api/journal/connection").then((r) => r.json()).then((d: Connection | null) => setConnection(d));
            }}
          />
        </div>
      </div>

      {/* Content */}
      {tab === "overview" && (
        stats ? <StatsCards stats={stats} /> : <p className="text-slate-500 text-sm">No data yet — sync your sheet.</p>
      )}
      {tab === "trades" && <TradeLog />}
      {tab === "calendar" && (
        stats ? <CalendarView calendarData={stats.calendarData} /> : <p className="text-slate-500 text-sm">No data yet.</p>
      )}
      {tab === "equity" && (
        stats ? <EquityCurve data={stats.equityCurve} /> : <p className="text-slate-500 text-sm">No data yet.</p>
      )}

      {showAddModal && <AddTradeModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
