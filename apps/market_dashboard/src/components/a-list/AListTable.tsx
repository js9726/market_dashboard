"use client";

/**
 * AListTable — sortable table of A-list candidates.
 * One row per (pickDate, ticker). Click a row to open the detail panel.
 */

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
  day14: {
    mfe: number | null;
    mae: number | null;
    mfeR: number | null;
    maeR: number | null;
    score: number | null;
    outcome: string | null;
    verdict: string | null;
    computedAt: string;
  } | null;
  tags: unknown;
  notes: string | null;
}

interface Props {
  rows: AListRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function AListTable({ rows, selectedId, onSelect }: Props) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-[var(--line)] text-[var(--fg-3)]">
          <tr>
            <Th>Date</Th>
            <Th>Ticker</Th>
            <Th>Setup</Th>
            <Th align="right">Entry</Th>
            <Th align="right">Stop</Th>
            <Th align="right">Target</Th>
            <Th align="right">R:R</Th>
            <Th align="right">Score</Th>
            <Th align="right">RVOL</Th>
            <Th>Trader Lens</Th>
            <Th>Sector</Th>
            <Th align="right">Day-14 MFE</Th>
            <Th align="right">Day-14 MAE</Th>
            <Th align="right">Day-14 Score</Th>
            <Th>Outcome</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              onClick={() => onSelect(r.id)}
              className={`cursor-pointer border-b border-[var(--line)] hover:bg-[var(--bg-2)] ${
                selectedId === r.id ? "bg-[var(--bg-2)]" : ""
              }`}
            >
              <Td><span className="t-mono">{r.pickDate}</span></Td>
              <Td><strong>{r.ticker}</strong></Td>
              <Td>{r.setup ?? "-"}</Td>
              <Td align="right">{fmt(r.entry, 2)}</Td>
              <Td align="right">{fmt(r.stop, 2)}</Td>
              <Td align="right">{fmt(r.target, 2)}</Td>
              <Td align="right">{fmt(r.rrr, 1)}</Td>
              <Td align="right">
                <strong style={{ color: scoreColor(r.score) }}>{r.score ?? "-"}</strong>
              </Td>
              <Td align="right">{r.rvol != null ? `${r.rvol.toFixed(1)}x` : "-"}</Td>
              <Td>{r.traderLens ?? "-"}</Td>
              <Td>{r.sector ?? "-"}</Td>
              <Td align="right">
                {r.day14?.mfe != null ? (
                  <span>
                    {fmt(r.day14.mfe, 2)}
                    {r.day14.mfeR != null && (
                      <span className="text-[var(--fg-3)]"> ({r.day14.mfeR.toFixed(1)}R)</span>
                    )}
                  </span>
                ) : "-"}
              </Td>
              <Td align="right">
                {r.day14?.mae != null ? (
                  <span>
                    {fmt(r.day14.mae, 2)}
                    {r.day14.maeR != null && (
                      <span className="text-[var(--fg-3)]"> ({r.day14.maeR.toFixed(1)}R)</span>
                    )}
                  </span>
                ) : "-"}
              </Td>
              <Td align="right">
                {r.day14?.score != null ? (
                  <strong style={{ color: outcomeColor(r.day14.score) }}>
                    {r.day14.score.toFixed(1)}
                  </strong>
                ) : "-"}
              </Td>
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

function scoreColor(score: number | null): string {
  if (score == null) return "var(--fg-3)";
  if (score >= 80) return "var(--gain-fg)";
  if (score >= 60) return "var(--warn-fg)";
  return "var(--loss-fg)";
}

function outcomeColor(score: number | null): string {
  if (score == null) return "var(--fg-3)";
  if (score >= 7) return "var(--gain-fg)";
  if (score >= 4) return "var(--warn-fg)";
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
    case "ACTIVE": return "var(--accent-fg)";
    case "HIT_TARGET": return "var(--gain-fg)";
    case "STOPPED_OUT": return "var(--loss-fg)";
    case "CONVERTED": return "var(--accent-fg)";
    case "EXPIRED": return "var(--fg-3)";
    case "MANUALLY_CLOSED": return "var(--fg-3)";
    default: return "var(--fg-2)";
  }
}
