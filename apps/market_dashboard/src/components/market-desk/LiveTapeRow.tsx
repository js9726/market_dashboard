"use client";

import { useLiveQuotes, type LiveQuoteRow } from "@/hooks/useLiveQuotes";

const SECTORS: Array<{ symbol: string; label: string }> = [
  { symbol: "XLK", label: "Technology" },
  { symbol: "XLC", label: "Comm. Svcs" },
  { symbol: "XLY", label: "Cons. Disc." },
  { symbol: "XLF", label: "Financials" },
  { symbol: "XLV", label: "Healthcare" },
  { symbol: "XLI", label: "Industrials" },
  { symbol: "XLE", label: "Energy" },
  { symbol: "XLP", label: "Cons. Staples" },
  { symbol: "XLU", label: "Utilities" },
  { symbol: "XLB", label: "Materials" },
  { symbol: "XLRE", label: "Real Estate" },
];

const WATCHLIST = [
  "NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META",
  "GOOGL", "AMD", "SMCI", "PLTR", "CRWD", "MSTR",
];

function sourceBadge(activeSource: string | null, activeAt: string | null) {
  if (!activeSource) return <span className="t-caption">No live source</span>;
  const ago = activeAt ? Math.max(0, Math.round((Date.now() - new Date(activeAt).getTime()) / 1000)) : null;
  return (
    <span className="t-caption">
      {activeSource}
      {ago != null ? ` · ${ago}s ago` : ""}
    </span>
  );
}

function changeClass(v: number | null): string {
  if (v == null) return "text-[var(--fg-3)]";
  if (v > 0) return "gain";
  if (v < 0) return "loss";
  return "";
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

export default function LiveTapeRow() {
  const { bySymbol, activeSource, activeSourceAt, loading, error } = useLiveQuotes();

  return (
    <section className="space-y-3">
      <div className="market-section-head">
        <p className="t-overline">Live Tape</p>
        {sourceBadge(activeSource, activeSourceAt)}
      </div>
      {error ? <p className="t-caption text-[var(--loss-fg)]">Live feed error: {error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <SectorGrid bySymbol={bySymbol} loading={loading} />
        <WatchlistGrid bySymbol={bySymbol} loading={loading} />
      </div>
    </section>
  );
}

function SectorGrid({
  bySymbol,
  loading,
}: {
  bySymbol: Map<string, LiveQuoteRow>;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-surface)] p-4">
      <p className="t-overline text-[var(--fg-3)]">Sectors</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {SECTORS.map((s) => {
          const q = bySymbol.get(s.symbol);
          const changePct = q?.changePct ?? null;
          return (
            <li key={s.symbol} className="flex items-baseline justify-between text-[12px] py-1">
              <span className="t-ticker">{s.symbol}</span>
              <span className="text-[var(--fg-2)] truncate mx-2 flex-1 text-right">{s.label}</span>
              <span className={`font-mono ${changeClass(changePct)}`}>
                {loading && !q ? "…" : fmtPct(changePct)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function WatchlistGrid({
  bySymbol,
  loading,
}: {
  bySymbol: Map<string, LiveQuoteRow>;
  loading: boolean;
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--bg-surface)] p-4">
      <p className="t-overline text-[var(--fg-3)]">Watchlist</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {WATCHLIST.map((sym) => {
          const q = bySymbol.get(sym);
          const changePct = q?.changePct ?? null;
          return (
            <li key={sym} className="flex items-baseline justify-between text-[12px] py-1">
              <span className="t-ticker">{sym}</span>
              <span className="text-[var(--fg-2)] mx-2 flex-1 text-right font-mono">
                {q ? q.price.toFixed(2) : loading ? "…" : "—"}
              </span>
              <span className={`font-mono ${changeClass(changePct)}`}>
                {loading && !q ? "…" : fmtPct(changePct)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
