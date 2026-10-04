import { describe, expect, it } from "vitest";
import { emptyReport, LENSES, SECTION_KEYS, sourceSchema, validateReport, type Evidence } from "../schema";
const now = new Date("2026-10-04T10:00:00.000Z");
const job = { id: "job-1", ticker: "NTAP", provider: "claude", asOf: now };
function source(kind: Evidence["kind"] = "quote"): Evidence {
  return { id: kind, kind, url: "https://example.com/source", contentHash: "a".repeat(64), text: "Verified source text", asOf: now.toISOString(), retrievedAt: now.toISOString(), expiresAt: "2026-10-04T10:10:00.000Z", period: "2026 Q2", coverageFrom: "2026-07-01T00:00:00.000Z", coverageTo: now.toISOString(), authenticated: true, currentBar: true, movingAverages: true, volume: true, ticker: "NTAP", timezone: "America/New_York" };
}
function complete() {
  const r = emptyReport(job);
  const sources = (["quote", "fundamental", "search_grounded", "chart_daily", "chart_weekly"] as const).map(source);
  for (const k of SECTION_KEYS) r.sections[k] = { status: "complete", summary: "Evidence reviewed", observations: [{ text: "Supported observation", kind: "fact", sourceIds: sources.map(s => s.id) }], gaps: [] };
  r.lenses = LENSES.map(name => ({ name, assessment: "Evidence reviewed", sourceIds: ["chart_daily"] }));
  r.fundamentalGrade = "B";
  r.scores = { setup: 25, entry: 15, theme: 15, sentiment: 5 };
  r.action.verdict = "WATCH";
  return { r, sources };
}
describe("research report evidence gate", () => {
  it("accepts explicit unavailable sections as partial without inventing a score", () => {
    expect(validateReport(emptyReport(job), job, [], now)).toMatchObject({ status: "partial", total: null });
  });
  it("accepts a fully sourced WATCH report", () => {
    const { r, sources } = complete();
    expect(validateReport(r, job, sources, now)).toMatchObject({ status: "succeeded", total: 60 });
  });
  it("rejects wrong job, ticker, provider or as-of", () => {
    for (const field of ["jobId", "ticker", "provider", "asOf"] as const) {
      const r = { ...emptyReport(job), [field]: field === "asOf" ? "2026-10-03T10:00:00.000Z" : "other" };
      expect(() => validateReport(r, job, [], now)).toThrow();
    }
  });
  it("does not let models invent source IDs or cite stale inputs", () => {
    const { r, sources } = complete();
    expect(() => validateReport(r, job, sources.slice(1), now)).toThrow(/source/);
    sources[0].expiresAt = now.toISOString();
    expect(() => validateReport(r, job, sources, now)).toThrow(/source/);
  });
  it("requires grounded news and a verified 90-day coverage window", () => {
    const { r, sources } = complete();
    sources[2].coverageFrom = "2026-10-01T00:00:00.000Z";
    expect(() => validateReport(r, job, sources, now)).toThrow(/90-day/);
    r.sections.latestCatalyst.observations[0].sourceIds = ["quote"];
    expect(() => validateReport(r, job, sources, now)).toThrow(/search-grounded/);
  });
  it("rejects missing weekly charts, grades, periods and trader lenses", () => {
    for (const mutation of [
      (f: ReturnType<typeof complete>) => { f.sources[4].authenticated = false; },
      (f: ReturnType<typeof complete>) => { f.r.fundamentalGrade = null; },
      (f: ReturnType<typeof complete>) => { delete f.sources[1].period; },
      (f: ReturnType<typeof complete>) => { f.r.lenses.pop(); },
    ]) { const f = complete(); mutation(f); expect(() => validateReport(f.r, job, f.sources, now)).toThrow(); }
  });
  it("rejects GO/PROBE even when the model claims structural gates passed", () => {
    const { r, sources } = complete();
    r.scores = { setup: 40, entry: 30, theme: 20, sentiment: 10 };
    r.action.hardGatesPassed = true;
    for (const verdict of ["GO", "PROBE"] as const) { r.action.verdict = verdict; expect(() => validateReport(r, job, sources, now)).toThrow(/structural/); }
  });
  it("rejects wrong-company and ancient fundamentals even when freshly fetched", () => {
    const { r, sources } = complete();
    sources[1].ticker = "AAPL";
    expect(() => validateReport(r, job, sources, now)).toThrow(/subject-company/);
    sources[1].ticker = "NTAP"; sources[1].asOf = "2001-01-01T00:00:00.000Z";
    expect(() => validateReport(r, job, sources, now)).toThrow(/stale/);
  });
  it("rejects technical/conviction completeness supported only by fundamentals", () => {
    const { r, sources } = complete();
    r.sections.technical.observations[0].sourceIds = ["fundamental"];
    r.lenses.forEach(l => { l.sourceIds = ["fundamental"]; });
    expect(() => validateReport(r, job, sources, now)).toThrow(/Technical assessment/);
  });
  it("rejects invented and inverted price plans even in an unavailable report", () => {
    const r = emptyReport(job);
    Object.assign(r.action, { entry: 100, stop: 200, target: 50, atr: 5 });
    expect(() => validateReport(r, job, [], now)).toThrow(/risk levels/);
    Object.assign(r.action, { entry: 100, stop: 95, target: 110, atr: 5 });
    expect(() => validateReport(r, job, [], now)).toThrow(/risk levels/);
  });
  it("rejects missing sections, nonfinite scores and unsafe source URLs", () => {
    expect(() => validateReport({ ...emptyReport(job), sections: {} }, job, [], now)).toThrow();
    const r = emptyReport(job); r.scores.setup = NaN;
    expect(() => validateReport(r, job, [], now)).toThrow();
    expect(sourceSchema.safeParse({ ...source(), url: "javascript:alert(1)" }).success).toBe(false);
  });
});
