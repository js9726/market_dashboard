"use client";

import { useState } from "react";
import Link from "next/link";
import ChatInterface from "@/components/ChatInterface";
import MarketMetricsDashboard from "@/components/market/MarketMetricsDashboard";
import MorningBrief from "@/components/market/MorningBrief";
import JournalShell from "@/components/journal/JournalShell";

type Tab = "brief" | "overview" | "chat" | "journal";

export default function DashboardShell() {
  const [tab, setTab] = useState<Tab>("brief");

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
        <div className="container mx-auto flex flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-slate-400 hover:text-white">
              ← Home
            </Link>
            <h1 className="text-lg font-semibold tracking-tight">Market desk</h1>
          </div>
          <nav className="flex gap-1 rounded-lg bg-slate-800/80 p-1">
            {(
              [
                { id: "brief", label: "Morning Brief" },
                { id: "overview", label: "Overview" },
                { id: "chat", label: "Chat ($tickers)" },
                { id: "journal", label: "Trade Journal" },
              ] as { id: Tab; label: string }[]
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                  tab === id
                    ? "bg-slate-700 text-white shadow"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">
        {tab === "brief" && <MorningBrief />}
        {tab === "overview" && <MarketMetricsDashboard />}
        {tab === "chat" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <ChatInterface />
          </div>
        )}
        {tab === "journal" && <JournalShell />}
      </main>
    </div>
  );
}
