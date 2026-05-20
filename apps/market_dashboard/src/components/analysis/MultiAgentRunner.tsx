"use client";

import { useState } from "react";
import MultiAgentAnalysisCard from "./MultiAgentAnalysisCard";
import type { MultiAgentResult } from "@/lib/analysis/agents";

const PIPELINE_ORDER: MultiAgentResult["reports"][number]["agent"][] = [
  "data",
  "fundamental",
  "technical",
  "news",
  "chart",
  "historical",
  "risk",
];

function verdictTone(verdict: "BUY" | "HOLD" | "PASS"): { bg: string; fg: string } {
  switch (verdict) {
    case "BUY":  return { bg: "var(--gain-bg)", fg: "var(--gain-fg)" };
    case "PASS": return { bg: "var(--loss-bg)", fg: "var(--loss-fg)" };
    default:     return { bg: "var(--accent-soft-bg)", fg: "var(--accent)" };
  }
}

export default function MultiAgentRunner() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MultiAgentResult | null>(null);

  async function run() {
    const t = ticker.trim().toUpperCase();
    if (!t) {
      setError("Enter a ticker first");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/analysis/multi-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
      setResult(payload as MultiAgentResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  // Build a quick ordered map of reports for the pipeline visualization.
  const reportsByAgent = new Map(result?.reports.map((r) => [r.agent, r]) ?? []);
  const tone = result ? verdictTone(result.moderator.verdict) : null;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Multi-Agent Analysis</p>
          <p className="t-caption">
            7 specialised agents inspect the ticker from different angles. The Moderator
            synthesises a final BUY / HOLD / PASS verdict with confidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={ticker}
            disabled={loading}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="AAPL"
            maxLength={10}
            className="w-24 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-center text-[13px] font-mono uppercase outline-none"
          />
          <button
            type="button"
            onClick={run}
            disabled={loading || !ticker.trim()}
            className="mds-button mds-button--primary h-9 px-4 text-[12px]"
          >
            {loading ? "Analysing..." : "Run analysis"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p> : null}

      {/* Pipeline progress strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-[var(--bg-raised)] p-3">
        {PIPELINE_ORDER.map((agent, i) => {
          const r = reportsByAgent.get(agent);
          const active = !!r;
          const stub = r?.status === "stub";
          return (
            <div key={agent} className="flex items-center gap-2">
              <span
                className="flex h-7 min-w-7 items-center justify-center rounded px-2 font-mono text-[11px] font-bold uppercase"
                style={{
                  background: active ? (stub ? "var(--bg-surface)" : "var(--accent-soft-bg)") : "transparent",
                  color: active ? (stub ? "var(--fg-3)" : "var(--accent)") : "var(--fg-3)",
                  border: "1px solid var(--line)",
                }}
              >
                {agent}
              </span>
              {i < PIPELINE_ORDER.length - 1 ? (
                <span className="text-[var(--fg-3)]">→</span>
              ) : null}
            </div>
          );
        })}
        <span className="text-[var(--fg-3)]">→</span>
        <span
          className="rounded px-2 py-1 font-mono text-[11px] font-bold uppercase"
          style={tone ? { background: tone.bg, color: tone.fg, border: "1px solid var(--line)" } : { color: "var(--fg-3)", border: "1px solid var(--line)" }}
        >
          {result ? result.moderator.verdict : "moderator"}
        </span>
      </div>

      {/* Moderator consensus card */}
      {result ? (
        <div
          className="mb-4 rounded-lg border p-4"
          style={{
            background: tone?.bg ?? "var(--bg-raised)",
            borderColor: "var(--line)",
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p
              className="font-mono text-3xl font-bold"
              style={{ color: tone?.fg }}
            >
              {result.moderator.verdict}
            </p>
            <p className="font-mono text-[13px]" style={{ color: tone?.fg }}>
              confidence {result.moderator.confidence} / 100
            </p>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-1)]">
            {result.moderator.rationale}
          </p>
        </div>
      ) : null}

      {/* Per-agent cards */}
      <div className="space-y-2">
        {result?.reports.map((r) => (
          <MultiAgentAnalysisCard key={r.agent} report={r} />
        ))}
        {!result && !loading ? (
          <p className="t-body-small text-[var(--fg-3)]">
            Enter a ticker and click <strong>Run analysis</strong> to see the full 7-agent breakdown.
          </p>
        ) : null}
      </div>
    </section>
  );
}
