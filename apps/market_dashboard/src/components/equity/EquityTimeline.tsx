"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";

interface RealizedPoint { date: string; value: number }
interface AccountValuePoint { date: string; totalAssets: number; cash: number; marketVal: number }
interface Reconciliation {
  expectedNet: number;
  brokerLatest: number | null;
  discrepancy: number | null;
  discrepancyPct: number | null;
  positionsValue: number;
  latestCash: number | null;
  latestMarketVal: number | null;
}
interface Account { id: string; alias: string; currency: string; isLive: boolean }
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
  realized: RealizedPoint[];
  realizedCurrency: string;
  realizedGrossUsd: number;
  realizedFeesUsd: number;
  realizedNetUsd: number;
  accountValue: AccountValuePoint[];
  accountValueCurrency: "USD";
  accountValueSource: "broker-total-assets" | "fallback-cash-plus-positions";
  fxUsdMyr: number | null;
  positionsValue: number;
  positionsPricing: PositionsPricing;
  latestCash: number | null;
  reconciliation: Reconciliation | null;
  snapshotQuality: { repairedSnapshots: number; skippedSnapshots: number };
  latestAccountBreakdown: {
    id: string;
    alias: string;
    currency: string;
    totalAssets: number;
    totalAssetsUsd: number;
    cash: number;
    cashUsd: number;
    marketVal: number;
    marketValUsd: number;
    repaired: boolean;
  }[];
  accounts: Account[];
}

const CASH_KEY = "md-equity-cash-override";
const CCY_KEY = "md-equity-ccy";
const ACCT_KEY = "md-equity-account";
const W = 800;
const EQUITY_TOP = 14;
const EQUITY_H = 160;
const PNL_TOP = 212;
const PNL_H = 58;

type Ccy = "USD" | "MYR";

export default function EquityTimeline() {
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState(90);
  const [cashOverride, setCashOverride] = useState("");
  const [wantCcy, setWantCcy] = useState<Ccy>("USD");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  // "" = all LIVE accounts (the server's default aggregate — paper excluded).
  const [accountId, setAccountId] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCashOverride(window.localStorage.getItem(CASH_KEY) ?? "");
    const c = window.localStorage.getItem(CCY_KEY);
    if (c === "USD" || c === "MYR") setWantCcy(c);
    setAccountId(window.localStorage.getItem(ACCT_KEY) ?? "");
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const to = new Date().toISOString().slice(0, 10);
    const fromD = new Date();
    fromD.setUTCDate(fromD.getUTCDate() - windowDays);
    const acctQ = accountId ? `&accountId=${encodeURIComponent(accountId)}` : "";
    fetch(`/api/equity/timeline?from=${fromD.toISOString().slice(0, 10)}&to=${to}${acctQ}`, { cache: "no-store" })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => { if (!cancelled) { setData(j); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setError((e as Error).message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [windowDays, accountId]);

  function pickAccount(id: string) {
    setAccountId(id);
    if (typeof window === "undefined") return;
    if (id === "") window.localStorage.removeItem(ACCT_KEY);
    else window.localStorage.setItem(ACCT_KEY, id);
  }

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
  const ccy: Ccy = canConvert ? wantCcy : "USD";
  const sym = ccy === "MYR" ? "RM" : "$";

  const realized = useMemo(() => {
    const pts = data?.realized ?? [];
    return pts.map((p) => ({ date: p.date, v: ccy === "MYR" && fx ? p.value * fx : p.value }));
  }, [data, ccy, fx]);

  const brokerEquity = useMemo(() => {
    return (data?.accountValue ?? []).map((p) => ({ date: p.date, v: ccy === "MYR" && fx ? p.totalAssets * fx : p.totalAssets }));
  }, [data, ccy, fx]);

  const parsedCash = cashOverride.trim() !== "" ? Number(cashOverride) : null;
  const cashNum =
    parsedCash != null
      ? (Number.isFinite(parsedCash) ? parsedCash : null)
      : (data?.latestCash ?? null);
  const fallbackNetUsd = cashNum != null ? cashNum + (data?.positionsValue ?? 0) : null;
  const fallbackNet = fallbackNetUsd == null ? null : ccy === "MYR" && fx ? fallbackNetUsd * fx : fallbackNetUsd;
  const fallbackEquity = useMemo(() => {
    if (brokerEquity.length > 0 || fallbackNet == null) return [];
    const first = realized[0]?.date ?? new Date().toISOString().slice(0, 10);
    const last = realized[realized.length - 1]?.date ?? first;
    return first === last
      ? [{ date: first, v: fallbackNet }]
      : [{ date: first, v: fallbackNet }, { date: last, v: fallbackNet }];
  }, [brokerEquity, fallbackNet, realized]);
  const equity = brokerEquity.length > 0 ? brokerEquity : fallbackEquity;
  const usingBrokerTotal = brokerEquity.length > 0;

  const chart = useMemo(() => buildChartData(equity, realized), [equity, realized]);
  const equityDomain = useMemo(() => domain(equity.map((p) => p.v)), [equity]);
  const realizedDomain = useMemo(() => domain([...realized.map((p) => p.v), 0]), [realized]);
  const equityPath = useMemo(() => buildPath(chart.equity, equityDomain, EQUITY_TOP, EQUITY_H, chart.dates.length), [chart, equityDomain]);
  const realizedPath = useMemo(() => buildPath(chart.realized, realizedDomain, PNL_TOP, PNL_H, chart.dates.length), [chart, realizedDomain]);
  const equityStats = useMemo(() => computeStats(equity), [equity]);
  const realizedStats = useMemo(() => computeStats(realized), [realized]);
  const hover = hoverIndex == null ? null : chart.dates[hoverIndex] ? {
    date: chart.dates[hoverIndex],
    equity: valueAtOrBefore(equity, chart.dates[hoverIndex]),
    realized: valueAtOrBefore(realized, chart.dates[hoverIndex]),
    drawdown: drawdownAt(equity, chart.dates[hoverIndex]),
  } : null;

  function handleChartMove(e: MouseEvent<SVGSVGElement>) {
    if (chart.dates.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.max(0, Math.min(chart.dates.length - 1, Math.round((x / W) * (chart.dates.length - 1))));
    setHoverIndex(idx);
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="t-overline text-[var(--fg-3)]">Equity Timeline</p>
          <p className="t-caption">
            Broker account snapshots are normalized to USD first, then converted for display. Broker realized P&amp;L is
            net of fees; cash + live positions is shown as a diagnostic fallback.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={accountId}
            onChange={(e) => pickAccount(e.target.value)}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--fg-1)] focus:border-[var(--accent)] focus:outline-none"
            title="Account scope — the default aggregates live accounts only; paper accounts are viewable individually"
          >
            <option value="">All live accounts</option>
            {(data?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.alias}{a.isLive ? "" : " (PAPER)"}
              </option>
            ))}
          </select>
          <div className="inline-flex gap-1 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-raised)] p-1">
            {(["USD", "MYR"] as Ccy[]).map((c) => (
              <button
                key={c}
                onClick={() => pickCcy(c)}
                disabled={!canConvert && c === "MYR"}
                className={`rounded-[var(--radius-sm)] px-3 py-1 text-xs font-medium transition ${ccy === c ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "text-[var(--fg-3)] hover:text-[var(--fg-1)] disabled:opacity-40"}`}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="t-caption flex items-center gap-1.5">
            Fallback cash $
            <input
              type="number"
              value={cashOverride}
              onChange={(e) => saveCash(e.target.value)}
              placeholder={data?.latestCash != null ? String(data.latestCash) : "cash"}
              className="w-24 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-xs text-[var(--fg-1)] focus:border-[var(--accent)] focus:outline-none"
              title="Used only when no MooMoo account snapshot is available"
            />
          </label>
          {[30, 90, 180, 365].map((d) => (
            <button key={d} onClick={() => setWindowDays(d)} className={`mds-button ${windowDays === d ? "mds-button--primary" : ""}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {data && accountId !== "" && (
        <div className="rounded-[var(--radius-md)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--accent)]">Single-account view.</span>{" "}
          Showing {data.accounts.find((a) => a.id === accountId)?.alias ?? "the selected account"}
          {data.accounts.find((a) => a.id === accountId)?.isLive === false ? " — a PAPER account (excluded from the default all-accounts curve)" : ""}. {""}
          <button onClick={() => pickAccount("")} className="underline hover:text-[var(--fg-1)]">Back to all live accounts</button>
        </div>
      )}
      {data && !canConvert && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Live USD/MYR unavailable.</span>{" "}
          Showing everything in USD; switch to MYR once the rate is back.
        </div>
      )}
      {data && !usingBrokerTotal && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Broker account snapshot unavailable.</span>{" "}
          The chart is using cash + live-position value as a fallback until the bridge writes EquitySnapshot rows.
        </div>
      )}
      {data && usingBrokerTotal && data.reconciliation && (
        <div className="rounded-[var(--radius-md)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--accent)]">Broker total assets plotted.</span>{" "}
          Latest broker total{" "}
          <span className="t-mono">{data.reconciliation.brokerLatest != null ? `$${fmt(data.reconciliation.brokerLatest)}` : "n/a"}</span>
          {" "}vs cash + live positions{" "}
          <span className="t-mono">${fmt(data.reconciliation.expectedNet)}</span>
          {data.reconciliation.discrepancy != null ? (
            <>
              {" "}(diff{" "}
              <span className="t-mono">
                {data.reconciliation.discrepancy >= 0 ? "+" : "-"}${fmt(data.reconciliation.discrepancy)}
                {data.reconciliation.discrepancyPct != null ? `, ${data.reconciliation.discrepancyPct >= 0 ? "+" : ""}${data.reconciliation.discrepancyPct.toFixed(1)}%` : ""}
              </span>
              ).
            </>
          ) : "."}
        </div>
      )}
      {data && data.snapshotQuality.repairedSnapshots > 0 && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Snapshot repair applied.</span>{" "}
          {data.snapshotQuality.repairedSnapshots} MooMoo Malaysia snapshot{data.snapshotQuality.repairedSnapshots === 1 ? "" : "s"} used reconciled MYR cash + securities instead of the inconsistent broker total_assets field.
        </div>
      )}
      {data && data.latestAccountBreakdown.length > 0 && (
        <div className="grid gap-2 md:grid-cols-2">
          {data.latestAccountBreakdown.map((acct) => {
            const displayTotal = ccy === "MYR" && fx ? acct.totalAssetsUsd * fx : acct.totalAssetsUsd;
            return (
              <div key={acct.id} className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-raised)] p-3 text-xs text-[var(--fg-2)]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--fg-1)]">{acct.alias}</span>
                  <span className="t-mono">{sym}{fmt(displayTotal)}</span>
                </div>
                <p className="mt-1 text-[var(--fg-3)]">
                  Native {acct.currency}: {acct.currency === "MYR" ? "RM" : "$"}{fmt(acct.totalAssets)}
                  {acct.repaired ? " from cash + securities" : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {data && (data.positionsPricing.usedAvgCost > 0 || data.positionsPricing.usedPositionCache > 0 || data.positionsPricing.staleQuotes > 0) && (
        <div className="rounded-[var(--radius-md)] border border-[var(--warn-500)] p-3 text-xs text-[var(--fg-2)]">
          <span className="font-semibold text-[var(--warn-500)]">Position cross-check fallback.</span>{" "}
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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`${usingBrokerTotal ? "Broker total assets" : "Fallback net value"} (${ccy})`} value={equityStats.current != null ? `${sym}${fmt(equityStats.current)}` : "-"} />
        <Stat label={`Broker realized (${ccy})`} value={signed(realizedStats.current ?? 0, sym)} color={(realizedStats.current ?? 0) >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label={`${windowDays}d realized`} value={signed(realizedStats.change ?? 0, sym)} color={(realizedStats.change ?? 0) >= 0 ? "var(--gain-fg)" : "var(--loss-fg)"} />
        <Stat label="Max equity drawdown" value={equityStats.maxDd != null ? `-${sym}${fmt(equityStats.maxDd)}` : "-"} color="var(--loss-fg)" />
      </div>

      {data && data.realizedCurrency === "USD" && (
        <p className="t-caption text-[var(--fg-3)]">
          Broker realized (USD): gross ${fmt(data.realizedGrossUsd)} - fees ${fmt(data.realizedFeesUsd)} ={" "}
          net {data.realizedNetUsd >= 0 ? "+" : "-"}${fmt(data.realizedNetUsd)}. MooMoo deal history, FIFO, net of fees.
        </p>
      )}

      {loading ? (
        <p className="t-caption t-mono">Loading equity timeline...</p>
      ) : error ? (
        <p className="t-caption t-mono">Error: {error}</p>
      ) : equity.length === 0 && realized.length === 0 ? (
        <div className="border-t border-[var(--line)] pt-4">
          <p className="t-caption">No equity snapshots or broker fills in this window yet.</p>
        </div>
      ) : (
        <div className="border-t border-[var(--line)] pt-4">
          <svg
            viewBox="0 0 800 280"
            preserveAspectRatio="none"
            className="h-72 w-full cursor-crosshair"
            onMouseMove={handleChartMove}
            onMouseLeave={() => setHoverIndex(null)}
            role="img"
            aria-label="Equity timeline chart"
          >
            <rect x={0} y={0} width={800} height={280} fill="transparent" />
            <text x={0} y={10} fill="var(--fg-3)" fontSize={10}>Account equity</text>
            <line x1={0} y1={EQUITY_TOP + EQUITY_H} x2={800} y2={EQUITY_TOP + EQUITY_H} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {equityPath && <path d={equityPath} stroke="var(--fg-2)" strokeWidth={1.8} fill="none" vectorEffect="non-scaling-stroke" />}
            <text x={0} y={PNL_TOP - 8} fill="var(--fg-3)" fontSize={10}>Realized P&amp;L</text>
            <line x1={0} y1={zeroY(realizedDomain, PNL_TOP, PNL_H)} x2={800} y2={zeroY(realizedDomain, PNL_TOP, PNL_H)} stroke="var(--line)" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            {realizedPath && <path d={realizedPath} stroke="var(--accent)" strokeWidth={2} fill="none" vectorEffect="non-scaling-stroke" />}
            {hoverIndex != null && chart.dates[hoverIndex] && (
              <g>
                <line x1={xForIndex(hoverIndex, chart.dates.length)} y1={0} x2={xForIndex(hoverIndex, chart.dates.length)} y2={280} stroke="var(--accent)" strokeOpacity={0.45} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                {hover?.equity != null && (
                  <circle cx={xForIndex(hoverIndex, chart.dates.length)} cy={yFor(hover.equity, equityDomain, EQUITY_TOP, EQUITY_H)} r={3} fill="var(--fg-2)" />
                )}
                {hover?.realized != null && (
                  <circle cx={xForIndex(hoverIndex, chart.dates.length)} cy={yFor(hover.realized, realizedDomain, PNL_TOP, PNL_H)} r={3} fill="var(--accent)" />
                )}
              </g>
            )}
          </svg>
          <div className="mt-2 flex items-center justify-between gap-3 t-caption text-[var(--fg-3)]">
            <span>{chart.dates[0]}</span>
            <span className="flex flex-wrap items-center justify-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--fg-2)" }} />{usingBrokerTotal ? "Broker total assets" : "Fallback net"}</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--accent)" }} />Realized P&amp;L</span>
            </span>
            <span>{chart.dates[chart.dates.length - 1]}</span>
          </div>
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2 t-caption">
            {hover ? (
              <span>
                <span className="t-mono text-[var(--fg-1)]">{hover.date}</span>
                {" "}Equity <span className="t-mono text-[var(--fg-1)]">{hover.equity != null ? `${sym}${fmt(hover.equity)}` : "-"}</span>
                {" "}Realized <span className="t-mono" style={{ color: (hover.realized ?? 0) >= 0 ? "var(--gain-fg)" : "var(--loss-fg)" }}>{hover.realized != null ? signed(hover.realized, sym) : "-"}</span>
                {" "}Drawdown <span className="t-mono text-[var(--loss-fg)]">{hover.drawdown != null ? `-${sym}${fmt(hover.drawdown)}` : "-"}</span>
              </span>
            ) : (
              <span>Hover the chart for date, account equity, realized P&amp;L, and drawdown.</span>
            )}
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

function domain(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1];
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.01);
    min -= pad;
    max += pad;
  } else {
    const pad = (max - min) * 0.08;
    min -= pad;
    max += pad;
  }
  return [min, max];
}

function xForIndex(index: number, total: number): number {
  return total <= 1 ? W / 2 : (index / (total - 1)) * W;
}

function yFor(v: number, [min, max]: [number, number], top: number, height: number): number {
  const range = max - min || 1;
  return top + height - ((v - min) / range) * height;
}

function zeroY(domainVals: [number, number], top: number, height: number): number {
  return yFor(0, domainVals, top, height);
}

function buildPath(
  points: { i: number; v: number }[],
  domainVals: [number, number],
  top: number,
  height: number,
  totalDates: number,
): string {
  if (points.length === 0) return "";
  return points
    .map((p, n) => {
      const x = xForIndex(p.i, totalDates);
      const y = yFor(p.v, domainVals, top, height);
      return `${n === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function buildChartData(equity: { date: string; v: number }[], realized: { date: string; v: number }[]) {
  const dates = Array.from(new Set([...equity.map((p) => p.date), ...realized.map((p) => p.date)])).sort();
  return {
    dates,
    equity: dates
      .map((date, i) => ({ i, v: valueAtOrBefore(equity, date) }))
      .filter((p): p is { i: number; v: number } => p.v != null),
    realized: dates
      .map((date, i) => ({ i, v: valueAtOrBefore(realized, date) }))
      .filter((p): p is { i: number; v: number } => p.v != null),
  };
}

function valueAtOrBefore(points: { date: string; v: number }[], date: string): number | null {
  let out: number | null = null;
  for (const p of points) {
    if (p.date > date) break;
    out = p.v;
  }
  return out;
}

function drawdownAt(points: { date: string; v: number }[], date: string): number | null {
  let peak: number | null = null;
  let current: number | null = null;
  for (const p of points) {
    if (p.date > date) break;
    peak = peak == null ? p.v : Math.max(peak, p.v);
    current = p.v;
  }
  return peak == null || current == null ? null : Math.max(0, peak - current);
}

function computeStats(points: { date: string; v: number }[]) {
  if (points.length === 0) return { current: null as number | null, change: null as number | null, maxDd: null as number | null };
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
  return { current, change: current - first, maxDd };
}
