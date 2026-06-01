"use client";

/**
 * JournalDigestCard — surfaces the weekly "what to learn" digest at the top of
 * the Journal. Zero per-trade effort: it reads /api/journal/digest, which is
 * computed from auto-journaled entries + the HELD A-list tracker.
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
    <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-100">
          This week — what to learn{" "}
          <span className="font-normal text-slate-500">
            ({d.from} → {d.to})
          </span>
        </h3>
        <span className="text-xs text-slate-500">auto-generated · zero effort</span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4 lg:grid-cols-6">
        <Stat label="Closed" value={`${d.trades.closed}`} sub={d.trades.winRatePct != null ? `${d.trades.winRatePct}% win` : undefined} />
        <Stat label="Avg realized" value={R(d.savings.avgRealizedR)} />
        <Stat label="On-book R" value={R(d.discipline.onBookAvgR)} sub={`${d.discipline.onBookCount} trades`} good />
        <Stat label="Off-book R" value={R(d.discipline.offBookAvgR)} sub={`${d.discipline.offBookCount} trades`} warn />
        <Stat label="Soft↔Hard saved" value={R(d.savings.avgSoftVsHardR)} sub={`$${d.savings.totalSoftVsHardUsd}`} />
        <Stat label="Stop too tight" value={`${d.discipline.stopTooTightCount}`} sub="vs ATR-floor" warn={d.discipline.stopTooTightCount > 0} />
      </div>

      <ul className="mt-4 space-y-1.5">
        {d.takeaways.map((t, i) => (
          <li key={i} className="flex gap-2 text-sm text-slate-300">
            <span className="text-slate-500">▸</span>
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value, sub, good, warn }: { label: string; value: string; sub?: string; good?: boolean; warn?: boolean }) {
  const color = good ? "text-emerald-400" : warn ? "text-amber-400" : "text-slate-100";
  return (
    <div className="rounded-lg bg-slate-800/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-base font-semibold tabular-nums ${color}`}>{value}</div>
      {sub ? <div className="text-[10px] text-slate-500">{sub}</div> : null}
    </div>
  );
}
