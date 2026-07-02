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

function formatPnl(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export default function AuditsView() {
  const [manifest, setManifest] = useState<WikiManifest | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [selectedOperator, setSelectedOperator] = useState<string | null>(null);
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
        // Auto-select the operator + period of the most recent audit
        if (payload.audits?.length) {
          setSelectedOperator(payload.audits[0].operatorLabel);
          setSelectedPeriod(payload.audits[0].period);
        } else if (payload.operators?.length) {
          setSelectedOperator(payload.operators[0]);
        }
      })
      .catch((e) => {
        if (!cancelled) setManifestError(e instanceof Error ? e.message : "load failed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Periods available for the currently-selected operator. Recomputed on switch
  // so the month dropdown only shows months JS (or XX) actually has audits for.
  const periodsForOperator = useMemo(() => {
    if (!manifest?.audits || !selectedOperator) return [];
    return manifest.audits
      .filter((a) => a.operatorLabel === selectedOperator)
      .map((a) => a.period);
  }, [manifest, selectedOperator]);

  // When the operator switches, snap selectedPeriod onto a valid period for them.
  // Default to their most recent audit; if they have none, clear it.
  useEffect(() => {
    if (!selectedOperator) return;
    if (periodsForOperator.length === 0) {
      setSelectedPeriod(null);
      setReport(null);
      return;
    }
    if (!selectedPeriod || !periodsForOperator.includes(selectedPeriod)) {
      setSelectedPeriod(periodsForOperator[0]);
    }
  }, [selectedOperator, periodsForOperator, selectedPeriod]);

  // 2) load selected report
  const loadReport = useCallback(async (operatorLabel: string, period: string) => {
    setReportLoading(true);
    setReportError(null);
    setReport(null);
    try {
      const url = `/api/wiki/audits/${encodeURIComponent(period)}?operator=${encodeURIComponent(operatorLabel)}`;
      const r = await fetch(url, { cache: "no-store" });
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
    if (selectedOperator && selectedPeriod) loadReport(selectedOperator, selectedPeriod);
  }, [selectedOperator, selectedPeriod, loadReport]);

  // Lookup map for verdict-JSON links + P&L keyed by (operator, date, ticker) so
  // the table only renders cells for the operator currently in view.
  const tradesByKey = useMemo(() => {
    const m = new Map<
      string,
      { day0_url?: string; day14_url?: string; pnl_user?: number | null }
    >();
    for (const t of manifest?.trades ?? []) {
      m.set(`${t.operatorLabel}_${t.date}_${t.ticker}`, {
        day0_url: t.day0_url,
        day14_url: t.day14_url,
        pnl_user: t.pnl_user,
      });
    }
    return m;
  }, [manifest]);

  const operators = manifest?.operators ?? [];
  const showOperatorPicker = operators.length > 1;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Trade Audits</p>
          <p className="t-caption">
            Monthly grade-A/B/C breakdown of past trades vs the wiki rubric. Sourced from{" "}
            <code>jie_wiki/verdicts/{"{operator}"}/_audit_YYYY-MM.md</code> via{" "}
            <code>npm run sync:wiki -- --post</code>. Paper-only rows (no actual buy price in the
            journal) are flagged <span className="font-mono text-[var(--fg-3)]">PAPER</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {showOperatorPicker ? (
            <div className="flex items-center gap-2">
              <label htmlFor="operator-select" className="t-caption">Operator</label>
              <select
                id="operator-select"
                value={selectedOperator ?? ""}
                onChange={(e) => setSelectedOperator(e.target.value || null)}
                className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
              >
                {operators.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <label htmlFor="period-select" className="t-caption">Month</label>
            <select
              id="period-select"
              value={selectedPeriod ?? ""}
              disabled={periodsForOperator.length === 0}
              onChange={(e) => setSelectedPeriod(e.target.value || null)}
              className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
            >
              {periodsForOperator.length ? (
                periodsForOperator.map((period) => (
                  <option key={period} value={period}>{period}</option>
                ))
              ) : (
                <option value="">no audits</option>
              )}
            </select>
          </div>
        </div>
      </div>

      {manifestError ? (
        <p className="mb-3 t-caption text-[var(--loss-fg)]">{manifestError}</p>
      ) : null}

      {manifest?.drift_suggestions?.length ? (
        <DriftPanel
          rows={manifest.drift_suggestions}
          byRubric={manifest.drift_by_rubric ?? {}}
        />
      ) : null}

      {!manifest ? (
        <p className="t-body-small text-[var(--fg-3)]">Loading manifest…</p>
      ) : !manifest.audits?.length ? (
        <p className="t-body-small text-[var(--fg-3)]">
          No audits synced yet. From <code>apps/market_dashboard/</code> run{" "}
          <code>npm run sync:wiki -- --post</code> to ingest the wiki verdicts.
        </p>
      ) : reportLoading ? (
        <p className="t-body-small text-[var(--fg-3)]">
          Loading {selectedOperator}/{selectedPeriod}…
        </p>
      ) : reportError ? (
        <p className="t-body-small text-[var(--loss-fg)]">Failed: {reportError}</p>
      ) : report ? (
        <AuditDetail
          report={report}
          tradesByKey={tradesByKey}
        />
      ) : null}
    </section>
  );
}

function OperatorChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center rounded bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--fg-2)]"
      title={`Operator: ${label}`}
    >
      {label}
    </span>
  );
}

function PaperChip() {
  return (
    <span
      className="inline-flex items-center rounded bg-[var(--bg-surface)] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--fg-3)]"
      title="Paper trade — planned in the journal but no actual buy price was recorded (Col S empty)"
    >
      PAPER
    </span>
  );
}

function UnknownEnteredChip() {
  return (
    <span
      className="inline-flex items-center rounded border border-dashed border-[var(--line)] px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.05em] text-[var(--fg-3)]"
      title="Entered/paper unknown — legacy verdict generated before the entered-flag was wired. Run scripts/audit_trades.py --backfill-entered to fill in."
    >
      ?
    </span>
  );
}

function AuditDetail({
  report,
  tradesByKey,
}: {
  report: AuditReport;
  tradesByKey: Map<
    string,
    { day0_url?: string; day14_url?: string; pnl_user?: number | null }
  >;
}) {
  const driftPct =
    report.tradesReviewed != null && report.tradesReviewed > 0 && report.driftCases != null
      ? Math.round((report.driftCases / report.tradesReviewed) * 100)
      : null;

  // Count entered vs paper if the report uses the entered-flag-aware format.
  const enteredSummary = useMemo(() => {
    const hasFlag = report.trades.some((t) => t.entered !== null);
    if (!hasFlag) return null;
    let entered = 0;
    let paper = 0;
    for (const t of report.trades) {
      if (t.entered === false) paper += 1;
      else if (t.entered === true) entered += 1;
    }
    return { entered, paper };
  }, [report.trades]);

  return (
    <div className="space-y-5">
      {/* Header stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Trades reviewed" value={report.tradesReviewed?.toString() ?? "-"} />
        <Stat
          label="Grade A / B / C"
          value={`${report.gradeCounts.A} / ${report.gradeCounts.B} / ${report.gradeCounts.C}`}
        />
        <Stat
          label="Drift cases"
          value={`${report.driftCases ?? "-"}${driftPct != null ? ` (${driftPct}%)` : ""}`}
        />
        <Stat
          label="Entered / Paper"
          value={enteredSummary ? `${enteredSummary.entered} / ${enteredSummary.paper}` : "—"}
        />
        <Stat label="Period" value={`${report.operatorLabel} · ${report.period}`} mono />
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
                <table className="w-full min-w-[820px] text-left text-[12px]">
                  <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
                    <tr className="border-b border-[var(--line)]">
                      <th className="py-2 pr-3 font-bold">Ticker</th>
                      <th className="px-3 py-2 font-bold">Date</th>
                      <th className="px-3 py-2 text-right font-bold">14d</th>
                      <th className="px-3 py-2 text-right font-bold">P&amp;L</th>
                      <th className="px-3 py-2 font-bold">Outcome</th>
                      <th className="py-2 pl-3 font-bold">Verdict JSON</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((t) => {
                      const links = tradesByKey.get(`${report.operatorLabel}_${t.date}_${t.ticker}`);
                      const pnl = links?.pnl_user;
                      return (
                        <tr key={`${t.date}_${t.ticker}`} className="border-b border-[var(--line)] last:border-0">
                          <td className="py-2 pr-3">
                            <span className="t-ticker mr-2">{t.ticker}</span>
                            <span className="inline-flex items-center gap-1 align-middle">
                              <OperatorChip label={report.operatorLabel} />
                              {t.entered === false ? <PaperChip /> : null}
                              {t.entered === null ? <UnknownEnteredChip /> : null}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-[var(--fg-2)]">{t.date}</td>
                          <td className={`px-3 py-2 text-right font-mono ${pctClass(t.pctIn14d)}`}>
                            {formatPct(t.pctIn14d)}
                          </td>
                          <td
                            className={`px-3 py-2 text-right font-mono ${
                              pnl == null
                                ? "text-[var(--fg-3)]"
                                : pnl > 0
                                  ? "gain"
                                  : pnl < 0
                                    ? "loss"
                                    : "text-[var(--fg-2)]"
                            }`}
                            title={
                              pnl == null
                                ? "P&L not recorded — trade may be open, or run --backfill-entered to refresh from sheet."
                                : `Realised net P&L from journal Col AP`
                            }
                          >
                            {formatPnl(pnl)}
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

function DriftPanel({
  rows,
  byRubric,
}: {
  rows: NonNullable<WikiManifest["drift_suggestions"]>;
  byRubric: Record<string, number>;
}) {
  const [expanded, setExpanded] = useState(false);
  const sortedRubrics = useMemo(
    () => Object.entries(byRubric).sort((a, b) => b[1] - a[1]),
    [byRubric],
  );

  const totalDrift = rows.length;

  return (
    <div className="mb-5 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <p className="t-overline">Drift suggestions across all audits</p>
          <span className="rounded bg-[var(--loss-bg)] px-2 py-0.5 font-mono text-[11px] font-bold text-[var(--loss-fg)]">
            {totalDrift} pending
          </span>
        </div>
        <span className="t-caption text-[var(--fg-3)]">{expanded ? "Hide" : "Show all"}</span>
      </button>
      <div className="mt-2 flex flex-wrap gap-2">
        {sortedRubrics.map(([rubric, count]) => (
          <span
            key={rubric}
            className="inline-flex items-center gap-1 rounded bg-[var(--bg-surface)] px-2 py-0.5 font-mono text-[11px]"
          >
            <span className="font-bold text-[var(--accent)]">{rubric}</span>
            <span className="text-[var(--fg-2)]">{count}</span>
          </span>
        ))}
      </div>
      {expanded ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-3 font-bold">Period</th>
                <th className="px-3 py-2 font-bold">Op</th>
                <th className="px-3 py-2 font-bold">Trade</th>
                <th className="px-3 py-2 font-bold">Rubric</th>
                <th className="py-2 pl-3 font-bold">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={i} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-2 pr-3 font-mono text-[var(--fg-2)]">{s.period}</td>
                  <td className="px-3 py-2"><OperatorChip label={s.operatorLabel} /></td>
                  <td className="px-3 py-2 font-mono text-[var(--fg-2)]">
                    {s.ticker ? (
                      <>
                        <span className="t-ticker">{s.ticker}</span>
                        {s.tradeDate ? <span className="ml-2 text-[var(--fg-3)]">{s.tradeDate}</span> : null}
                      </>
                    ) : (
                      <span className="text-[var(--fg-3)]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-[var(--accent)]">{s.rubric}</td>
                  <td className="py-2 pl-3 text-[var(--fg-1)]">{s.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 t-caption text-[var(--fg-3)]">
            Append resolution notes to <code>wiki/_skill-suggestions.md</code> manually after
            you act on a suggestion. Promote recurring patterns to their own wiki page (see{" "}
            <code>wiki/rubric-stop-too-tight.md</code> for the template).
          </p>
        </div>
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
