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
 * Mirrors the llm_traders_wiki/skills/trade-analyser scoring contract so the
 * cloud journaler and the local interactive analyser produce comparable output.
 *
 * Usage (in journal_close.yml, 30 min post-close):
 *   ANTHROPIC_API_KEY=... VERCEL_INGEST_URL=... BRIEF_INGEST_KEY=... \
 *     WIKI_DIR=.../wiki-source/wiki npm run journal
 *
 *   # Dry run (score + print, no POST):
 *   npm run journal:dry
 */
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
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

async function fetchClosedTrades(): Promise<ClosedTrade[]> {
  const res = await fetch(`${BASE}/api/journal/closed-today?lookbackDays=5`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`closed-today HTTP ${res.status}`);
  const json = (await res.json()) as { trades: ClosedTrade[] };
  return json.trades ?? [];
}

async function scoreTrade(client: Anthropic, wiki: string, t: ClosedTrade): Promise<object> {
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

  const resp = await client.messages.create({
    model: MODEL, max_tokens: 2000, system,
    messages: [{ role: "user", content: user }],
  });
  const text = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b < 0) throw new Error(`no JSON for ${t.ticker}: ${text.slice(0, 120)}`);
  return { tradeRecordId: t.id, ...JSON.parse(text.slice(a, b + 1)) };
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
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY required");
  if (!DRY_RUN && (!BASE || !KEY)) throw new Error("VERCEL_INGEST_URL + BRIEF_INGEST_KEY required");

  const trades = await fetchClosedTrades();
  console.error(`[journal] ${trades.length} closed trade(s) to journal`);
  if (trades.length === 0) return;

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const wiki = loadWiki();

  for (const t of trades) {
    try {
      console.error(`[journal] scoring ${t.ticker}...`);
      const entry = await scoreTrade(client, wiki, t);
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
