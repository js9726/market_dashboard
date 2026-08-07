import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  campaignWorstCase,
  convictionRiskCap,
  evaluateTradingSession,
  renderTradingSessionMarkdown,
} from "../session";
import { tradingRulesPayloadSchema } from "../rules";
import { mostRecentlyCompletedUsSession, parseJournalThought } from "../thoughts";

function baseSession() {
  const focusList: Array<Record<string, unknown>> = [];
  const entries: Array<Record<string, unknown>> = [];
  const exits: Array<Record<string, unknown>> = [];
  const openPositions: Array<Record<string, unknown>> = [];
  return {
    schemaVersion: "trading-journal/v2",
    sessionDate: "2026-08-03",
    source: "backfill",
    generatedAt: "2026-08-04T12:00:00.000Z",
    owner: { provider: "openai", verdict: "WATCH", reason: "No fresh trigger confirmed" },
    validator: null,
    market: {
      regime: "MIXED_SELECTIVE",
      traction: "YELLOW",
      fearGreed: 20,
      summary: "Breadth and index structure conflicted.",
      eventOverlay: "None identified",
      themes: [],
    },
    focusList,
    entries,
    exits,
    openPositions,
    review: { userThoughts: null, thoughtSource: null, aiAnalysis: "No psychology inferred.", learnings: [] },
    risk: { mtdDrawdownPct: 0, portfolioRiskPct: 0, explicitBlockReasons: [] },
    sheetDiscrepancies: [],
    evidence: [],
  };
}

describe("trading journal session module", () => {
  it("blocks new live risk when any live position lacks an active broker stop", () => {
    const input = baseSession();
    input.openPositions = [{
      broker: "moomoo Malaysia",
      accountType: "LIVE",
      ticker: "HPE",
      quantity: 10,
      avgCost: 20,
      tradingDaysHeld: 2,
      stopPrice: null,
      stopStatus: "MISSING",
      stopAtBreakeven: false,
      trimmed: false,
    }];
    const result = evaluateTradingSession(input);
    expect(result.riskBlocked).toBe(true);
    expect(result.violations).toContain("moomoo Malaysia:HPE is UNPROTECTED");
    expect(renderTradingSessionMarkdown(result)).toContain("UNPROTECTED");
  });

  it("keeps GO visible while an independent risk block is active", () => {
    const input = baseSession();
    input.owner = { provider: "claude", verdict: "GO", reason: "Valid reclaim with volume" };
    input.risk.mtdDrawdownPct = -5;
    const result = evaluateTradingSession(input);
    const markdown = renderTradingSessionMarkdown(result);
    expect(result.riskBlocked).toBe(true);
    expect(markdown).toContain("claude — GO");
    expect(markdown).toContain("MTD drawdown");
  });

  it("uses the approved conviction tiers", () => {
    expect(convictionRiskCap(74)).toBe(0);
    expect(convictionRiskCap(75)).toBe(0.5);
    expect(convictionRiskCap(85)).toBe(0.75);
    expect(convictionRiskCap(90)).toBe(1);
  });

  it("computes same-ticker campaign worst case from realized and protected legs", () => {
    expect(campaignWorstCase({ realizedTrimPnl: 400, corePnlAtStop: 100, addPnlAtStop: -900 })).toBe(-400);
  });

  it.each(["2026-08-03", "2026-07-27"])("validates the %s approved backfill", (date) => {
    const path = resolve(process.cwd(), `../../../jie_wiki/docs/agents/work/ai-managed-trading-journal-v2/backfill-${date}.json`);
    const input = JSON.parse(readFileSync(path, "utf8"));
    const result = evaluateTradingSession(input);
    expect(result.session.sessionDate).toBe(date);
    expect(result.riskBlocked).toBe(true);
  });

  it("validates the approved rule registry", () => {
    const path = resolve(process.cwd(), "../../../jie_wiki/docs/agents/work/ai-managed-trading-journal-v2/rules-v2.json");
    const payload = JSON.parse(readFileSync(path, "utf8"));
    const parsed = tradingRulesPayloadSchema.parse(payload);
    expect(parsed.rules.filter((rule) => rule.stage === "HARD_SAFETY_RULE")).toHaveLength(10);
    expect(parsed.rules.find((rule) => rule.ruleKey === "trim-near-one-r-experiment")?.status).toBe("EXPERIMENT");
  });

  it("captures only explicit journal intent and defaults to the last completed US session", () => {
    const duringSession = new Date("2026-08-04T14:30:00.000Z");
    expect(parseJournalThought("HPE looks good", duringSession)).toBeNull();
    expect(parseJournalThought("/journal HPE looked good but I did not chase", duringSession)).toEqual({
      sessionDate: "2026-08-03",
      text: "HPE looked good but I did not chase",
    });
    expect(parseJournalThought("journal this 2026-07-27 I saved five charts", duringSession)).toEqual({
      sessionDate: "2026-07-27",
      text: "I saved five charts",
    });
    expect(mostRecentlyCompletedUsSession(new Date("2026-08-08T02:00:00.000Z"))).toBe("2026-08-07");
  });
});
