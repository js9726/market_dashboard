"use client";

import { useMemo } from "react";
import { useMarketSnapshot } from "@/hooks/useMarketSnapshot";
import { classifyTheme, themeLabel, type ThemeBucket } from "@/lib/themes";
import type { TickerRow } from "@/types/market-dashboard";
import FreshnessBadge from "./FreshnessBadge";
import { SNAPSHOT_THRESHOLDS } from "@/lib/freshness";

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
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

function bucketTone(bucket: ThemeBucket): { background: string; color: string; label: string } {
  switch (bucket) {
    case "heating":
      return { background: "var(--gain-bg)", color: "var(--gain-fg)", label: "HEATING" };
    case "accumulate":
      return { background: "var(--accent-soft-bg)", color: "var(--accent)", label: "ACCUMULATE" };
    case "cooling":
      return { background: "var(--loss-bg)", color: "var(--loss-fg)", label: "COOLING" };
    default:
      return { background: "var(--bg-raised)", color: "var(--fg-3)", label: "NEUTRAL" };
  }
}

type BucketGroup = {
  bucket: Exclude<ThemeBucket, "neutral">;
  title: string;
  subtitle: string;
  rows: TickerRow[];
};

export default function ThemeRadar() {
  const { data, loading, error } = useMarketSnapshot();

  const groups = useMemo<BucketGroup[]>(() => {
    const industries = data?.groups?.Industries ?? [];
    const classified: Record<ThemeBucket, TickerRow[]> = {
      heating: [],
      accumulate: [],
      cooling: [],
      neutral: [],
    };
    for (const row of industries) {
      classified[classifyTheme(row)].push(row);
    }
    // Sort each bucket so the strongest signal floats to the top.
    classified.heating.sort((a, b) => (b.daily ?? 0) - (a.daily ?? 0));
    classified.accumulate.sort((a, b) => (b.rs ?? 0) - (a.rs ?? 0));
    classified.cooling.sort((a, b) => (a.daily ?? 0) - (b.daily ?? 0));
    return [
      {
        bucket: "heating",
        title: "Active Signals",
        subtitle: "Breakout / Heating - chase carefully",
        rows: classified.heating,
      },
      {
        bucket: "accumulate",
        title: "Next to Heat",
        subtitle: "Accumulate - building-position window",
        rows: classified.accumulate,
      },
      {
        bucket: "cooling",
        title: "Cooling",
        subtitle: "Watch for exit - trail stops, take profit",
        rows: classified.cooling,
      },
    ];
  }, [data]);

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Theme Radar</p>
          <p className="t-caption">
            Industry ETFs classified by today&apos;s action signal. Thresholds in{" "}
            <code>src/lib/themes.ts</code>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="t-caption t-mono">
            {loading ? "Loading..." : error ? `Unavailable: ${error}` : `${data?.groups?.Industries?.length ?? 0} themes`}
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

      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <BucketSection key={group.bucket} group={group} loading={loading} />
        ))}
      </div>
    </section>
  );
}

function BucketSection({ group, loading }: { group: BucketGroup; loading: boolean }) {
  const tone = bucketTone(group.bucket);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[var(--fg-1)]">
            {group.title}
          </h3>
          <p className="t-caption">{group.subtitle}</p>
        </div>
        <span
          className="inline-flex rounded px-2 py-1 font-mono text-[11px] font-bold"
          style={{ background: tone.background, color: tone.color }}
        >
          {tone.label} - {group.rows.length}
        </span>
      </div>

      {loading ? (
        <p className="t-body-small text-[var(--fg-3)]">Loading themes...</p>
      ) : group.rows.length === 0 ? (
        <p className="t-body-small text-[var(--fg-3)]">No themes meet criteria right now.</p>
      ) : (
        <BucketTable rows={group.rows} bucket={group.bucket} />
      )}
    </div>
  );
}

function BucketTable({ rows, bucket }: { rows: TickerRow[]; bucket: ThemeBucket }) {
  const tone = bucketTone(bucket);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-[12px]">
        <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
          <tr className="border-b border-[var(--line)]">
            <th className="py-2 pr-3 font-bold">Theme</th>
            <th className="px-3 py-2 font-bold">Ticker</th>
            <th className="px-3 py-2 text-right font-bold">Daily</th>
            <th className="px-3 py-2 text-right font-bold">Intra</th>
            <th className="px-3 py-2 text-right font-bold">5D</th>
            <th className="px-3 py-2 text-right font-bold">20D</th>
            <th className="px-3 py-2 text-right font-bold">RS</th>
            <th className="px-3 py-2 text-right font-bold">ABC</th>
            <th className="py-2 pl-3 text-right font-bold">Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ticker} className="border-b border-[var(--line)] last:border-0">
              <td className="py-2 pr-3 text-[var(--fg-1)]">{themeLabel(row.ticker)}</td>
              <td className="px-3 py-2 t-ticker">{row.ticker}</td>
              <td className={`px-3 py-2 text-right font-mono ${changeClass(row.daily)}`}>
                {formatPct(row.daily)}
              </td>
              <td className={`px-3 py-2 text-right font-mono ${changeClass(row.intra)}`}>
                {formatPct(row.intra)}
              </td>
              <td className={`px-3 py-2 text-right font-mono ${changeClass(row["5d"])}`}>
                {formatPct(row["5d"])}
              </td>
              <td className={`px-3 py-2 text-right font-mono ${changeClass(row["20d"])}`}>
                {formatPct(row["20d"])}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">
                {formatRs(row.rs)}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">
                {row.abc ?? "-"}
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
