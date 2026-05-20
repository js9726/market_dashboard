/**
 * POST /api/analysis/multi-agent
 *
 * Body:
 *   { ticker: string, accountSize?: number, riskPct?: number, rMultiple?: number }
 *
 * Runs the 7-agent pipeline against the supplied ticker:
 *   Data → Fundamental → Technical → News (stub) → Chart (stub) →
 *   Historical (stub) → Risk → Moderator
 *
 * Fundamental + Technical reuse the existing single-ticker agents (cheap +
 * already gated on DEEPSEEK_API_KEY). The three stubs return placeholder
 * reports — Feature 4b will fill them in.
 *
 * Result is one MultiAgentResult JSON. Sibling to /api/analysis which is
 * kept untouched so chat + scan callers don't regress.
 */
import { auth } from "@/auth";
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import type { AgentReport, MultiAgentResult } from "@/lib/analysis/agents";
import {
  runChartAgentStub,
  runDataAgent,
  runHistoricalAgentStub,
  runModerator,
  runNewsAgentStub,
  runRiskAgent,
} from "@/lib/analysis/agents";
import { fundamentalsAgent } from "../../../../../agents/fundamental/capability";
import { technicalAgent } from "../../../../../agents/technical/capability";
import { formatTickers } from "@/utils/format";
import type { MarketSnapshot, TickerRow } from "@/types/market-dashboard";
import type { AgentMessage } from "@/types/agent";

export const dynamic = "force-dynamic";

async function loadSnapshotRow(ticker: string): Promise<TickerRow | null> {
  try {
    const snapshotPath = path.join(
      process.cwd(),
      "public",
      "market-dashboard",
      "snapshot.json",
    );
    const raw = await fs.readFile(snapshotPath, "utf-8");
    const snap = JSON.parse(raw) as MarketSnapshot;
    for (const group of Object.values(snap.groups ?? {})) {
      const hit = group.find((r) => r.ticker === ticker);
      if (hit) return hit;
    }
    return null;
  } catch {
    return null;
  }
}

function adaptLegacyAgent(
  agent: "fundamental" | "technical",
  signals: Record<string, unknown>,
): AgentReport {
  const key = agent === "fundamental" ? "fundamentals_agent" : "technical_agent";
  const raw = signals[key];
  if (!raw || typeof raw !== "object") {
    return {
      agent,
      status: agent === "technical" && !process.env.DEEPSEEK_API_KEY ? "skipped" : "error",
      verdict: "unknown",
      confidence: 0,
      headline: agent === "technical" && !process.env.DEEPSEEK_API_KEY
        ? `Technical analysis skipped — DEEPSEEK_API_KEY not set.`
        : `${agent} agent returned no signal.`,
      details: [],
    };
  }

  // The legacy agents nest per-ticker results. Take the first ticker's payload.
  const perTicker = raw as Record<string, unknown>;
  const firstKey = Object.keys(perTicker)[0];
  if (!firstKey) {
    return {
      agent,
      status: "error",
      verdict: "unknown",
      confidence: 0,
      headline: `${agent} agent returned an empty signal.`,
      details: [],
    };
  }

  const payload = perTicker[firstKey] as Record<string, unknown>;
  const signal = String(payload.signal ?? "neutral").toLowerCase();
  let verdict: AgentReport["verdict"] = "neutral";
  if (signal.includes("bull") || signal === "buy") verdict = "bullish";
  else if (signal.includes("bear") || signal === "sell") verdict = "bearish";

  const confidence = typeof payload.confidence === "number"
    ? Math.round(payload.confidence)
    : 50;
  const reasoning = typeof payload.reasoning === "string" ? payload.reasoning : "";

  return {
    agent,
    status: "ok",
    verdict,
    confidence,
    headline: reasoning.split("\n")[0]?.slice(0, 200) || `${agent} signal: ${signal}.`,
    details: reasoning
      ? reasoning.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 6)
      : [`Raw signal: ${signal}.`],
    metrics: Object.fromEntries(
      Object.entries(payload).filter(([, v]) => typeof v === "number" || typeof v === "string"),
    ) as Record<string, number | string | null>,
  };
}

interface RequestBody {
  ticker?: unknown;
  accountSize?: unknown;
  riskPct?: unknown;
  rMultiple?: unknown;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.ticker !== "string" || !body.ticker.trim()) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }
  const [ticker] = formatTickers([body.ticker]);
  if (!ticker) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  // ── Data agent ─────────────────────────────────────────────────────────
  const row = await loadSnapshotRow(ticker);
  const dataReport = runDataAgent(ticker, row);

  // ── Fundamental + Technical (reuse existing) ───────────────────────────
  const state = {
    data: {
      tickers: [ticker],
      end_date: new Date().toISOString(),
      analyst_signals: {} as Record<string, unknown>,
    },
    metadata: { show_reasoning: true },
  };

  let fundamentalReport: AgentReport;
  try {
    const out = await fundamentalsAgent(state);
    fundamentalReport = adaptLegacyAgent("fundamental", out.data.analyst_signals);
  } catch (e) {
    fundamentalReport = {
      agent: "fundamental",
      status: "error",
      verdict: "unknown",
      confidence: 0,
      headline: e instanceof Error ? e.message : "Fundamental agent error.",
      details: [],
    };
  }

  let technicalReport: AgentReport;
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const empty: { messages: AgentMessage[]; data: typeof state.data } = {
        messages: [],
        data: { ...state.data, analyst_signals: { technical_agent: {} } },
      };
      const out = (await technicalAgent(state).catch(() => empty));
      technicalReport = adaptLegacyAgent("technical", out.data.analyst_signals);
    } catch (e) {
      technicalReport = {
        agent: "technical",
        status: "error",
        verdict: "unknown",
        confidence: 0,
        headline: e instanceof Error ? e.message : "Technical agent error.",
        details: [],
      };
    }
  } else {
    technicalReport = adaptLegacyAgent("technical", {});
  }

  // ── Stubs ──────────────────────────────────────────────────────────────
  const newsReport = runNewsAgentStub(ticker);
  const chartReport = runChartAgentStub(ticker);
  const historicalReport = runHistoricalAgentStub(ticker);

  // ── Risk agent ─────────────────────────────────────────────────────────
  const accountSize = typeof body.accountSize === "number" ? body.accountSize : 10_000;
  const riskPct = typeof body.riskPct === "number" ? body.riskPct : 1;
  const rMultiple = typeof body.rMultiple === "number" ? body.rMultiple : 2;
  const riskReport = runRiskAgent(ticker, row && row.atr_pct ? {
    price: (() => {
      // We don't store absolute price in snapshot.json — fundamental agent has it.
      // Pull from fundamentalReport.metrics.price if present, else fall back to ATR-only sizing.
      const p = fundamentalReport.metrics?.price;
      return typeof p === "number" ? p : 100;
    })(),
    atrPct: row.atr_pct,
    accountSize,
    riskPct,
    rMultiple,
  } : null);

  // ── Moderator ──────────────────────────────────────────────────────────
  const reports: AgentReport[] = [
    dataReport,
    fundamentalReport,
    technicalReport,
    newsReport,
    chartReport,
    historicalReport,
    riskReport,
  ];
  const moderator = runModerator(reports);

  const result: MultiAgentResult = {
    ticker,
    generatedAt: new Date().toISOString(),
    reports,
    moderator,
  };

  return NextResponse.json(result);
}
