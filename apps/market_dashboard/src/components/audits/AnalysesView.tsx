"use client";

import { useEffect, useMemo, useState } from "react";

interface AnalysisRow {
  operatorLabel: string;
  date: string;
  ticker: string;
  setupClassification: string | null;
  compositeScore: number | null;
  bestStyleMatch: string | null;
  hotTheme: string | null;
  catalysts: string[];
  upcomingCatalysts: { date: string | null; type: string; description: string }[];
  verdictUrl: string;
  ingestedAt: string;
}

interface AnalysesPayload {
  operators: string[];
  count: number;
  analyses: AnalysisRow[];
}

function scoreClass(value: number | null): string {
  if (value == null) return "text-[var(--fg-3)]";
  if (value >= 7.0) return "gain";
  if (value <= 4.5) return "loss";
  return "text-[var(--fg-2)]";
}

function fmtScore(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return value.toFixed(1);
}

function firstText(rows: string[] | null | undefined): string {
  return rows?.find(Boolean) ?? "-";
}

function upcomingText(rows: AnalysisRow["upcomingCatalysts"]): string {
  const first = rows?.[0];
  if (!first) return "-";
  return `${first.date ?? "undated"} ${first.type}: ${first.description}`;
}

export default function AnalysesView() {
  const [data, setData] = useState<AnalysesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<string | "ALL">("ALL");

  useEffect(() => {
    fetch("/api/wiki/analyses", { cache: "no-store" })
      .then(async (r) => {
        const payload = await r.json();
        if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
        setData(payload);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "load failed"));
  }, []);

  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (selectedOperator === "ALL") return data.analyses;
    return data.analyses.filter((r) => r.operatorLabel === selectedOperator);
  }, [data, selectedOperator]);

  const showOperatorPicker = (data?.operators?.length ?? 0) > 1;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Analysis History</p>
          <p className="t-caption">
            Ad-hoc ticker scores from chat (<code>intent=analysis</code>) — separate from journaled
            trades so they don&apos;t pollute the monthly audit. To add a row, run{" "}
            <code>python scripts/audit_trades.py --analyse TICKER --date YYYY-MM-DD</code> then{" "}
            <code>npm run sync:wiki -- --post</code>.
          </p>
        </div>
        {showOperatorPicker ? (
          <div className="flex items-center gap-2">
            <label htmlFor="analyses-op-select" className="t-caption">Operator</label>
            <select
              id="analyses-op-select"
              value={selectedOperator}
              onChange={(e) => setSelectedOperator(e.target.value as string)}
              className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
            >
              <option value="ALL">All</option>
              {data?.operators.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p>
      ) : null}

      {!data ? (
        <p className="t-body-small text-[var(--fg-3)]">Loading analyses…</p>
      ) : filteredRows.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--line)] p-4 t-body-small text-[var(--fg-3)]">
          No ad-hoc analyses yet. Once you ask the <code>trade-analyser</code> skill to score a
          ticker that isn&apos;t in your journal, it&apos;ll show up here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-3 font-bold">Ticker</th>
                <th className="px-3 py-2 font-bold">Date</th>
                <th className="px-3 py-2 font-bold">Setup</th>
                <th className="px-3 py-2 font-bold">Theme</th>
                <th className="px-3 py-2 font-bold">Catalyst</th>
                <th className="px-3 py-2 font-bold">Next event</th>
                <th className="px-3 py-2 text-right font-bold">Score</th>
                <th className="px-3 py-2 font-bold">Best style</th>
                <th className="py-2 pl-3 font-bold">JSON</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map((r) => (
                <tr key={`${r.operatorLabel}_${r.date}_${r.ticker}`} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 pr-3">
                    <span className="t-ticker mr-2">{r.ticker}</span>
                    <span
                      className="inline-flex items-center rounded bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--fg-2)]"
                      title={`Operator: ${r.operatorLabel}`}
                    >
                      {r.operatorLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[var(--fg-2)]">{r.date}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--accent)]">
                    {r.setupClassification ?? "—"}
                  </td>
                  <td className="max-w-[190px] px-3 py-2 text-[var(--fg-2)]">
                    <span title={r.hotTheme ?? undefined} className="line-clamp-2">{r.hotTheme ?? "-"}</span>
                  </td>
                  <td className="max-w-[220px] px-3 py-2 text-[var(--fg-2)]">
                    <span title={firstText(r.catalysts)} className="line-clamp-2">{firstText(r.catalysts)}</span>
                  </td>
                  <td className="max-w-[240px] px-3 py-2 text-[var(--fg-2)]">
                    <span title={upcomingText(r.upcomingCatalysts)} className="line-clamp-2">{upcomingText(r.upcomingCatalysts)}</span>
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${scoreClass(r.compositeScore)}`}>
                    {fmtScore(r.compositeScore)}
                  </td>
                  <td className="px-3 py-2 text-[var(--fg-1)]">{r.bestStyleMatch ?? "—"}</td>
                  <td className="py-2 pl-3">
                    <a className="text-[var(--accent)] hover:underline" href={r.verdictUrl} target="_blank" rel="noreferrer">day0</a>
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
