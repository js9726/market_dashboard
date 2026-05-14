"use client";

import { useMemo } from "react";
import { useBreadth } from "@/hooks/useBreadth";
import type { IndustryRow, SectorRow } from "@/types/breadth";
import BreadthBar from "./BreadthBar";
import StageAnalysisBar from "./StageAnalysisBar";

function formatPct(value: number | null | undefined, signed = false): string {
  if (value == null || Number.isNaN(value)) return "-";
  const prefix = signed && value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(1)}%`;
}

function formatBuiltAt(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMcap(value: number | null | undefined): string {
  if (value == null) return "-";
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(0)}B+`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(0)}M+`;
  return `$${value.toLocaleString()}+`;
}

function previousPct(now: number, delta: number | null | undefined): number | null {
  return delta == null || Number.isNaN(delta) ? null : now - delta;
}

function deltaClass(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "text-[var(--fg-3)]";
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "text-[var(--fg-2)]";
}

function deltaRank(row: SectorRow | IndustryRow): number {
  return row.delta_mom ?? row.delta_wow ?? row.pct_above_50sma;
}

export default function MarketBreadthPanels() {
  const { data, loading, error } = useBreadth();
  const universeText = data?.market.universe_size
    ? `${data.market.universe_size.toLocaleString()} usable rows`
    : "daily composite scan";

  return (
    <div className="border-t border-[var(--line)] p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="t-overline text-[var(--fg-3)]">Market Breadth</p>
          <p className="t-caption">
            NYSE + Nasdaq composite attempt, {universeText}; sector and industry breadth at {formatMcap(data?.mcap_floor)}
          </p>
        </div>
        <p className="t-caption t-mono">
          {loading ? "Loading..." : error ? `Unavailable: ${error}` : `Built ${formatBuiltAt(data?.built_at)}`}
        </p>
      </div>

      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="brief-panel space-y-4">
            <p className="t-overline text-[var(--fg-3)]">Market Breadth</p>
            <BreadthBar
              label="New Highs vs New Lows"
              leftCount={data?.market.new_highs}
              rightCount={data?.market.new_lows}
              leftLabel="Highs"
              rightLabel="Lows"
            />
            <BreadthBar
              label="Advance vs Decline"
              leftCount={data?.market.advance}
              rightCount={data?.market.decline}
              leftLabel="Advance"
              rightLabel="Decline"
            />
            <StageAnalysisBar counts={data?.market.stage_counts ?? {}} />
          </div>

          <div className="brief-panel space-y-4">
            <p className="t-overline text-[var(--fg-3)]">Momentum Breadth</p>
            <BreadthBar
              label="Up from Open"
              leftCount={data?.momentum.up_from_open}
              rightCount={data?.momentum.down_from_open}
              leftLabel="Up"
              rightLabel="Down"
            />
            <BreadthBar
              label="Up on Volume"
              leftCount={data?.momentum.up_on_volume}
              rightCount={data?.momentum.down_on_volume}
              leftLabel="Up Vol"
              rightLabel="Down Vol"
            />
            <BreadthBar
              label="Up 4% or More"
              leftCount={data?.momentum.up_4pct}
              rightCount={data?.momentum.down_4pct}
              leftLabel="Up 4%"
              rightLabel="Down 4%"
            />
          </div>
        </div>

        <SectorMomentumTable rows={data?.sectors ?? []} />
        <IndustryRotationStrip rows={data?.industries ?? []} />
      </div>
    </div>
  );
}

function SectorMomentumTable({ rows }: { rows: SectorRow[] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => deltaRank(b) - deltaRank(a)).slice(0, 12),
    [rows],
  );

  return (
    <div className="brief-panel">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <p className="t-overline text-[var(--fg-3)]">Sector Momentum</p>
        <p className="t-caption">% above 50-SMA, sorted by 1M change</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
            <tr className="border-b border-[var(--line)]">
              <th className="py-2 pr-3 font-bold">Sector</th>
              <th className="px-3 py-2 text-right font-bold">Now</th>
              <th className="px-3 py-2 text-right font-bold">1W Ago</th>
              <th className="px-3 py-2 text-right font-bold">1M Ago</th>
              <th className="px-3 py-2 text-right font-bold">WoW</th>
              <th className="px-3 py-2 text-right font-bold">MoM</th>
              <th className="py-2 pl-3 text-right font-bold">Names</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length ? (
              sorted.map((row) => (
                <tr key={row.sector} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 pr-3 font-semibold text-[var(--fg-1)]">{row.sector}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatPct(row.pct_above_50sma)}</td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">
                    {formatPct(previousPct(row.pct_above_50sma, row.delta_wow))}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">
                    {formatPct(previousPct(row.pct_above_50sma, row.delta_mom))}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${deltaClass(row.delta_wow)}`}>
                    {formatPct(row.delta_wow, true)}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${deltaClass(row.delta_mom)}`}>
                    {formatPct(row.delta_mom, true)}
                  </td>
                  <td className="py-2 pl-3 text-right font-mono text-[var(--fg-3)]">{row.n}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="py-3 text-[var(--fg-3)]" colSpan={7}>
                  Sector breadth will appear after the daily breadth scan writes breadth.json.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IndustryRotationStrip({ rows }: { rows: IndustryRow[] }) {
  const hasHistory = rows.some((row) => row.delta_wow != null);
  const heating = useMemo(() => {
    const sortable = [...rows].sort((a, b) => {
      const aRank = hasHistory ? a.delta_wow ?? -999 : a.pct_above_50sma;
      const bRank = hasHistory ? b.delta_wow ?? -999 : b.pct_above_50sma;
      return bRank - aRank;
    });
    return sortable.slice(0, 8);
  }, [hasHistory, rows]);
  const cooling = useMemo(() => {
    const sortable = [...rows].sort((a, b) => {
      const aRank = hasHistory ? a.delta_wow ?? 999 : a.pct_above_50sma;
      const bRank = hasHistory ? b.delta_wow ?? 999 : b.pct_above_50sma;
      return aRank - bRank;
    });
    return sortable.slice(0, 8);
  }, [hasHistory, rows]);

  return (
    <div className="brief-panel">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <p className="t-overline text-[var(--fg-3)]">Industry Rotation</p>
        <p className="t-caption">
          {hasHistory ? "Ranked by WoW change in % above 50-SMA" : "History building; ranked by current breadth"}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <IndustryList title="Heating Up" rows={heating} history={hasHistory} />
        <IndustryList title="Cooling Off" rows={cooling} history={hasHistory} />
      </div>
    </div>
  );
}

function IndustryList({
  title,
  rows,
  history,
}: {
  title: string;
  rows: IndustryRow[];
  history: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fg-3)]">{title}</p>
      <ul className="space-y-1">
        {rows.length ? (
          rows.map((row) => (
            <li
              key={`${title}-${row.industry}`}
              className="grid grid-cols-[minmax(0,1fr)_64px_64px] gap-2 text-[12px]"
            >
              <span className="truncate font-semibold text-[var(--fg-1)]" title={row.industry}>
                {row.industry}
              </span>
              <span className={`text-right font-mono ${deltaClass(history ? row.delta_wow : row.pct_above_50sma)}`}>
                {history ? formatPct(row.delta_wow, true) : formatPct(row.pct_above_50sma)}
              </span>
              <span className="text-right font-mono text-[var(--fg-3)]">{row.n} names</span>
            </li>
          ))
        ) : (
          <li className="text-[12px] text-[var(--fg-3)]">No industry rows yet.</li>
        )}
      </ul>
    </div>
  );
}
