import type { AgentReport } from "./agents";
import type { MarketSnapshot, TickerRow } from "@/types/market-dashboard";

export function usableSnapshotRow(ticker: string, snapshot: MarketSnapshot, now = Date.now()): TickerRow | null {
  const builtAt = Date.parse(snapshot.built_at);
  const age = now - builtAt;
  if (!Number.isFinite(builtAt) || age < -5 * 60_000 || age > 180 * 60_000) return null;
  for (const group of Object.values(snapshot.groups ?? {})) {
    const row = Array.isArray(group) ? group.find(r => r.ticker === ticker) : null;
    if (row) return row;
  }
  return null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function metrics(value: unknown, prefix = ""): NonNullable<AgentReport["metrics"]> {
  const result: NonNullable<AgentReport["metrics"]> = {};
  for (const [key, item] of Object.entries(object(value))) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (item === null || typeof item === "string" || (typeof item === "number" && Number.isFinite(item))) {
      result[name] = item;
    } else if (item && typeof item === "object") Object.assign(result, metrics(item, name));
  }
  return result;
}

/** Legacy summaries retain observed metrics, but are not complete wiki research reports. */
export function adaptLegacyReport(
  agent: "fundamental" | "technical", ticker: string, signals: Record<string, unknown>,
): AgentReport {
  const key = agent === "fundamental" ? "fundamentals_agent" : "technical_agent";
  const payload = object(object(signals[key])[ticker]);
  const observed = metrics(payload.metrics);
  // Technical failure payloads contain fabricated zero-valued indicators. Do not display them.
  const validMetrics = agent === "technical" && payload.analysisAvailable !== true ? {} : observed;
  const available = payload.analysisAvailable === true
    && ["bullish", "bearish", "neutral"].includes(String(payload.signal))
    && typeof payload.confidence === "number" && Number.isFinite(payload.confidence)
    && payload.confidence >= 0 && payload.confidence <= 100;
  const sections = object(agent === "technical" ? payload.trader_signals : payload.reasoning);
  const details = available ? Object.entries(sections).flatMap(([name, raw]) => {
    const section = object(raw);
    return typeof section.details === "string" && section.details.trim()
      ? [`${name.replace(/_/g, " ")}: ${section.details}`] : [];
  }) : [];
  const hasMetrics = Object.values(validMetrics).some(v => typeof v === "number");
  const reason = typeof payload.analysisReason === "string" ? payload.analysisReason : "No verified analysis output.";
  return {
    agent, status: available || hasMetrics ? "partial" : "skipped",
    verdict: "unknown", confidence: 0,
    headline: available ? `${ticker}: preliminary ${agent} findings; full research is incomplete.`
      : hasMetrics ? `${ticker}: financial metrics available; analysis unavailable.` : `${ticker}: ${agent} analysis unavailable.`,
    details: [reason, ...details,
      agent === "fundamental"
        ? "Still required: business and moat, named peers, sourced financial periods and the canonical fundamental rubric."
        : "Still required: verified daily/weekly charts, real ATR/RVOL, seven trader lenses and Conviction scoring.",
      "Legacy source timestamps are not supplied. These findings are not a current trade recommendation."],
    ...(hasMetrics ? { metrics: validMetrics } : {}),
  };
}
