"use client";

import { useLiveQuotes, type LiveQuoteRow } from "@/hooks/useLiveQuotes";
import FreshnessBadge from "./FreshnessBadge";
import { liveQuoteThresholdsForNow } from "@/lib/freshness";
import {
  LIVE_QUOTE_DEFAULT_WATCHLIST,
  LIVE_QUOTE_SECTORS,
  requiredLiveQuoteSymbols,
} from "@/lib/live-quote-universe";

function sourceBadge(
  activeSource: string | null,
  activeAt: string | null,
  missingCount: number,
  loading: boolean,
) {
  if (loading) return <span className="t-caption">Loading live source…</span>;
  if (!activeSource) return <span className="t-caption">No fresh live source</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="t-caption">{activeSource}</span>
      <FreshnessBadge timestamp={activeAt} thresholds={liveQuoteThresholdsForNow()} />
      {missingCount > 0 ? (
        <span className="t-caption text-[var(--loss-fg)]">
          {missingCount} required stale/unavailable
        </span>
      ) : null}
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
  const missingRequired = loading
    ? 0
    : requiredLiveQuoteSymbols().filter((symbol) => !bySymbol.has(symbol)).length;

  return (
    <section className="space-y-3">
      <div className="market-section-head">
        <p className="t-overline">Live Tape</p>
        {sourceBadge(activeSource, activeSourceAt, missingRequired, loading)}
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
      <p className="t-overline text-[var(--fg-3)]">Sectors · Session change</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {LIVE_QUOTE_SECTORS.map((s) => {
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
      <p className="t-overline text-[var(--fg-3)]">Watchlist · Session change</p>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {LIVE_QUOTE_DEFAULT_WATCHLIST.map((sym) => {
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
