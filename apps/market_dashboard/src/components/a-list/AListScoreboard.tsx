"use client";

/**
 * AListScoreboard — turns the raw A-list rows into a performance read so the
 * page answers "is the GO list actually any good?" at a glance.
 *
 * KPIs across finished picks: count, win-rate, avg MFE (R), avg MAE (R), and
 * MFE-capture (realized R / available MFE R on closed held picks — how much of
 * the move you kept). Then a breakdown by setup so you can see which setups pay.
 *
 * Definitions are deliberately simple and shown on hover; the deeper coaching
 * digest (Analytics tab) carries the edge × execution detail.
 */
import { useMemo } from "react";
import type { AListRow } from "./AListTable";

const FINISHED = new Set(["STOPPED_OUT", "CLOSED", "HIT_TARGET", "EXPIRED", "MANUALLY_CLOSED", "CONVERTED"]);
function isFinished(r: AListRow): boolean {
  return FINISHED.has(r.status) || r.day14?.final === true;
}
function isWin(r: AListRow): boolean {
  if (r.day14?.outcome === "HIT_TARGET") return true;
  const realized = r.savings?.realizedR;
  if (realized != null) return realized > 0;
  return (r.day14?.mfeR ?? 0) >= 1; // reached at least +1R at best excursion
}
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

interface Lane {
  key: string;
  n: number;
  wins: number;
  mfeR: number[];
  maeR: number[];
  realizedR: number[];
}

export default function AListScoreboard({ rows }: { rows: AListRow[] }) {
  const { finished, winRate, avgMfe, avgMae, mfeCapture, lanes } = useMemo(() => {
    const fin = rows.filter(isFinished);
    const wins = fin.filter(isWin).length;
    const mfes = fin.map((r) => r.day14?.mfeR).filter((x): x is number => x != null);
    const maes = fin.map((r) => r.day14?.maeR).filter((x): x is number => x != null);
    // MFE-capture: realized R ÷ available MFE R, on closed picks that ran (MFE > 0.2R).
    const caps = fin
      .map((r) => ({ realized: r.savings?.realizedR ?? null, mfe: r.day14?.mfeR ?? null }))
      .filter((x): x is { realized: number; mfe: number } => x.realized != null && x.mfe != null && x.mfe > 0.2)
      .map((x) => x.realized / x.mfe);

    const laneMap = new Map<string, Lane>();
    for (const r of fin) {
      const key = r.setup ?? (r.isHeld ? "HELD / off-book" : "—");
      const lane = laneMap.get(key) ?? { key, n: 0, wins: 0, mfeR: [], maeR: [], realizedR: [] };
      lane.n++;
      if (isWin(r)) lane.wins++;
      if (r.day14?.mfeR != null) lane.mfeR.push(r.day14.mfeR);
      if (r.day14?.maeR != null) lane.maeR.push(r.day14.maeR);
      if (r.savings?.realizedR != null) lane.realizedR.push(r.savings.realizedR);
      laneMap.set(key, lane);
    }
    const laneList = Array.from(laneMap.values()).sort((a, b) => b.n - a.n);

    return {
      finished: fin.length,
      winRate: fin.length ? Math.round((wins / fin.length) * 100) : null,
      avgMfe: avg(mfes),
      avgMae: avg(maes),
      mfeCapture: caps.length ? Math.round((caps.reduce((a, b) => a + b, 0) / caps.length) * 100) : null,
      lanes: laneList,
    };
  }, [rows]);

  if (finished === 0) {
    return (
      <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-surface)] p-4">
        <p className="t-overline text-[var(--fg-3)]">Performance</p>
        <p className="t-caption mt-2">
          No finished picks in range yet. As picks resolve (stop / target / day-14), this scoreboard fills in —
          win-rate, average MFE/MAE in R, and how much of the move you captured.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-surface)] p-4">
      <p className="t-overline text-[var(--fg-3)]">Performance — finished picks in range</p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Kpi label="Finished" value={String(finished)} />
        <Kpi label="Win rate" value={winRate != null ? `${winRate}%` : "—"} tone={winRate != null && winRate >= 50 ? "gain" : "loss"} hint="HIT_TARGET, positive realized R, or reached +1R MFE" />
        <Kpi label="Avg MFE" value={avgMfe != null ? `${avgMfe >= 0 ? "+" : ""}${avgMfe.toFixed(2)}R` : "—"} tone="gain" hint="Average best favorable excursion (R)" />
        <Kpi label="Avg MAE" value={avgMae != null ? `${avgMae.toFixed(2)}R` : "—"} tone="loss" hint="Average worst adverse excursion (R)" />
        <Kpi label="MFE capture" value={mfeCapture != null ? `${mfeCapture}%` : "—"} hint="Realized R ÷ available MFE R on closed picks — how much of the move you kept" />
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="text-[10px] uppercase tracking-wider text-[var(--fg-3)]">
            <tr className="border-b border-[var(--line)]">
              <th className="py-1.5 pr-3 font-normal">Setup</th>
              <th className="px-3 py-1.5 text-right font-normal">N</th>
              <th className="px-3 py-1.5 text-right font-normal">Win%</th>
              <th className="px-3 py-1.5 text-right font-normal">Avg MFE</th>
              <th className="px-3 py-1.5 text-right font-normal">Avg MAE</th>
              <th className="py-1.5 pl-3 text-right font-normal">Avg realized</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((l) => {
              const mfe = avg(l.mfeR);
              const mae = avg(l.maeR);
              const real = avg(l.realizedR);
              const win = Math.round((l.wins / l.n) * 100);
              return (
                <tr key={l.key} className="border-b border-[var(--line)] last:border-0">
                  <td className="py-1.5 pr-3 font-semibold text-[var(--fg-1)]">{l.key}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-[var(--fg-3)]">{l.n}</td>
                  <td className="px-3 py-1.5 text-right font-mono" style={{ color: win >= 50 ? "var(--gain-fg)" : "var(--loss-fg)" }}>{win}%</td>
                  <td className="px-3 py-1.5 text-right font-mono" style={{ color: "var(--gain-fg)" }}>{mfe != null ? `${mfe >= 0 ? "+" : ""}${mfe.toFixed(2)}R` : "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono" style={{ color: "var(--loss-fg)" }}>{mae != null ? `${mae.toFixed(2)}R` : "—"}</td>
                  <td className="py-1.5 pl-3 text-right font-mono" style={{ color: real != null ? (real >= 0 ? "var(--gain-fg)" : "var(--loss-fg)") : undefined }}>{real != null ? `${real >= 0 ? "+" : ""}${real.toFixed(2)}R` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value, tone, hint }: { label: string; value: string; tone?: "gain" | "loss"; hint?: string }) {
  const color = tone === "gain" ? "var(--gain-fg)" : tone === "loss" ? "var(--loss-fg)" : "var(--fg-1)";
  return (
    <div className="rounded-md bg-[var(--bg-raised)] px-3 py-2" title={hint}>
      <p className="t-overline text-[var(--fg-3)]">{label}</p>
      <p className="t-metric mt-0.5 text-base" style={{ color }}>{value}</p>
    </div>
  );
}
