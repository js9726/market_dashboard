"use client";

import { useMemo, useState } from "react";
import { useMarketSnapshot } from "@/hooks/useMarketSnapshot";
import { pct52wTone, rvolLabel, rvolTone, sortByRvolDesc } from "@/lib/rvol";
import type { TickerRow } from "@/types/market-dashboard";
import FreshnessBadge from "./FreshnessBadge";
import { SNAPSHOT_THRESHOLDS } from "@/lib/freshness";

type SortKey = "rvol" | "daily" | "intra" | "20d" | "rs" | "off_52w_high_pct";
type SortDir = "asc" | "desc";

function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

function formatRvol(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(2)}x`;
}

function formatRs(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return Math.round(value).toString();
}

function changeClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "text-[var(--fg-3)]";
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "text-[var(--fg-2)]";
}

function sortRows(rows: TickerRow[], key: SortKey, dir: SortDir): TickerRow[] {
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return dir === "desc" ? (bv as number) - (av as number) : (av as number) - (bv as number);
  });
  return sorted;
}

export default function RvolOverview() {
  const { data, loading, error } = useMarketSnapshot();
  const [sortKey, setSortKey] = useState<SortKey>("rvol");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    const industries = data?.groups?.Industries ?? [];
    if (sortKey === "rvol" && sortDir === "desc") return sortByRvolDesc(industries);
    return sortRows(industries, sortKey, sortDir);
  }, [data, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const totalThemes = data?.groups?.Industries?.length ?? 0;
  const rvolCoverage = data?.groups?.Industries?.filter((r) => r.rvol != null).length ?? 0;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">RVOL Overview</p>
          <p className="t-caption">
            Relative volume (today / 30-day avg) and distance from 52-week high, sorted by RVOL.
            Click any column header to re-sort.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="t-caption t-mono">
            {loading
              ? "Loading..."
              : error
                ? `Unavailable: ${error}`
                : `${rvolCoverage}/${totalThemes} themes with RVOL`}
          </p>
          {!loading && !error ? (
            <FreshnessBadge timestamp={data?.built_at} thresholds={SNAPSHOT_THRESHOLDS} />
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="t-body-small text-[var(--loss-fg)]">
          Snapshot fetch failed. Run <code>npm run sync:market</code> after the next refresh.
        </p>
      ) : null}

      {rvolCoverage === 0 && !loading && !error ? (
        <p className="t-body-small text-[var(--fg-3)]">
          RVOL data not yet present in <code>snapshot.json</code>. It will populate after the next{" "}
          <code>build_data.py</code> run.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
            <tr className="border-b border-[var(--line)]">
              <th className="py-2 pr-3 font-bold">Theme</th>
              <th className="px-3 py-2 font-bold">Ticker</th>
              <SortableHeader label="RVOL" k="rvol" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Intra" k="intra" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="1D" k="daily" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="1M" k="20d" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="RS" k="rs" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="% off 52W" k="off_52w_high_pct" sortKey={sortKey} sortDir={sortDir} onClick={toggleSort} />
              <th className="py-2 pl-3 text-right font-bold">Signal</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td className="py-3 text-[var(--fg-3)]" colSpan={9}>
                  Loading RVOL universe...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td className="py-3 text-[var(--fg-3)]" colSpan={9}>
                  No industry tickers in snapshot.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const tone = rvolTone(row.rvol);
                return (
                  <tr key={row.ticker} className="border-b border-[var(--line)] last:border-0">
                    <td className="py-2 pr-3 text-[var(--fg-1)]">{rvolLabel(row.ticker)}</td>
                    <td className="px-3 py-2 t-ticker">{row.ticker}</td>
                    <td className="px-3 py-2 text-right">
                      <span
                        className="inline-flex rounded px-2 py-1 font-mono text-[11px] font-bold"
                        style={{ background: tone.background, color: tone.color }}
                      >
                        {formatRvol(row.rvol)}
                      </span>
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${changeClass(row.intra)}`}>
                      {formatPct(row.intra)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${changeClass(row.daily)}`}>
                      {formatPct(row.daily)}
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${changeClass(row["20d"])}`}>
                      {formatPct(row["20d"])}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">
                      {formatRs(row.rs)}
                    </td>
                    <td
                      className="px-3 py-2 text-right font-mono"
                      style={pct52wTone(row.off_52w_high_pct)}
                    >
                      {formatPct(row.off_52w_high_pct)}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <span
                        className="inline-flex rounded px-2 py-1 font-mono text-[11px] font-bold"
                        style={{ background: tone.background, color: tone.color }}
                      >
                        {tone.label}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SortableHeader({
  label,
  k,
  sortKey,
  sortDir,
  onClick,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onClick: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const arrow = active ? (sortDir === "desc" ? " v" : " ^") : "";
  return (
    <th className="px-3 py-2 text-right font-bold">
      <button
        type="button"
        onClick={() => onClick(k)}
        className={`uppercase tracking-[0.12em] ${active ? "text-[var(--accent)]" : "text-[var(--fg-3)] hover:text-[var(--fg-2)]"}`}
      >
        {label}
        <span className="ml-1 inline-block w-3 font-mono">{arrow}</span>
      </button>
    </th>
  );
}
