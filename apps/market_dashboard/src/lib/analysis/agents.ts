/**
 * Multi-agent analysis pipeline — Feature 4.
 *
 * Seven specialised agents inspect a ticker from different angles and the
 * Moderator synthesises their verdicts into a single recommendation.
 *
 * Three agents are REAL (Data + Risk + Moderator — pure deterministic logic),
 * two REUSE existing implementations (Fundamental + Technical), and three are
 * stubs (News + Chart + Historical) that ship the pipeline shape today and
 * get filled in Feature 4b once we wire web-search + pattern-detection +
 * a lookback DB.
 *
 * Pure types + the Moderator's synthesis live in this file so they can be
 * unit-tested without spinning up a server. The route handler orchestrates.
 */

import type { TickerRow } from "@/types/market-dashboard";

export type AgentRole =
  | "data"
  | "fundamental"
  | "technical"
  | "news"
  | "chart"
  | "historical"
  | "risk"
  | "moderator";

export type AgentVerdict = "bullish" | "neutral" | "bearish" | "unknown";

export interface AgentReport {
  agent: AgentRole;
  status: "ok" | "stub" | "skipped" | "error";
  verdict: AgentVerdict;
  confidence: number;      // 0-100
  headline: string;        // one-sentence summary
  details: string[];       // bullet points rendered in the expanded card
  /** Free-form numeric payload — what was actually observed. */
  metrics?: Record<string, number | string | null>;
}

export interface ModeratorOutput {
  verdict: "BUY" | "HOLD" | "PASS";
  confidence: number;       // 0-100, confidence in the verdict itself
  rationale: string;        // one-sentence explanation
  votes: Record<AgentVerdict, number>;
  components: Array<{ agent: AgentRole; verdict: AgentVerdict; weight: number }>;
}

export interface MultiAgentResult {
  ticker: string;
  generatedAt: string;
  reports: AgentReport[];
  moderator: ModeratorOutput;
}

/**
 * Per-agent contribution weight to the moderator vote. Tuned so the agents
 * with the cleanest signal (Risk + Technical + Fundamental) dominate; the
 * three stubs contribute zero until they ship for real (Feature 4b).
 */
export const AGENT_WEIGHTS: Record<AgentRole, number> = {
  data:        0.10,
  fundamental: 0.20,
  technical:   0.20,
  news:        0.00, // stub
  chart:       0.00, // stub
  historical:  0.00, // stub
  risk:        0.30,
  moderator:   0.00, // synthesises, doesn't vote on itself
};

// ── DATA AGENT ────────────────────────────────────────────────────────────
//
// Reads the row for `ticker` from snapshot.json's groups (any of Indices /
// Sectors / Industries / Countries / Stocks). Verdict comes from change %
// and distance from 50-SMA.
//
export function runDataAgent(
  ticker: string,
  row: TickerRow | null,
): AgentReport {
  if (!row) {
    return {
      agent: "data",
      status: "skipped",
      verdict: "unknown",
      confidence: 0,
      headline: `${ticker} not present in today's snapshot.`,
      details: [
        "The Data Agent reads from snapshot.json. Outside-universe tickers fall through.",
        "Consider adding the ticker to STOCK_GROUPS in build_data.py.",
      ],
    };
  }

  const daily = row.daily ?? 0;
  const distAtr = row.dist_sma50_atr ?? 0;
  const rs = row.rs ?? 50;

  let verdict: AgentVerdict = "neutral";
  if (daily >= 1.5 && distAtr > 0.5 && rs >= 60) verdict = "bullish";
  else if (daily <= -1.5 || distAtr < -1) verdict = "bearish";

  // Confidence scales with magnitude of the signal.
  const confidence = Math.min(
    100,
    Math.round(Math.abs(daily) * 8 + Math.abs(distAtr) * 4 + Math.abs(rs - 50) * 0.6),
  );

  return {
    agent: "data",
    status: "ok",
    verdict,
    confidence,
    headline: `${ticker} ${daily >= 0 ? "+" : ""}${daily.toFixed(2)}% today, ${rs.toFixed(0)} RS, ${distAtr.toFixed(2)} ATR from SMA50.`,
    details: [
      `Daily change: ${daily.toFixed(2)}% (intra ${(row.intra ?? 0).toFixed(2)}%).`,
      `5-day: ${(row["5d"] ?? 0).toFixed(2)}%, 20-day: ${(row["20d"] ?? 0).toFixed(2)}%.`,
      `Relative strength vs SPY: ${rs.toFixed(0)} / 100.`,
      `Distance from 50-SMA: ${distAtr.toFixed(2)} ATR. ABC rating ${row.abc ?? "-"}.`,
      row.rvol != null ? `RVOL: ${row.rvol.toFixed(2)}x avg.` : "RVOL not available.",
      row.off_52w_high_pct != null
        ? `${row.off_52w_high_pct.toFixed(1)}% off 52W high.`
        : "52W distance not available.",
    ],
    metrics: {
      daily,
      intra: row.intra,
      "5d": row["5d"],
      "20d": row["20d"],
      rs,
      dist_sma50_atr: distAtr,
      atr_pct: row.atr_pct,
      rvol: row.rvol ?? null,
      off_52w_high_pct: row.off_52w_high_pct ?? null,
      abc: row.abc ?? null,
    },
  };
}

// ── RISK AGENT ────────────────────────────────────────────────────────────
//
// Pure trade-management math. Given current price + ATR%, compute a
// 2-ATR stop, 4-ATR target (2R), and a position size for 1% account risk.
// Verdict is bullish only if the R:R is acceptable AND ATR is in a sane band.
//
export interface RiskInput {
  price: number;
  atrPct: number;     // ATR as % of price
  accountSize?: number;
  riskPct?: number;   // % of account risk per trade
  rMultiple?: number; // target reward multiple of risk
}

export function runRiskAgent(ticker: string, input: RiskInput | null): AgentReport {
  if (!input || input.price <= 0 || input.atrPct <= 0) {
    return {
      agent: "risk",
      status: "skipped",
      verdict: "unknown",
      confidence: 0,
      headline: `Cannot compute risk for ${ticker}: missing price or ATR.`,
      details: ["Need a positive price and a positive ATR% to run risk math."],
    };
  }
  const account = input.accountSize ?? 10_000;
  const riskFrac = (input.riskPct ?? 1) / 100;
  const rMult = input.rMultiple ?? 2;

  const atrAbsolute = (input.atrPct / 100) * input.price;
  const stop = input.price - 2 * atrAbsolute;
  const target = input.price + rMult * (input.price - stop);
  const riskPerShare = input.price - stop;
  const riskBudget = account * riskFrac;
  const shares = riskPerShare > 0 ? Math.floor(riskBudget / riskPerShare) : 0;
  const positionValue = shares * input.price;

  let verdict: AgentVerdict = "neutral";
  if (input.atrPct > 8) {
    verdict = "bearish"; // too volatile — sizing forces tiny positions
  } else if (input.atrPct >= 1.5 && input.atrPct <= 5 && shares > 0) {
    verdict = "bullish"; // clean sizing window
  }

  const confidence = verdict === "bullish" ? 70 :
                     verdict === "bearish" ? 60 :
                     40;

  return {
    agent: "risk",
    status: "ok",
    verdict,
    confidence,
    headline: `2-ATR stop at $${stop.toFixed(2)}; ${rMult}R target $${target.toFixed(2)}; size ${shares} sh ($${positionValue.toFixed(0)}).`,
    details: [
      `Entry $${input.price.toFixed(2)}, ATR ${input.atrPct.toFixed(1)}% ($${atrAbsolute.toFixed(2)}).`,
      `Stop ${input.price > 0 ? ((stop / input.price - 1) * 100).toFixed(1) : "-"}% below entry → $${stop.toFixed(2)}.`,
      `Target ${rMult}R above entry → $${target.toFixed(2)}.`,
      `Account $${account.toFixed(0)} × ${(riskFrac * 100).toFixed(1)}% risk = $${riskBudget.toFixed(0)} budget.`,
      `Position: ${shares} shares ($${positionValue.toFixed(0)} notional).`,
      input.atrPct > 8 ? "⚠ ATR > 8% — position size would be too small for clean management." : "",
    ].filter(Boolean),
    metrics: {
      entry: input.price,
      stop,
      target,
      atrPct: input.atrPct,
      rMultiple: rMult,
      shares,
      positionValue,
      riskBudget,
    },
  };
}

// ── STUB AGENTS ───────────────────────────────────────────────────────────
// Ship the pipeline shape; real implementations land in Feature 4b.

export function runNewsAgentStub(ticker: string): AgentReport {
  return {
    agent: "news",
    status: "stub",
    verdict: "unknown",
    confidence: 0,
    headline: `News agent: ${ticker} — web-search integration pending (Feature 4b).`,
    details: [
      "Will scrape headline sentiment via the Anthropic web-search beta + Gemini grounding.",
      "Outputs: catalyst classification, sentiment score, breaking-news flag.",
    ],
  };
}

export function runChartAgentStub(ticker: string): AgentReport {
  return {
    agent: "chart",
    status: "stub",
    verdict: "unknown",
    confidence: 0,
    headline: `Chart agent: ${ticker} — pattern detection pending (Feature 4b).`,
    details: [
      "Will detect VCP / cup-and-handle / breakout shapes from per-bar OHLCV.",
      "Outputs: pattern name + days-into-pattern + clean-base score.",
    ],
  };
}

export function runHistoricalAgentStub(ticker: string): AgentReport {
  return {
    agent: "historical",
    status: "stub",
    verdict: "unknown",
    confidence: 0,
    headline: `Historical agent: ${ticker} — analog lookup pending (Feature 4b).`,
    details: [
      "Will search the breadth_history archive for analogous setups + outcomes.",
      "Outputs: count of analogous setups, hit-rate, average forward return.",
    ],
  };
}

// ── MODERATOR ────────────────────────────────────────────────────────────
//
// Weighted vote across the agents. BUY when bullish weight clearly dominates,
// PASS when bearish dominates, HOLD otherwise. Confidence scales with the
// strength of the consensus.
//
export function runModerator(reports: AgentReport[]): ModeratorOutput {
  const votes: Record<AgentVerdict, number> = {
    bullish: 0,
    neutral: 0,
    bearish: 0,
    unknown: 0,
  };
  const components: ModeratorOutput["components"] = [];

  for (const r of reports) {
    const weight = AGENT_WEIGHTS[r.agent] * (r.confidence / 100);
    votes[r.verdict] += weight;
    components.push({ agent: r.agent, verdict: r.verdict, weight });
  }

  const total = votes.bullish + votes.bearish + votes.neutral;
  if (total === 0) {
    return {
      verdict: "HOLD",
      confidence: 0,
      rationale: "No agent produced a usable signal. Default to HOLD.",
      votes,
      components,
    };
  }

  const bullishShare = votes.bullish / total;
  const bearishShare = votes.bearish / total;

  let verdict: ModeratorOutput["verdict"];
  let rationale: string;
  if (bullishShare > 0.55 && bullishShare - bearishShare > 0.20) {
    verdict = "BUY";
    rationale = `Bullish consensus: ${(bullishShare * 100).toFixed(0)}% of weighted agent votes.`;
  } else if (bearishShare > 0.55 && bearishShare - bullishShare > 0.20) {
    verdict = "PASS";
    rationale = `Bearish consensus: ${(bearishShare * 100).toFixed(0)}% of weighted agent votes.`;
  } else {
    verdict = "HOLD";
    rationale = `Mixed signal: bullish ${(bullishShare * 100).toFixed(0)}% / bearish ${(bearishShare * 100).toFixed(0)}% — wait for cleaner setup.`;
  }

  // Confidence: how lopsided is the vote vs how much agent weight participated.
  const dominance = Math.abs(bullishShare - bearishShare);
  const participation = total / Object.values(AGENT_WEIGHTS).reduce((a, b) => a + b, 0);
  const confidence = Math.round(Math.min(100, dominance * 100 * 0.7 + participation * 100 * 0.3));

  return { verdict, confidence, rationale, votes, components };
}
