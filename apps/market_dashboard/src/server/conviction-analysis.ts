/**
 * conviction-analysis.ts — R4 multi-agent Conviction verdict (LLM).
 *
 * Replaces the misaligned generic 7-agent pipeline. Scores a TRIGGERED A-list
 * pick on the wiki Conviction model (Setup/40 + Entry/30 + Theme/20 +
 * Sentiment/10; GO>=75) and returns a Moderator ENTER/WAIT/PASS tied to the
 * trigger state. The Entry component uses the 4 TraderLion early-entry methods,
 * so a first-pullback-to-rising-MA (the TWLO calibration) scores HIGH on Entry
 * rather than being mis-read as weakness.
 *
 * DeepSeek by default (premium credits are tight); runs only on triggered picks.
 */
import { callLLM } from "@/utils/llm-router";
import { salvageJsonObject } from "@/lib/brief/salvage";

export interface ConvictionInput {
  ticker: string;
  setup: string | null;
  sector: string | null;
  triggerState: string | null;
  triggerReason: string | null;
  entryZone: number | null;
  stop: number | null;
  target: number | null;
  rvol: number | null;
  rsRating: number | null;
  day0Thesis: string | null;
  /** Deterministic screener breakdown, for the LLM to refine (not copy). */
  algo: { setup: number | null; entry: number | null; theme: number | null; sentiment: number | null };
  /** Recent daily path (most recent last) — close/ema8/ema21/rvol per session. */
  recentPath?: { date: string; close: number; ema8: number | null; ema21: number | null; rvol: number | null }[];
}

export interface ConvictionAnalysis {
  setup: number;
  entry: number;
  theme: number;
  sentiment: number;
  conviction: number;
  verdict: "GO" | "WATCH" | "PASS";
  moderator: "ENTER" | "WAIT" | "PASS";
  champion: string | null;
  reasoning: { setup: string; entry: string; theme: string; sentiment: string; moderator: string };
  provider?: string;
}

const SYSTEM = `You are the Moderator of a momentum-swing Conviction desk. Score ONE ticker on the Conviction model and return ONLY JSON (no markdown).

CONVICTION MODEL (weights are the point — do not equal-weight personas):
- Setup /40: does the chart match a PROVEN setup that works (BO-CB, BO-VCP, EP-FRESH, POST-GAP-VCP, first PB-21EMA / MA-PULLBACK) AND is it a clean instance (tight base, volume dry-up then expansion, right location near pivot/highs)? Loose/wide/late/PARABOLIC/EP-SECOND score low.
- Entry /30: is there an ACTIONABLE trigger NOW with a tight stop and R:R >= 2? Use the early-entry methods (alternative early pivot, Power of 3, Launch Pad, High-Volume-Close). CRITICAL: a controlled FIRST pullback to the rising 8/21EMA after an EP or base breakout — on CONTRACTING volume, RS intact, holding above the rising MAs — is the setup FORMING; it earns a HIGH entry score once it prints the reclaim/Power-of-3 trigger. Do NOT score it low for "down day / below 8EMA / MACD falling" — that is what a healthy first pullback looks like. Mid-pullback with volume still contracting = WAIT, not high entry.
- Theme /20: RS leadership, thematic tailwind, fresh catalyst.
- Sentiment /10: market regime + event gate (FOMC/CPI imminent subtracts).

BANDS: conviction = setup+entry+theme+sentiment. GO >= 75, WATCH 50-74, PASS < 50.

MODERATOR (ENTER/WAIT/PASS) must respect the trigger state given:
- triggerState TRIGGERED + conviction >= 75 -> ENTER.
- triggerState ARMED / forming, or conviction 50-74 -> WAIT.
- triggerState INVALIDATED, or conviction < 50, or extended/illiquid -> PASS.

Return JSON: {"setup":<0-40>,"entry":<0-30>,"theme":<0-20>,"sentiment":<0-10>,"verdict":"GO|WATCH|PASS","moderator":"ENTER|WAIT|PASS","champion":"@handle","reasoning":{"setup":"...","entry":"...","theme":"...","sentiment":"...","moderator":"..."}}`;

function buildPrompt(input: ConvictionInput): string {
  const path = (input.recentPath ?? [])
    .slice(-6)
    .map((b) => `  ${b.date}: close ${b.close} ema8 ${b.ema8 ?? "-"} ema21 ${b.ema21 ?? "-"} rvol ${b.rvol != null ? b.rvol.toFixed(1) + "x" : "-"}`)
    .join("\n");
  return [
    `TICKER: ${input.ticker}`,
    `Setup classification: ${input.setup ?? "unknown"}`,
    `Sector: ${input.sector ?? "-"}`,
    `Trigger state: ${input.triggerState ?? "-"}${input.triggerReason ? ` (${input.triggerReason})` : ""}`,
    `Proposed entry/stop/target: ${input.entryZone ?? "-"} / ${input.stop ?? "-"} / ${input.target ?? "-"}`,
    `RVOL: ${input.rvol != null ? input.rvol.toFixed(1) + "x" : "-"}  RS Rating: ${input.rsRating ?? "-"}`,
    `Deterministic screener breakdown (refine, don't copy): setup ${input.algo.setup ?? "-"}/40, entry ${input.algo.entry ?? "-"}/30, theme ${input.algo.theme ?? "-"}/20, sentiment ${input.algo.sentiment ?? "-"}/10`,
    input.day0Thesis ? `Day-0 thesis: ${input.day0Thesis}` : "",
    path ? `Recent daily path:\n${path}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function clampInt(v: unknown, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
}

export async function runConvictionAnalysis(input: ConvictionInput): Promise<ConvictionAnalysis | null> {
  const meta: { providerUsed?: string } = {};
  let raw: string;
  try {
    raw = await callLLM(buildPrompt(input), SYSTEM, { maxTokens: 900, provider: "deepseek", tier: "fast" }, meta);
  } catch (e) {
    console.error(`[conviction-analysis] ${input.ticker} LLM failed:`, e);
    return null;
  }
  const obj = salvageJsonObject(raw) as Record<string, unknown> | null;
  if (!obj) {
    console.error(`[conviction-analysis] ${input.ticker} unparseable output`);
    return null;
  }
  const setup = clampInt(obj.setup, 40);
  const entry = clampInt(obj.entry, 30);
  const theme = clampInt(obj.theme, 20);
  const sentiment = clampInt(obj.sentiment, 10);
  const conviction = setup + entry + theme + sentiment;
  const verdict = conviction >= 75 ? "GO" : conviction >= 50 ? "WATCH" : "PASS";
  const mod = String(obj.moderator ?? "").toUpperCase();
  const moderator = mod === "ENTER" || mod === "WAIT" || mod === "PASS" ? (mod as ConvictionAnalysis["moderator"]) : verdict === "GO" ? "ENTER" : verdict === "WATCH" ? "WAIT" : "PASS";
  const reasoning = (obj.reasoning ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    setup, entry, theme, sentiment, conviction, verdict, moderator,
    champion: typeof obj.champion === "string" ? obj.champion : null,
    reasoning: {
      setup: str(reasoning.setup), entry: str(reasoning.entry), theme: str(reasoning.theme),
      sentiment: str(reasoning.sentiment), moderator: str(reasoning.moderator),
    },
    provider: meta.providerUsed,
  };
}
