"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface WatchlistItem {
  id: string;
  ticker: string;
  addedAt: string;
}

const TV_WATCHLIST_URL = "https://www.tradingview.com/watchlists/169793207/";
const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function normalizeTicker(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

export default function WatchlistEditor() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/watchlist");
      const data = (await res.json()) as { items?: WatchlistItem[] };
      setItems(data.items ?? []);
    } catch {
      setError("Failed to load watchlist.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addTicker(raw: string) {
    const ticker = normalizeTicker(raw);
    if (!ticker) { flash("Invalid ticker format."); return; }
    if (items.some((i) => i.ticker === ticker)) { flash(`${ticker} already in list.`); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });
      const data = (await res.json()) as { item?: WatchlistItem; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setItems((prev) => [data.item!, ...prev]);
      flash(`${ticker} added.`);
    } catch (e) {
      flash(`Error: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function removeTicker(ticker: string) {
    setSaving(true);
    try {
      await fetch(`/api/watchlist?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" });
      setItems((prev) => prev.filter((i) => i.ticker !== ticker));
    } catch {
      flash("Delete failed.");
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkImport() {
    const tickers = bulkText
      .split(/[\s,\n]+/)
      .map((t) => normalizeTicker(t))
      .filter((t): t is string => t !== null && !items.some((i) => i.ticker === t));

    if (!tickers.length) { flash("No new valid tickers found."); return; }
    setSaving(true);
    let added = 0;
    for (const ticker of tickers) {
      try {
        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticker }),
        });
        const data = (await res.json()) as { item?: WatchlistItem };
        if (res.ok && data.item) {
          setItems((prev) => [data.item!, ...prev]);
          added++;
        }
      } catch { /* skip */ }
    }
    setSaving(false);
    setBulkText("");
    setBulkOpen(false);
    flash(`${added} ticker${added !== 1 ? "s" : ""} added.`);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      void addTicker(inputValue);
      setInputValue("");
    }
  }

  return (
    <section className="market-panel p-5">
      <div className="market-section-head mb-4">
        <div>
          <p className="t-overline">My Watchlist</p>
          <p className="t-caption">
            Used by the morning brief (CLI + dashboard runs). {items.length} ticker{items.length !== 1 ? "s" : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={TV_WATCHLIST_URL}
            target="_blank"
            rel="noreferrer"
            className="mds-button h-7 px-3 text-[11px]"
            title="Open your TradingView watchlist — copy tickers from there and paste below"
          >
            Open TV Watchlist
          </a>
          <button
            type="button"
            className="mds-button h-7 px-3 text-[11px]"
            onClick={() => setBulkOpen((o) => !o)}
          >
            {bulkOpen ? "Cancel" : "Bulk Import"}
          </button>
        </div>
      </div>

      {notice ? (
        <p className="mb-3 t-caption text-[var(--accent)]">{notice}</p>
      ) : error ? (
        <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p>
      ) : null}

      {/* Bulk import panel */}
      {bulkOpen && (
        <div className="mb-4 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-3">
          <p className="t-caption mb-2">
            Paste tickers from TradingView (comma, space, or newline separated):
          </p>
          <textarea
            className="w-full rounded border border-[var(--line)] bg-[var(--bg)] p-2 font-mono text-[12px] text-[var(--fg-1)] placeholder:text-[var(--fg-3)]"
            rows={3}
            placeholder="NVDA, TSLA, AAPL&#10;or one per line"
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="mds-button h-7 px-3 text-[11px]"
              disabled={!bulkText.trim() || saving}
              onClick={() => void handleBulkImport()}
            >
              {saving ? "Importing..." : "Import"}
            </button>
          </div>
        </div>
      )}

      {/* Single ticker input */}
      <div className="mb-4 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          className="flex-1 rounded border border-[var(--line)] bg-[var(--bg)] px-3 py-1.5 font-mono text-[13px] text-[var(--fg-1)] uppercase placeholder:normal-case placeholder:text-[var(--fg-3)] focus:border-[var(--accent)] focus:outline-none"
          placeholder="Add ticker — type and press Enter"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.toUpperCase())}
          onKeyDown={handleKeyDown}
          disabled={saving}
          maxLength={12}
        />
        <button
          type="button"
          className="mds-button h-9 px-4 text-[12px]"
          disabled={!inputValue.trim() || saving}
          onClick={() => { void addTicker(inputValue); setInputValue(""); }}
        >
          Add
        </button>
      </div>

      {/* Ticker chips */}
      {loading ? (
        <p className="t-caption text-[var(--fg-3)]">Loading...</p>
      ) : items.length === 0 ? (
        <p className="t-caption text-[var(--fg-3)]">
          No tickers yet. Add them above or click &quot;Bulk Import&quot; to paste from TradingView.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {items.map((item) => (
            <span
              key={item.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-1 font-mono text-[12px] font-bold text-[var(--fg-1)]"
            >
              {item.ticker}
              <button
                type="button"
                className="ml-0.5 text-[10px] text-[var(--fg-3)] hover:text-[var(--loss-fg)] transition"
                onClick={() => void removeTicker(item.ticker)}
                disabled={saving}
                aria-label={`Remove ${item.ticker}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      <p className="mt-4 t-caption text-[var(--fg-3)]">
        To sync from TradingView: click &quot;Open TV Watchlist&quot; → select all tickers → copy → &quot;Bulk Import&quot; → paste.
      </p>
    </section>
  );
}
