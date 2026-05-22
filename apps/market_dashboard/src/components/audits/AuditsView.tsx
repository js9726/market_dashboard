"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AuditReport, WikiManifest } from "@/lib/wiki/audits";

function gradeTone(grade: "A" | "B" | "C"): { bg: string; fg: string } {
  switch (grade) {
    case "A": return { bg: "var(--gain-bg)", fg: "var(--gain-fg)" };
    case "B": return { bg: "var(--accent-soft-bg)", fg: "var(--accent)" };
    case "C": return { bg: "var(--loss-bg)", fg: "var(--loss-fg)" };
  }
}

function pctClass(value: number | null): string {
  if (value == null) return "text-[var(--fg-3)]";
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "text-[var(--fg-2)]";
}

function formatPct(value: number | null): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default function AuditsView() {
  const [manifest, setManifest] = useState<WikiManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [report, setReport] = useState<AuditReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  // 1) load manifest
  useEffect(() => {
    let cancelled = false;
    fetch("/api/wiki/audits", { cache: "no-store" })
      .then(async (r) => {
        const payload = (await r.json()) as WikiManifest & { error?: string };
        if (!r.ok && r.status !== 503) throw new Error(payload.error ?? `HTTP ${r.status}`);
        if (cancelled) return;
        setManifest(payload);
        if (payload.error) setManifestError(payload.error);
        // Auto-select the latest audit
        if (payload.audits?.length) setSelectedPeriod(payload.audits[0].period);
      })
      .catch((e) => {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 2) load selected report
  const loadReport = useCallback(async (period: string) => {
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    try {
      const r = await fetch(`/api/wiki/audits/${encodeURIComponent(period)}`, { cache: "no-store" });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
      setReport(payload as AuditReport);
    } catch (e) {
      setReportError(e instanceof Error ? e.message : "load failed");
    } finally {
      setReportLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedPeriod) loadReport(selectedPeriod);
  }, [selectedPeriod, loadReport]);

  const tradesByDateTicker = useMemo(() => {
    const m = new Map<string, { day0_url?: string; day14_url?: string }>();
    for (const t of manifest?.trades ?? []) {
      m.set(`${t.date}_${t.ticker}`, { day0_url: t.day0_url, day14_url: t.day14_url });
    }
    return m;
  }, [manifest]);

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Trade Audits</p>
          <p className="t-caption">
            Monthly grade-A/B/C breakdown of past trades vs the wiki rubric. Sourced from{" "}
            <code>llm_traders_wiki/verdicts/js/_audit_YYYY-MM.md</code> via{" "}
            <code>npm run sync:wiki -- --post</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="period-select" className="t-caption">Month</label>
          <select
            id="period-select"
            value={selectedPeriod ?? ""}
            disabled={!manifest?.audits?.length}
            onChange={(e) => setSelectedPeriod(e.target.value || null)}
            className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
          >
            {manifest?.audits?.length ? (
              manifest.audits.map((a) => (
                <option key={a.period} value={a.period}>{a.period}</option>
              ))
            ) : (
              <option value="">no audits</option>
            )}
          </select>
        </div>
      </div>

      {manifestError ? (
        <p className="mb-3 t-caption text-[var(--loss-fg)]">{manifestError}</p>
      ) : null}

      {!manifest ? (
        <p className="t-body-small text-[var(--fg-3)]">Loading manifest…</p>
      ) : !manifest.audits?.length ? (
        <p className="t-body-small text-[var(--fg-3)]">
          No audits synced yet. From <code>apps/market_dashboard/</code> run{" "}
          <code>npm run sync:wiki -- --post</code> to ingest the wiki verdicts.
        </p>
      ) : reportLoading ? (
        <p className="t-body-small text-[var(--fg-3)]">Loading {selectedPeriod}…</p>
      ) : reportError ? (
        <p className="t-body-small text-[var(--loss-fg)]">Failed: {reportError}</p>
      ) : report ? (
        <AuditDetail report={report} tradesByDateTicker={tradesByDateTicker} />
      ) : null}
    </section>
  );
}

function AuditDetail({
  report,
  tradesByDateTicker,
}: {
  report: AuditReport;
  tradesByDateTicker: Map<string, { day0_url?: string; day14_url?: string }>;
}) {
  const driftPct =
    report.tradesReviewed != null && report.tradesReviewed > 0 && report.driftCases != null
      ? Math.round((report.driftCases / report.tradesReviewed) * 100)
      : null;

  return (
    <div className="space-y-5">
      {/* Header stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Trades reviewed" value={report.tradesReviewed?.toString() ?? "-"} />
        <Stat
          label="Grade A / B / C"
          value={`${report.gradeCounts.A} / ${report.gradeCounts.B} / ${report.gradeCounts.C}`}
        />
        <Stat
          label="Drift cases"
          value={`${report.driftCases ?? "-"}${driftPct != null ? ` (${driftPct}%)` : ""}`}
        />
        <Stat label="Period" value={report.period} mono />
      </div>

      {/* Trade rows grouped by grade */}
      <div className="space-y-4">
        {(["A", "B", "C"] as const).map((g) => {
          const rows = report.trades.filter((t) => t.grade === g);
          if (rows.length === 0) return null;
          const tone = gradeTone(g);
          return (
            <div key={g}>
              <div className="mb-2 flex items-center gap-2">
                <span
                  className="inline-flex h-6 w-6 items-center justify-center rounded font-mono text-[11px] font-bold"
                  style={{ background: tone.bg, color: tone.fg }}
                >
                  {g}
                </span>
                <h3 className="text-[13px] font-bold uppercase tracking-[0.1em]">
                  Grade {g} — {rows.length}
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[12px]">
                  <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
                    <tr className="border-b border-[var(--line)]">
                      <th className="py-2 pr-3 font-bold">Ticker</th>
                      <th className="px-3 py-2 font-bold">Date</th>
                      <th className="px-3 py-2 text-right font-bold">14d</th>
                      <th className="px-3 py-2 font-bold">Outcome</th>
                      <th className="py-2 pl-3 font-bold">Verdict JSON</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const links = tradesByDateTicker.get(`${t.date}_${t.ticker}`);
                      return (
                        <tr key={`${t.date}_${t.ticker}`} className="border-b border-[var(--line)] last:border-0">
                          <td className="py-2 pr-3 t-ticker">{t.ticker}</td>
                          <td className="px-3 py-2 font-mono text-[var(--fg-2)]">{t.date}</td>
                          <td className={`px-3 py-2 text-right font-mono ${pctClass(t.pctIn14d)}`}>
                            {formatPct(t.pctIn14d)}
                          </td>
                          <td className="px-3 py-2 text-[var(--fg-1)]">{t.outcome}</td>
                          <td className="py-2 pl-3">
                            {links?.day0_url ? (
                              <a className="text-[var(--accent)] hover:underline" href={links.day0_url} target="_blank" rel="noreferrer">day0</a>
                            ) : null}
                            {links?.day0_url && links?.day14_url ? <span className="mx-1 text-[var(--fg-3)]">·</span> : null}
                            {links?.day14_url ? (
                              <a className="text-[var(--accent)] hover:underline" href={links.day14_url} target="_blank" rel="noreferrer">day14</a>
                            ) : null}
                            {!links?.day0_url && !links?.day14_url ? (
                              <span className="text-[var(--fg-3)]">-</span>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>

      {/* Suggestions */}
      {report.suggestions.length > 0 ? (
        <div>
          <h3 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em]">
            Suggested wiki updates
          </h3>
          <ul className="space-y-2">
            {report.suggestions.map((s, i) => (
              <li key={i} className="rounded border border-[var(--line)] bg-[var(--bg-raised)] p-3 text-[12px]">
                <span className="inline-flex rounded bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--accent)]">
                  {s.rubric}
                </span>
                <p className="mt-1 text-[var(--fg-1)] leading-relaxed">{s.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.warnings.length > 0 ? (
        <details className="t-caption text-[var(--fg-3)]">
          <summary className="cursor-pointer">Parser warnings ({report.warnings.length})</summary>
          <ul className="mt-2 space-y-1">
            {report.warnings.map((w, i) => (
              <li key={i} className="font-mono">{w}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-3">
      <p className="t-overline">{label}</p>
      <p className={`mt-1 text-xl font-bold ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
