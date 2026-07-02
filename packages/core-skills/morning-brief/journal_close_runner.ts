/**
 * journal_close_runner.ts — Phase 5b: AI-assisted post-close trade journaling.
 *
 * THE "final end to journaling the trade that day with AI assistance."
 *
 * For each trade closed today (and not yet journaled), this:
 *   1. Pulls the trade from /api/journal/closed-today
 *   2. Loads wiki context (trader-styles, risk-management, entry-methods) from
 *      the wiki-source submodule
 *   3. Asks Claude to score the trade against the 7-trader rubric, classify the
 *      setup, grade the entry, and note patterns vs recent trades
 *   4. POSTs the structured JournalEntry to /api/journal/entries/ingest
 *
 * Mirrors the jie_wiki/skills/trade-analyser scoring contract so the
 * cloud journaler and the local interactive analyser produce comparable output.
 *
 * Usage (in journal_close.yml, 30 min post-close):
 *   CLAUDE_CODE_OAUTH_TOKEN=... VERCEL_INGEST_URL=... BRIEF_INGEST_KEY=... \
 *     DEEPSEEK_API_KEY=... WIKI_DIR=.../wiki-source/wiki npm run journal
 *
 *   Claude runs via the Agent SDK under the subscription (CLAUDE_CODE_OAUTH_TOKEN);
 *   DeepSeek is the fallback when the subscription is unavailable. No metered
 *   Anthropic API token needed.
 *
 *   # Dry run (score + print, no POST):
 *   npm run journal:dry
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.CLAUDE_MODEL; // undefined => Claude Code default model
const DRY_RUN = process.argv.includes("--dry-run");
const BASE = (process.env.VERCEL_INGEST_URL ?? "").replace(/\/$/, "");
const KEY = process.env.BRIEF_INGEST_KEY ?? "";
const WIKI_DIR = process.env.WIKI_DIR ?? path.resolve(__dirname, "..", "wiki-source", "wiki");

const WIKI_PAGES = [
  "trader-styles.md", "entry-methods.md", "risk-management.md",
  "priming-patterns.md", "fundamental-analysis.md",
];

interface ClosedTrade {
  id: string; ticker: string; side: string | null;
  buyPrice: number | null; exitPrice: number | null; quantity: number | null;
  pnl: number | null; fees: number | null; tradeDate: string | null;
  industry: string | null; strategy: string | null;
  proposedEntry: number | null; proposedSL: number | null;
  proposedTP: number | null; rrr: number | null; notes: string | null;
}

function loadWiki(): string {
  const out: string[] = [];
  for (const p of WIKI_PAGES) {
    try {
      const txt = fs.readFileSync(path.join(WIKI_DIR, p), "utf-8");
      out.push(`### wiki/${p}\n${txt.slice(0, 3500)}`);
    } catch {
      console.error(`[journal] wiki page missing: ${p}`);
    }
  }
  return out.join("\n\n---\n\n");
}

const LOOKBACK_DAYS = process.env.JOURNAL_LOOKBACK_DAYS ?? "5";

async function fetchClosedTrades(): Promise<ClosedTrade[]> {
  const res = await fetch(`${BASE}/api/journal/closed-today?lookbackDays=${LOOKBACK_DAYS}`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`closed-today HTTP ${res.status}`);
  const json = (await res.json()) as { trades: ClosedTrade[] };
  return json.trades ?? [];
}

/**
 * DeepSeek fallback (OpenAI-compatible API). Used when Claude is unavailable
 * (credit balance, rate limit) OR when JOURNAL_PROVIDER=deepseek. Honors the
 * goal's "Claude AND DeepSeek / any available AI provider" requirement and
 * keeps the journaler working when one provider's balance runs out.
 */
async function deepseekJson(system: string, user: string): Promise<string> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("DEEPSEEK_API_KEY not set (Claude failed and no fallback)");
  const res = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content ?? "";
}

/**
 * Score one trade via the Claude Agent SDK — drives Claude Code under the
 * SUBSCRIPTION (CLAUDE_CODE_OAUTH_TOKEN / logged-in CLI), NOT the metered
 * Anthropic API token. Pure system+user → JSON; no tools, single turn.
 */
async function claudeCodeJson(system: string, user: string): Promise<string> {
  let out = "";
  const response = query({
    prompt: user,
    options: {
      systemPrompt: system,
      allowedTools: [],
      permissionMode: "bypassPermissions",
      maxTurns: 1,
      ...(MODEL ? { model: MODEL } : {}),
    },
  });
  for await (const m of response) {
    if (m.type === "result" && m.subtype === "success") out = m.result ?? "";
  }
  if (!out) throw new Error("Claude Code returned no result");
  return out;
}

async function scoreTrade(wiki: string, t: ClosedTrade): Promise<object> {
  const pnlPct = t.buyPrice && t.exitPrice
    ? (((t.exitPrice - t.buyPrice) / t.buyPrice) * 100 * (t.side === "Short" ? -1 : 1)).toFixed(2)
    : "n/a";

  const system = `You are Jie Sheng's trade journal analyst. Score a CLOSED US-stock trade against the 7-trader rubric using the wiki context. Output ONE strict JSON object — no prose, no markdown fences.

## Wiki context (apply these rules)
${wiki}

## Output schema (all fields required)
{
  "setupType": "EP-FRESH|POST-GAP-VCP|BO-VCP|BO-CB|PB-21EMA|MA-PULLBACK|POCKET-PIVOT|ORH-INTRADAY|PARABOLIC|EP-SECOND|CONTINUATION|OTHER",
  "primingPattern": "INSIDE-BAR|UPSIDE-REVERSAL|POSITIVE-EXPECTATION-BREAKER|TIGHT-SETUP-DAY|NONE",
  "setupJustification": "1-2 sentence wiki-cited explanation",
  "traderScores": {
    "@markminervini": {"entry":0-3,"risk":0-3,"setup":0-3,"total":0-9,"wouldEnter":"Y|N|Cond","why":"..."},
    "@Clement_Ang17": {...}, "@jfsrev": {...}, "@TedHZhang": {...},
    "@SRxTrades": {...}, "@PrimeTrading_": {...}, "@Qullamaggie": {...}
  },
  "compositeScore": 0.0-10.0,
  "bestStyleMatch": "@trader",
  "weakestDimension": "Entry|Risk|Setup + explanation",
  "entryVerdict": "GOOD|ACCEPTABLE|POOR",
  "evolutionNote": "what this trade teaches",
  "patternNote": "recurring weakness/improvement (note if data limited)",
  "wikiRefs": ["wiki/trader-styles.md", ...]
}
First char MUST be {, last MUST be }.`;

  const user = `Closed trade to journal:
  Ticker: ${t.ticker}
  Side: ${t.side ?? "Long"}
  Entry: ${t.buyPrice ?? "?"}  Exit: ${t.exitPrice ?? "?"}  Qty: ${t.quantity ?? "?"}
  Realised P/L: ${t.pnl ?? "?"} (${pnlPct}%)  Fees: ${t.fees ?? "?"}
  Trade date: ${t.tradeDate ?? "?"}
  Industry: ${t.industry ?? "?"}  Strategy: ${t.strategy ?? "?"}
  Plan — proposed entry ${t.proposedEntry ?? "?"} / stop ${t.proposedSL ?? "?"} / target ${t.proposedTP ?? "?"} / RRR ${t.rrr ?? "?"}
  Notes: ${t.notes ?? "(none)"}

Score it. Be honest about entry quality vs the plan and the outcome.`;

  const forceDeepseek = (process.env.JOURNAL_PROVIDER ?? "").toLowerCase() === "deepseek";
  let text = "";
  let usedProvider = "claude";

  if (!forceDeepseek) {
    try {
      // Claude via the Agent SDK → uses the Claude Code SUBSCRIPTION
      // (CLAUDE_CODE_OAUTH_TOKEN / logged-in CLI), NOT a metered API token.
      text = await claudeCodeJson(system, user);
    } catch (e) {
      // Claude unavailable (subscription rate limit / not logged in) → DeepSeek.
      console.error(`[journal] Claude Code failed for ${t.ticker} (${e instanceof Error ? e.message.slice(0, 80) : e}); trying DeepSeek...`);
      text = await deepseekJson(system, user);
      usedProvider = "deepseek";
    }
  } else {
    text = await deepseekJson(system, user);
    usedProvider = "deepseek";
  }

  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error(`no JSON for ${t.ticker}: ${text.slice(0, 120)}`);
  console.error(`[journal] ${t.ticker} scored via ${usedProvider}`);
  return { tradeRecordId: t.id, scoredBy: usedProvider, ...JSON.parse(text.slice(a, b + 1)) };
}

async function ingest(entry: object): Promise<void> {
  const res = await fetch(`${BASE}/api/journal/entries/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(entry),
  });
  const json = await res.json();
  console.error(`[journal] ingest: ${JSON.stringify(json)}`);
}

async function main() {
  // No ANTHROPIC_API_KEY required — Claude runs via the Agent SDK under the
  // Claude Code subscription. DeepSeek is the fallback if the subscription is
  // unavailable. Only requirement: at least one of {subscription, DeepSeek key}.
  if (!DRY_RUN && (!BASE || !KEY)) throw new Error("VERCEL_INGEST_URL + BRIEF_INGEST_KEY required");

  const trades = await fetchClosedTrades();
  console.error(`[journal] ${trades.length} closed trade(s) to journal`);
  if (trades.length === 0) return;

  const wiki = loadWiki();

  for (const t of trades) {
    try {
      console.error(`[journal] scoring ${t.ticker}...`);
      const entry = await scoreTrade(wiki, t);
      if (DRY_RUN) {
        console.log(JSON.stringify(entry, null, 2));
      } else {
        await ingest(entry);
      }
    } catch (e) {
      console.error(`[journal] FAILED ${t.ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.error(`[journal] done`);
}

main().catch((e) => {
  console.error(`[journal] FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
