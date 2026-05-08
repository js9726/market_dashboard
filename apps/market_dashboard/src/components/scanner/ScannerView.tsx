"use client";

import { useEffect, useState } from "react";

type WatchlistItem = { id: string; ticker: string; addedAt: string };

export default function ScannerView() {
  const [items, setItems] = useState<WatchlistItem[] | null>(null);
  const [tickerInput, setTickerInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/watchlist");
    if (!res.ok) {
      setError(`Failed to load watchlist (${res.status})`);
      return;
    }
    const data = (await res.json()) as { items: WatchlistItem[] };
    setItems(data.items);
  }

  useEffect(() => {
    refresh().catch(() => setError("Failed to load watchlist"));
  }, []);

  async function add() {
    const ticker = tickerInput.trim().toUpperCase();
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Add failed (${res.status})`);
        return;
      }
      setTickerInput("");
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  async function remove(ticker: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist?ticker=${encodeURIComponent(ticker)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(`Delete failed (${res.status})`);
        return;
      }
      await refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Scanner</h2>
          <span className="text-xs text-slate-500">PR 1 — watchlist plumbing only</span>
        </div>
        <p className="text-sm text-slate-400">
          Add tickers to your watchlist. They&apos;ll be fetched by the daily data pipeline and
          available for the agent pipeline (PR 4) and custom screener (PR 5).
        </p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <h3 className="mb-3 text-sm font-medium text-slate-300">My watchlist</h3>
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            placeholder="Add ticker (e.g., NVDA)"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            disabled={loading}
            className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <button
            onClick={add}
            disabled={loading || !tickerInput.trim()}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500"
          >
            Add
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-md bg-red-900/40 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {items === null ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-sm text-slate-500">No tickers yet.</div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {items.map((item) => (
              <li key={item.id} className="flex items-center justify-between py-2">
                <span className="font-mono text-sm text-slate-100">{item.ticker}</span>
                <button
                  onClick={() => remove(item.ticker)}
                  disabled={loading}
                  className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
