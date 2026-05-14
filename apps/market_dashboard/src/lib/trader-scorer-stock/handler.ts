/**
 * trader-scorer-stock skill — local Next.js mirror.
 *
 * Canonical source: packages/core-skills/trader-scorer-stock/handler.ts
 * This file is kept inside the Next.js project root so webpack/Turbopack
 * can compile it. Trader profiles are sourced from the inlined local copy
 * at @/lib/brief/trader-profiles instead of the shared package JSON.
 * Keep in sync when the skill prompt or schema is updated.
 */
import { TRADER_PROFILES, type TraderProfile } from "@/lib/brief/trader-profiles";

const PROMPT_TEMPLATE =
  "Analyze this stock through 7 trader style lenses and return a JSON object.\n\n" +
  "{stock_context}\n\n" +
  "## Trader profiles\n{trader_profiles_block}\n\n" +
  "Return ONLY this JSON structure (no markdown, no explanation):\n{schema_example}\n";

export const SYSTEM_PROMPT =
  "You are an expert stock market analyst. Analyze the provided stock data through the lens of 7 specific trader styles and return ONLY valid JSON, no markdown fences.\n\n" +
  "## Verdict ladder\n" +
  "- `STRONG BUY` (score >= 9) - high-conviction long\n" +
  "- `BUY` (7-8) - long with caveats\n" +
  "- `HOLD` (5-6) - neutral, no fresh entry\n" +
  "- `AVOID` (3-4) - passive avoidance\n" +
  "- `STRONG AVOID` (<= 2) - actively negative; consider short or stay-out\n\n" +
  "## Score calibration\n" +
  "A 10 means the stock satisfies every requirement of that trader's style with no caveats. " +
  "A 5 means split signals - some criteria met, others violated. " +
  "A 1 means the stock breaks the trader's hard rules (e.g. extended above 21dma for PrimeTrading, " +
  "no Stage 2 for Minervini, no Qullamaggie breakout/EP trigger).\n\n" +
  "The composite score is a weighted average across the 7 traders, not the simple mean.\n\n" +
  "## Style integrity\n" +
  "Each trader's note must reference at least one concrete rule from their playbook " +
  "(e.g. \"21EMA pullback on lower volume\" for Clement, \"RVOL + LoD < 60% ATR\" for Jeff, " +
  "\"ORH breakout with LOD stop\" for Qullamaggie). Generic praise without a rule reference is wrong.";

export type StockDisplayFields = {
  name: string;
  sector: string | null;
  industry: string | null;
  exchange: string | null;
  currentPrice: number | null;
  changePct: number | null;
  week52Low: number | null;
  week52High: number | null;
  analystPT: number | null;
  earningsDate: string | null;
  earningsDays: number | null;
  marketCap: string;
  revenueTtm: string;
  grossMarginPct: number | null;
  trailingEps: number | null;
  forwardEps: number | null;
  dividendYieldPct: number | null;
};

function renderProfilesBlock(profiles: TraderProfile[]): string {
  return profiles
    .map((p) => `### ${p.handle} - ${p.name}\n${p.styleShort}`)
    .join("\n\n");
}

function schemaExample(d: StockDisplayFields): string {
  const lines = [
    "{",
    `  "name": ${JSON.stringify(d.name)},`,
    `  "sector": ${JSON.stringify(d.sector ?? "")},`,
    `  "industry": ${JSON.stringify(d.industry ?? "")},`,
    `  "exchange": ${JSON.stringify(d.exchange ?? "")},`,
    `  "price": ${d.currentPrice ?? "null"},`,
    `  "price_change_pct": ${d.changePct != null ? +d.changePct.toFixed(2) : "null"},`,
    `  "week52_low": ${d.week52Low ?? "null"},`,
    `  "week52_high": ${d.week52High ?? "null"},`,
    `  "analyst_pt": ${d.analystPT ?? "null"},`,
    `  "earnings_date": ${JSON.stringify(d.earningsDate ?? "")},`,
    `  "earnings_days": ${d.earningsDays ?? "null"},`,
    `  "market_cap": ${JSON.stringify(d.marketCap)},`,
    `  "revenue_ttm": ${JSON.stringify(d.revenueTtm)},`,
    `  "gross_margin_pct": ${d.grossMarginPct != null ? +d.grossMarginPct.toFixed(1) : "null"},`,
    `  "trailing_eps": ${d.trailingEps ?? "null"},`,
    `  "forward_eps": ${d.forwardEps ?? "null"},`,
    `  "dividend_yield_pct": ${d.dividendYieldPct != null ? +d.dividendYieldPct.toFixed(2) : "null"},`,
    `  "trader_analysis": [`,
    `    {`,
    `      "handle": "@markminervini",`,
    `      "score": <number 1-10>,`,
    `      "verdict": "<STRONG BUY | BUY | HOLD | AVOID | STRONG AVOID>",`,
    `      "note": "<2-3 sentence reasoning specific to this trader's style and the stock data>"`,
    `    }`,
    `    /* ... all 7 traders ... */`,
    `  ],`,
    `  "entry_plan": {`,
    `    "zone": "<price range, e.g. $45.20-$46.00>",`,
    `    "stop": "<stop loss price>",`,
    `    "target": "<price target>",`,
    `    "risk_reward": <number>,`,
    `    "batches": "<entry batching strategy, e.g. 50% at breakout, 50% on first pullback>"`,
    `  },`,
    `  "bulls": ["<bull case point 1>", "<bull case point 2>", "<bull case point 3>"],`,
    `  "bears": ["<bear case point 1>", "<bear case point 2>"],`,
    `  "composite_score": <number 1-10 weighted average>,`,
    `  "composite_verdict": "<STRONG BUY | BUY | HOLD | AVOID | STRONG AVOID>",`,
    `  "composite_note": "<1-2 sentence overall summary>",`,
    `  "best_match_trader": "<handle of trader whose style fits best>"`,
    "}",
  ];
  return lines.join("\n");
}

export function buildPrompt(input: {
  stockContext: string;
  display: StockDisplayFields;
}): string {
  return PROMPT_TEMPLATE
    .split("{stock_context}").join(input.stockContext)
    .split("{trader_profiles_block}").join(renderProfilesBlock(TRADER_PROFILES))
    .split("{schema_example}").join(schemaExample(input.display));
}
