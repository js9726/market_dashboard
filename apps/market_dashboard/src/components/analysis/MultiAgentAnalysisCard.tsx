"use client";

import { useState } from "react";
import type { AgentReport } from "@/lib/analysis/agents";

interface Props {
  report: AgentReport;
  defaultOpen?: boolean;
}

const AGENT_LABEL: Record<AgentReport["agent"], string> = {
  data:        "Data",
  fundamental: "Fundamental",
  technical:   "Technical",
  news:        "News",
  chart:       "Chart",
  historical:  "Historical",
  risk:        "Risk",
  moderator:   "Moderator",
};

const AGENT_ICON: Record<AgentReport["agent"], string> = {
  data:        "D",
  fundamental: "F",
  technical:   "T",
  news:        "N",
  chart:       "C",
  historical:  "H",
  risk:        "R",
  moderator:   "M",
};

function verdictTone(verdict: AgentReport["verdict"]): { bg: string; fg: string; label: string } {
  switch (verdict) {
    case "bullish":  return { bg: "var(--gain-bg)", fg: "var(--gain-fg)", label: "BULLISH" };
    case "bearish":  return { bg: "var(--loss-bg)", fg: "var(--loss-fg)", label: "BEARISH" };
    case "neutral":  return { bg: "var(--bg-raised)", fg: "var(--fg-2)",  label: "NEUTRAL" };
    default:         return { bg: "var(--bg-raised)", fg: "var(--fg-3)",  label: "—" };
  }
}

function statusTone(status: AgentReport["status"]): { bg: string; fg: string; label: string } {
  switch (status) {
    case "ok":      return { bg: "var(--gain-bg)", fg: "var(--gain-fg)", label: "REPORT COMPLETED" };
    case "stub":    return { bg: "var(--bg-raised)", fg: "var(--fg-3)",  label: "COMING SOON" };
    case "skipped": return { bg: "var(--bg-raised)", fg: "var(--fg-3)",  label: "SKIPPED" };
    case "error":   return { bg: "var(--loss-bg)", fg: "var(--loss-fg)", label: "ERROR" };
  }
}

export default function MultiAgentAnalysisCard({ report, defaultOpen }: Props) {
  const [open, setOpen] = useState(defaultOpen ?? report.status === "ok");
  const verdict = verdictTone(report.verdict);
  const status = statusTone(report.status);

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--bg-raised)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span
            className="flex h-7 w-7 items-center justify-center rounded font-mono text-[12px] font-bold"
            style={{ background: verdict.bg, color: verdict.fg }}
          >
            {AGENT_ICON[report.agent]}
          </span>
          <div>
            <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-[var(--fg-1)]">
              {AGENT_LABEL[report.agent]} Agent
            </p>
            <p className="t-caption" style={{ color: status.fg }}>
              {status.label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {report.status === "ok" || report.status === "error" ? (
            <span
              className="rounded px-2 py-1 font-mono text-[11px] font-bold"
              style={{ background: verdict.bg, color: verdict.fg }}
            >
              {verdict.label} · {report.confidence}
            </span>
          ) : null}
          <span className="font-mono text-[var(--fg-3)]">{open ? "−" : "+"}</span>
        </div>
      </button>

      {open ? (
        <div className="border-t border-[var(--line)] px-4 py-3">
          <p className="text-[13px] leading-relaxed text-[var(--fg-1)]">{report.headline}</p>
          {report.details.length > 0 ? (
            <ul className="mt-2 space-y-1 text-[12px] leading-relaxed text-[var(--fg-2)]">
              {report.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
          {report.metrics ? (
            <details className="mt-3 t-caption">
              <summary className="cursor-pointer">Raw metrics</summary>
              <pre className="mt-2 overflow-x-auto rounded bg-[var(--bg-surface)] p-2 font-mono text-[10px]">
                {JSON.stringify(report.metrics, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
