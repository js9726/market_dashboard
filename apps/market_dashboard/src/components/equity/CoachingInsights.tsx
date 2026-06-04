"use client";

import { useEffect, useState } from "react";

type Coaching = {
  generatedAt: string;
  periodDays: number;
  current: {
    trades: number;
    winRate: number;
    recentWinRate: number | null;
    avgRR: number;
    avgComposite: number;
    gradeCounts: { A: number; B: number; C: number };
    topSetup: string | null;
  };
  target: {
    winRate: number;
    avgRR: number;
  };
  improvement: {
    summary: string;
    mistakes: string[];
    plan: string[];
    adoption: string;
    patternNote: string | null;
    recentAEntries: number;
  };
};

export default function CoachingInsights() {
  const [data, setData] = useState<Coaching | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/journal/coaching", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((payload: Coaching) => {
        if (!cancelled) setData(payload);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="space-y-4 px-5">
      <div>
        <p className="t-overline text-[var(--fg-3)]">Coaching Insights</p>
        <p className="t-caption">
          Improvement plan from recent USD outcomes, trade-score grades, journal weaknesses, and A-list adoption.
        </p>
      </div>

      {error ? <p className="t-caption t-mono">Error loading coaching: {error}</p> : null}
      {!data && !error ? <p className="t-caption t-mono">Loading coaching insights...</p> : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label={`${data.periodDays}d win rate`} value={`${data.current.winRate}%`} good={data.current.winRate >= data.target.winRate} />
            <Metric label="Target win rate" value={`${data.target.winRate}%`} />
            <Metric label="Avg R:R" value={data.current.avgRR.toFixed(2)} good={data.current.avgRR >= data.target.avgRR} />
            <Metric label="Grades A/B/C" value={`${data.current.gradeCounts.A}/${data.current.gradeCounts.B}/${data.current.gradeCounts.C}`} />
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
            <p className="text-sm font-semibold text-[var(--fg-1)]">What to improve</p>
            <p className="mt-1 text-sm leading-relaxed text-[var(--fg-2)]">{data.improvement.summary}</p>
            {data.improvement.patternNote ? (
              <p className="mt-2 text-xs leading-relaxed text-[var(--fg-3)]">{data.improvement.patternNote}</p>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <Panel title="Likely mistakes" items={data.improvement.mistakes} />
            <Panel title="Improvement plan" items={data.improvement.plan} />
          </div>

          <div className="rounded-[var(--radius-md)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] p-4 text-sm text-[var(--fg-2)]">
            <span className="font-semibold text-[var(--accent)]">Adoption check:</span>{" "}
            {data.improvement.adoption}
            {data.improvement.recentAEntries > 0 ? (
              <span className="text-[var(--fg-3)]"> Recent A-grade held entries: {data.improvement.recentAEntries}.</span>
            ) : null}
          </div>
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value, good }: { label: string; value: string; good?: boolean }) {
  const color = good == null ? "text-[var(--fg-1)]" : good ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--fg-3)]">{label}</p>
      <p className={`mt-1 font-mono text-lg font-semibold tabular-nums ${color}`}>{value}</p>
    </div>
  );
}

function Panel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--line)] bg-[var(--bg-surface)] p-4 shadow-[var(--shadow-card)]">
      <p className="text-sm font-semibold text-[var(--fg-1)]">{title}</p>
      <ul className="mt-2 space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2 text-sm leading-relaxed text-[var(--fg-2)]">
            <span className="text-[var(--accent)]">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
