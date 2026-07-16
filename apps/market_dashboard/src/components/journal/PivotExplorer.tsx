"use client";

/**
 * PivotExplorer — "group my trades by ANY field and chart it" (TradesViz-platform
 * P2). The client for /api/analytics/pivot: pick a dimension, get every metric
 * per group, sorted, with proportional bars. Two clicks from "how do I do on
 * Fridays?" to the answer.
 *
 * Bars are CSS-width (no chart dependency) so this page can't break on a lib
 * upgrade. Saved layouts / custom dashboards land on top of this (Codex, P2-🄲).
 */
import { useEffect, useMemo, useState } from "react";

type PivotRow = {
  key: string;
  count: number;
  pricedCount: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number | null;
  expectancy: number | null;
  profitFactor: number | null;
  avgRrr: number | null;
  best: number | null;
  worst: number | null;
};
type PivotResp = {
  groupBy: string;
  sort: string;
  dimensions: string[];
  sorts: string[];
  rows: PivotRow[];
  totals: { trades: number; measuredTrades: number; totalPnl: number; winRate: number | null; unconvertedExcluded: number };
  dataQuality?: { weekendDated: number; weekendSample: string[]; warning: string | null };
  note: string;
};

const DIM_LABEL: Record<string, string> = {
  ticker: "Ticker",
  side: "Side (long/short)",
  strategy: "Strategy",
  source: "Source (manual/CSV/bridge)",
  platform: "Broker",
  industry: "Industry",
  currency: "Currency",
  tag: "Tag",
  mistake: "Mistake",
  dow: "Day of week",
  month: "Month",
};
const SORT_LABEL: Record<string, string> = {
  totalPnl: "Total P&L",
  count: "Trades",
  winRate: "Win rate",
  expectancy: "Expectancy",
  profitFactor: "Profit factor",
};

function fmt(n: number | null | undefined, digits = 0, sign = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return sign && n > 0 ? `+${s}` : s;
}
function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[var(--fg-2)]";
  return n > 0 ? "gain" : "loss";
}

export default function PivotExplorer() {
  const [groupBy, setGroupBy] = useState("strategy");
  const [sort, setSort] = useState("totalPnl");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<PivotResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ groupBy, sort });
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    fetch(`/api/analytics/pivot?${qs}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((j) => !off && (setData(j), setLoading(false)))
      .catch((e) => !off && (setError((e as Error).message), setLoading(false)));
    return () => {
      off = true;
    };
  }, [groupBy, sort, from, to]);

  // Bar scale on the sorted metric (abs, so losses render too).
  const maxAbs = useMemo(() => {
    if (!data?.rows.length) return 1;
    const vals = data.rows.map((r) => {
      const v = r[sort as keyof PivotRow];
      return typeof v === "number" ? Math.abs(v) : 0;
    });
    return Math.max(1, ...vals);
  }, [data, sort]);

  const selectCls =
    "rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-[var(--fg-1)] outline-none focus:border-[var(--accent)]";

  return (
    <div className="space-y-4">
      {/* Controls */}
      <section className="market-panel flex flex-wrap items-end gap-3 p-4">
        <label className="t-caption text-[var(--fg-3)]">
          Group by
          <br />
          <select className={`${selectCls} mt-1`} value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {(data?.dimensions ?? Object.keys(DIM_LABEL)).map((d) => (
              <option key={d} value={d}>
                {DIM_LABEL[d] ?? d}
              </option>
            ))}
          </select>
        </label>
        <label className="t-caption text-[var(--fg-3)]">
          Sort by
          <br />
          <select className={`${selectCls} mt-1`} value={sort} onChange={(e) => setSort(e.target.value)}>
            {(data?.sorts ?? Object.keys(SORT_LABEL)).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="t-caption text-[var(--fg-3)]">
          From
          <br />
          <input type="date" className={`${selectCls} mt-1`} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="t-caption text-[var(--fg-3)]">
          To
          <br />
          <input type="date" className={`${selectCls} mt-1`} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {(from || to) && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
            }}
            className="rounded-[var(--radius-sm)] border border-[var(--line)] px-2 py-1.5 text-xs text-[var(--fg-2)] hover:text-[var(--fg-1)]"
          >
            Clear dates
          </button>
        )}
      </section>

      {/* Totals */}
      {data && (
        <section className="market-panel flex flex-wrap items-center gap-5 p-4">
          <span className="t-caption">
            <strong className="font-mono text-[var(--fg-1)]">{data.totals.trades}</strong> closed trades
          </span>
          <span className="t-caption">
            Total P&L{" "}
            <strong className={`font-mono ${tone(data.totals.totalPnl)}`}>{fmt(data.totals.totalPnl, 0, true)}</strong>
          </span>
          <span className="t-caption">
            Win rate <strong className="font-mono text-[var(--fg-1)]">{data.totals.winRate ?? "—"}%</strong>
          </span>
          {data.totals.unconvertedExcluded > 0 && (
            <span className="t-caption text-[var(--warn-fg,#f59e0b)]" title="Non-USD trades with no FX rate are counted but excluded from money metrics — currency-truth rule">
              ⚠ {data.totals.unconvertedExcluded} unconverted (excluded from $ metrics)
            </span>
          )}
        </section>
      )}

      {/* Data-quality warning — surfaced, never silently applied */}
      {data?.dataQuality?.warning && (
        <section className="market-panel border-l-2 border-[var(--warn-fg,#f59e0b)] p-4">
          <p className="t-caption text-[var(--fg-2)]">
            <strong className="text-[var(--warn-fg,#f59e0b)]">⚠ Data quality:</strong> {data.dataQuality.warning}
          </p>
          {data.dataQuality.weekendSample.length > 0 && (
            <p className="t-caption mt-1 font-mono text-[var(--fg-3)]">{data.dataQuality.weekendSample.join(" · ")}</p>
          )}
        </section>
      )}

      {/* Rows */}
      <section className="market-panel p-4">
        {loading ? (
          <p className="t-caption text-[var(--fg-3)]">Loading…</p>
        ) : error ? (
          <p className="t-caption text-[var(--loss-fg)]">Failed: {error}</p>
        ) : !data?.rows.length ? (
          <p className="t-caption text-[var(--fg-3)]">
            No closed trades in this range yet — pivot needs realized outcomes to measure.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-[var(--fg-3)]">
                  <th className="py-2 pr-3 text-left font-medium">{DIM_LABEL[data.groupBy] ?? data.groupBy}</th>
                  <th className="px-2 py-2 text-left font-medium">{SORT_LABEL[sort] ?? sort}</th>
                  <th className="px-2 py-2 text-right font-medium">Trades</th>
                  <th className="px-2 py-2 text-right font-medium">Win%</th>
                  <th className="px-2 py-2 text-right font-medium">Total P&L</th>
                  <th className="px-2 py-2 text-right font-medium">Expectancy</th>
                  <th className="px-2 py-2 text-right font-medium">PF</th>
                  <th className="px-2 py-2 text-right font-medium">Avg RRR</th>
                  <th className="py-2 pl-2 text-right font-medium">Best / Worst</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const v = r[sort as keyof PivotRow];
                  const val = typeof v === "number" ? v : 0;
                  const pct = Math.min(100, (Math.abs(val) / maxAbs) * 100);
                  return (
                    <tr key={r.key} className="border-b border-[var(--line)]/50">
                      <td className="py-2 pr-3 font-semibold text-[var(--fg-1)]">{r.key}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--bg-raised)]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                background: val >= 0 ? "var(--gain-fg, #16a34a)" : "var(--loss-fg, #dc2626)",
                              }}
                            />
                          </div>
                          <span className={`font-mono text-xs ${sort === "totalPnl" || sort === "expectancy" ? tone(val) : "text-[var(--fg-2)]"}`}>
                            {fmt(val, sort === "winRate" || sort === "profitFactor" ? 1 : 0, sort === "totalPnl" || sort === "expectancy")}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[var(--fg-2)]">{r.count}</td>
                      <td className={`px-2 py-2 text-right font-mono ${r.winRate != null && r.winRate >= 50 ? "gain" : "text-[var(--fg-2)]"}`}>
                        {r.winRate == null ? "—" : `${r.winRate}%`}
                      </td>
                      <td className={`px-2 py-2 text-right font-mono ${tone(r.totalPnl)}`}>{fmt(r.totalPnl, 0, true)}</td>
                      <td className={`px-2 py-2 text-right font-mono ${tone(r.expectancy)}`}>{fmt(r.expectancy, 0, true)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[var(--fg-2)]">{r.profitFactor == null ? "∞" : fmt(r.profitFactor, 2)}</td>
                      <td className="px-2 py-2 text-right font-mono text-[var(--fg-2)]">{r.avgRrr == null ? "—" : fmt(r.avgRrr, 2)}</td>
                      <td className="py-2 pl-2 text-right font-mono text-xs text-[var(--fg-3)]">
                        <span className="gain">{fmt(r.best, 0, true)}</span> / <span className="loss">{fmt(r.worst, 0, true)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.note && <p className="t-caption mt-3 text-[var(--fg-3)]">{data.note}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
