import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { adaptLegacyReport, usableSnapshotRow } from "../analysis/legacy-report";
import type { MarketSnapshot } from "@/types/market-dashboard";
import { runModerator, runRiskAgent } from "../analysis/agents";
import { fundamentalsAgent } from "../../../agents/fundamental/capability";
import { technicalAgent } from "../../../agents/technical/capability";
import { POST } from "@/app/api/analysis/multi-agent/route";

const mocks = vi.hoisted(() => ({ metrics: vi.fn(), llm: vi.fn(), configured: vi.fn(), historical: vi.fn(), auth: vi.fn(), readFile: vi.fn() }));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("node:fs/promises", () => ({ default: { readFile: mocks.readFile } }));
vi.mock("../../../agents/fundamental/tools/api", () => ({ getFinalancialMetrics: mocks.metrics }));
vi.mock("@/utils/llm-router", () => ({ callLLM: mocks.llm }));
vi.mock("@/lib/ai/provider-policy", () => ({ isMeteredLLMProviderConfigured: mocks.configured }));
vi.mock("yahoo-finance2", () => ({ default: { historical: mocks.historical } }));
vi.mock("@/utils/retry", () => ({ withRetry: (fn: () => unknown) => fn() }));

const state = () => ({ data: { tickers: ["NTAP"], end_date: "2026-10-04", analyst_signals: {} }, metadata: { show_reasoning: false } });
beforeEach(() => { vi.resetAllMocks(); mocks.metrics.mockResolvedValue([{ currentPrice: 120, returnOnEquity: null }]); });
afterEach(() => vi.unstubAllEnvs());

describe("truthful legacy reports", () => {
  it("does not invent a price for route-level risk sizing", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-owner" } });
    mocks.readFile.mockResolvedValue(JSON.stringify({ built_at: new Date().toISOString(), groups: { stocks: [
      { ticker: "NTAP", daily: 1, dist_sma50_atr: 1, rs: 60, atr_pct: 2 },
    ] } }));
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    const response = await POST(new Request("https://example.invalid/api/analysis/multi-agent", { method: "POST", body: JSON.stringify({ ticker: "NTAP" }) }));
    const result = await response.json();
    expect(result.reports.find((r: { agent: string }) => r.agent === "risk").status).toBe("skipped");
    expect(result.moderator.verdict).toBe("UNAVAILABLE");
  });

  it("rejects invalid sizing input before running providers", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "test-owner" } });
    const response = await POST(new Request("https://example.invalid/api/analysis/multi-agent", { method: "POST", body: JSON.stringify({ ticker: "NTAP", accountSize: "not a number" }) }));
    expect(response.status).toBe(400);
    expect(mocks.metrics).not.toHaveBeenCalled();
  });
  it("requires a current timestamp before using static ticker data", () => {
    const now = Date.parse("2026-10-04T12:00:00Z");
    const snapshot = { built_at: "2026-10-04T11:00:00Z", groups: { stocks: [{ ticker: "NTAP", price: 120 }] } } as unknown as MarketSnapshot;
    expect(usableSnapshotRow("NTAP", snapshot, now)?.price).toBe(120);
    expect(usableSnapshotRow("AAPL", snapshot, now)).toBeNull();
    for (const built_at of ["", "2026-10-03T11:00:00Z", "2026-10-04T12:10:00Z"]) {
      expect(usableSnapshotRow("NTAP", { ...snapshot, built_at }, now)).toBeNull();
    }
  });
  it("reproduces the screenshot fallback without manufacturing HOLD/8", () => {
    const reports = [adaptLegacyReport("fundamental", "NTAP", {
      fundamentals_agent: { NTAP: { signal: "neutral", confidence: 50, metrics: {} } },
    }), adaptLegacyReport("technical", "NTAP", {
      technical_agent: { NTAP: { signal: "neutral", confidence: 50, metrics: { price: 0, rsi: 50 } } },
    })];
    expect(reports.every(r => r.status === "skipped" && r.verdict === "unknown")).toBe(true);
    expect(reports[1].metrics).toBeUndefined();
    expect(runModerator(reports).verdict).toBe("UNAVAILABLE");
  });

  it("preserves actual nested metrics and explanations without claiming complete research", () => {
    const out = adaptLegacyReport("fundamental", "NTAP", { fundamentals_agent: { NTAP: {
      analysisAvailable: true, signal: "neutral", confidence: 50,
      metrics: { currentPrice: 120, returnOnEquity: null, nested: { value: 4 }, invalid: Infinity },
      reasoning: { growth_signal: { details: "Revenue increased in the reported quarter." } },
    } } });
    expect(out.status).toBe("partial");
    expect(out.metrics).toEqual({ currentPrice: 120, returnOnEquity: null, "nested.value": 4 });
    expect(out.details.join(" ")).toContain("Revenue increased");
    expect(out.verdict).toBe("unknown");
  });

  it("never uses another ticker's output", () => {
    expect(adaptLegacyReport("fundamental", "NTAP", { fundamentals_agent: { AAPL: { metrics: { currentPrice: 120 } } } }).metrics).toBeUndefined();
  });

  it("retains raw financial metrics without a provider, with no fake neutral confidence", async () => {
    mocks.configured.mockReturnValue(false);
    const output = await fundamentalsAgent(state());
    const report = adaptLegacyReport("fundamental", "NTAP", output.data.analyst_signals);
    expect(report.status).toBe("partial");
    expect(report.metrics?.currentPrice).toBe(120);
    expect(report.confidence).toBe(0);
    expect(mocks.llm).not.toHaveBeenCalled();
  });

  it("rejects empty provider JSON and preserves data-only status", async () => {
    mocks.configured.mockReturnValue(true); mocks.llm.mockResolvedValue("{}");
    const output = await fundamentalsAgent(state());
    const payload = (output.data.analyst_signals.fundamentals_agent as Record<string, { analysisAvailable: boolean }>).NTAP;
    expect(payload.analysisAvailable).toBe(false);
    const prompt = mocks.llm.mock.calls[0][0] as string;
    expect(prompt).toContain("Return on Equity: Unavailable");
    expect(prompt).not.toContain("Return on Equity: 0.00%");
  });

  it("does not present failed financial or technical data as completed analysis", async () => {
    mocks.metrics.mockRejectedValue(new Error("offline fixture"));
    mocks.historical.mockRejectedValue(new Error("offline fixture"));
    const fundamental = await fundamentalsAgent(state());
    const technical = await technicalAgent(state());
    expect(adaptLegacyReport("fundamental", "NTAP", fundamental.data.analyst_signals).status).toBe("skipped");
    expect(adaptLegacyReport("technical", "NTAP", technical.data.analyst_signals).metrics).toBeUndefined();
  });

  it("ignores failed votes and non-finite risk inputs", () => {
    expect(runModerator([{ agent: "risk", status: "error", verdict: "bullish", confidence: 100, headline: "", details: [] }]).votes.bullish).toBe(0);
    expect(runRiskAgent("NTAP", { price: NaN, atrPct: 2 }).status).toBe("skipped");
    expect(runRiskAgent("NTAP", { price: 120, atrPct: 2, accountSize: -1 }).status).toBe("skipped");
    expect(runRiskAgent("NTAP", { price: 120, atrPct: 2 }).details.join(" ")).toContain("Illustrative");
  });
});
