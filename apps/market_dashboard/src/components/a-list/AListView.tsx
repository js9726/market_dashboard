"use client";

/**
 * AListView — top-level component for the /dashboard/a-list page.
 *
 * Reads GET /api/a-list/history (filtered) and splits the result into two
 * boards: ACTIVE (still in the tracking window / still held) and CLOSED/REVIEW
 * (resolved — stopped, target, expired, or broker-exited). A performance
 * scoreboard sits on top so the past GO-list outcomes are actually visualised.
 *
 * Each row drills into a detail panel (day-0 thesis, frozen brief, day-14
 * outcome, notes).
 */

import { useEffect, useMemo, useState } from "react";
import AListTable, { type AListRow } from "./AListTable";
import AListFilters, { type AListFilterState } from "./AListFilters";
import AListDetailPanel from "./AListDetailPanel";
import AListScoreboard from "./AListScoreboard";

const TODAY_LIMIT = 200;
type Board = "active" | "closed";

const CLOSED_STATUSES = new Set(["STOPPED_OUT", "CLOSED", "HIT_TARGET", "EXPIRED", "MANUALLY_CLOSED", "CONVERTED"]);
/** A pick is "finished" when its status is terminal or its day-14 window locked.
 *  HELD positions stay ACTIVE until the broker exit reconciles (broker-truth),
 *  so they never fall into Closed just because a rule-stop was tagged. */
function isClosed(r: AListRow): boolean {
  return CLOSED_STATUSES.has(r.status) || r.day14?.final === true;
}

export default function AListView() {
  const [rows, setRows] = useState<AListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>("active");
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

  const activeRows = useMemo(() => rows.filter((r) => !isClosed(r)), [rows]);
  const closedRows = useMemo(() => rows.filter(isClosed), [rows]);
  const shown = board === "active" ? activeRows : closedRows;

  // Selected row for detail panel (search across both boards)
  const selected = useMemo(() => rows.find((r) => r.id === selectedId) ?? null, [rows, selectedId]);

  // Summary stats for the header
  const summary = useMemo(() => computeSummary(rows), [rows]);

  return (
    <div className="space-y-4">
      <div className="border-b border-[var(--line)] p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="t-overline text-[var(--fg-3)]">A-List Candidates</p>
            <p className="t-caption">
              GO &ge; 75 Conviction (Setup/40 + Entry/30 + Theme/20 + Sentiment/10), RVOL &ge; 1.5x.
              Tracked day-0 to day-14; held positions tracked to broker exit.
            </p>
          </div>
          <div className="flex flex-wrap items-baseline gap-4 t-caption">
            <span><strong className="t-mono">{summary.total}</strong> total</span>
            <span><strong className="t-mono">{summary.active}</strong> active</span>
            <span><strong className="t-mono">{summary.hitTarget}</strong> hit target</span>
            <span><strong className="t-mono">{summary.stoppedOut}</strong> stopped</span>
            <span>hit rate <strong className="t-mono">{summary.hitRatePct}%</strong></span>
            <span>avg day-14 score <strong className="t-mono">{summary.avgDay14Score}</strong></span>
          </div>
        </div>
      </div>

      <AListScoreboard rows={rows} />

      <AListFilters filters={filters} onChange={setFilters} />

      {/* Active vs Closed/Review boards */}
      <div className="flex gap-1 border-b border-[var(--line)] px-1">
        <BoardTab label="Active" count={activeRows.length} active={board === "active"} onClick={() => setBoard("active")} />
        <BoardTab label="Closed / Review" count={closedRows.length} active={board === "closed"} onClick={() => setBoard("closed")} />
      </div>

      {loading ? (
        <p className="p-5 t-caption t-mono">Loading...</p>
      ) : error ? (
        <p className="p-5 t-caption t-mono">Error: {error}</p>
      ) : shown.length === 0 ? (
        <p className="p-5 t-caption">
          {board === "active"
            ? "No active picks in range. Switch to Closed / Review, or widen the date range."
            : "No closed picks in range yet — resolved picks (stop / target / day-14 / broker exit) land here."}
        </p>
      ) : (
        <AListTable rows={shown} selectedId={selectedId} onSelect={setSelectedId} />
      )}

      {selected && <AListDetailPanel row={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function BoardTab({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-t px-4 py-2 text-[13px] font-semibold transition ${
        active
          ? "bg-[var(--bg-surface)] text-[var(--fg-1)] border-b-2 border-[var(--accent)]"
          : "text-[var(--fg-3)] hover:text-[var(--fg-1)]"
      }`}
    >
      {label} <span className="ml-1 text-[11px] text-[var(--fg-3)]">{count}</span>
    </button>
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
  // Status flips live (track-positions) while day14.outcome lands at day 14 —
  // counting only the latter showed "0 stopped" over a table full of stops.
  // A row counts once, whichever field resolved first.
  const hitTarget = rows.filter(
    (r) => r.status === "HIT_TARGET" || r.day14?.outcome === "HIT_TARGET",
  ).length;
  const stoppedOut = rows.filter(
    (r) => r.status === "STOPPED_OUT" || r.day14?.outcome === "STOPPED_OUT",
  ).length;
  const finished = hitTarget + stoppedOut;
  const hitRatePct = finished > 0 ? Math.round((hitTarget / finished) * 100) : 0;
  const scoredRows = rows.filter((r) => r.day14?.score != null);
  const avgDay14Score = scoredRows.length > 0
    ? (scoredRows.reduce((sum, r) => sum + (r.day14!.score ?? 0), 0) / scoredRows.length).toFixed(1)
    : "-";
  return { total, active, hitTarget, stoppedOut, hitRatePct, avgDay14Score };
}
