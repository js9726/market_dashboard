"use client";

import { useEffect, useMemo, useState } from "react";

interface ScreenerPick {
  operatorLabel: string;
  date: string;
  ticker: string;
  setupClassification: string | null;
  screenSource: string;
  notes: string | null;
  sourceUrl: string | null;
  convertedTradeId: string | null;
}

interface ScreenerPayload {
  operators: string[];
  sources: string[];
  counts: {
    total: number;
    converted: number;
    conversionPct: number;
    bySource: Record<string, number>;
  };
  picks: ScreenerPick[];
}

export default function ScreenerView() {
  const [data, setData] = useState<ScreenerPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operatorFilter, setOperatorFilter] = useState<string | "ALL">("ALL");
  const [sourceFilter, setSourceFilter] = useState<string | "ALL">("ALL");

  useEffect(() => {
    fetch("/api/wiki/screener", { cache: "no-store" })
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
        setData(payload);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "load failed"));
  }, []);

  const filteredPicks = useMemo(() => {
    if (!data) return [];
    return data.picks.filter((p) => {
      if (operatorFilter !== "ALL" && p.operatorLabel !== operatorFilter) return false;
      if (sourceFilter !== "ALL" && p.screenSource !== sourceFilter) return false;
      return true;
    });
  }, [data, operatorFilter, sourceFilter]);

  const showOpPicker = (data?.operators?.length ?? 0) > 1;
  const showSourcePicker = (data?.sources?.length ?? 0) > 1;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Screener History</p>
          <p className="t-caption">
            Daily screener picks — lightweight snapshots (no LLM scoring per row). Conversion rate
            tracks how many made it into your journal. Wire your screener workflow to POST to{" "}
            <code>/api/wiki/audits/ingest</code> with a <code>screenerPicks</code> array, or feed
            JSON files into <code>npm run sync:wiki -- --post</code>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showOpPicker ? (
            <div className="flex items-center gap-2">
              <label htmlFor="screener-op" className="t-caption">Operator</label>
              <select
                id="screener-op"
                value={operatorFilter}
                onChange={(e) => setOperatorFilter(e.target.value)}
                className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
              >
                <option value="ALL">All</option>
                {data?.operators.map((op) => <option key={op} value={op}>{op}</option>)}
              </select>
            </div>
          ) : null}
          {showSourcePicker ? (
            <div className="flex items-center gap-2">
              <label htmlFor="screener-source" className="t-caption">Source</label>
              <select
                id="screener-source"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
              >
                <option value="ALL">All</option>
                {data?.sources.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p>
      ) : null}

      {data ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Picks (last 60d)" value={data.counts.total.toString()} />
          <Stat label="Converted to trades" value={data.counts.converted.toString()} />
          <Stat label="Conversion rate" value={`${data.counts.conversionPct}%`} />
          <Stat label="Sources" value={data.sources.length.toString()} />
        </div>
      ) : null}

      {!data ? (
        <p className="t-body-small text-[var(--fg-3)]">Loading screener picks…</p>
      ) : filteredPicks.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--line)] p-4 t-body-small text-[var(--fg-3)]">
          <p className="mb-2">No screener picks logged yet.</p>
          <p>
            Each daily TradingView / Qullamaggie scan should POST a list of picks to{" "}
            <code>/api/wiki/audits/ingest</code> like:
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-raised)] p-2 font-mono text-[11px]">
{`{
  "screenerPicks": [
    {
      "operatorLabel": "JS",
      "pickDate": "2026-05-25",
      "ticker": "NVDA",
      "setupClassification": "BO-CB",
      "screenSource": "qullamaggie-ep",
      "notes": "RVOL 2.8x, holding 21EMA"
    }
  ]
}`}
          </pre>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-3 font-bold">Date</th>
                <th className="px-3 py-2 font-bold">Op</th>
                <th className="px-3 py-2 font-bold">Ticker</th>
                <th className="px-3 py-2 font-bold">Setup</th>
                <th className="px-3 py-2 font-bold">Source</th>
                <th className="px-3 py-2 font-bold">Notes</th>
                <th className="py-2 pl-3 font-bold">Converted</th>
              </tr>
            </thead>
            <tbody>
              {filteredPicks.map((p, i) => (
                <tr key={i} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 pr-3 font-mono text-[var(--fg-2)]">{p.date}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-[var(--fg-2)]">
                      {p.operatorLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2 t-ticker">{p.ticker}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--accent)]">
                    {p.setupClassification ?? "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--fg-2)]">{p.screenSource}</td>
                  <td className="px-3 py-2 text-[var(--fg-1)]">{p.notes ?? "—"}</td>
                  <td className="py-2 pl-3">
                    {p.convertedTradeId ? (
                      <span className="inline-flex items-center rounded bg-[var(--gain-bg)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--gain-fg)]">
                        ✓
                      </span>
                    ) : (
                      <span className="text-[var(--fg-3)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-3">
      <p className="t-overline">{label}</p>
      <p className="mt-1 text-xl font-bold">{value}</p>
    </div>
  );
}
