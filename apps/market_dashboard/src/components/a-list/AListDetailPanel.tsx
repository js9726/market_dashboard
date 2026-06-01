"use client";

import { useEffect, useState } from "react";
import { type AListRow } from "./AListTable";

interface Props {
  row: AListRow;
  onClose: () => void;
}

type TrackRow = {
  dayIndex: number;
  sessionDate: string;
  close: number | null;
  ema8: number | null;
  ema21: number | null;
  closeBelow8ema: boolean;
  closeBelow21ema: boolean;
  hardStopHitLogged: boolean;
  hardStopHitAtr: boolean;
  runMfeR: number | null;
  runMaeR: number | null;
};

type GradeJson = {
  score?: number | null;
  rvol?: number | null;
  verdict?: string | null;
  setup?: string | null;
  passedBar?: boolean;
  reasons?: string[];
  source?: string;
};

export default function AListDetailPanel({ row, onClose }: Props) {
  const [track, setTrack] = useState<TrackRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTrack(null);
    fetch(`/api/a-list/${row.id}/track`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (!cancelled) setTrack(j.track ?? []);
      })
      .catch(() => {
        if (!cancelled) setTrack([]);
      });
    return () => {
      cancelled = true;
    };
  }, [row.id]);

  const grade = (row.entryGradeJson ?? null) as GradeJson | null;
  const sv = row.savings;
  const hasRisk = row.rUnitLogged != null || row.rUnitAtr != null || (sv && sv.saveSoftVsHardR != null);

  return (
    <div className="fixed bottom-0 right-0 top-16 z-40 w-[460px] overflow-y-auto border-l border-[var(--line)] bg-[var(--bg)] p-5 shadow-xl">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="t-overline text-[var(--fg-3)]">A-List Detail</p>
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            {row.ticker}
            {(row.badges ?? []).map((b) => (
              <span
                key={b}
                className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                style={{
                  background: b === "HELD" ? "var(--gain-bg, #14321f)" : "var(--bg-2)",
                  color: b === "HELD" ? "var(--gain-fg)" : "var(--fg-2)",
                }}
              >
                {b}
              </span>
            ))}
          </h2>
          <span className="t-caption font-normal text-[var(--fg-3)]">{row.pickDate}</span>
        </div>
        <button onClick={onClose} className="mds-button" aria-label="Close">
          Close
        </button>
      </div>

      {row.isHeld && (
        <Section title="Held Position">
          <Row label="Book" value={row.onBook ? "On-book (bought an A-list pick)" : "Off-book (freelance)"} />
          <Row label="Entry grade" value={row.entryGrade ?? "-"} />
          <Row label="Entry avg cost" value={fmt(row.held?.entryAvgCost ?? null, 2)} />
          <Row label="Qty" value={row.held?.qty != null ? String(row.held.qty) : "-"} />
          <Row
            label="Entry date"
            value={row.held?.entryFillAt ? new Date(row.held.entryFillAt).toLocaleDateString() : "-"}
          />
          {grade?.reasons && grade.reasons.length > 0 && (
            <p className="t-caption mt-1 text-[var(--fg-3)]">Vs A-list bar: {grade.reasons.join("; ")}</p>
          )}
        </Section>
      )}

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

      {hasRisk && (
        <Section title="Risk & Savings">
          <Row label="1R (logged stop)" value={fmt(row.rUnitLogged ?? null, 2)} />
          <Row label="1R (ATR-floor)" value={fmt(row.rUnitAtr ?? null, 2)} />
          <Row label="ATR-floor stop" value={fmt(row.atrFloorStop ?? null, 2)} />
          <Row label="Realized R" value={rfmt(sv?.realizedR)} />
          <Row label="Realized vs full-R" value={withUsd(sv?.saveRealizedR, sv?.saveRealizedUsd)} />
          <Row label="Soft-tranche vs Hard" value={withUsd(sv?.saveSoftVsHardR, sv?.saveSoftVsHardUsd)} />
          <Row
            label="Hard stop hit"
            value={
              sv?.hardStopHitAt
                ? `${new Date(sv.hardStopHitAt).toLocaleDateString()} (${sv.hardStopHitBasis ?? "?"})`
                : "not hit"
            }
          />
        </Section>
      )}

      <Section title="Day-0 → 14 Path">
        {track == null ? (
          <p className="t-caption text-[var(--fg-3)]">Loading path…</p>
        ) : track.length === 0 ? (
          <p className="t-caption text-[var(--fg-3)]">
            No path yet — the daily tracker runs post-close for ~14 sessions after entry.
          </p>
        ) : (
          <PathTable rows={track} />
        )}
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
                <p className="t-caption mt-1 whitespace-pre-wrap text-[var(--fg-2)]">{row.day14.verdict}</p>
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
        {row.convertedTradeId && <Row label="Trade Record" value={row.convertedTradeId} />}
      </Section>

      {row.notes && (
        <Section title="Notes">
          <p className="t-caption whitespace-pre-wrap text-[var(--fg-2)]">{row.notes}</p>
        </Section>
      )}
    </div>
  );
}

function PathTable({ rows }: { rows: TrackRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-[var(--fg-3)]">
          <tr>
            <th className="px-1 text-left">D</th>
            <th className="px-1 text-right">Close</th>
            <th className="px-1 text-center" title="closed below 8-EMA">8E</th>
            <th className="px-1 text-center" title="closed below 21-EMA">21E</th>
            <th className="px-1 text-center" title="hard-stop breach">Stop</th>
            <th className="px-1 text-right">MFE</th>
            <th className="px-1 text-right">MAE</th>
          </tr>
        </thead>
        <tbody className="t-mono">
          {rows.map((r) => {
            const stopped = r.hardStopHitLogged || r.hardStopHitAtr;
            return (
              <tr key={r.dayIndex} className="border-t border-[var(--line)]">
                <td className="px-1">{r.dayIndex}</td>
                <td className="px-1 text-right">{r.close != null ? r.close.toFixed(2) : "-"}</td>
                <td className="px-1 text-center" style={{ color: r.closeBelow8ema ? "var(--warn-fg)" : "var(--fg-3)" }}>
                  {r.closeBelow8ema ? "▼" : "·"}
                </td>
                <td className="px-1 text-center" style={{ color: r.closeBelow21ema ? "var(--loss-fg)" : "var(--fg-3)" }}>
                  {r.closeBelow21ema ? "▼" : "·"}
                </td>
                <td className="px-1 text-center" style={{ color: stopped ? "var(--loss-fg)" : "var(--fg-3)" }}>
                  {stopped ? "⛔" : "·"}
                </td>
                <td className="px-1 text-right" style={{ color: "var(--gain-fg)" }}>
                  {r.runMfeR != null ? r.runMfeR.toFixed(1) : "-"}
                </td>
                <td className="px-1 text-right" style={{ color: "var(--loss-fg)" }}>
                  {r.runMaeR != null ? r.runMaeR.toFixed(1) : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="t-caption mt-1 text-[var(--fg-3)]">
        8E/21E ▼ = closed below the 8/21-EMA · ⛔ = hard-stop breach · MFE/MAE in R
      </p>
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

function rfmt(n: number | null | undefined): string {
  return n == null ? "-" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

function withUsd(r: number | null | undefined, usd: number | null | undefined): string {
  const rPart = rfmt(r);
  if (rPart === "-") return "-";
  return usd != null ? `${rPart} ($${Math.round(usd)})` : rPart;
}
