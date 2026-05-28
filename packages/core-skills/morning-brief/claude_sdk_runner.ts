/**
 * claude_sdk_runner.ts — Phase 3c MVP
 * ====================================
 * Node-based morning brief generator for the "Claude" provider tab on the
 * Conviction Desk dashboard.
 *
 * Architecture decision:
 *   The PLAN (apps/market_dashboard/docs/PLAN-pre-open-ci-and-journal-revamp.md)
 *   chose "Claude Agent SDK in CI" as the long-term target. This MVP uses
 *   the direct Anthropic SDK (@anthropic-ai/sdk) with manual wiki context
 *   loading from the wiki-source git submodule. Once verified stable, migrate
 *   to @anthropic-ai/claude-agent-sdk for skills/MCP support.
 *
 *   Why MVP first: the Agent SDK requires a .claude/skills/ folder layout +
 *   tool wiring + careful CI permissions. The direct SDK path delivers the
 *   same OUTPUT (StructuredBrief JSON) with 1/10th the setup complexity.
 *
 * Pipeline:
 *   1. Load prompt.md template
 *   2. Load live data block (snapshot, breadth, screener, index technicals)
 *      from JSON files written by the Python preflight steps in
 *      refresh_premarket.yml
 *   3. Load wiki context excerpts (trader-styles, risk-management,
 *      entry-methods) from the wiki-source submodule
 *   4. Call Claude Sonnet with system + user prompt
 *   5. Parse StructuredBrief JSON from response
 *   6. POST to ${VERCEL_INGEST_URL}/api/morning-verdict/ingest as
 *      provider="claude"
 *
 * Usage:
 *   npm install
 *   ANTHROPIC_API_KEY=... \
 *     VERCEL_INGEST_URL=https://market-dashboard-ivory.vercel.app \
 *     BRIEF_INGEST_KEY=... \
 *     npm run brief
 *
 *   # Dry-run (writes brief_output.json, doesn't POST):
 *   npm run brief:dry
 *
 * Env vars (required unless --dry-run):
 *   ANTHROPIC_API_KEY     Claude API key
 *   VERCEL_INGEST_URL     e.g. https://market-dashboard-ivory.vercel.app
 *   BRIEF_INGEST_KEY      Shared secret for /api/morning-verdict/ingest
 *
 * Optional env:
 *   CLAUDE_MODEL          default: claude-sonnet-4-5-20250929
 *   BRIEF_DATA_DIR        default: ../../../apps/market_dashboard_backend/data
 *   WIKI_DIR              default: ../wiki-source/wiki
 *   BRIEF_PROVIDER        default: claude (used in ingest payload)
 *   BRIEF_GENERATED_BY    default: cli:claude-sdk:<ISO>
 */
import Anthropic from "@anthropic-ai/sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { fileURLToPath } from "node:url";

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-5-20250929";
const DRY_RUN = process.argv.includes("--dry-run");
const DATA_DIR = process.env.BRIEF_DATA_DIR
  ?? path.resolve(__dirname, "..", "..", "..", "apps", "market_dashboard_backend", "data");
const WIKI_DIR = process.env.WIKI_DIR
  ?? path.resolve(__dirname, "..", "wiki-source", "wiki");

// Wiki pages auto-included as system context (Claude reads these to apply
// trader-style scoring + entry-method rubric consistently).
const WIKI_CONTEXT_PAGES = [
  "trader-styles.md",
  "entry-methods.md",
  "risk-management.md",
  "priming-patterns.md",
  "21dma-structure.md",
] as const;

// Watchlist that the brief should always cover (canonical 12 tickers).
const WATCHLIST = [
  "APLD", "RMBS", "CRDO", "AMKR", "POWL", "HUT",
  "FSLR", "ALAB", "VICR", "QBTS", "VIAV", "AVGO",
];

// ────────────────────────────────────────────────────────────────────────────
// Data loaders
// ────────────────────────────────────────────────────────────────────────────
function readJsonIfExists<T = unknown>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
  } catch (e) {
    console.error(`[brief] failed to parse ${p}:`, e);
    return null;
  }
}

function readTextIfExists(p: string): string | null {
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf-8");
  } catch (e) {
    console.error(`[brief] failed to read ${p}:`, e);
    return null;
  }
}

interface LiveDataBundle {
  snapshot: unknown;
  breadth: unknown;
  screener: unknown;
  technicals: unknown;
  opend: unknown;
}

function loadLiveData(): LiveDataBundle {
  return {
    snapshot: readJsonIfExists(path.join(DATA_DIR, "snapshot.json")),
    breadth: readJsonIfExists(path.join(DATA_DIR, "breadth.json")),
    screener: readJsonIfExists(path.join(DATA_DIR, "tv_screeners.json")),
    technicals: readJsonIfExists(path.join(__dirname, "index_technicals.json")),
    opend: readJsonIfExists(path.join(__dirname, "opend_live.json")),
  };
}

function loadWikiContext(): string {
  const sections: string[] = [];
  for (const page of WIKI_CONTEXT_PAGES) {
    const text = readTextIfExists(path.join(WIKI_DIR, page));
    if (text) {
      // Trim to first 4000 chars per page so the system prompt doesn't blow
      // up the context window. The full wiki is also available to Claude via
      // tool calls in the future Agent SDK migration.
      sections.push(`### wiki/${page}\n\n${text.slice(0, 4000)}`);
    } else {
      console.warn(`[brief] wiki page missing: ${page}`);
    }
  }
  return sections.join("\n\n---\n\n");
}

function buildLiveDataBlock(d: LiveDataBundle): string {
  const lines: string[] = ["PRE-FETCHED LIVE DATA (AUTHORITATIVE):"];
  if (d.snapshot && typeof d.snapshot === "object") {
    lines.push(`\n## Snapshot\n\`\`\`json\n${JSON.stringify(d.snapshot, null, 2).slice(0, 6000)}\n\`\`\``);
  }
  if (d.breadth && typeof d.breadth === "object") {
    lines.push(`\n## Breadth\n\`\`\`json\n${JSON.stringify(d.breadth, null, 2).slice(0, 3000)}\n\`\`\``);
  }
  if (d.screener && typeof d.screener === "object") {
    lines.push(`\n## TV Screener (5 screeners)\n\`\`\`json\n${JSON.stringify(d.screener, null, 2).slice(0, 8000)}\n\`\`\``);
  }
  if (d.technicals && typeof d.technicals === "object") {
    lines.push(`\n## Index Technicals (ATR/RSI/MACD)\n\`\`\`json\n${JSON.stringify(d.technicals, null, 2)}\n\`\`\``);
  }
  if (d.opend && Array.isArray(d.opend)) {
    lines.push(`\n## OpenD Live Quotes\n\`\`\`json\n${JSON.stringify(d.opend, null, 2).slice(0, 4000)}\n\`\`\``);
  }
  return lines.join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Claude call
// ────────────────────────────────────────────────────────────────────────────
async function generateBrief(promptTemplate: string, wikiContext: string, liveDataBlock: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is required");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const dateStr = new Date().toISOString().slice(0, 10);
  const filledPrompt = promptTemplate
    .replace("{date_str}", dateStr)
    .replace("{watchlist_str}", WATCHLIST.join(", "))
    .replace("{live_data_block}", liveDataBlock)
    .replace("{screener_unscored_str}", "(all top picks already scored by DeepSeek; only synthesize narrative)");

  const systemPrompt = `You are generating today's morning brief for an active US-stock swing trader.
You MUST output ONE strict JSON object matching the StructuredBrief schema described in the user prompt. No prose, no markdown fences.

## Wiki context (apply trader-style rubric + entry-method rules consistently)

${wikiContext}

## Hard rules
- The first character of your response MUST be \`{\`. The last MUST be \`}\`.
- Use the live data block AS-IS for breadth/indices/sectors/watchlist/technicals values. Never fabricate numbers.
- For \`technicals\` field: copy verbatim from the INDEX TECHNICALS section of live data.
- For \`movers\` field: prefer screener hits with score >= 80 + RVOL >= 1.5x (these become A-list candidates downstream).
- \`mood.posture\` should reflect index technicals — WAIT/TRIM_TIGHTEN if any index is EXTENDED or EXTREME-EXTENDED.`;

  console.error(`[brief] calling Claude (${MODEL})...`);
  const startedAt = Date.now();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: systemPrompt,
    messages: [{ role: "user", content: filledPrompt }],
  });

  const elapsedMs = Date.now() - startedAt;
  const usage = response.usage;
  console.error(
    `[brief] response in ${elapsedMs}ms (input=${usage.input_tokens} output=${usage.output_tokens})`,
  );

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((b) => b.text)
    .join("");

  // Trim to JSON envelope (Claude sometimes prefixes with whitespace/markdown).
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < 0) {
    throw new Error(`No JSON envelope in Claude response: ${text.slice(0, 200)}`);
  }
  return text.slice(firstBrace, lastBrace + 1);
}

// ────────────────────────────────────────────────────────────────────────────
// Ingest
// ────────────────────────────────────────────────────────────────────────────
async function pushToDashboard(structuredJson: unknown): Promise<unknown> {
  const base = (process.env.VERCEL_INGEST_URL ?? "").replace(/\/$/, "");
  const key = process.env.BRIEF_INGEST_KEY ?? "";
  if (!base || !key) {
    throw new Error("VERCEL_INGEST_URL and BRIEF_INGEST_KEY must be set (or pass --dry-run)");
  }

  const payloadStr = JSON.stringify(structuredJson);
  const inputHash = crypto.createHash("sha256").update(payloadStr).digest("hex").slice(0, 16);
  const provider = process.env.BRIEF_PROVIDER ?? "claude";
  const generatedBy = process.env.BRIEF_GENERATED_BY
    ?? `cli:claude-sdk:${new Date().toISOString().replace(/[:.]/g, "").slice(0, 13)}`;

  const body = JSON.stringify({
    provider,
    htmlBody: "",
    structuredJson,
    verdictJson: structuredJson,
    generatedBy,
    inputHash,
  });

  const url = `${base}/api/morning-verdict/ingest`;
  console.error(`[brief] POSTing to ${url}...`);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ingest HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.error(`[brief] data_dir=${DATA_DIR}`);
  console.error(`[brief] wiki_dir=${WIKI_DIR}`);
  console.error(`[brief] dry_run=${DRY_RUN}`);

  const promptTemplate = readTextIfExists(path.join(__dirname, "prompt.md"));
  if (!promptTemplate) throw new Error(`prompt.md not found at ${__dirname}`);

  const wikiContext = loadWikiContext();
  const liveData = loadLiveData();
  const liveDataBlock = buildLiveDataBlock(liveData);

  console.error(`[brief] wiki context: ${wikiContext.length} chars`);
  console.error(`[brief] live data block: ${liveDataBlock.length} chars`);

  const jsonStr = await generateBrief(promptTemplate, wikiContext, liveDataBlock);

  let structured: unknown;
  try {
    structured = JSON.parse(jsonStr);
  } catch (e) {
    console.error("[brief] JSON parse failed; writing raw output for debugging.");
    fs.writeFileSync(path.join(__dirname, "claude_brief_output.raw.txt"), jsonStr);
    throw e;
  }

  fs.writeFileSync(
    path.join(__dirname, "claude_brief_output.json"),
    JSON.stringify(structured, null, 2),
  );
  console.error(`[brief] wrote claude_brief_output.json`);

  if (DRY_RUN) {
    console.error(`[brief] --dry-run: skipping POST to dashboard`);
    return;
  }

  const ingestResult = await pushToDashboard(structured);
  console.log(JSON.stringify(ingestResult, null, 2));
  console.error(`[brief] ✓ Ingested to dashboard`);
}

main().catch((e) => {
  console.error(`[brief] FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
