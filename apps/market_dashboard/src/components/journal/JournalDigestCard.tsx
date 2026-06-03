"use client";

/**
 * JournalDigestCard — the review-first hero of the Journal. Surfaces the weekly
 * "what to learn" digest with zero per-trade effort: it reads
 * /api/journal/digest, computed from auto-journaled broker fills + the HELD
 * A-list tracker. Themed on the mode-aware design tokens.
 */
import { useEffect, useState } from "react";

type Digest = {
  periodDays: number;
  from: string;
  to: string;
  trades: { closed: number; wins: number; losses: number; winRatePct: number | null };
  discipline: {
    onBookCount: number;
    offBookCount: number;
    onBookAvgR: number | null;
    offBookAvgR: number | null;
    stopTooTightCount: number;
    gradeDist: { A: number; B: number; C: number };
  };
  savings: { avgSoftVsHardR: number | null; totalSoftVsHardUsd: number; avgRealizedR: number | null };
  journal: { entries: number; avgComposite: number | null; topWeakness: string | null; topSetup: string | null };
  takeaways: string[];
};

function R(n: number | null): string {
  return n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export default function JournalDigestCard() {
  const [d, setD] = useState<Digest | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/journal/digest", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setD)
      .catch(() => setFailed(true));
  }, []);

  if (failed || !d) return null;

  return (
    <section className="rounded-[var(--radius-xl)] border border-[var(--line)] bg-[var(--bg-surface)] p-5 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--fg-1)]">
          This week — what to learn{" "}
          <span className="font-normal text-[var(--fg-3)]">
            ({d.from} → {d.to})
          </span>
        </h3>
        <span className="rounded-[var(--radius-pill)] bg-[var(--accent-soft-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--accent)]">
          auto · zero effort
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Closed" value={`${d.trades.closed}`} sub={d.trades.winRatePct != null ? `${d.trades.winRatePct}% win` : undefined} />
        <Stat label="Avg realized" value={R(d.savings.avgRealizedR)} />
        <Stat label="On-book R" value={R(d.discipline.onBookAvgR)} sub={`${d.discipline.onBookCount} trades`} good />
        <Stat label="Off-book R" value={R(d.discipline.offBookAvgR)} sub={`${d.discipline.offBookCount} trades`} warn />
        <Stat label="Soft↔Hard saved" value={R(d.savings.avgSoftVsHardR)} sub={`$${d.savings.totalSoftVsHardUsd}`} />
        <Stat label="Stop too tight" value={`${d.discipline.stopTooTightCount}`} sub="vs ATR-floor" warn={d.discipline.stopTooTightCount > 0} />
      </div>

      {d.takeaways.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {d.takeaways.map((t, i) => (
            <li key={i} className="flex gap-2 text-sm text-[var(--fg-2)]">
              <span className="text-[var(--accent)]">▸</span>
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, sub, good, warn }: { label: string; value: string; sub?: string; good?: boolean; warn?: boolean }) {
  const color = good ? "text-[var(--gain-fg)]" : warn ? "text-[var(--warn-500)]" : "text-[var(--fg-1)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-raised)] px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--fg-3)]">{label}</div>
      <div className={`font-mono text-base font-semibold tabular-nums ${color}`}>{value}</div>
      {sub ? <div className="text-[10px] text-[var(--fg-3)]">{sub}</div> : null}
    </div>
  );
}
