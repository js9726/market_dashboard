"use client";

/**
 * JournalShell - the Trades Hub "Journal" tab.
 *
 * Journal is now focused on trade logs and the automated daily journal.
 * Portfolio stats, calendar, and coaching live on the Equity page.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import SyncButton from "./SyncButton";
import TradeLog from "./TradeLog";
import AddTradeModal from "./AddTradeModal";
import DailyJournal from "./DailyJournal";

type Tab = "trades" | "daily";

type Connection = {
  id: string;
  spreadsheetId: string;
  sheetTab: string;
  lastSyncedAt: string | null;
};

const SUB_TABS: { id: Tab; label: string }[] = [
  { id: "trades", label: "Trades" },
  { id: "daily", label: "Daily" },
];

export default function JournalShell() {
  const router = useRouter();
  const [connection, setConnection] = useState<Connection | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>("trades");
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetch("/api/journal/connection")
      .then((r) => r.json())
      .then((data: Connection | null) => setConnection(data));
  }, []);

  function refreshConnected() {
    fetch("/api/journal/connection")
      .then((r) => r.json())
      .then((d: Connection | null) => setConnection(d));
  }

  return (
    <div className="space-y-5">
      {connection === undefined ? (
        <p className="py-10 text-center text-sm text-[var(--fg-3)]">Loading...</p>
      ) : !connection ? (
        <div className="rounded-[var(--radius-lg)] border border-[var(--line)] bg-[var(--bg-surface)] p-6 text-center shadow-[var(--shadow-card)]">
          <p className="text-sm text-[var(--fg-1)]">
            Auto-journal is running from your broker fills. Use Trades for logs and Daily for the generated journal.
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs text-[var(--fg-3)]">
            Equity now owns the stats, calendar, and coaching view. Optionally connect a Google Sheet to import full trade history.
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

          {tab === "trades" && <TradeLog />}
          {tab === "daily" && <DailyJournal />}
        </>
      )}

      {showAddModal && <AddTradeModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
