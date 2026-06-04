"use client";

/**
 * JournalShell — the Trades Hub "Journal" tab.
 *
 * Connected-sheet analytics for Overview / Trades / Calendar / Daily.
 * Auto-journal is primary - a Google Sheet is an optional import, not the
 * empty-state centerpiece. Themed on mode-aware design tokens so it follows the
 * light/dark toggle.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SyncButton from "./SyncButton";
import StatsCards from "./StatsCards";
import TradeLog from "./TradeLog";
import CalendarView from "./CalendarView";
import AddTradeModal from "./AddTradeModal";
import DailyJournal from "./DailyJournal";

type Tab = "overview" | "trades" | "calendar" | "daily";

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

const SUB_TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "trades", label: "Trades" },
  { id: "calendar", label: "Calendar" },
  { id: "daily", label: "Daily" },
];

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

  function refreshConnected() {
    fetch("/api/journal/stats").then((r) => r.json()).then((d: Stats) => setStats(d));
    fetch("/api/journal/connection").then((r) => r.json()).then((d: Connection | null) => setConnection(d));
  }

  return (
    <div className="space-y-5">
      {connection === undefined ? (
        <p className="py-10 text-center text-sm text-[var(--fg-3)]">Loading…</p>
      ) : !connection ? (
        /* Auto-journal primary: the sheet is an optional enhancement, not a gate. */
        <div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-surface)] p-6 text-center shadow-[var(--shadow-card)]">
          <p className="text-sm text-[var(--fg-1)]">
            Auto-journal is running from your broker fills — the weekly review above updates itself.
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--fg-3)]">
            Optionally connect a Google Sheet to import full trade history and unlock the P&amp;L, equity-curve, and calendar views.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => router.push("/journal/connect")}
              className="rounded-[var(--radius-sm)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] px-4 py-2 text-xs font-medium text-[var(--accent)] transition hover:opacity-90"
            >
              Connect a Google Sheet
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-4 py-2 text-xs font-medium text-[var(--fg-2)] transition hover:bg-[var(--bg-surface)]"
            >
              + Add a trade manually
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Toolbar: sub-tabs + secondary actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="inline-flex gap-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-raised)] p-1">
              {SUB_TABS.map(({ id, label }) => {
                const active = tab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTab(id)}
                    className={`rounded-[var(--radius-sm)] px-3.5 py-1.5 text-xs font-medium transition ${
                      active
                        ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "text-[var(--fg-3)] hover:text-[var(--fg-1)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </nav>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddModal(true)}
                className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-xs font-medium text-[var(--fg-2)] transition hover:bg-[var(--bg-surface)]"
              >
                + Add Trade
              </button>
              <button
                onClick={() => router.push("/journal/connect")}
                className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-xs font-medium text-[var(--fg-3)] transition hover:text-[var(--fg-1)]"
                title="Change tab or remap columns"
              >
                Manage Sheet
              </button>
              <SyncButton lastSyncedAt={connection.lastSyncedAt} onSynced={refreshConnected} />
            </div>
          </div>

          {/* Content */}
          {tab === "overview" &&
            (stats ? (
              <div className="space-y-5">
                <StatsCards stats={stats} />
                <a
                  href="/dashboard/equity"
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1.5 text-xs font-medium text-[var(--fg-2)] transition hover:bg-[var(--bg-surface)]"
                >
                  View account equity timeline
                </a>
              </div>
            ) : (
              <p className="text-sm text-[var(--fg-3)]">No data yet — sync your sheet.</p>
            ))}
          {tab === "trades" && <TradeLog />}
          {tab === "calendar" &&
            (stats ? (
              <CalendarView calendarData={stats.calendarData} />
            ) : (
              <p className="text-sm text-[var(--fg-3)]">No data yet.</p>
            ))}
          {tab === "daily" && <DailyJournal />}
        </>
      )}

      {showAddModal && <AddTradeModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
