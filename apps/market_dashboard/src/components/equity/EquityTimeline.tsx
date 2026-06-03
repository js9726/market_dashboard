"use client";

/**
 * EquityTimeline (/dashboard/equity).
 *
 * Two reliable lines, both independent of the broken broker total:
 *   • Realized P&L — cumulative booked P&L from sheet closed trades.
 *   • Net account value — (cash + live position value) projected back through
 *     time via the realized-P&L curve. Cash defaults to the last broker
 *     snapshot but can be overridden manually (persisted locally) until the
 *     bridge acc_id is fixed. We never plot the raw broker total when it fails
 *     reconciliation.
 */

import { useEffect, useMemo, useState } from "react";

interface RealizedPoint { date: string; value: number }
interface Reconciliation { expectedNet: number; brokerLatest: number | null; positionsValue: number; latestCash: number | null }
interface Account { id: string; alias: string; currency: string }
interface Resp {
  realized: RealizedPoint[];
  accountValueReliable: boolean;
  positionsValue: number;
  latestCash: number | null;
  reconciliation: Reconciliation | null;
  accounts: Account[];
}

const CASH_KEY = "md-equity-cash-override";

export default function EquityTimeline() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(90);
  const [cashOverride, setCashOverride] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") setCashOverride(window.localStorage.getItem(CASH_KEY) ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const to = new Date().toISOString().slice(0, 10);
    const fromD = new Date();
    fromD.setUTCDate(fromD.getUTCDate() - windowDays);
    const from = fromD.toISOString().slice(0, 10);
    fetch(`/api/equity/timeline?from=${from}&to=${to}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!cancelled) { setData(j); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [windowDays]);

  function saveCash(v: string) {
    setCashOverride(v);
    if (typeof window !== "undefined") {
      if (v.trim() === "") window.localStorage.removeItem(CASH_KEY);
      else window.localStorage.setItem(CASH_KEY, v);
    }
  }

  const realized = useMemo(() => (data?.realized ?? []).map((p) => ({ date: p.date, v: p.value })), [data]);
  const positionsValue = data?.positionsValue ?? 0;
  const cashNum = cashOverride.trim() !== "" ? Number(cashOverride) : (data?.latestCash ?? null);
  const currentNet = cashNum != null ? cashNum + positionsValue : null;

  // Net account value line: project current net back via the realized curve.
  const netSeries = useMemo(() => {
    if (currentNet == null || realized.length === 0) return [];
    const totalRealized = realized[realized.length - 1].v;
    const startingCapital = currentNet - totalRealized;
    return realized.map((p) => ({ date: p.date, v: Number((startingCapital + p.v).toFixed(2)) }));
  }, [currentNet, realized]);

  const stats = useMemo(() => computeStats(realized), [realized]);
  const allV = useMemo(() => [...realized.map((p) => p.v), ...netSeries.map((p) => p.v)], [realized, netSeries]);
  const realizedPath = useMemo(() => buildSvgPath(realized, allV), [realized, allV]);
  const netPath = useMemo(() => buildSvgPath(netSeries, allV), [netSeries, allV]);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="t-overline text-[var(--fg-3)]">Equity Timeline</p>
          <p className="t-caption">
            Realized P&amp;L from your booked trades + net account value (cash + live positions).
            Both are independent of the broker total, which is gated by reconciliation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="t-caption flex items-center gap-1.5">
            Cash $
            <input
              type="number"
              value={cashOverride}
              onChange={(e) => saveCash(e.target.value)}
              placeholder={data?.latestCash != null ? String(data.latestCash) : "cash"}
              className="w-24 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--fg-1)] focus:border-[var(--accent)] focus:outline-none"
              title="Override cash to compute net account value (saved on this device)"
            />
          </label>
          {[30, 90, 180, 365].map((d) => (
            <button key={d} onClick={() => setWindowDays(d)} className={`mds-button ${windowDays === d ? "mds-button--primary" : ""}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {data && !data.accountValueReliable && data.reconciliation && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Broker total ignored.</span>{" "}
          The bridge reported{" "}
          <span className="font-mono">{data.reconciliation.brokerLatest != null ? `$${fmt(data.reconciliation.brokerLatest)}` : "n/a"}</span>{" "}
          (doesn&apos;t reconcile with cash + positions). Net value below is computed from cash + live positions instead.
          Fix the moomoo <code>acc_id</code> (see EQUITY-ACCID-FIX.md) for an automatic figure.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net account value" value={currentNet != null ? `$${fmt(currentNet)}` : "—"} />
        <Stat label="Realized P&L" value={signed(stats.current)} color={stats.current >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label={`${windowDays}d Realized`} value={signed(stats.change)} color={stats.change >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label="Max Drawdown" value={`-$${fmt(stats.maxDd)}`} color="var(--loss-fg)" />
      </div>

      {loading ? (
        <p className="t-caption t-mono">Loading equity timeline…</p>
      ) : error ? (
        <p className="t-caption t-mono">Error: {error}</p>
      ) : realized.length === 0 ? (
        <div className="border-t border-[var(--line)] pt-4">
          <p className="t-caption">No closed trades in this window yet — your realized-P&amp;L curve appears once trades close.</p>
        </div>
      ) : (
        <div className="border-t border-[var(--line)] pt-4">
          <svg viewBox="0 0 800 280" className="h-72 w-full">
            <line x1={0} y1={zeroY(allV)} x2={800} y2={zeroY(allV)} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 4" />
            {netPath && <path d={netPath} stroke="var(--fg-2)" strokeWidth={1.5} fill="none" />}
            <path d={realizedPath} stroke="var(--accent)" strokeWidth={2} fill="none" />
          </svg>
          <div className="mt-2 flex items-center justify-between t-caption text-[var(--fg-3)]">
            <span>{realized[0]?.date}</span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--accent)" }} />Realized P&amp;L</span>
              {netSeries.length > 0 && (
                <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--fg-2)" }} />Net value</span>
              )}
            </span>
            <span>{realized[realized.length - 1]?.date}</span>
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
      <p className="text-xl font-semibold tabular-nums" style={{ color }}>{value}</p>
    </div>
  );
}

function fmt(n: number): string {
  return Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function signed(n: number): string {
  return `${n >= 0 ? "+" : "-"}$${fmt(n)}`;
}

function computeStats(points: { date: string; v: number }[]) {
  if (points.length === 0) return { current: 0, peak: 0, change: 0, maxDd: 0 };
  const vals = points.map((p) => p.v);
  const current = vals[vals.length - 1];
  const first = vals[0];
  let peak = vals[0];
  let maxDd = 0;
  for (const v of vals) {
    if (v > peak) peak = v;
    const dd = peak - v;
    if (dd > maxDd) maxDd = dd;
  }
  return { current, peak, change: current - first, maxDd };
}

function zeroY(allV: number[]): number {
  if (allV.length === 0) return 280;
  const min = Math.min(...allV, 0);
  const max = Math.max(...allV, 0);
  const range = max - min || 1;
  const H = 280, pad = 10;
  return H - pad - ((0 - min) / range) * (H - 2 * pad);
}

function buildSvgPath(points: { date: string; v: number }[], allV: number[]): string {
  if (points.length === 0 || allV.length === 0) return "";
  const min = Math.min(...allV, 0);
  const max = Math.max(...allV, 0);
  const range = max - min || 1;
  const W = 800, H = 280, pad = 10;
  return points
    .map((p, i) => {
      const x = points.length === 1 ? W / 2 : (i / (points.length - 1)) * W;
      const y = H - pad - ((p.v - min) / range) * (H - 2 * pad);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}
