"use client";

/**
 * CoachCard — ask the AI coach about YOUR journal, from the Journal home
 * (TradesViz-platform P3). Thin client over /api/coach: question box + mode
 * picker + latest answers. Answers persist server-side (CoachInsight), so
 * refreshing the page keeps the history.
 */
import { useEffect, useState } from "react";

type Insight = {
  id: string;
  mode: string;
  question: string;
  answer: string;
  model?: string | null;
  createdAt: string;
};

const MODES = [
  ["performance", "Performance"],
  ["risk", "Risk"],
  ["pattern", "Patterns"],
  ["accountability", "Accountability"],
] as const;

const SUGGESTIONS = [
  "Which day of the week hurts me most, and why?",
  "Which strategy has my best expectancy?",
  "What mistake costs me the most money?",
  "Am I cutting winners short?",
];

export default function CoachCard() {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<string>("performance");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/coach?limit=3", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j?.insights && setInsights(j.insights))
      .catch(() => {});
  }, []);

  async function ask(q?: string) {
    const text = (q ?? question).trim();
    if (text.length < 5 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, mode }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      const row: Insight = { id: j.id ?? String(Date.now()), mode, question: text, answer: j.answer, model: j.model, createdAt: j.createdAt ?? new Date().toISOString() };
      setInsights((prev) => [row, ...prev].slice(0, 3));
      setExpanded(row.id);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Coach failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="market-panel p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="t-overline text-[var(--fg-3)]">AI coach — ask your journal</p>
        <div className="flex gap-1">
          {MODES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setMode(key)}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${
                mode === key ? "border-[var(--accent)] text-[var(--fg-1)]" : "border-[var(--line)] text-[var(--fg-3)] hover:text-[var(--fg-1)]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder='e.g. "Why do I lose on Tuesdays?"'
          className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--fg-1)] outline-none placeholder:text-[var(--fg-3)] focus:border-[var(--accent)]"
        />
        <button
          type="button"
          onClick={() => ask()}
          disabled={busy || question.trim().length < 5}
          className="shrink-0 rounded-[var(--radius-sm)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] px-4 py-2 text-xs font-bold text-[var(--accent)] transition hover:opacity-90 disabled:opacity-40"
        >
          {busy ? "Thinking…" : "Ask"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => ask(s)}
            disabled={busy}
            className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[10px] text-[var(--fg-3)] transition hover:border-[var(--accent)] hover:text-[var(--fg-1)] disabled:opacity-40"
          >
            {s}
          </button>
        ))}
      </div>

      {error && <p className="t-caption mt-2 text-[var(--loss-fg)]">{error}</p>}

      {insights.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--line)]">
          {insights.map((i) => (
            <li key={i.id} className="py-2">
              <button
                type="button"
                onClick={() => setExpanded(expanded === i.id ? null : i.id)}
                className="flex w-full items-baseline justify-between gap-2 text-left"
              >
                <span className="min-w-0 truncate text-sm font-semibold text-[var(--fg-1)]">{i.question}</span>
                <span className="t-caption shrink-0 text-[var(--fg-3)]">
                  {i.mode} · {new Date(i.createdAt).toLocaleDateString()}
                </span>
              </button>
              {expanded === i.id && (
                <p className="t-body-small mt-1.5 whitespace-pre-wrap text-[var(--fg-2)]">{i.answer}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="t-caption mt-2 text-[var(--fg-3)]">
        Answers use only your own closed-trade data (server-computed aggregates) and are saved to your insight history. Educational, not financial advice.
      </p>
    </section>
  );
}
