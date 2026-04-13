"use client";

import { useState } from "react";
import Link from "next/link";
import ChatInterface from "@/components/ChatInterface";
import MarketOverview from "@/components/market/MarketOverview";
import MarketMetricsDashboard from "@/components/market/MarketMetricsDashboard";

type Tab = "market" | "metrics" | "chat";

export default function DashboardShell() {
  const [tab, setTab] = useState<Tab>("market");

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
            <button
              type="button"
              onClick={() => setTab("market")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                tab === "market"
                  ? "bg-slate-700 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Dashboard
            </button>
            <button
              type="button"
              onClick={() => setTab("metrics")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                tab === "metrics"
                  ? "bg-slate-700 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              📈 Market Metrics
            </button>
            <button
              type="button"
              onClick={() => setTab("chat")}
              className={`rounded-md px-4 py-2 text-sm font-medium transition ${
                tab === "chat"
                  ? "bg-slate-700 text-white shadow"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Chat ($tickers)
            </button>
          </nav>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">
        {tab === "market" && (
          <div>
            <p className="mb-4 text-sm text-slate-400">
              Pipeline snapshot from{" "}
              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                apps/market_dashboard_backend
              </code>{" "}
              (Yahoo + calendar). Same tables as the static site, plus charts here.
            </p>
            <MarketOverview />
          </div>
        )}
        {tab === "metrics" && (
          <div>
            <MarketMetricsDashboard />
          </div>
        )}
        {tab === "chat" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <ChatInterface />
          </div>
        )}
      </main>
    </div>
  );
}
