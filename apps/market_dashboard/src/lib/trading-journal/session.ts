import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const provider = z.enum(["claude", "openai", "manual", "backfill"]);
const verdict = z.enum(["GO", "WATCH", "PASS", "NO_TRADE"]);

const themeSchema = z.object({
  theme: z.string().min(1),
  intraday: z.string().default("unknown"),
  day: z.string().default("unknown"),
  week: z.string().default("unknown"),
  month: z.string().default("unknown"),
  breadthAndRs: z.string().default("unknown"),
  catalyst: z.string().default("not visible"),
  state: z.enum(["EXPANDING", "STEADY", "FADING", "PROXY", "UNKNOWN"]).default("UNKNOWN"),
});

const focusSchema = z.object({
  ticker: z.string().min(1).transform((value) => value.toUpperCase()),
  source: z.string().min(1),
  capturedAt: z.string().datetime({ offset: true }).optional(),
  intendedSession: isoDate.optional(),
  setup: z.string().default("UNCLASSIFIED"),
  verdict: z.enum(["PRELIMINARY_FOCUS", "GO", "WATCH", "PASS", "TRADED"]),
  reason: z.string().min(1),
  trigger: z.string().optional(),
  stop: z.number().positive().optional(),
  cancel: z.string().optional(),
  chartEvidence: z.array(z.string()).default([]),
});

const entrySchema = z.object({
  broker: z.string().min(1),
  accountType: z.enum(["LIVE", "SIM"]),
  ticker: z.string().min(1).transform((value) => value.toUpperCase()),
  kind: z.enum(["ENTRY", "ADD", "REENTRY"]),
  setup: z.string().default("UNCLASSIFIED"),
  trigger: z.string().optional(),
  fillPrice: z.number().positive(),
  quantity: z.number().positive(),
  stopPrice: z.number().positive(),
  stopStatus: z.enum(["ACTIVE", "MISSING", "UNKNOWN"]),
  riskPct: z.number().nonnegative(),
  scoreAtEntry: z.number().min(0).max(100).optional(),
  campaignKey: z.string().optional(),
  evidence: z.array(z.string()).default([]),
});

const exitSchema = z.object({
  broker: z.string().min(1),
  accountType: z.enum(["LIVE", "SIM"]),
  ticker: z.string().min(1).transform((value) => value.toUpperCase()),
  kind: z.enum(["TRIM", "FULL_EXIT"]),
  classification: z.enum(["HARD_STOP", "SOFT_STOP", "TARGET", "DISCRETIONARY", "UNCLASSIFIED"]),
  price: z.number().positive(),
  quantity: z.number().positive(),
  realizedPnl: z.number().optional(),
  realizedR: z.number().optional(),
  evidence: z.array(z.string()).default([]),
});

const openPositionSchema = z.object({
  broker: z.string().min(1),
  accountType: z.enum(["LIVE", "SIM"]),
  ticker: z.string().min(1).transform((value) => value.toUpperCase()),
  quantity: z.number().positive(),
  avgCost: z.number().positive(),
  currentPrice: z.number().positive().optional(),
  tradingDaysHeld: z.number().int().nonnegative(),
  stopPrice: z.number().positive().nullable(),
  stopStatus: z.enum(["ACTIVE", "WAITING_SUBMIT", "MISSING", "UNKNOWN", "HOLD_EXEMPT"]),
  stopAtBreakeven: z.boolean().default(false),
  trimmed: z.boolean().default(false),
  currentScore: z.number().min(0).max(100).optional(),
  currentR: z.number().optional(),
  pnlIfStopped: z.number().optional(),
});

export const tradingSessionSchema = z.object({
  schemaVersion: z.literal("trading-journal/v2"),
  sessionDate: isoDate,
  source: z.enum(["daily", "backfill", "manual"]),
  generatedAt: z.string().datetime(),
  owner: z.object({
    provider,
    verdict,
    reason: z.string().min(1),
  }),
  validator: z.object({
    provider,
    status: z.enum(["PENDING", "VALIDATED", "HARD_GATE_BLOCKED", "JUDGMENT_DIFFERS"]),
    note: z.string().optional(),
  }).nullable().default(null),
  market: z.object({
    regime: z.enum(["EARLY_RECOVERY", "RISK_ON", "EXTENDED", "RISK_OFF", "MIXED_SELECTIVE", "UNVERIFIED"]),
    traction: z.enum(["GREEN", "YELLOW", "RED"]),
    fearGreed: z.number().min(0).max(100).nullable().default(null),
    summary: z.string().min(1),
    eventOverlay: z.string().default("None identified"),
    themes: z.array(themeSchema).max(3).default([]),
  }),
  focusList: z.array(focusSchema).default([]),
  entries: z.array(entrySchema).default([]),
  exits: z.array(exitSchema).default([]),
  openPositions: z.array(openPositionSchema).default([]),
  review: z.object({
    userThoughts: z.string().nullable().default(null),
    thoughtSource: z.string().nullable().default(null),
    aiAnalysis: z.string().default("Not yet reviewed"),
    learnings: z.array(z.object({
      stage: z.enum(["OBSERVATION", "EXPERIMENT", "CONDITIONAL_PLAYBOOK", "HARD_SAFETY_RULE"]),
      statement: z.string().min(1),
      evidence: z.array(z.string()).default([]),
      approval: z.enum(["NOT_REQUIRED", "PROPOSED", "APPROVED", "REJECTED"]).default("NOT_REQUIRED"),
    })).default([]),
  }),
  risk: z.object({
    mtdDrawdownPct: z.number().default(0),
    portfolioRiskPct: z.number().nonnegative().default(0),
    explicitBlockReasons: z.array(z.string()).default([]),
  }),
  sheetDiscrepancies: z.array(z.object({
    field: z.string().min(1),
    brokerValue: z.string(),
    sheetValue: z.string(),
    proposedCorrection: z.string().min(1),
    status: z.literal("AWAITING_APPROVAL").default("AWAITING_APPROVAL"),
  })).default([]),
  evidence: z.array(z.string()).default([]),
});

export type TradingSessionInput = z.input<typeof tradingSessionSchema>;
export type TradingSession = z.output<typeof tradingSessionSchema>;

export type SessionEvaluation = {
  session: TradingSession;
  riskBlocked: boolean;
  violations: string[];
  counts: { open: number; new: number; closed: number };
};

export function convictionRiskCap(score: number): number {
  if (!Number.isFinite(score) || score < 75) return 0;
  if (score < 85) return 0.5;
  if (score < 90) return 0.75;
  return 1;
}

export function campaignWorstCase(values: {
  realizedTrimPnl: number;
  corePnlAtStop: number;
  addPnlAtStop: number;
}): number {
  return values.realizedTrimPnl + values.corePnlAtStop + values.addPnlAtStop;
}

export function evaluateTradingSession(input: unknown): SessionEvaluation {
  const session = tradingSessionSchema.parse(input);
  const violations = [...session.risk.explicitBlockReasons];

  for (const position of session.openPositions) {
    if (position.accountType === "LIVE" && !["ACTIVE", "HOLD_EXEMPT"].includes(position.stopStatus)) {
      violations.push(`${position.broker}:${position.ticker} is UNPROTECTED`);
    }
  }
  if (session.risk.mtdDrawdownPct <= -5) {
    violations.push("MTD drawdown is at or below -5%; new risk is blocked");
  }
  if (session.market.regime === "RISK_OFF" && session.entries.length > 0) {
    violations.push("Risk-Off regime permits no new risk");
  }
  if (session.market.regime === "EXTENDED" && session.entries.length > 0) {
    violations.push("Extended regime permits no new risk");
  }

  return {
    session,
    riskBlocked: violations.length > 0,
    violations: Array.from(new Set(violations)),
    counts: {
      open: session.openPositions.length,
      new: session.entries.filter((entry) => entry.kind === "ENTRY").length,
      closed: session.exits.filter((exit) => exit.kind === "FULL_EXIT").length,
    },
  };
}

function table(headers: string[], rows: string[][], empty: string): string {
  if (rows.length === 0) return `_${empty}_`;
  const safe = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.map(safe).join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.map((value) => safe(String(value))).join(" | ")} |`),
  ].join("\n");
}

function protectionLabel(position: TradingSession["openPositions"][number]): string {
  if (position.stopStatus === "HOLD_EXEMPT") return "HOLD-EXEMPT";
  if (position.accountType !== "LIVE" || position.stopStatus === "ACTIVE") return position.stopStatus;
  return position.stopStatus.replaceAll("_", " ");
}

export function renderTradingSessionMarkdown(evaluation: SessionEvaluation): string {
  const { session, counts, violations } = evaluation;
  const header = `${session.sessionDate} | ${session.market.regime} | ${session.market.traction} | OP: ${counts.open} | NP: ${counts.new} | CP: ${counts.closed} | Fear & Greed: ${session.market.fearGreed ?? "N/A"}`;
  const themes = table(
    ["Theme", "Intraday", "Day", "Week", "Month", "Breadth + RS", "Catalyst", "State"],
    session.market.themes.map((theme) => [theme.theme, theme.intraday, theme.day, theme.week, theme.month, theme.breadthAndRs, theme.catalyst, theme.state]),
    "No sufficiently broad theme was proven",
  );
  const focus = table(
    ["Ticker", "Setup", "Verdict", "Reason", "Trigger", "Stop", "Cancel"],
    session.focusList.map((item) => [item.ticker, item.setup, item.verdict, item.reason, item.trigger ?? "-", item.stop?.toString() ?? "-", item.cancel ?? "-"]),
    "No focus candidates recorded",
  );
  const entries = table(
    ["Broker", "Ticker", "Kind", "Setup", "Fill", "Qty", "Stop", "Stop status", "Risk", "Entry score"],
    session.entries.map((entry) => [entry.broker, entry.ticker, entry.kind, entry.setup, entry.fillPrice.toString(), entry.quantity.toString(), entry.stopPrice.toString(), entry.stopStatus, `${entry.riskPct}%`, entry.scoreAtEntry?.toString() ?? "N/A"]),
    "No entries or adds",
  );
  const exits = table(
    ["Broker", "Ticker", "Kind", "Exit type", "Price", "Qty", "R", "P&L"],
    session.exits.map((exit) => [exit.broker, exit.ticker, exit.kind, exit.classification, exit.price.toString(), exit.quantity.toString(), exit.realizedR?.toString() ?? "N/A (risk basis unavailable)", exit.realizedPnl?.toString() ?? "N/A"]),
    "No exits or trims",
  );
  const positions = table(
    ["Broker", "Ticker", "Qty", "Avg", "Days", "Stop", "Stop state", "Management", "R now", "P&L @ stop"],
    session.openPositions.map((position) => [position.broker, position.ticker, position.quantity.toString(), position.avgCost.toString(), position.tradingDaysHeld.toString(), position.stopPrice?.toString() ?? "NONE", protectionLabel(position), `BE:${position.stopAtBreakeven ? "Y" : "N"} / Trim:${position.trimmed ? "Y" : "N"}`, position.currentR?.toString() ?? "N/A", position.pnlIfStopped?.toString() ?? "N/A"]),
    "No open positions",
  );
  const lessons = session.review.learnings.length
    ? session.review.learnings.map((item) => `- ${item.stage}: ${item.statement} (${item.approval})`).join("\n")
    : "_No learning promoted this session._";

  return [
    `### ${header}`,
    "",
    "#### Market & Risk",
    session.market.summary,
    `**Event overlay:** ${session.market.eventOverlay}`,
    `**Owner:** ${session.owner.provider} — ${session.owner.verdict}: ${session.owner.reason}`,
    `**Validator:** ${session.validator ? `${session.validator.provider} — ${session.validator.status}${session.validator.note ? `: ${session.validator.note}` : ""}` : "Pending"}`,
    `**New-risk block:** ${violations.length ? violations.join("; ") : "None"}`,
    "",
    themes,
    "",
    "#### Focus List & GO",
    focus,
    "",
    "#### Entries / Adds",
    entries,
    "",
    "#### Exits / Trims",
    exits,
    "",
    "#### Open Positions",
    positions,
    "",
    "#### Review & Learning",
    `**User thoughts:** ${session.review.userThoughts ?? "Not provided"}`,
    `**AI review:** ${session.review.aiAnalysis}`,
    lessons,
    session.sheetDiscrepancies.length
      ? `\n**Sheet corrections awaiting approval:**\n${session.sheetDiscrepancies.map((item) => `- ${item.field}: broker=${item.brokerValue}; sheet=${item.sheetValue}; proposed=${item.proposedCorrection}`).join("\n")}`
      : "",
  ].filter((line) => line !== "").join("\n\n");
}
