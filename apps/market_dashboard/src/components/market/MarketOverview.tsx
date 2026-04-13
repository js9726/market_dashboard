"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MacroEvent, MarketMeta, MarketSnapshot, TickerRow } from "@/types/market-dashboard";

const BASE = "/market-dashboard";

function chartSrc(rsChart: string | null | undefined): string | null {
  if (!rsChart) return null;
  return `${BASE}/${rsChart.replace(/^data\//, "")}`;
}

function cellClass(v: number | null | undefined): string {
  if (v == null) return "text-slate-400";
  if (v > 0) return "text-emerald-400 font-medium";
  if (v < 0) return "text-red-400 font-medium";
  return "text-slate-300";
}

function AbcBadge({ abc }: { abc: string | null }) {
  if (!abc) return <span className="text-slate-500">—</span>;
  const cls =
    abc === "A"
      ? "bg-blue-600"
      : abc === "B"
        ? "bg-emerald-600"
        : "bg-amber-600";
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white ${cls}`}
    >
      {abc}
    </span>
  );
}

export default function MarketOverview() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [events, setEvents] = useState<MacroEvent[]>([]);
  const [meta, setMeta] = useState<MarketMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, e, m] = await Promise.all([
          fetch(`${BASE}/snapshot.json`),
          fetch(`${BASE}/events.json`),
          fetch(`${BASE}/meta.json`),
        ]);
        if (!s.ok) throw new Error(`snapshot ${s.status}`);
        if (!e.ok) throw new Error(`events ${e.status}`);
        if (!m.ok) throw new Error(`meta ${m.status}`);
        const [sj, ej, mj] = await Promise.all([s.json(), e.json(), m.json()]);
        if (!cancelled) {
          setSnapshot(sj);
          setEvents(Array.isArray(ej) ? ej : []);
          setMeta(mj);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load market data",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const indicesChart = useMemo(() => {
    const rows: TickerRow[] = snapshot?.groups?.Indices ?? [];
    return rows
      .map((r: TickerRow) => ({
        ticker: r.ticker,
        daily: r.daily ?? 0,
      }))
      .sort(
        (a: { ticker: string; daily: number }, b: { ticker: string; daily: number }) =>
          b.daily - a.daily,
      );
  }, [snapshot]);

  if (error) {
    return (
      <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-4 text-amber-100">
        <p className="font-medium">Market snapshot not available</p>
        <p className="mt-2 text-sm text-amber-200/90">
          Refresh pipeline data, then sync into this app: from{" "}
          <code className="rounded bg-black/30 px-1">apps/market_dashboard</code> run{" "}
          <code className="rounded bg-black/30 px-1">npm run sync:market</code>
        </p>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="text-slate-400">Loading market snapshot…</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-slate-400">
          Data as of{" "}
          <time className="text-slate-200">
            {new Date(snapshot.built_at).toLocaleString()}
          </time>
        </p>
        {meta?.default_symbol && (
          <p className="text-xs text-slate-500">
            Default chart symbol (static site): {meta.default_symbol}
          </p>
        )}
      </div>

      <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
          Indices — daily % (bar)
        </h3>
        <div className="h-64 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={indicesChart} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="ticker" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis
                tick={{ fill: "#94a3b8", fontSize: 11 }}
                tickFormatter={(v: number) => `${v}%`}
              />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155" }}
                labelStyle={{ color: "#e2e8f0" }}
                formatter={(v: number | string) => [
                  `${typeof v === "number" ? v.toFixed(2) : v}%`,
                  "Daily",
                ]}
              />
              <Bar dataKey="daily" radius={[4, 4, 0, 0]}>
                {indicesChart.map((entry: { ticker: string; daily: number }) => (
                  <Cell
                    key={entry.ticker}
                    fill={entry.daily >= 0 ? "#10b981" : "#ef4444"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {events.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/80 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Macro events (next week)
          </h3>
          <ul className="max-h-48 space-y-2 overflow-y-auto text-sm">
            {events.map((ev, i) => (
              <li
                key={`${ev.date}-${i}`}
                className="flex flex-wrap gap-2 border-b border-slate-800/80 pb-2 last:border-0"
              >
                <span className="text-indigo-300">
                  {ev.date} {ev.time}
                </span>
                <span className="text-slate-300">{ev.event}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(Object.entries(snapshot.groups) as [string, TickerRow[]][]).map(
        ([groupName, rows]) => (
        <details
          key={groupName}
          className="group rounded-xl border border-slate-800 bg-slate-950/50 open:bg-slate-950/80"
          open={groupName === "Indices"}
        >
          <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-slate-200 marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="inline-flex items-center gap-2">
              <span className="text-slate-400">▸</span>
              {groupName}
              <span className="text-xs font-normal text-slate-500">
                ({rows.length} tickers)
              </span>
            </span>
          </summary>
          <div className="overflow-x-auto px-2 pb-4">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="p-2">Ticker</th>
                  <th className="p-2">Day</th>
                  <th className="p-2">Intra</th>
                  <th className="p-2">5d</th>
                  <th className="p-2">20d</th>
                  <th className="p-2">ATR%</th>
                  <th className="p-2">Dist/ATR</th>
                  <th className="p-2">RS</th>
                  <th className="p-2">ABC</th>
                  <th className="p-2">RRS</th>
                  <th className="p-2">Leveraged</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.ticker} className="border-b border-slate-800/80 hover:bg-slate-900/50">
                    <td className="p-2 font-mono text-slate-200">{r.ticker}</td>
                    <td className={`p-2 tabular-nums ${cellClass(r.daily)}`}>
                      {r.daily != null ? `${r.daily > 0 ? "+" : ""}${r.daily.toFixed(2)}%` : "—"}
                    </td>
                    <td className={`p-2 tabular-nums ${cellClass(r.intra)}`}>
                      {r.intra != null ? `${r.intra > 0 ? "+" : ""}${r.intra.toFixed(2)}%` : "—"}
                    </td>
                    <td className={`p-2 tabular-nums ${cellClass(r["5d"])}`}>
                      {r["5d"] != null ? `${r["5d"] > 0 ? "+" : ""}${r["5d"].toFixed(2)}%` : "—"}
                    </td>
                    <td className={`p-2 tabular-nums ${cellClass(r["20d"])}`}>
                      {r["20d"] != null ? `${r["20d"] > 0 ? "+" : ""}${r["20d"].toFixed(2)}%` : "—"}
                    </td>
                    <td className="p-2 tabular-nums text-slate-300">
                      {r.atr_pct != null ? `${r.atr_pct.toFixed(1)}%` : "—"}
                    </td>
                    <td className="p-2 tabular-nums text-slate-300">
                      {r.dist_sma50_atr != null ? r.dist_sma50_atr.toFixed(2) : "—"}
                    </td>
                    <td className="p-2 tabular-nums text-slate-300">
                      {r.rs != null ? r.rs.toFixed(0) : "—"}
                    </td>
                    <td className="p-2">
                      <AbcBadge abc={r.abc} />
                    </td>
                    <td className="p-2">
                      {chartSrc(r.rs_chart) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={chartSrc(r.rs_chart)!}
                          alt={`${r.ticker} RRS`}
                          className="h-8 max-w-[100px] object-contain"
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="p-2 text-xs text-slate-400">
                      {r.long?.length ? (
                        <span className="text-emerald-400">{r.long.join(", ")}</span>
                      ) : null}
                      {r.long?.length && r.short?.length ? " / " : null}
                      {r.short?.length ? (
                        <span className="text-red-400">{r.short.join(", ")}</span>
                      ) : null}
                      {!r.long?.length && !r.short?.length ? "—" : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )
      )}
    </div>
  );
}
