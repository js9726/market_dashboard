"use client";

/**
 * AListTable — sortable table of the MERGED A-List (REC + HELD in one board).
 * One row per (pickDate, ticker). Click a row to open the detail panel.
 *
 * Badges: REC (passed the screener bar) and/or HELD (a real position). HELD rows
 * also carry an entry grade and the two savings metrics (Realized-vs-full-R and
 * Soft-tranche-vs-Hard) once the daily tracker has run.
 */

import { sessionsBetween, validUntil } from "@/lib/alist-validity";

export interface MarketCtx {
  spyChg: number | null;
  qqqChg: number | null;
  breadthAdvance: number | null;
  breadthDecline: number | null;
  fearGreed: number | null;
  fearGreedLabel: string | null;
  asOf?: string;
}

export interface AListRow {
  id: string;
  pickDate: string;
  ticker: string;
  setup: string | null;
  screenSource: string | null;
  sector: string | null;
  industry: string | null;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rrr: number | null;
  score: number | null;
  verdict: string | null;
  rvol: number | null;
  thesis: string | null;
  traderLens: string | null;
  day0Price: number | null;
  status: string;
  convertedTradeId: string | null;
  // Conviction breakdown + champion persona (R3.1) and entry trigger (R3.2).
  conviction?: { setup: number | null; entry: number | null; theme: number | null; sentiment: number | null } | null;
  championPersona?: string | null;
  trigger?: { state: string; at: string | null; reason: string | null } | null;
  // Multi-agent Conviction verdict (R4) — ENTER/WAIT/PASS + LLM breakdown.
  agent?: {
    verdict: string;
    at: string | null;
    analysis: {
      setup?: number; entry?: number; theme?: number; sentiment?: number; conviction?: number;
      verdict?: string; champion?: string | null;
      reasoning?: { setup?: string; entry?: string; theme?: string; sentiment?: string; moderator?: string };
    } | null;
  } | null;
  day14: {
    mfe: number | null;
    mae: number | null;
    mfeR: number | null;
    maeR: number | null;
    score: number | null;
    outcome: string | null;
    verdict: string | null;
    computedAt: string | null;
    final?: boolean; // true once the 14-session window is locked; else "so far"
  } | null;
  tags: unknown;
  notes: string | null;

  // ── Merged-board additions (REC / HELD) ──────────────────────────────────
  badges?: string[];
  onBook?: boolean | null;
  isHeld?: boolean;
  entryGrade?: string | null;
  held?: { entryAvgCost: number | null; qty: number | null; entryFillAt: string | null } | null;
  rUnitLogged?: number | null;
  rUnitAtr?: number | null;
  atrFloorStop?: number | null;
  effectiveStop?: number | null;
  stopSource?: string | null; // "logged" | "atr" | null
  entryGradeJson?: unknown;
  savings?: {
    realizedR: number | null;
    saveRealizedR: number | null;
    saveRealizedUsd: number | null;
    saveSoftVsHardR: number | null;
    saveSoftVsHardUsd: number | null;
    hardStopHitBasis: string | null;
    hardStopHitAt: string | null;
  };
  // Market backdrop at entry vs exit (P4).
  day0Market?: MarketCtx | null;
  exitMarket?: MarketCtx | null;
}

interface Props {
  rows: AListRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** Entry-trigger badge — the "should I take it" signal (R3.2). */
const TRIGGER_STYLE: Record<string, { bg: string; label: string }> = {
  TRIGGERED: { bg: "var(--gain-fg)", label: "TRIGGERED" },
  ARMED: { bg: "var(--accent)", label: "ARMED" },
  INVALIDATED: { bg: "var(--loss-fg)", label: "INVALID" },
  EXPIRED: { bg: "var(--fg-4)", label: "EXPIRED" },
};
const AGENT_COLOR: Record<string, string> = {
  ENTER: "var(--gain-fg)",
  WAIT: "var(--accent)",
  PASS: "var(--loss-fg)",
};
function renderTrigger(r: AListRow) {
  if (r.isHeld) return <span className="text-[var(--fg-4)]">—</span>;
  const t = r.trigger;
  if (!t) return <span className="text-[var(--fg-4)]">—</span>;
  const s = TRIGGER_STYLE[t.state] ?? { bg: "var(--fg-4)", label: t.state };
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <span
        className="rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
        style={{ backgroundColor: s.bg }}
        title={t.reason ?? t.state}
      >
        {s.label}
      </span>
      {r.agent?.verdict && (
        <span
          className="text-[10px] font-semibold leading-none"
          style={{ color: AGENT_COLOR[r.agent.verdict] ?? "var(--fg-3)" }}
          title={r.agent.analysis?.reasoning?.moderator ?? "Multi-agent Conviction verdict"}
        >
          ▸ {r.agent.verdict}
        </span>
      )}
    </span>
  );
}

/** Day-N-of-14 counter with the entry-validity window on hover. */
function renderDayIndex(r: AListRow) {
  const pick = new Date(`${r.pickDate}T00:00:00.000Z`);
  if (Number.isNaN(pick.getTime())) return <span>-</span>;
  const n = sessionsBetween(pick, new Date());
  const label = n > 14 ? "d14+" : `d${n}/14`;
  const valid = validUntil(pick, r.setup).toISOString().slice(0, 10);
  const title =
    r.status === "ACTIVE" && !r.isHeld
      ? `Entry valid through ${valid}; outcome tracked to day 14`
      : `Day ${n} of the 14-session tracking window`;
  return (
    <span className="t-mono text-[var(--fg-3)]" title={title}>
      {label}
    </span>
  );
}

export default function AListTable({ rows, selectedId, onSelect }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--line)] text-[var(--fg-3)]">
          <tr>
            <Th>Date</Th>
            <Th>Day</Th>
            <Th>Ticker</Th>
            <Th>Badges</Th>
            <Th>Setup</Th>
            <Th>Trigger</Th>
            <Th align="right">Entry</Th>
            <Th align="right">Stop</Th>
            <Th align="right">Score</Th>
            <Th>Grade</Th>
            <Th align="right">RVOL</Th>
            <Th>Sector</Th>
            <Th align="right">Save vs 1R</Th>
            <Th align="right">Soft↔Hard</Th>
            <Th align="right">Day-14 MFE</Th>
            <Th align="right">Day-14 MAE</Th>
            <Th>Outcome</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`cursor-pointer border-b border-[var(--line)] hover:bg-[var(--bg-raised)] ${
                selectedId === r.id ? "bg-[var(--accent-soft-bg)]" : ""
              }`}
            >
              <Td><span className="t-mono">{r.pickDate}</span></Td>
              <Td>{renderDayIndex(r)}</Td>
              <Td><strong>{r.ticker}</strong></Td>
              <Td>{renderBadges(r.badges, r.onBook)}</Td>
              <Td>{r.setup ?? "-"}</Td>
              <Td>{renderTrigger(r)}</Td>
              <Td align="right">{fmt(r.entry ?? (r.held?.entryAvgCost ?? null), 2)}</Td>
              <Td align="right">{renderStop(r)}</Td>
              <Td align="right">
                <strong style={{ color: scoreColor(r.score) }}>{r.score ?? "-"}</strong>
              </Td>
              <Td>{renderGrade(r.entryGrade)}</Td>
              <Td align="right">{r.rvol != null ? `${r.rvol.toFixed(1)}x` : "-"}</Td>
              <Td>{r.sector ?? "-"}</Td>
              <Td align="right">{renderSaveR(r.savings?.saveRealizedR, r.savings?.saveRealizedUsd)}</Td>
              <Td align="right">{renderSaveR(r.savings?.saveSoftVsHardR, r.savings?.saveSoftVsHardUsd)}</Td>
              <Td align="right">{renderExcursion(r.day14?.mfeR, r.day14?.mfe, r.day14?.final, "mfe")}</Td>
              <Td align="right">{renderExcursion(r.day14?.maeR, r.day14?.mae, r.day14?.final, "mae")}</Td>
              <Td>
                {r.day14?.outcome ? (
                  <span className="t-mono" style={{ color: outcomeLabelColor(r.day14.outcome) }}>
                    {r.day14.outcome}
                  </span>
                ) : "-"}
              </Td>
              <Td>
                <span className="t-mono" style={{ color: statusColor(r.status) }}>
                  {r.status}
                </span>
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th className={`px-3 py-2 text-${align} font-normal text-xs uppercase tracking-wider`}>
      {children}
    </th>
  );
}

function Td({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <td className={`px-3 py-2 text-${align}`}>{children}</td>;
}

function fmt(v: number | null, dp: number): string {
  return v == null ? "-" : v.toFixed(dp);
}

function renderBadges(badges?: string[], onBook?: boolean | null) {
  if (!badges || badges.length === 0) return <span className="text-[var(--fg-3)]">-</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {badges.map((b) => (
        <span
          key={b}
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
          style={{
            background: b === "HELD" ? "var(--gain-bg, #14321f)" : "var(--bg-raised)",
            color: b === "HELD" ? "var(--gain-fg)" : "var(--fg-2)",
          }}
        >
          {b}
        </span>
      ))}
      {onBook === false ? (
        <span className="text-[10px]" style={{ color: "var(--warn-fg)" }} title="bought but was not a recommended pick">
          off-book
        </span>
      ) : null}
    </span>
  );
}

function renderGrade(grade?: string | null) {
  if (!grade) return <span className="text-[var(--fg-3)]">-</span>;
  const color = grade === "A" ? "var(--gain-fg)" : grade === "B" ? "var(--warn-fg)" : "var(--loss-fg)";
  return <strong style={{ color }}>{grade}</strong>;
}

/** Always show a risk level: the logged stop, or the wiki ATR-floor stop as a
 *  fallback (flagged "atr") so a pick never shows a blank stop. */
function renderStop(r: AListRow) {
  const s = r.effectiveStop ?? r.stop ?? null;
  if (s == null) return <span className="text-[var(--fg-3)]">-</span>;
  const isAtr = r.stopSource === "atr" || (r.stop == null && r.effectiveStop != null);
  return (
    <span title={isAtr ? "Wiki ATR-floor stop (no logged stop on this pick)" : "Logged stop"}>
      {s.toFixed(2)}
      {isAtr ? <span className="ml-1 text-[9px] text-[var(--fg-3)]">atr</span> : null}
    </span>
  );
}

/** MFE/MAE shown R-first (the comparable unit), with the $ level dimmed and a
 *  "·now" marker while the 14-session window is still open (running value). */
function renderExcursion(
  r: number | null | undefined,
  abs: number | null | undefined,
  final: boolean | undefined,
  kind: "mfe" | "mae",
) {
  if (r == null && abs == null) return <span className="text-[var(--fg-3)]">-</span>;
  const color = kind === "mfe" ? "var(--gain-fg)" : "var(--loss-fg)";
  return (
    <span title={final ? "Locked day-14 value" : "Running value so far — 14-session window still open"}>
      {r != null ? (
        <span style={{ color }}>{r >= 0 ? "+" : ""}{r.toFixed(2)}R</span>
      ) : null}
      {abs != null ? <span className="text-[var(--fg-3)]"> {abs.toFixed(2)}</span> : null}
      {final === false ? <span className="ml-1 text-[9px] text-[var(--fg-3)]">·now</span> : null}
    </span>
  );
}

function renderSaveR(saveR?: number | null, saveUsd?: number | null) {
  if (saveR == null) return <span className="text-[var(--fg-3)]">-</span>;
  const color = saveR >= 0 ? "var(--gain-fg)" : "var(--loss-fg)";
  return (
    <span style={{ color }}>
      {saveR >= 0 ? "+" : ""}
      {saveR.toFixed(2)}R
      {saveUsd != null ? <span className="text-[var(--fg-3)]"> (${Math.round(saveUsd)})</span> : null}
    </span>
  );
}

function scoreColor(score: number | null): string {
  if (score == null) return "var(--fg-3)";
  if (score >= 80) return "var(--gain-fg)";
  if (score >= 60) return "var(--warn-fg)";
  return "var(--loss-fg)";
}

function outcomeLabelColor(outcome: string): string {
  switch (outcome) {
    case "HIT_TARGET": return "var(--gain-fg)";
    case "STOPPED_OUT": return "var(--loss-fg)";
    case "PARTIAL": return "var(--warn-fg)";
    case "FADE": return "var(--warn-fg)";
    case "DRIFT": return "var(--fg-3)";
    default: return "var(--fg-2)";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "ACTIVE": return "var(--accent)";
    case "HIT_TARGET": return "var(--gain-fg)";
    case "STOPPED_OUT": return "var(--loss-fg)";
    case "CONVERTED": return "var(--accent)";
    case "EXPIRED": return "var(--fg-3)";
    case "MANUALLY_CLOSED": return "var(--fg-3)";
    default: return "var(--fg-2)";
  }
}
