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
import { adaptLegacyReport, usableSnapshotRow } from "@/lib/analysis/legacy-report";
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
    return usableSnapshotRow(ticker, snap);
  } catch {
    return null;
  }
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
  for (const name of ["accountSize", "riskPct", "rMultiple"] as const) {
    const value = body[name];
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value <= 0
      || (name === "riskPct" && value > 100))) {
      return NextResponse.json({ error: `${name} must be a positive finite number${name === "riskPct" ? " no greater than 100" : ""}.` }, { status: 400 });
    }
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
    fundamentalReport = adaptLegacyReport("fundamental", ticker, out.data.analyst_signals);
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
      technicalReport = adaptLegacyReport("technical", ticker, out.data.analyst_signals);
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
    technicalReport = adaptLegacyReport("technical", ticker, {});
  }

  // ── Stubs ──────────────────────────────────────────────────────────────
  const newsReport = runNewsAgentStub(ticker);
  const chartReport = runChartAgentStub(ticker);
  const historicalReport = runHistoricalAgentStub(ticker);

  // ── Risk agent ─────────────────────────────────────────────────────────
  const accountSize = typeof body.accountSize === "number" ? body.accountSize : undefined;
  const riskPct = typeof body.riskPct === "number" ? body.riskPct : undefined;
  const rMultiple = typeof body.rMultiple === "number" ? body.rMultiple : undefined;
  const price = row?.price ?? row?.close;
  const riskReport = runRiskAgent(ticker, row && typeof row.atr_pct === "number" && typeof price === "number" ? {
    price, atrPct: row.atr_pct, accountSize, riskPct, rMultiple,
  } : null);

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
