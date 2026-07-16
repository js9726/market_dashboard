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
import { evaluateRiskGate, RISK_CEILING_ATR_MULT } from "@/server/alist-metrics";

/** Location/extension facts. Absent => fail-closed at the gate. */
export interface ExtensionInput {
  atr14: number | null;
  /** Distance from the 21EMA in ATR units (+2.82 = 2.82 ATR ABOVE). */
  dist21Atr: number | null;
  dist50Atr: number | null;
  rsi14: number | null;
  /** compute_index_technicals classification. */
  entryRisk: "EXTREME-EXTENDED" | "EXTENDED" | "FAIR" | "AT-MA" | "OVERSOLD-PB" | "UNKNOWN" | null;
}

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
  /**
   * Location facts. Before 2026-07-16 these did not exist, so the scorer was
   * STRUCTURALLY INCAPABLE of seeing that VCTR sat +2.82 ATR above its 21EMA at
   * RSI 74 — and scored it Entry 27/30. Location is not optional.
   */
  extension?: ExtensionInput;
  /** True when entryZone is a real prior-consolidation high (alist-levels.findPivot). */
  pivotFound?: boolean;
}

/** Deterministic pre-gate outcome; overrides the LLM (a-list-gate-and-screener.md). */
export interface GateResult {
  ok: boolean;
  code: "RISK-GATE-FAIL" | "EXTENDED-GATE-FAIL" | "NEEDS-PIVOT" | null;
  reason: string;
}

/** Price is "extended" beyond this many ATR above the 21EMA (wiki Lane-2: 0-1x is ideal). */
export const EXTENSION_ATR_LIMIT = 2;

/**
 * HARD pre-gates, evaluated BEFORE the LLM and overriding it.
 * Fail-closed: missing location/risk inputs FAIL rather than pass silently.
 */
export function evaluateHardGates(input: ConvictionInput): GateResult {
  const fam = (input.setup ?? "").toUpperCase();
  const isBreakout = !fam.startsWith("EP") && !fam.startsWith("PB") && !fam.includes("PULLBACK");

  // 1. Pivot must exist for breakout-family names.
  if (isBreakout && input.pivotFound === false)
    return { ok: false, code: "NEEDS-PIVOT", reason: "NEEDS-PIVOT: no prior-consolidation high to break — the last close is not a pivot" };

  // 2. Extension / location.
  const ext = input.extension;
  if (!ext || ext.dist21Atr == null)
    return { ok: false, code: "EXTENDED-GATE-FAIL", reason: "EXTENDED-GATE-FAIL: location unknown (no dist-from-21EMA) — fail-closed" };
  if (ext.entryRisk === "EXTENDED" || ext.entryRisk === "EXTREME-EXTENDED")
    return { ok: false, code: "EXTENDED-GATE-FAIL", reason: `EXTENDED-GATE-FAIL: entry_risk ${ext.entryRisk} (${ext.dist21Atr.toFixed(2)}xATR above the 21EMA)` };
  if (ext.dist21Atr > EXTENSION_ATR_LIMIT)
    return { ok: false, code: "EXTENDED-GATE-FAIL", reason: `EXTENDED-GATE-FAIL: ${ext.dist21Atr.toFixed(2)}xATR above the 21EMA exceeds the ${EXTENSION_ATR_LIMIT}xATR limit` };

  // 3. Risk ceiling (measured to the pattern stop).
  if (input.entryZone != null) {
    const gate = evaluateRiskGate({ entry: input.entryZone, stop: input.stop, atr14: ext.atr14 });
    if (!gate.ok) return { ok: false, code: "RISK-GATE-FAIL", reason: gate.reason };
  }
  return { ok: true, code: null, reason: "hard gates passed" };
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
  /** Hard pre-gate outcome. `ok:false` means the verdict was forced to PASS. */
  gate?: GateResult;
  provider?: string;
}

const SYSTEM = `You are the Moderator of a momentum-swing Conviction desk. Score ONE ticker on the Conviction model and return ONLY JSON (no markdown).

CONVICTION MODEL (weights are the point — do not equal-weight personas):
- Setup /40: does the chart match a PROVEN setup that works (BO-CB, BO-VCP, EP-FRESH, POST-GAP-VCP, first PB-21EMA / MA-PULLBACK) AND is it a clean instance (tight base, volume dry-up then expansion, right location near pivot/highs)? Loose/wide/late/PARABOLIC/EP-SECOND score low.
- Entry /30: is there an ACTIONABLE trigger NOW at GOOD LOCATION with a genuinely tight stop? Use the early-entry methods (alternative early pivot, Power of 3, Launch Pad, High-Volume-Close). CRITICAL: a controlled FIRST pullback to the rising 8/21EMA after an EP or base breakout — on CONTRACTING volume, RS intact, holding above the rising MAs — is the setup FORMING; it earns a HIGH entry score once it prints the reclaim/Power-of-3 trigger. Do NOT score it low for "down day / below 8EMA / MACD falling" — that is what a healthy first pullback looks like. Mid-pullback with volume still contracting = WAIT, not high entry.
- Theme /20: RS leadership, thematic tailwind, fresh catalyst.
- Sentiment /10: market regime + event gate (FOMC/CPI imminent subtracts).

LOCATION IS PART OF ENTRY — READ THE NUMBERS GIVEN, DO NOT ASSUME:
- "Distance from 21EMA" is supplied in ATR units. 0-1x = ideal. >2x = EXTENDED: Entry scores <= 10 and you must say so explicitly. Chasing is the single most expensive error this desk makes.
- "Risk to stop" is supplied in ATR units and %. A stop is "tight" ONLY at <= ${RISK_CEILING_ATR_MULT}xATR. NEVER describe a stop as tight because a ratio looks good — quote the ATR multiple.
- Do NOT cite "R:R >= 2" as evidence FOR an entry. R:R is an OUTCOME of structure; a wider stop mechanically mints a bigger target and can make any trade look 2R. Judge the stop and the location, not the ratio.
- High RVOL and high RS do NOT offset bad location. A leader bought 3xATR extended is still a bad trade.

BANDS: conviction = setup+entry+theme+sentiment. GO >= 75, WATCH 50-74, PASS < 50.

MODERATOR (ENTER/WAIT/PASS) must respect the trigger state given:
- triggerState TRIGGERED + conviction >= 75 + location OK -> ENTER.
- triggerState ARMED / forming, or conviction 50-74, or extended-but-strong (put it on the pullback list) -> WAIT.
- triggerState INVALIDATED / NEEDS-PIVOT, or conviction < 50, or extended/illiquid -> PASS.

"champion" must be the REAL @handle of the trader whose style this setup matches (@markminervini, @Qullamaggie, @Clement_Ang17, @jfsrev, @TedHZhang, @SRxTrades, @PrimeTrading_). Never emit the literal placeholder "@handle". Only name a champion whose actual rules this trade satisfies — Minervini does not buy extended, Qullamaggie does not buy without an EP/breakout.

Return JSON: {"setup":<0-40>,"entry":<0-30>,"theme":<0-20>,"sentiment":<0-10>,"verdict":"GO|WATCH|PASS","moderator":"ENTER|WAIT|PASS","champion":"@realhandle","reasoning":{"setup":"...","entry":"...","theme":"...","sentiment":"...","moderator":"..."}}`;

const VALID_CHAMPIONS = new Set([
  "@markminervini", "@qullamaggie", "@clement_ang17", "@jfsrev", "@tedhzhang", "@srxtrades", "@primetrading_",
]);

/** Risk stated in ATR units + % so the LLM cannot call 12.4% risk "tight". */
function riskLine(input: ConvictionInput): string {
  const atr = input.extension?.atr14 ?? null;
  if (input.entryZone == null || input.stop == null || atr == null || !(atr > 0))
    return `Risk to stop: UNKNOWN (fail-closed — do not call this a tight stop)`;
  const risk = input.entryZone - input.stop;
  if (!(risk > 0)) return `Risk to stop: INVALID (stop on wrong side of entry)`;
  const atrMult = risk / atr;
  const pct = (risk / input.entryZone) * 100;
  const flag = atrMult > RISK_CEILING_ATR_MULT ? `  <-- EXCEEDS the ${RISK_CEILING_ATR_MULT}xATR ceiling, NOT tight` : "";
  return `Risk to stop: ${pct.toFixed(1)}% = ${atrMult.toFixed(2)}xATR(14)${flag}`;
}

/** Location stated explicitly — the input that did not exist before 2026-07-16. */
function locationLine(input: ConvictionInput): string {
  const e = input.extension;
  if (!e || e.dist21Atr == null) return `Location: UNKNOWN (fail-closed — cannot score Entry high without it)`;
  const flag = e.dist21Atr > EXTENSION_ATR_LIMIT ? `  <-- EXTENDED, do not chase` : "";
  return [
    `Location: ${e.dist21Atr.toFixed(2)}xATR from 21EMA${e.dist50Atr != null ? `, ${e.dist50Atr.toFixed(2)}xATR from 50EMA` : ""}${flag}`,
    `  RSI(14): ${e.rsi14?.toFixed(1) ?? "-"}${e.rsi14 != null && e.rsi14 > 70 ? " (OVERBOUGHT)" : ""}  entry_risk: ${e.entryRisk ?? "UNKNOWN"}  ATR(14): ${e.atr14?.toFixed(2) ?? "-"}`,
  ].join("\n");
}

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
    riskLine(input),
    locationLine(input),
    input.pivotFound === false ? `PIVOT: NONE — no prior-consolidation high; the last close is not a pivot.` : "",
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
  // HARD PRE-GATES — deterministic, evaluated before the LLM and overriding it.
  // A scoring model without hard gates will always find a way to say yes
  // (VCTR 2026-07-16: conviction 80 / ENTER while 2.6x over the risk ceiling,
  // 2.82xATR extended, and with no pivot at all). Structural facts are not
  // tradeable against RVOL and RS.
  const gate = evaluateHardGates(input);
  if (!gate.ok) {
    console.warn(`[conviction-analysis] ${input.ticker} ${gate.reason} — forced PASS, LLM skipped`);
    return {
      setup: 0, entry: 0, theme: 0, sentiment: 0, conviction: 0,
      verdict: "PASS", moderator: "PASS", champion: null,
      reasoning: {
        setup: "", entry: gate.reason, theme: "", sentiment: "",
        moderator: `${gate.code}: hard pre-gate failed, so the candidate is PASS regardless of Conviction. ${gate.reason}`,
      },
      gate,
    };
  }

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
  let entry = clampInt(obj.entry, 30);
  const theme = clampInt(obj.theme, 20);
  const sentiment = clampInt(obj.sentiment, 10);

  // Deterministic Entry cap on approaching-extended location. The gate above
  // rejects >2xATR outright; between 1.5x and 2x the LLM may still over-score a
  // chase, so cap it rather than trust the prose.
  const d21 = input.extension?.dist21Atr ?? null;
  const reasoningNotes: string[] = [];
  if (d21 != null && d21 > 1.5 && entry > 18) {
    reasoningNotes.push(`[auto] Entry capped 30->18: ${d21.toFixed(2)}xATR above the 21EMA is late-but-not-rejected location.`);
    entry = 18;
  }

  const conviction = setup + entry + theme + sentiment;
  const verdict = conviction >= 75 ? "GO" : conviction >= 50 ? "WATCH" : "PASS";
  const mod = String(obj.moderator ?? "").toUpperCase();
  const moderator = mod === "ENTER" || mod === "WAIT" || mod === "PASS" ? (mod as ConvictionAnalysis["moderator"]) : verdict === "GO" ? "ENTER" : verdict === "WATCH" ? "WAIT" : "PASS";
  const reasoning = (obj.reasoning ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  // Champion: reject the literal "@handle" placeholder (it leaked to the UI) and
  // anything that is not a real desk handle.
  const rawChampion = typeof obj.champion === "string" ? obj.champion.trim() : "";
  const champion = VALID_CHAMPIONS.has(rawChampion.toLowerCase()) ? rawChampion : null;
  if (rawChampion && !champion)
    console.warn(`[conviction-analysis] ${input.ticker} dropped invalid champion ${JSON.stringify(rawChampion)}`);

  return {
    setup, entry, theme, sentiment, conviction, verdict, moderator,
    champion,
    reasoning: {
      setup: str(reasoning.setup),
      entry: [str(reasoning.entry), ...reasoningNotes].filter(Boolean).join(" "),
      theme: str(reasoning.theme),
      sentiment: str(reasoning.sentiment),
      moderator: str(reasoning.moderator),
    },
    gate,
    provider: meta.providerUsed,
  };
}
