"use client";

import { useMemo } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useMarketSnapshot } from "@/hooks/useMarketSnapshot";
import {
  QUADRANT_META,
  RRG_MIDPOINTS,
  rrgPointTone,
  rrgQuadrantCounts,
  toRrgPoints,
  type RrgPoint,
  type RrgQuadrant,
} from "@/lib/rrg";
import { type ThemeBucket } from "@/lib/themes";
import FreshnessBadge from "./FreshnessBadge";
import { SNAPSHOT_THRESHOLDS } from "@/lib/freshness";

const BUCKET_ORDER: ThemeBucket[] = ["heating", "accumulate", "cooling", "neutral"];

const BUCKET_LABELS: Record<ThemeBucket, string> = {
  heating: "Heating",
  accumulate: "Accumulate",
  cooling: "Cooling",
  neutral: "Neutral",
};

function formatPct(value: number | null | undefined, decimals = 1): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(decimals)}%`;
}

interface TooltipPayload {
  payload: RrgPoint;
}

function PointTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded border border-[var(--line)] bg-[var(--bg-surface)] p-3 text-[12px] shadow-lg"
      style={{ minWidth: 180 }}
    >
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="t-ticker">{p.ticker}</span>
        <span className="t-caption">{p.label}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
        <span className="text-[var(--fg-3)]">RS</span>
        <span className="text-right text-[var(--fg-1)]">{Math.round(p.x)}</span>
        <span className="text-[var(--fg-3)]">1M</span>
        <span className="text-right text-[var(--fg-1)]">{formatPct(p.y)}</span>
        <span className="text-[var(--fg-3)]">1D</span>
        <span className="text-right text-[var(--fg-1)]">{formatPct(p.daily)}</span>
        <span className="text-[var(--fg-3)]">Intra</span>
        <span className="text-right text-[var(--fg-1)]">{formatPct(p.intra)}</span>
        <span className="text-[var(--fg-3)]">Bucket</span>
        <span className="text-right text-[var(--accent)] uppercase tracking-[0.12em]">
          {p.themeBucket}
        </span>
      </div>
    </div>
  );
}

function QuadrantCornerLabel({
  quadrant,
}: {
  quadrant: Exclude<RrgQuadrant, "unknown">;
}) {
  const meta = QUADRANT_META[quadrant];
  const positions: Record<string, string> = {
    "left-top": "left-4 top-4",
    "right-top": "right-4 top-4",
    "left-bottom": "left-4 bottom-4",
    "right-bottom": "right-4 bottom-4",
  };
  const cls = positions[`${meta.cornerX}-${meta.cornerY}`];
  const align = meta.cornerX === "right" ? "text-right" : "text-left";
  return (
    <div className={`pointer-events-none absolute ${cls} ${align}`}>
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--fg-2)]">
        {meta.label}
      </div>
      <div className="t-caption">{meta.subtitle}</div>
    </div>
  );
}

export default function RotationGraph() {
  const { data, loading, error } = useMarketSnapshot();

  const points = useMemo(() => {
    const industries = data?.groups?.Industries ?? [];
    return toRrgPoints(industries);
  }, [data]);

  const quadrantCounts = useMemo(() => rrgQuadrantCounts(points), [points]);

  const bucketGroups = useMemo(() => {
    const groups: Record<ThemeBucket, RrgPoint[]> = {
      heating: [],
      accumulate: [],
      cooling: [],
      neutral: [],
    };
    for (const p of points) groups[p.themeBucket].push(p);
    return groups;
  }, [points]);

  const totalIndustries = data?.groups?.Industries?.length ?? 0;
  const plottedCount = points.length;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Rotation Graph</p>
          <p className="t-caption">
            Industry ETFs plotted by Relative Strength (X) vs 1-month momentum (Y). Bubble size
            scales with ATR %. Colour matches Theme Radar buckets.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="t-caption t-mono">
            {loading
              ? "Loading..."
              : error
                ? `Unavailable: ${error}`
                : `${plottedCount}/${totalIndustries} themes plotted`}
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

      <div className="grid gap-4 lg:grid-cols-[1fr_220px]">
        <div className="relative h-[480px] rounded border border-[var(--line)] bg-[var(--bg-raised)] p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 24, right: 24, bottom: 32, left: 32 }}>
              <CartesianGrid stroke="var(--line)" strokeDasharray="2 4" />
              <XAxis
                type="number"
                dataKey="x"
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                stroke="var(--fg-3)"
                tick={{ fill: "var(--fg-3)", fontSize: 11 }}
                label={{
                  value: "RELATIVE STRENGTH",
                  position: "insideBottom",
                  offset: -16,
                  fill: "var(--fg-3)",
                  fontSize: 10,
                  letterSpacing: "0.12em",
                }}
              />
              <YAxis
                type="number"
                dataKey="y"
                stroke="var(--fg-3)"
                tick={{ fill: "var(--fg-3)", fontSize: 11 }}
                tickFormatter={(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(0)}%`}
                label={{
                  value: "1M MOMENTUM",
                  angle: -90,
                  position: "insideLeft",
                  offset: 8,
                  fill: "var(--fg-3)",
                  fontSize: 10,
                  letterSpacing: "0.12em",
                }}
              />
              <ZAxis type="number" dataKey="size" range={[40, 360]} />
              <ReferenceLine
                x={RRG_MIDPOINTS.rs}
                stroke="var(--fg-3)"
                strokeDasharray="3 3"
              />
              <ReferenceLine
                y={RRG_MIDPOINTS.momentum}
                stroke="var(--fg-3)"
                strokeDasharray="3 3"
              />
              <Tooltip cursor={{ stroke: "var(--accent)", strokeOpacity: 0.3 }} content={<PointTooltip />} />
              {BUCKET_ORDER.map((bucket) => {
                const tone = rrgPointTone(bucket);
                const data = bucketGroups[bucket];
                if (!data.length) return null;
                return (
                  <Scatter
                    key={bucket}
                    name={BUCKET_LABELS[bucket]}
                    data={data}
                    fill={tone.fill}
                    fillOpacity={bucket === "neutral" ? 0.35 : 0.7}
                    stroke={tone.stroke}
                    strokeWidth={1}
                  />
                );
              })}
            </ScatterChart>
          </ResponsiveContainer>
          {(["leading", "improving", "lagging", "weakening"] as const).map((q) => (
            <QuadrantCornerLabel key={q} quadrant={q} />
          ))}
        </div>

        <aside className="flex flex-col gap-4 text-[12px]">
          <div>
            <p className="t-overline mb-2">Quadrants</p>
            <ul className="space-y-1 t-mono">
              {(["leading", "improving", "weakening", "lagging"] as const).map((q) => (
                <li key={q} className="flex items-baseline justify-between">
                  <span className="text-[var(--fg-2)] uppercase tracking-[0.1em]">
                    {QUADRANT_META[q].label}
                  </span>
                  <span className="text-[var(--fg-1)]">{quadrantCounts[q]}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="t-overline mb-2">Theme buckets</p>
            <ul className="space-y-1 t-mono">
              {BUCKET_ORDER.map((bucket) => {
                const tone = rrgPointTone(bucket);
                const count = bucketGroups[bucket].length;
                return (
                  <li key={bucket} className="flex items-baseline justify-between gap-2">
                    <span className="inline-flex items-center gap-2 text-[var(--fg-2)] uppercase tracking-[0.1em]">
                      <span
                        aria-hidden
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: 999,
                          background: tone.fill,
                          opacity: bucket === "neutral" ? 0.35 : 0.7,
                        }}
                      />
                      {BUCKET_LABELS[bucket]}
                    </span>
                    <span className="text-[var(--fg-1)]">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <p className="t-caption">
            Top-right = Leading (long, trail stops). Top-left = Improving (next rotation). Bottom
            corners = lagging / weakening.
          </p>
        </aside>
      </div>
    </section>
  );
}
