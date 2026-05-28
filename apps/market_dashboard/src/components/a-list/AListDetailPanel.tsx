"use client";

import { type AListRow } from "./AListTable";

interface Props {
  row: AListRow;
  onClose: () => void;
}

export default function AListDetailPanel({ row, onClose }: Props) {
  return (
    <div className="fixed bottom-0 right-0 top-16 z-40 w-[460px] overflow-y-auto border-l border-[var(--line)] bg-[var(--bg)] p-5 shadow-xl">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="t-overline text-[var(--fg-3)]">A-List Detail</p>
          <h2 className="text-2xl font-semibold">
            {row.ticker}{" "}
            <span className="t-caption font-normal text-[var(--fg-3)]">{row.pickDate}</span>
          </h2>
        </div>
        <button
          onClick={onClose}
          className="mds-button"
          aria-label="Close"
        >
          Close
        </button>
      </div>

      <Section title="Setup">
        <Row label="Classification" value={row.setup ?? "-"} />
        <Row label="Trader Lens" value={row.traderLens ?? "-"} />
        <Row label="Sector" value={row.sector ?? "-"} />
        <Row label="Industry" value={row.industry ?? "-"} />
        <Row label="Screener Source" value={row.screenSource ?? "-"} />
      </Section>

      <Section title="Day-0 Entry Proposal">
        <Row label="Entry Zone" value={fmt(row.entry, 2)} />
        <Row label="Stop" value={fmt(row.stop, 2)} />
        <Row label="Target" value={fmt(row.target, 2)} />
        <Row label="R:R" value={row.rrr != null ? row.rrr.toFixed(1) : "-"} />
        <Row label="Day-0 Price" value={fmt(row.day0Price, 2)} />
        <Row label="Score" value={row.score != null ? String(row.score) : "-"} />
        <Row label="Verdict" value={row.verdict ?? "-"} />
        <Row label="RVOL" value={row.rvol != null ? `${row.rvol.toFixed(1)}x` : "-"} />
      </Section>

      {row.thesis && (
        <Section title="Day-0 Thesis">
          <p className="t-caption whitespace-pre-wrap text-[var(--fg-2)]">{row.thesis}</p>
        </Section>
      )}

      <Section title="Day-14 Outcome">
        {row.day14 ? (
          <>
            <Row label="Outcome" value={row.day14.outcome ?? "-"} />
            <Row label="MFE" value={fmt(row.day14.mfe, 2)} />
            <Row label="MAE" value={fmt(row.day14.mae, 2)} />
            <Row label="MFE (R)" value={row.day14.mfeR != null ? `${row.day14.mfeR.toFixed(1)}R` : "-"} />
            <Row label="MAE (R)" value={row.day14.maeR != null ? `${row.day14.maeR.toFixed(1)}R` : "-"} />
            <Row label="Day-14 Score" value={row.day14.score != null ? row.day14.score.toFixed(1) : "-"} />
            <Row label="Computed" value={new Date(row.day14.computedAt).toLocaleString()} />
            {row.day14.verdict && (
              <div className="mt-3">
                <p className="t-overline text-[var(--fg-3)]">Verdict</p>
                <p className="t-caption mt-1 whitespace-pre-wrap text-[var(--fg-2)]">
                  {row.day14.verdict}
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="t-caption text-[var(--fg-3)]">
            Day-14 outcome not yet computed. Auto-runs ~14 sessions after pick date via the
            journal-close workflow.
          </p>
        )}
      </Section>

      <Section title="Status">
        <Row label="Current" value={row.status} />
        {row.convertedTradeId && (
          <Row label="Trade Record" value={row.convertedTradeId} />
        )}
      </Section>

      {row.notes && (
        <Section title="Notes">
          <p className="t-caption whitespace-pre-wrap text-[var(--fg-2)]">{row.notes}</p>
        </Section>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 border-t border-[var(--line)] pt-3">
      <p className="t-overline mb-2 text-[var(--fg-3)]">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between t-caption">
      <span className="text-[var(--fg-3)]">{label}</span>
      <span className="t-mono">{value}</span>
    </div>
  );
}

function fmt(v: number | null, dp: number): string {
  return v == null ? "-" : v.toFixed(dp);
}
