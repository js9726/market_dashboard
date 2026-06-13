/**
 * Brief provider runners.
 *
 * The current dashboard path is JSON-first: providers return a StructuredBrief
 * object that is rendered into Conviction Desk placeholders. HTML is retained
 * only as a legacy compatibility field.
 */
import { generateObject, NoObjectGeneratedError } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { BriefProvider } from "@/lib/brief/bucket";
import type { ComposedSnapshot } from "@/lib/brief/snapshot";
import { structuredBriefSchema } from "@/lib/brief/structured-schema";
import { buildTraderLensBlock } from "@/lib/brief/trader-profiles";
import { salvageJsonObject } from "@/lib/brief/salvage";

export interface ProviderResult {
  htmlBody: string;
  verdictJson: unknown;
  structuredJson: unknown;
  tokensIn: number | null;
  tokensOut: number | null;
}

const MODEL_IDS: Record<BriefProvider, string> = {
  deepseek: "deepseek-v4-flash",
  gemini: "gemini-2.5-pro",
  openai: "gpt-4o",
  claude: "claude-sonnet-4-6",
};

function modelFor(p: BriefProvider): LanguageModel {
  switch (p) {
    case "deepseek":
      if (!process.env.DEEPSEEK_API_KEY) throw new Error("DEEPSEEK_API_KEY missing");
      return createOpenAI({
        baseURL: "https://api.deepseek.com/v1",
        apiKey: process.env.DEEPSEEK_API_KEY,
      })(MODEL_IDS.deepseek);
    case "gemini":
      if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");
      return createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })(MODEL_IDS.gemini);
    case "openai":
      if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY missing");
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY })(MODEL_IDS.openai);
    case "claude":
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY missing");
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(MODEL_IDS.claude);
  }
}

function buildSystemPrompt(): string {
  return [
    "You are an experienced trader writing an intraday market brief for an active swing trader based in Malaysia (MYT = UTC+8).",
    "The dashboard renders your answer directly into Conviction Desk placeholders: mood, posture, index read, sector rotation,",
    "industry movers, trader lens, standout, watchlist, movers, calendar, and sources.",
    "Return concise field values — NOT HTML, markdown, or a long article.",
    "This is a snapshot-fed refresh with no live web access; reason only from the snapshot and breadth data provided.",
    "Use null (not empty string) when a field cannot be inferred from the snapshot.",
    "",
    "ANTI-HALLUCINATION RULES",
    "1. The BREADTH block in the user message is authoritative. Set `breadth.up` = `advance` and `breadth.down` = `decline` exactly as given. Use `null` for both if the block is missing — never invent these numbers.",
    "2. Every `traderLens[].view`, `movers[].traderLens`, and the `mood`/`indicesNarrative`/`sectorsNarrative` fields must be consistent with the MARKET DIRECTION line. On a RED tape, do not write 'confirmed uptrend', 'rotation into <leadership>', or similar bullish framing unless a positive sector or index in the snapshot directly supports it. On a GREEN tape, the inverse applies.",
    "",
    "TRADER-STYLE FRAMEWORK",
    "Colour the `traderLens` array and `movers[].traderLens` using these seven trader lenses.",
    "Match each trader's lens exactly — do not invent new names.",
    "The seventh entry is always 'Composite' — a synthesised actionable recommendation.",
    "",
    buildTraderLensBlock(),
    "",
    "- **Composite**: Synthesise all six lenses above into one actionable verdict for today: what the trader should DO right now (GO / WAIT / PASS / RAISE-THE-BAR), and why.",
  ].join("\n");
}

const SYSTEM_PROMPT = buildSystemPrompt();

function userPromptFor(snapshot: ComposedSnapshot, dateStr: string, watchlist: string[]): string {
  const breadthBlock = snapshot.breadth
    ? [
        "BREADTH (from breadth_scan.py — authoritative, copy verbatim into breadth.up / breadth.down):",
        `advance: ${snapshot.breadth.advance}`,
        `decline: ${snapshot.breadth.decline}`,
        `new_highs: ${snapshot.breadth.new_highs}`,
        `new_lows: ${snapshot.breadth.new_lows}`,
        `universe: ${snapshot.breadth.universe_size}`,
      ].join("\n")
    : "BREADTH: unavailable — set breadth.up and breadth.down to null.";

  return [
    `Date: ${dateStr} (Malaysia time)`,
    `Live data as of: ${snapshot.liveAsOf ?? "unavailable"}`,
    `Baseline snapshot built at: ${snapshot.baselineBuiltAt ?? "unavailable"}`,
    "",
    "MARKET DIRECTION (computed from live indices — authoritative):",
    snapshot.marketDirection ?? "unavailable",
    "",
    breadthBlock,
    "",
    "INDICES (live overlay):",
    JSON.stringify(snapshot.indices, null, 2),
    "",
    "SECTORS (live overlay):",
    JSON.stringify(snapshot.sectors, null, 2),
    "",
    "INDUSTRY MOVERS (deterministic grouping from TradingView screeners, breadth, and Finviz when available):",
    JSON.stringify(snapshot.industryMovers, null, 2),
    "",
    "WATCHLIST (live overlay):",
    JSON.stringify(snapshot.watchlist, null, 2),
    "",
    `Watchlist tickers: ${watchlist.join(", ")}`,
    "",
    "BASELINE SNAPSHOT (daily structural context):",
    JSON.stringify(snapshot.baseline ?? {}, null, 2).slice(0, 12000),
    "",
    "Fill each StructuredBrief field for the UI. Keep narratives short and directly actionable. Preserve up to 6 industryMovers from the deterministic list when available, adding concise trader notes only.",
  ].join("\n");
}

export async function runProvider(
  provider: BriefProvider,
  snapshot: ComposedSnapshot,
  watchlist: string[],
): Promise<ProviderResult> {
  const dateStr = new Date().toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  // The Anthropic AI-SDK provider does NOT support json-mode structured output
  // ("'json-mode object generation' functionality not supported") — it routes
  // structured output through a tool call. DeepSeek/Gemini/OpenAI use json-mode.
  // Forcing mode:"json" for all four bricked the on-demand Claude refresh.
  const mode = provider === "claude" ? "tool" : "json";

  let object: unknown;
  let usage: { promptTokens?: number; completionTokens?: number } | undefined;
  try {
    const res = await generateObject({
      model: modelFor(provider),
      schema: structuredBriefSchema,
      schemaName: "StructuredBrief",
      schemaDescription: "JSON fields rendered directly into the Conviction Desk UI.",
      mode,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPromptFor(snapshot, dateStr, watchlist) }],
      // 5000 truncated DeepSeek's verbose JSON mid-object ("No object generated:
      // could not parse the response", 2026-06-09). Headroom is cheap.
      maxTokens: 8000,
    });
    object = res.object;
    usage = res.usage;
  } catch (err) {
    // Salvage path: the raw text often contains one valid JSON object wrapped
    // in fences/prose. Recover it instead of discarding the whole run.
    if (!NoObjectGeneratedError.isInstance(err)) throw err;
    const salvaged = salvageJsonObject(err.text ?? "");
    const parsed = salvaged ? structuredBriefSchema.safeParse(salvaged) : null;
    if (!parsed?.success) throw err;
    object = parsed.data;
    usage = err.usage;
  }

  return {
    htmlBody: "",
    verdictJson: object,
    structuredJson: object,
    tokensIn: usage?.promptTokens ?? null,
    tokensOut: usage?.completionTokens ?? null,
  };
}
