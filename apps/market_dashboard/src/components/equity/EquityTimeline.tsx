"use client";

/**
 * EquityTimeline — Phase 6 page.
 *
 * Renders the user's daily equity curve from /api/equity/timeline.
 *
 * Per Round 5 answer: NO benchmark comparison (user chose simple). Just the
 * equity curve with drawdown periods highlighted.
 *
 * Lightweight SVG line chart (no chart library dependency). Drawdown bands
 * computed client-side from peak-to-trough.
 */

import { useEffect, useMemo, useState } from "react";

interface EquityPoint {
  date: string;
  totalAssets: number;
  cash: number;
  marketVal: number;
  unrealizedPl: number;
  equityPctChange: number | null;
  source?: "broker" | "sheet";
}

interface Account {
  id: string;
  alias: string;
  currency: string;
}

interface TimelineResp {
  count: number;
  brokerStart?: string | null;
  accounts: Account[];
  points: EquityPoint[];
}

export default function EquityTimeline() {
  const [data, setData] = useState<TimelineResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(90);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const to = new Date().toISOString().slice(0, 10);
    const fromD = new Date();
    fromD.setUTCDate(fromD.getUTCDate() - windowDays);
    const from = fromD.toISOString().slice(0, 10);

    fetch(`/api/equity/timeline?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (!cancelled) {
          setData(j);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError((e as Error).message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [windowDays]);

  const stats = useMemo(() => computeStats(data?.points ?? []), [data?.points]);
  const path = useMemo(() => buildSvgPath(data?.points ?? []), [data?.points]);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="t-overline text-[var(--fg-3)]">Equity Timeline</p>
          <p className="t-caption">
            Account equity — live broker total assets (moomoo / IBKR via the bridge daemon),
            extended back through history with your sheet&apos;s realized P&amp;L.
            {(data?.accounts.length ?? 0) > 1 && ` Aggregated across ${data!.accounts.length} accounts.`}
            {data?.brokerStart && ` Broker snapshots start ${data.brokerStart}.`}
          </p>
        </div>
        <div className="flex gap-2">
          {[30, 90, 180, 365].map((d) => (
            <button
              key={d}
              onClick={() => setWindowDays(d)}
              className={`mds-button ${windowDays === d ? "mds-button--primary" : ""}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Current" value={`$${fmt(stats.current)}`} />
        <Stat label={`${windowDays}d Change`} value={`${stats.changePct >= 0 ? "+" : ""}${stats.changePct.toFixed(2)}%`} color={stats.changePct >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label="Peak" value={`$${fmt(stats.peak)}`} />
        <Stat label="Max Drawdown" value={`${stats.maxDdPct.toFixed(2)}%`} color="var(--loss-fg)" />
      </div>

      {loading ? (
        <p className="t-caption t-mono">Loading equity timeline…</p>
      ) : error ? (
        <p className="t-caption t-mono">Error: {error}</p>
      ) : !data || data.count === 0 ? (
        <div className="border-t border-[var(--line)] pt-4">
          <p className="t-caption">
            No equity snapshots yet. The dashboard-bridge daemon writes one snapshot
            per (account, day) — install it via{" "}
            <code>packages/dashboard-bridge/install.ps1</code> on your PC.
          </p>
        </div>
      ) : (
        <div className="border-t border-[var(--line)] pt-4">
          <svg viewBox="0 0 800 280" className="w-full h-72">
            {/* Drawdown shading */}
            {stats.drawdowns.map((dd, i) => (
              <rect
                key={i}
                x={dd.x0 * 800}
                y={0}
                width={(dd.x1 - dd.x0) * 800}
                height={280}
                fill="var(--loss-bg)"
                opacity={0.15}
              />
            ))}
            {/* Equity curve */}
            <path d={path} stroke="var(--accent-fg)" strokeWidth={2} fill="none" />
            {/* Zero/baseline */}
            <line x1={0} y1={280} x2={800} y2={280} stroke="var(--line)" strokeWidth={1} />
          </svg>
          <div className="mt-2 flex justify-between t-caption text-[var(--fg-3)]">
            <span>{data.points[0]?.date}</span>
            <span>{data.points[data.points.length - 1]?.date}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="brief-panel">
      <p className="t-overline text-[var(--fg-3)]">{label}</p>
      <p className="text-xl font-semibold" style={{ color }}>{value}</p>
    </div>
  );
}

function fmt(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function computeStats(points: EquityPoint[]) {
  if (points.length === 0) {
    return { current: 0, peak: 0, changePct: 0, maxDdPct: 0, drawdowns: [] as { x0: number; x1: number }[] };
  }
  if (points.length === 1) {
    const current = points[0].totalAssets;
    return { current, peak: current, changePct: 0, maxDdPct: 0, drawdowns: [] as { x0: number; x1: number }[] };
  }
  const first = points[0].totalAssets;
  const current = points[points.length - 1].totalAssets;
  let peak = first;
  let peakIdx = 0;
  let maxDd = 0;
  const drawdowns: { x0: number; x1: number }[] = [];
  let ddStartIdx: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const v = points[i].totalAssets;
    if (v > peak) {
      // new peak — close any open drawdown
      if (ddStartIdx != null) {
        drawdowns.push({ x0: ddStartIdx / (points.length - 1), x1: i / (points.length - 1) });
        ddStartIdx = null;
      }
      peak = v;
      peakIdx = i;
    } else {
      // in drawdown
      if (ddStartIdx == null) ddStartIdx = peakIdx;
      const ddPct = ((peak - v) / peak) * 100;
      if (ddPct > maxDd) maxDd = ddPct;
    }
  }
  if (ddStartIdx != null) {
    drawdowns.push({ x0: ddStartIdx / (points.length - 1), x1: 1 });
  }

  return {
    current,
    peak,
    changePct: first > 0 ? ((current - first) / first) * 100 : 0,
    maxDdPct: maxDd,
    drawdowns,
  };
}

function buildSvgPath(points: EquityPoint[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return "M 400.0 140.0";
  const vals = points.map((p) => p.totalAssets);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 800;
  const H = 280;
  const pad = 10;
  return points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * W;
      const y = H - pad - ((p.totalAssets - min) / range) * (H - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
