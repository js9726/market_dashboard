import { z } from "zod";

export const VERSION = "trading-research/v1" as const;
export const PROMPT_VERSION = "research-2026-10-04";
export const SECTION_KEYS = ["latestCatalyst", "business", "peers", "fundamentals", "news90d", "insiderInstitutional", "sectorContext", "upcoming30d", "technical", "chartEvidence", "conviction", "action", "risk"] as const;
export const LENSES = ["@markminervini", "@Clement_Ang17", "@jfsrev", "@TedHZhang", "@SRxTrades", "@PrimeTrading_", "@Qullamaggie"] as const;
const text = z.string().trim().min(1).max(6000);
const timestamp = z.string().datetime({ offset: true });
export const requestSchema = z.object({
  requestKey: z.string().uuid(), ticker: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.-]{0,9}$/),
  provider: z.enum(["claude", "deepseek"]), threadId: z.string().cuid().optional(),
  horizon: z.enum(["swing", "position"]).default("swing"), question: text.max(2000),
}).strict();
export const sourceSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
  kind: z.enum(["quote", "fundamental", "search_grounded", "chart_daily", "chart_weekly"]),
  url: z.string().url().refine(s => /^https:\/\//.test(s), "HTTPS source required"),
  asOf: timestamp, retrievedAt: timestamp, expiresAt: timestamp,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), text: text.max(30000),
  period: z.string().max(100).optional(), coverageFrom: timestamp.optional(), coverageTo: timestamp.optional(),
  authenticated: z.boolean().optional(), currentBar: z.boolean().optional(),
  movingAverages: z.boolean().optional(), volume: z.boolean().optional(),
  ticker: z.string().optional(), timezone: z.string().max(80).optional(),
}).strict();
export type Evidence = z.infer<typeof sourceSchema>;
const section = z.object({
  status: z.enum(["complete", "partial", "unavailable"]), summary: z.string().max(6000),
  observations: z.array(z.object({ text, kind: z.enum(["fact", "source_claim", "inference"]), sourceIds: z.array(z.string()).max(20) }).strict()).max(30),
  gaps: z.array(text).max(20),
}).strict();
const score = (max: number) => z.number().finite().min(0).max(max).nullable();
export const reportSchema = z.object({
  schemaVersion: z.literal(VERSION), jobId: z.string(), ticker: z.string(), provider: z.enum(["claude", "deepseek"]), asOf: timestamp,
  sections: z.object(Object.fromEntries(SECTION_KEYS.map(key => [key, section])) as Record<typeof SECTION_KEYS[number], typeof section>).strict(),
  fundamentalGrade: z.enum(["A", "B", "C"]).nullable(),
  lenses: z.array(z.object({ name: z.enum(LENSES), assessment: text, sourceIds: z.array(z.string()).max(20) }).strict()).max(7),
  scores: z.object({ setup: score(40), entry: score(30), theme: score(20), sentiment: score(10) }).strict(),
  action: z.object({ verdict: z.enum(["GO", "PROBE", "WATCH", "PASS", "UNAVAILABLE"]), triggerComplete: z.boolean(),
    entry: z.number().positive().finite().nullable(), stop: z.number().positive().finite().nullable(), target: z.number().positive().finite().nullable(),
    atr: z.number().positive().finite().nullable(), invalidation: z.string().max(2000), sizing: z.string().max(2000),
    hardGatesPassed: z.boolean(), blockers: z.array(text).max(30),
  }).strict(),
  summary: text, openQuestions: z.array(text).max(20),
}).strict();
export type ResearchReport = z.infer<typeof reportSchema>;
export type JobBinding = { id: string; ticker: string; provider: string; asOf: Date };

export function emptyReport(job: JobBinding): ResearchReport {
  return {
    schemaVersion: VERSION, jobId: job.id, ticker: job.ticker, provider: job.provider as "claude" | "deepseek", asOf: job.asOf.toISOString(),
    sections: Object.fromEntries(SECTION_KEYS.map(k => [k, { status: "unavailable", summary: "", observations: [], gaps: ["Evidence unavailable"] }])) as unknown as ResearchReport["sections"],
    fundamentalGrade: null, lenses: [], scores: { setup: null, entry: null, theme: null, sentiment: null },
    action: { verdict: "UNAVAILABLE", triggerComplete: false, entry: null, stop: null, target: null, atr: null, invalidation: "", sizing: "", hardGatesPassed: false, blockers: ["Incomplete evidence"] },
    summary: "Research incomplete", openQuestions: [],
  };
}

/** Validate model claims against independently collected inputs, never model-created URLs. */
export function validateReport(input: unknown, job: JobBinding, evidence: Evidence[], now = new Date()) {
  const report = reportSchema.parse(input);
  if (report.jobId !== job.id || report.ticker !== job.ticker || report.provider !== job.provider || report.asOf !== job.asOf.toISOString()) throw new Error("Report does not match job");
  const sources = new Map(evidence.map(s => [s.id, s]));
  if (sources.size !== evidence.length) throw new Error("Duplicate source IDs");
  const fresh = (s: Evidence) => {
    const limit = s.kind === "quote" ? 15 * 60_000 : 24 * 3600_000;
    return Date.parse(s.asOf) <= now.getTime() + 300_000 && Date.parse(s.retrievedAt) <= now.getTime() + 300_000 &&
      Date.parse(s.expiresAt) > now.getTime() && Date.parse(s.expiresAt) <= Date.parse(s.retrievedAt) + limit &&
      (s.kind === "fundamental" ? Boolean(s.period) && now.getTime() - Date.parse(s.asOf) <= 180 * 86400_000 : now.getTime() - Date.parse(s.asOf) <= limit);
  };
  const used = (ids: string[]) => ids.every(id => sources.has(id) && fresh(sources.get(id)!));
  for (const key of SECTION_KEYS) {
    const s = report.sections[key];
    if (s.status !== "complete" && !s.gaps.length) throw new Error(`${key}: missing gap reason`);
    if (s.observations.some(o => !o.sourceIds.length || !used(o.sourceIds))) throw new Error(`${key}: missing, stale or unknown source`);
    if (s.status === "complete" && (!s.summary.trim() || !s.observations.length || s.gaps.length)) throw new Error(`${key}: incomplete evidence`);
  }
  if (report.lenses.some(l => !l.sourceIds.length || !used(l.sourceIds)) || new Set(report.lenses.map(l => l.name)).size !== report.lenses.length) throw new Error("Invalid trader lenses");
  if (report.sections.technical.status === "complete" && report.lenses.length !== 7) throw new Error("Seven trader lenses required");
  if (report.sections.fundamentals.status === "complete" && !report.fundamentalGrade) throw new Error("Fundamental grade required");
  const cited = (key: typeof SECTION_KEYS[number], kind: Evidence["kind"]) => report.sections[key].observations.flatMap(o => o.sourceIds).map(id => sources.get(id)!).filter(s => s.kind === kind && fresh(s));
  if (report.sections.fundamentals.status === "complete" && !cited("fundamentals", "fundamental").some(s => s.period && s.ticker === job.ticker)) throw new Error("Current subject-company financial reporting period required");
  for (const key of ["latestCatalyst", "news90d", "insiderInstitutional", "upcoming30d"] as const) {
    if (report.sections[key].status === "complete" && !cited(key, "search_grounded").length) throw new Error(`${key}: search-grounded evidence required`);
  }
  if (report.sections.news90d.status === "complete" && !cited("news90d", "search_grounded").some(s => s.coverageFrom && s.coverageTo && Date.parse(s.coverageFrom) <= job.asOf.getTime() - 90 * 86400_000 && Date.parse(s.coverageTo) >= job.asOf.getTime())) throw new Error("90-day news coverage unverified");
  const charts = (["chart_daily", "chart_weekly"] as const).every(kind => cited("chartEvidence", kind).some(s => s.authenticated && s.currentBar && s.movingAverages && s.volume && s.ticker === job.ticker && s.timezone));
  if (report.sections.chartEvidence.status === "complete" && !charts) throw new Error("Daily and weekly authenticated charts required");
  const technicalCharts = (["chart_daily", "chart_weekly"] as const).every(kind => cited("technical", kind).some(s => s.authenticated && s.currentBar && s.movingAverages && s.volume && s.ticker === job.ticker && s.timezone));
  if (report.sections.technical.status === "complete" && (!charts || !technicalCharts || report.lenses.some(l => !l.sourceIds.some(id => {
    const s = sources.get(id)!; return ["chart_daily", "chart_weekly"].includes(s.kind) && s.ticker === job.ticker;
  })))) throw new Error("Technical assessment requires subject-company daily and weekly chart evidence");
  const complete = SECTION_KEYS.every(key => report.sections[key].status === "complete");
  const numbers = Object.values(report.scores);
  const total = numbers.every(n => n !== null) ? numbers.reduce<number>((a, n) => a + n!, 0) : null;
  if (report.sections.conviction.status === "complete" && total === null) throw new Error("Conviction components required");
  if (["GO", "PROBE"].includes(report.action.verdict)) {
    // Until the complete canonical structural-veto evaluator is integrated, this
    // research worker must not promote an idea to an actionable trade.
    throw new Error("Actionable verdicts require the canonical structural-gate evaluator");
  }
  const a = report.action;
  if ([a.entry, a.stop, a.target, a.atr].some(n => n !== null)) {
    if (!a.entry || !a.stop || !a.target || !a.atr || a.stop >= a.entry || a.target <= a.entry ||
      (a.entry - a.stop) / a.entry > .08 || a.entry - a.stop > 1.5 * a.atr || (a.target - a.entry) / (a.entry - a.stop) < 2 ||
      !charts || !cited("risk", "quote").some(s => s.ticker === job.ticker) || !a.invalidation.trim() || !a.sizing.trim()) throw new Error("Unsupported or invalid risk levels");
  }
  if (numbers.some(n => n !== null) && (total === null || report.sections.conviction.status !== "complete" || report.sections.technical.status !== "complete")) throw new Error("Scores require complete conviction and technical evidence");
  if (total !== null && !cited("conviction", "quote").some(s => s.ticker === job.ticker)) throw new Error("Conviction requires a fresh subject-company quote");
  if (report.fundamentalGrade && report.sections.fundamentals.status !== "complete") throw new Error("Grade requires complete fundamental evidence");
  if (report.action.verdict === "WATCH" && (total === null || total < 50)) throw new Error("WATCH requires score >=50");
  if (report.action.verdict === "PASS" && total !== null && total >= 50 && !report.action.blockers.length) throw new Error("PASS requires a stated blocking reason");
  return { report, total, status: complete && report.action.verdict !== "UNAVAILABLE" ? "succeeded" : "partial" } as const;
}
