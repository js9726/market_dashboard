"use client";

/**
 * EquityTimeline (/dashboard/equity).
 *
 * Realized P&L comes from your sheet in MYR; the live account (cash + US
 * positions) is USD. A USD/MYR toggle converts both onto one curve using a
 * live USD/MYR rate. If the rate is unavailable we fail closed: show realized
 * in MYR and the account value in USD without guessing a conversion.
 */

import { useEffect, useMemo, useState } from "react";

interface RealizedPoint { date: string; value: number }
interface Reconciliation { expectedNet: number; brokerLatest: number | null; positionsValue: number; latestCash: number | null }
interface Account { id: string; alias: string; currency: string }
interface PositionsPricing {
  source: "live-quote" | "position-cache" | "mixed";
  latestQuoteAt: string | null;
  liveQuoteCount: number;
  staleQuotes: number;
  usedPositionCache: number;
  usedAvgCost: number;
  excludedPositionCurrencies: Record<string, number>;
}
interface Resp {
  realizedMyr: RealizedPoint[];
  realizedCurrency: string;
  fxUsdMyr: number | null;
  positionsValue: number;
  positionsPricing: PositionsPricing;
  latestCash: number | null;
  accountValueReliable: boolean;
  reconciliation: Reconciliation | null;
  accounts: Account[];
}

const CASH_KEY = "md-equity-cash-override";
const CCY_KEY = "md-equity-ccy";
type Ccy = "USD" | "MYR";

export default function EquityTimeline() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(90);
  const [cashOverride, setCashOverride] = useState("");
  const [wantCcy, setWantCcy] = useState<Ccy>("USD");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCashOverride(window.localStorage.getItem(CASH_KEY) ?? "");
    const c = window.localStorage.getItem(CCY_KEY);
    if (c === "USD" || c === "MYR") setWantCcy(c);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const to = new Date().toISOString().slice(0, 10);
    const fromD = new Date();
    fromD.setUTCDate(fromD.getUTCDate() - windowDays);
    fetch(`/api/equity/timeline?from=${fromD.toISOString().slice(0, 10)}&to=${to}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!cancelled) { setData(j); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [windowDays]);

  function saveCash(v: string) {
    setCashOverride(v);
    if (typeof window === "undefined") return;
    if (v.trim() === "") {
      window.localStorage.removeItem(CASH_KEY);
    } else {
      window.localStorage.setItem(CASH_KEY, v);
    }
  }
  function pickCcy(c: Ccy) {
    setWantCcy(c);
    if (typeof window !== "undefined") window.localStorage.setItem(CCY_KEY, c);
  }

  const fx = data?.fxUsdMyr ?? null;
  const canConvert = fx != null && fx > 0;
  // Realized is MYR natively; only show USD when we have a rate.
  const ccy: Ccy = canConvert ? wantCcy : "MYR";
  const sym = ccy === "MYR" ? "RM" : "$";

  // Realized series in the display currency (MYR native → ÷fx for USD).
  const realized = useMemo(() => {
    const pts = data?.realizedMyr ?? [];
    return pts.map((p) => ({ date: p.date, v: ccy === "USD" && fx ? p.value / fx : p.value }));
  }, [data, ccy, fx]);

  const positionsValue = data?.positionsValue ?? 0;
  const parsedCash = cashOverride.trim() !== "" ? Number(cashOverride) : null;
  const cashNum =
    parsedCash != null
      ? (Number.isFinite(parsedCash) ? parsedCash : null)
      : (data?.latestCash ?? null);
  const netUsd = cashNum != null ? cashNum + positionsValue : null; // USD
  const netInCcy = netUsd == null ? null : ccy === "MYR" ? (fx ? netUsd * fx : null) : netUsd;

  // Net-value line: project net (display ccy) back through the realized curve.
  const netSeries = useMemo(() => {
    if (netInCcy == null || realized.length === 0) return [];
    const totalRealized = realized[realized.length - 1].v;
    const start = netInCcy - totalRealized;
    return realized.map((p) => ({ date: p.date, v: Number((start + p.v).toFixed(2)) }));
  }, [netInCcy, realized]);

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
            Realized P&amp;L (from your sheet, MYR) + net account value (cash + live positions, USD),
            shown in {ccy}{canConvert ? ` at USD/MYR ${fx!.toFixed(3)}` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex gap-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-raised)] p-1">
            {(["USD", "MYR"] as Ccy[]).map((c) => (
              <button
                key={c}
                onClick={() => pickCcy(c)}
                disabled={!canConvert && c === "USD"}
                className={`rounded-[var(--radius-sm)] px-3 py-1 text-xs font-medium transition ${ccy === c ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-[var(--fg-3)] hover:text-[var(--fg-1)] disabled:opacity-40"}`}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="t-caption flex items-center gap-1.5">
            Cash $
            <input
              type="number"
              value={cashOverride}
              onChange={(e) => saveCash(e.target.value)}
              placeholder={data?.latestCash != null ? String(data.latestCash) : "cash"}
              className="w-24 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--fg-1)] focus:border-[var(--accent)] focus:outline-none"
              title="Override USD cash to compute net account value (saved on this device)"
            />
          </label>
          {[30, 90, 180, 365].map((d) => (
            <button key={d} onClick={() => setWindowDays(d)} className={`mds-button ${windowDays === d ? "mds-button--primary" : ""}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {data && !canConvert && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Live USD/MYR unavailable.</span>{" "}
          Showing realized P&amp;L in MYR; account value stays USD (can&apos;t combine without a rate).
        </div>
      )}
      {data && (data.positionsPricing.usedAvgCost > 0 || data.positionsPricing.usedPositionCache > 0 || data.positionsPricing.staleQuotes > 0) && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Position pricing fallback.</span>{" "}
          {data.positionsPricing.latestQuoteAt
            ? `Latest quote ${new Date(data.positionsPricing.latestQuoteAt).toLocaleString()}. `
            : "No live quote timestamp available. "}
          {data.positionsPricing.usedAvgCost > 0
            ? `${data.positionsPricing.usedAvgCost} position${data.positionsPricing.usedAvgCost !== 1 ? "s" : ""} valued at average cost. `
            : null}
          {data.positionsPricing.usedPositionCache > 0
            ? `${data.positionsPricing.usedPositionCache} position${data.positionsPricing.usedPositionCache !== 1 ? "s" : ""} valued from cached broker price. `
            : null}
          {data.positionsPricing.staleQuotes > 0
            ? `${data.positionsPricing.staleQuotes} stale live quote${data.positionsPricing.staleQuotes !== 1 ? "s" : ""} ignored.`
            : null}
        </div>
      )}
      {data && !data.accountValueReliable && data.reconciliation && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Broker total ignored.</span>{" "}
          The bridge reported{" "}
          <span className="font-mono">{data.reconciliation.brokerLatest != null ? `$${fmt(data.reconciliation.brokerLatest)}` : "n/a"}</span>{" "}
          (doesn&apos;t reconcile with cash + positions). Net value uses cash + live positions instead.
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Net account value (${netInCcy != null ? ccy : "USD"})`} value={netInCcy != null ? `${sym}${fmt(netInCcy)}` : netUsd != null ? `$${fmt(netUsd)}` : "—"} />
        <Stat label={`Realized P&L (${ccy})`} value={signed(stats.current, sym)} color={stats.current >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label={`${windowDays}d Realized`} value={signed(stats.change, sym)} color={stats.change >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label="Max Drawdown" value={`-${sym}${fmt(stats.maxDd)}`} color="var(--loss-fg)" />
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
function signed(n: number, sym: string): string {
  return `${n >= 0 ? "+" : "-"}${sym}${fmt(n)}`;
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
