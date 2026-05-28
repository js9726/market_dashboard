"use client";

/**
 * AListView — top-level component for the /dashboard/a-list page.
 *
 * Phase 2 of the pre-open CI + journal revamp plan
 * (see apps/market_dashboard/docs/PLAN-pre-open-ci-and-journal-revamp.md).
 *
 * Reads from:
 *   GET /api/a-list/today      (default view — today's candidates)
 *   GET /api/a-list/history    (filtered history view)
 *
 * Filters: date range, ticker, sector, setup, status, outcome, minScore.
 * Sort: date (default), score, outcome.
 *
 * Each row drills into a detail panel showing the day-0 thesis, the frozen
 * brief reference, day-14 outcome (when computed), and notes.
 */

import { useEffect, useMemo, useState } from "react";
import AListTable, { type AListRow } from "./AListTable";
import AListFilters, { type AListFilterState } from "./AListFilters";
import AListDetailPanel from "./AListDetailPanel";

const TODAY_LIMIT = 200;

export default function AListView() {
  const [rows, setRows] = useState<AListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<AListFilterState>({
    from: defaultFromDate(),
    to: defaultToDate(),
    ticker: "",
    sector: "",
    setup: "",
    status: "",
    outcome: "",
    minScore: "",
    sort: "date",
  });

  // Fetch rows whenever filters change
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams();
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.ticker) qs.set("ticker", filters.ticker);
    if (filters.sector) qs.set("sector", filters.sector);
    if (filters.setup) qs.set("setup", filters.setup);
    if (filters.status) qs.set("status", filters.status);
    if (filters.outcome) qs.set("outcome", filters.outcome);
    if (filters.minScore) qs.set("minScore", filters.minScore);
    if (filters.sort) qs.set("sort", filters.sort);
    qs.set("limit", String(TODAY_LIMIT));

    fetch(`/api/a-list/history?${qs.toString()}`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j) => {
        if (cancelled) return;
        setRows(j.items ?? []);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  // Selected row for detail panel
  const selected = useMemo(
    () => rows.find((r) => r.id === selectedId) ?? null,
    [rows, selectedId],
  );

  // Summary stats for the header
  const summary = useMemo(() => computeSummary(rows), [rows]);

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--line)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="t-overline text-[var(--fg-3)]">A-List Candidates</p>
            <p className="t-caption">
              Strict-quality picks (score &ge; 80, GO, RVOL &ge; 1.5x). Tracked day-0 to day-14.
            </p>
          </div>
          <div className="flex flex-wrap items-baseline gap-4 t-caption">
            <span>
              <strong className="t-mono">{summary.total}</strong> total
            </span>
            <span>
              <strong className="t-mono">{summary.active}</strong> active
            </span>
            <span>
              <strong className="t-mono">{summary.hitTarget}</strong> hit target
            </span>
            <span>
              <strong className="t-mono">{summary.stoppedOut}</strong> stopped
            </span>
            <span>
              hit rate <strong className="t-mono">{summary.hitRatePct}%</strong>
            </span>
            <span>
              avg day-14 score <strong className="t-mono">{summary.avgDay14Score}</strong>
            </span>
          </div>
        </div>
      </div>

      <AListFilters filters={filters} onChange={setFilters} />

      {loading ? (
        <p className="p-5 t-caption t-mono">Loading...</p>
      ) : error ? (
        <p className="p-5 t-caption t-mono">Error: {error}</p>
      ) : rows.length === 0 ? (
        <p className="p-5 t-caption">
          No candidates match these filters. Try widening the date range or clearing filters.
        </p>
      ) : (
        <AListTable rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {selected && (
        <AListDetailPanel row={selected} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

function defaultFromDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 90);
  return d.toISOString().slice(0, 10);
}

function defaultToDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function computeSummary(rows: AListRow[]) {
  const total = rows.length;
  const active = rows.filter((r) => r.status === "ACTIVE").length;
  const hitTarget = rows.filter((r) => r.day14?.outcome === "HIT_TARGET").length;
  const stoppedOut = rows.filter((r) => r.day14?.outcome === "STOPPED_OUT").length;
  const finished = hitTarget + stoppedOut;
  const hitRatePct = finished > 0 ? Math.round((hitTarget / finished) * 100) : 0;
  const scoredRows = rows.filter((r) => r.day14?.score != null);
  const avgDay14Score = scoredRows.length > 0
    ? (scoredRows.reduce((sum, r) => sum + (r.day14!.score ?? 0), 0) / scoredRows.length).toFixed(1)
    : "-";
  return { total, active, hitTarget, stoppedOut, hitRatePct, avgDay14Score };
}
