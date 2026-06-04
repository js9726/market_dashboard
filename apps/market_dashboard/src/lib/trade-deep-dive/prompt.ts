/**
 * trade-deep-dive/prompt.ts — "further detail" deep-dive scorecard.
 *
 * Augments the 7-trader rubric with a catalyst/theme/news analysis. Catalysts
 * are the CAUSE of big moves, so the contract is catalysts/themes-first.
 *
 * The LLM (via callLLM) synthesizes the 8 sections from the yahoo-finance2
 * grounding produced by agents/fundamental/tools/deep-dive-data.ts. It MUST mark
 * anything unverified when a source came back empty — never invent news,
 * links, insider trades, or analyst targets (fail-closed).
 */
import type { DeepDiveGrounding } from "../../../agents/fundamental/tools/deep-dive-data";

// ── Result contract (the 8 sections) ─────────────────────────────────────────

/** A bullet that can be flagged when the underlying source was empty. */
export interface DeepDiveNote {
  text: string;
  /** true = grounded in the supplied data; false = unverified / not in sources. */
  verified: boolean;
}

export interface DeepDiveNewsRow {
  date: string | null; // YYYY-MM-DD
  type: string; // Earnings | Product | Analyst | Regulatory | Macro | M&A | Other
  summary: string; // 1–2 sentences
  source: string | null; // URL or publisher
  majorMover: boolean; // marked when it likely moved the price
  verified: boolean; // false when not present in the grounding
}

export interface DeepDiveInsiderRow {
  date: string | null;
  party: string; // filer / institution name
  action: string; // Buy | Sell | New Position | Increase | Decrease | Grant
  detail: string | null; // shares / value / % held
  verified: boolean;
}

export interface DeepDiveCompetitorRow {
  ticker: string;
  name: string | null;
  monthTrend: "up" | "down" | "flat" | "unknown";
  note: string | null;
}

export interface DeepDiveCatalystRow {
  date: string | null; // YYYY-MM-DD, may be approximate
  type: string; // Earnings | Product | Regulatory | Conference | Lockup | Other
  description: string;
  verified: boolean;
}

export interface DeepDiveAnalystRow {
  date: string | null;
  firm: string | null;
  change: string; // "Upgrade Hold→Buy", "PT $40→$55", "Initiated Buy", etc.
  verified: boolean;
}

export interface DeepDiveResult {
  ticker: string;
  generatedAt: string;

  /** Section 1 — ELI12: what the company does, 3 short bullets + analogies. */
  eli12: string[];

  /** Section 2 — Professional summary (≤10 sentences). */
  professionalSummary: string;
  /** Competitor tickers referenced in the summary (section 2 requirement). */
  competitors: string[];
  /** Biotech only: "commercial" | "clinical" | null when N/A. */
  biotechStage: "commercial" | "clinical" | null;

  /** Section 3 — theme / catalysts / fundamentals table (single synthesized row). */
  thesisTable: {
    hotTheme: string | null; // narrative / story
    catalysts: string | null; // earnings / news / macro driving it
    fundamentals: string | null; // growth, moat, unique product, mgmt, patents
  };

  /** Section 4 — news/events over the last ~3 months. */
  recentNews: DeepDiveNewsRow[];

  /** Section 5 — insider + institutional activity. */
  insiderActivity: DeepDiveInsiderRow[];

  /** Section 6 — stock vs main competitors + sector trend over the past month. */
  competitorComparison: {
    sectorTrendMonth: "up" | "down" | "flat" | "unknown";
    stockTrendMonth: "up" | "down" | "flat" | "unknown";
    rows: DeepDiveCompetitorRow[];
    note: string | null;
  };

  /** Section 7 — upcoming catalysts in the next 30 days. */
  upcomingCatalysts: DeepDiveCatalystRow[];

  /** Section 8 — analyst price-target changes over the period. */
  analystChanges: DeepDiveAnalystRow[];

  /** Anything the model could not verify from the grounding (fail-closed audit). */
  unverifiedFlags: string[];
}

// ── System prompt ─────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = [
  "You are an equity research analyst producing a CATALYST-FIRST deep-dive on a single stock to augment a trade review.",
  "Big moves are caused by catalysts and themes, so lead with the narrative and the catalysts, then support it with fundamentals.",
  "",
  "You are given a GROUNDING block of facts fetched from Yahoo Finance (company profile, fundamentals, insider transactions, institutional ownership, analyst recommendation trend, upgrade/downgrade history, calendar events, current price, and recent news headlines).",
  "",
  "ABSOLUTE RULES (fail-closed):",
  "- Only state news, dates, links, insider trades, institutional changes, and analyst targets that appear in the GROUNDING. If a source is empty or a fact is not present, DO NOT invent it.",
  "- For any bullet/row you include that is NOT directly supported by the grounding (e.g. general industry knowledge, competitor names, qualitative moat), set its `verified` field to false and add a short entry to `unverifiedFlags`.",
  "- Never fabricate a URL. Use only links present in the grounding's news items; otherwise set source to null.",
  "- Dates must be YYYY-MM-DD. Convert any timestamps. If a date is unknown, use null.",
  "- Use your own world knowledge ONLY for: the ELI12 explanation, the professional summary's qualitative parts (moat, competitors-by-ticker, why-unique), and biotech stage. Flag these as verified:false where they are not in the grounding.",
  "",
  "Keep prose tight. ELI12 bullets ≤ 20 words each. Professional summary ≤ 10 sentences. News summaries 1–2 sentences.",
  "Return ONLY valid JSON matching the schema in the user message — no markdown fences, no commentary.",
].join("\n");

// ── Prompt builder ─────────────────────────────────────────────────────────────

export interface DeepDivePromptInput {
  grounding: DeepDiveGrounding;
  /** Optional trade context so the deep-dive can anchor to the entry. */
  trade?: {
    tradeDate?: string | null;
    side?: string | null;
    buyPrice?: string | null;
    notes?: string | null;
  } | null;
}

function fmtPct(v: number | null | undefined): string {
  return v == null ? "N/A" : `${(v * 100).toFixed(1)}%`;
}
function fmtNum(v: number | null | undefined): string {
  return v == null ? "N/A" : String(v);
}

function groundingBlock(g: DeepDiveGrounding): string {
  const lines: string[] = [];
  lines.push(`Ticker: ${g.ticker}`);
  lines.push(`Fetched at: ${g.fetchedAt}`);
  lines.push("");

  lines.push("[PROFILE]" + (g.availability.profile ? "" : " (EMPTY — mark profile-derived claims unverified)"));
  if (g.profile) {
    lines.push(`- Name: ${g.profile.longName ?? "N/A"}`);
    lines.push(`- Sector / Industry: ${g.profile.sector ?? "N/A"} / ${g.profile.industry ?? "N/A"}`);
    lines.push(`- Country / Employees: ${g.profile.country ?? "N/A"} / ${fmtNum(g.profile.fullTimeEmployees)}`);
    lines.push(`- Website: ${g.profile.website ?? "N/A"}`);
    if (g.profile.longBusinessSummary) lines.push(`- Business summary: ${g.profile.longBusinessSummary}`);
  }
  lines.push("");

  lines.push("[PRICE]" + (g.availability.price ? "" : " (EMPTY)"));
  if (g.price) {
    lines.push(`- Price: ${fmtNum(g.price.currentPrice)} ${g.price.currency ?? ""} (${fmtNum(g.price.changePct)}% day) on ${g.price.exchangeName ?? "N/A"}`);
    lines.push(`- Market cap: ${fmtNum(g.price.marketCap)}`);
    lines.push(`- 52w range: ${fmtNum(g.price.fiftyTwoWeekLow)} – ${fmtNum(g.price.fiftyTwoWeekHigh)}`);
  }
  lines.push("");

  lines.push("[FUNDAMENTALS]" + (g.availability.fundamentals ? "" : " (EMPTY)"));
  if (g.fundamentals) {
    const f = g.fundamentals;
    lines.push(`- Revenue (TTM): ${fmtNum(f.totalRevenue)} | Rev growth: ${fmtPct(f.revenueGrowth)} | Earnings growth: ${fmtPct(f.earningsGrowth)}`);
    lines.push(`- Gross margin: ${fmtPct(f.grossMargins)} | Profit margin: ${fmtPct(f.profitMargins)} | ROE: ${fmtPct(f.returnOnEquity)}`);
    lines.push(`- Fwd P/E: ${fmtNum(f.forwardPE)} | Trailing P/E: ${fmtNum(f.trailingPE)} | D/E: ${fmtNum(f.debtToEquity)} | FCF: ${fmtNum(f.freeCashflow)}`);
  }
  lines.push("");

  lines.push(`[INSIDER TRANSACTIONS]${g.availability.insiderTransactions ? "" : " (EMPTY — do NOT invent insider trades)"}`);
  for (const t of g.insiderTransactions.slice(0, 15)) {
    lines.push(`- ${t.date?.slice(0, 10) ?? "N/A"} | ${t.filer ?? "N/A"} (${t.relation ?? "N/A"}) | ${t.transaction ?? "N/A"} | shares: ${fmtNum(t.shares)} | value: ${fmtNum(t.value)}`);
  }
  lines.push("");

  lines.push(`[INSTITUTIONAL OWNERSHIP]${g.availability.institutional ? "" : " (EMPTY)"}`);
  if (g.institutional) {
    lines.push(`- Held by institutions: ${fmtPct(g.institutional.heldPercentInstitutions)} | by insiders: ${fmtPct(g.institutional.heldPercentInsiders)}`);
    for (const h of g.institutional.topHolders.slice(0, 8)) {
      lines.push(`  • ${h.organization ?? "N/A"} — ${fmtPct(h.pctHeld)} (value ${fmtNum(h.value)}, as of ${h.reportDate?.slice(0, 10) ?? "N/A"})`);
    }
  }
  lines.push("");

  lines.push(`[ANALYST RECOMMENDATION TREND]${g.availability.recommendationTrend ? "" : " (EMPTY)"}`);
  for (const r of g.recommendationTrend) {
    lines.push(`- ${r.period ?? "N/A"}: strongBuy ${fmtNum(r.strongBuy)}, buy ${fmtNum(r.buy)}, hold ${fmtNum(r.hold)}, sell ${fmtNum(r.sell)}, strongSell ${fmtNum(r.strongSell)}`);
  }
  lines.push("");

  lines.push(`[UPGRADE / DOWNGRADE HISTORY]${g.availability.upgradeDowngradeHistory ? "" : " (EMPTY — do NOT invent analyst actions)"}`);
  for (const u of g.upgradeDowngradeHistory.slice(0, 20)) {
    lines.push(`- ${u.date?.slice(0, 10) ?? "N/A"} | ${u.firm ?? "N/A"} | ${u.fromGrade ?? "?"} → ${u.toGrade ?? "?"} (${u.action ?? "?"})`);
  }
  lines.push("");

  lines.push(`[CALENDAR / UPCOMING]${g.availability.calendar ? "" : " (EMPTY)"}`);
  if (g.calendar) {
    lines.push(`- Earnings dates: ${g.calendar.earningsDates.map((d) => d.slice(0, 10)).join(", ") || "N/A"}`);
    lines.push(`- Ex-dividend: ${g.calendar.exDividendDate?.slice(0, 10) ?? "N/A"} | Dividend: ${g.calendar.dividendDate?.slice(0, 10) ?? "N/A"}`);
  }
  lines.push("");

  lines.push(`[RECENT NEWS HEADLINES]${g.availability.news ? "" : " (EMPTY — do NOT invent news or links)"}`);
  for (const n of g.news.slice(0, 15)) {
    lines.push(`- ${n.publishedAt?.slice(0, 10) ?? "N/A"} | ${n.publisher ?? "N/A"} | ${n.title} | ${n.link ?? "no-link"}`);
  }
  if (g.errors.length) {
    lines.push("");
    lines.push(`[FETCH ERRORS] ${g.errors.join("; ")}`);
  }
  return lines.join("\n");
}

function schemaExample(ticker: string): string {
  const example: DeepDiveResult = {
    ticker,
    generatedAt: "<ISO timestamp>",
    eli12: ["<≤20-word bullet + analogy>", "<bullet>", "<bullet>"],
    professionalSummary: "<≤10 sentences: industry, products, competitors (tickers), key metrics, moat, why unique. If biotech, say commercial vs clinical stage.>",
    competitors: ["<TICKER>", "<TICKER>"],
    biotechStage: null,
    thesisTable: {
      hotTheme: "<narrative / story or null>",
      catalysts: "<earnings/news/macro catalysts or null>",
      fundamentals: "<growth, moat, unique product, mgmt, patents or null>",
    },
    recentNews: [
      { date: "YYYY-MM-DD", type: "Earnings", summary: "<1-2 sentences>", source: "<url-from-grounding-or-null>", majorMover: true, verified: true },
    ],
    insiderActivity: [
      { date: "YYYY-MM-DD", party: "<name>", action: "Buy", detail: "<shares/value/%>", verified: true },
    ],
    competitorComparison: {
      sectorTrendMonth: "up",
      stockTrendMonth: "up",
      rows: [{ ticker: "<TICKER>", name: "<name>", monthTrend: "up", note: "<short>" }],
      note: "<one-line comparison or null>",
    },
    upcomingCatalysts: [
      { date: "YYYY-MM-DD", type: "Earnings", description: "<what + why it matters>", verified: true },
    ],
    analystChanges: [
      { date: "YYYY-MM-DD", firm: "<firm>", change: "<Upgrade Hold→Buy / PT $X→$Y>", verified: true },
    ],
    unverifiedFlags: ["<claim not supported by the grounding>"],
  };
  return JSON.stringify(example, null, 2);
}

export function buildPrompt(input: DeepDivePromptInput): string {
  const { grounding, trade } = input;
  const tradeLines = trade
    ? [
        "",
        "## Trade context (anchor the deep-dive to this entry)",
        `- Entry date: ${trade.tradeDate ?? "N/A"}`,
        `- Side: ${trade.side ?? "N/A"}`,
        `- Entry price: ${trade.buyPrice ?? "N/A"}`,
        `- Notes: ${trade.notes ?? "None"}`,
      ].join("\n")
    : "";

  return [
    `# Deep-dive request: ${grounding.ticker}`,
    "",
    "Produce the 8-section catalyst-first deep-dive below. Lead with theme + catalysts (sections 3, 4, 7), then fundamentals and analysts.",
    "",
    "## GROUNDING (the ONLY source of facts you may state as verified)",
    groundingBlock(grounding),
    tradeLines,
    "",
    "## Required sections (map to the JSON keys)",
    "1. eli12 — what the company does, 3 short bullets + analogies.",
    "2. professionalSummary (≤10 sentences) + competitors[] (tickers) + biotechStage (commercial|clinical|null).",
    "3. thesisTable — hot theme/story · catalysts (earnings/news/macro) · significant fundamentals (growth, moat, unique product, mgmt, patents).",
    "4. recentNews[] — events over the last ~3 months: date, type, 1–2 sentence summary, source link, majorMover flag. ONLY from the grounding's news.",
    "5. insiderActivity[] — recent insider buys/sells + institutional positions, from the grounding.",
    "6. competitorComparison — stock vs main competitors + sector trend over the past month (up/down/flat).",
    "7. upcomingCatalysts[] — catalysts in the next 30 days (earnings/product/regulatory), using the calendar grounding where present.",
    "8. analystChanges[] — analyst price-target / rating changes over the period, from the upgrade/downgrade grounding.",
    "",
    "Set `verified:false` and add to `unverifiedFlags` for anything not directly in the grounding. Never invent links.",
    "",
    "## Output schema (example shape — match keys/types exactly)",
    schemaExample(grounding.ticker),
    "",
    "Return ONLY the JSON object.",
  ].join("\n");
}
