"use client";

import { useEffect, useState, type ReactNode } from "react";
import { type AListRow } from "./AListTable";

interface Props {
  row: AListRow;
  onClose: () => void;
}

type TrackRow = {
  dayIndex: number;
  sessionDate: string;
  open: number | null;
  high: number | null;
  low: number | null;
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
  const entryStatus = entryHitStatus(row, track);

  return (
    <>
      <div className="fixed inset-0 top-16 z-40 bg-[var(--bg-overlay)]" onClick={onClose} />
      <div className="fixed bottom-0 right-0 top-16 z-50 w-full max-w-[480px] overflow-y-auto border-l border-[var(--line)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-modal)]">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="t-overline text-[var(--fg-3)]">A-List Detail</p>
            <h2 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
              {row.ticker}
              {(row.badges ?? []).map((b) => (
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
            </h2>
            <span className="t-caption font-normal text-[var(--fg-3)]">{row.pickDate}</span>
          </div>
          <button onClick={onClose} className="mds-button shrink-0" aria-label="Close">
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
              label="Entry fill"
              value={row.held?.entryFillAt ? new Date(row.held.entryFillAt).toLocaleString() : "-"}
            />
            {grade?.reasons && grade.reasons.length > 0 && (
              <p className="t-caption mt-1 text-[var(--fg-3)]">Vs A-list bar: {grade.reasons.join("; ")}</p>
            )}
          </Section>
        )}

        {!row.isHeld && row.trigger && (
          <Section title="Entry Trigger">
            <Row label="State" value={row.trigger.state} />
            <Row label="Reason" value={row.trigger.reason ?? "-"} />
            {row.trigger.at && <Row label="Since" value={new Date(row.trigger.at).toLocaleString()} />}
          </Section>
        )}

        {row.conviction && (row.conviction.setup != null || row.conviction.entry != null) && (
          <Section title="Conviction Breakdown">
            <ConvictionBar label="Setup" value={row.conviction.setup} max={40} />
            <ConvictionBar label="Entry" value={row.conviction.entry} max={30} />
            <ConvictionBar label="Theme" value={row.conviction.theme} max={20} />
            <ConvictionBar label="Sentiment" value={row.conviction.sentiment} max={10} />
            {row.championPersona && <Row label="Champion" value={row.championPersona} />}
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
          <Row label="Entry Zone" value={entryZoneLabel(row)} />
          <Row label="Entry Hit" value={entryStatus} />
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

        <Section title="Day-0 to 14 Path">
          {track == null ? (
            <p className="t-caption text-[var(--fg-3)]">Loading path...</p>
          ) : track.length === 0 ? (
            <p className="t-caption text-[var(--fg-3)]">
              No path yet. The daily tracker runs post-close for about 14 sessions after entry.
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
              Day-14 outcome not yet computed. Auto-runs about 14 sessions after pick date via the journal-close workflow.
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
    </>
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
                  {r.closeBelow8ema ? "v" : "."}
                </td>
                <td className="px-1 text-center" style={{ color: r.closeBelow21ema ? "var(--loss-fg)" : "var(--fg-3)" }}>
                  {r.closeBelow21ema ? "v" : "."}
                </td>
                <td className="px-1 text-center" style={{ color: stopped ? "var(--loss-fg)" : "var(--fg-3)" }}>
                  {stopped ? "STOP" : "."}
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
        8E/21E v = closed below the 8/21-EMA. STOP = hard-stop breach. MFE/MAE in R.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-4 border-t border-[var(--line)] pt-3">
      <p className="t-overline mb-2 text-[var(--fg-3)]">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Conviction sub-score as a labelled progress bar (value / max). */
function ConvictionBar({ label, value, max }: { label: string; value: number | null | undefined; max: number }) {
  const v = value ?? 0;
  const pct = Math.max(0, Math.min(100, (v / max) * 100));
  return (
    <div className="grid grid-cols-[minmax(70px,auto)_1fr_auto] items-center gap-2 t-caption">
      <span className="text-[var(--fg-3)]">{label}</span>
      <span className="h-1.5 overflow-hidden rounded bg-[var(--bg-raised)]">
        <span className="block h-full rounded bg-[var(--accent)]" style={{ width: `${pct}%` }} />
      </span>
      <span className="t-mono text-[var(--fg-2)]">{value != null ? `${v}/${max}` : `–/${max}`}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(110px,1fr)_minmax(0,1.35fr)] gap-3 t-caption">
      <span className="text-[var(--fg-3)]">{label}</span>
      <span className="t-mono break-words text-right text-[var(--fg-1)]">{value}</span>
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

function entryZoneLabel(row: AListRow): string {
  if (row.entry != null) return `$${row.entry.toFixed(2)}`;
  if (row.day0Price != null) return `ref $${row.day0Price.toFixed(2)} (no limit-zone stored)`;
  return "-";
}

function entryHitStatus(row: AListRow, track: TrackRow[] | null): string {
  if (row.held?.entryFillAt) {
    return `filled ${new Date(row.held.entryFillAt).toLocaleString()}`;
  }
  if (row.entry == null && row.day0Price != null) {
    return "reference only - no proposed limit zone";
  }
  if (row.entry == null) return "no entry proposal stored";
  if (track == null) return "checking path...";
  if (track.length === 0) return "not tracked yet";

  const hit = track.find((r) =>
    r.low != null && r.high != null && r.low <= row.entry! && r.high >= row.entry!
  );
  if (!hit) return "not hit in tracked sessions";
  return `hit ${hit.sessionDate} (D${hit.dayIndex})`;
}
