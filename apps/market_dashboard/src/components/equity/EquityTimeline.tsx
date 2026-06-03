"use client";

/**
 * EquityTimeline — the account's equity view (/dashboard/equity).
 *
 * Primary line: cumulative REALIZED P&L from sheet closed trades — the reliable
 * "real equity curve" of booked trading performance. Secondary line: broker net
 * account value, shown only when it reconciles with cash + live positions
 * (`accountValueReliable`). When the broker snapshot is off (known bridge bug),
 * we warn and show trading P&L only — never a fake account number.
 */

import { useEffect, useMemo, useState } from "react";

interface RealizedPoint { date: string; value: number }
interface AccountPoint { date: string; totalAssets: number; cash: number; marketVal: number }
interface Reconciliation { expectedNet: number; brokerLatest: number | null; positionsValue: number; latestCash: number | null }
interface Account { id: string; alias: string; currency: string }
interface Resp {
  realized: RealizedPoint[];
  accountValue: AccountPoint[];
  accountValueReliable: boolean;
  reconciliation: Reconciliation | null;
  accounts: Account[];
}

export default function EquityTimeline() {
  const [data, setData] = useState<Resp | null>(null);
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
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!cancelled) { setData(j); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [windowDays]);

  const realized = useMemo(() => (data?.realized ?? []).map((p) => ({ date: p.date, v: p.value })), [data]);
  const accountSeries = useMemo(
    () => (data?.accountValueReliable ? (data?.accountValue ?? []).map((p) => ({ date: p.date, v: p.totalAssets })) : []),
    [data],
  );
  const stats = useMemo(() => computeStats(realized), [realized]);
  // Shared scale across whichever lines are shown.
  const allV = useMemo(() => [...realized.map((p) => p.v), ...accountSeries.map((p) => p.v)], [realized, accountSeries]);
  const realizedPath = useMemo(() => buildSvgPath(realized, allV), [realized, allV]);
  const accountPath = useMemo(() => buildSvgPath(accountSeries, allV), [accountSeries, allV]);

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="t-overline text-[var(--fg-3)]">Equity Timeline</p>
          <p className="t-caption">
            Cumulative realized P&amp;L from your booked trades — your real trading equity curve.
            {data?.accountValueReliable && " Broker net account value overlaid."}
          </p>
        </div>
        <div className="flex gap-2">
          {[30, 90, 180, 365].map((d) => (
            <button key={d} onClick={() => setWindowDays(d)} className={`mds-button ${windowDays === d ? "mds-button--primary" : ""}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Reconciliation warning — broker totals don't match cash + positions */}
      {data && !data.accountValueReliable && data.reconciliation && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] bg-[var(--warn-bg,transparent)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Broker account value hidden.</span>{" "}
          The bridge reported{" "}
          <span className="font-mono">{data.reconciliation.brokerLatest != null ? `$${fmt(data.reconciliation.brokerLatest)}` : "n/a"}</span>,
          which doesn&apos;t reconcile with cash + live positions
          (<span className="font-mono">~${fmt(data.reconciliation.expectedNet)}</span>).
          Verify your moomoo <code>acc_id</code> on the bridge PC. Showing realized trading P&amp;L only.
        </div>
      )}

      {/* Summary stats — on the realized P&L curve */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Realized P&L" value={signed(stats.current)} color={stats.current >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label={`${windowDays}d Change`} value={signed(stats.change)} color={stats.change >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label="Peak" value={signed(stats.peak)} />
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
            {/* zero baseline (P&L can go negative) */}
            <line x1={0} y1={zeroY(allV)} x2={800} y2={zeroY(allV)} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 4" />
            {accountPath && <path d={accountPath} stroke="var(--fg-3)" strokeWidth={1.5} strokeDasharray="5 4" fill="none" />}
            <path d={realizedPath} stroke="var(--accent)" strokeWidth={2} fill="none" />
          </svg>
          <div className="mt-2 flex items-center justify-between t-caption text-[var(--fg-3)]">
            <span>{realized[0]?.date}</span>
            <span className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--accent)" }} />Realized P&amp;L</span>
              {accountSeries.length > 0 && (
                <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--fg-3)" }} />Account value</span>
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
