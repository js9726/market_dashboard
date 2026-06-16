#!/usr/bin/env node
/**
 * codex_brief_runner.mjs — Codex tab brief via the ChatGPT/Codex SUBSCRIPTION.
 *
 * Runs on a SELF-HOSTED GitHub Actions runner on the operator's PC, where the
 * Codex CLI is logged in (~/.codex/auth.json, auto-refreshing) — so this uses
 * the subscription, NOT the metered OpenAI API. Mirrors claude_sdk_runner.ts
 * but drives `codex exec` instead of the Claude Agent SDK.
 *
 * Why self-hosted: the Codex CLI is a stateful desktop binary with rotating
 * OAuth tokens — it can't be reproduced on a GitHub-hosted Linux runner. The
 * operator PC is the only place the live subscription auth exists.
 *
 * Flow:
 *   1. Resolve the codex binary (CODEX_EXE / PATH / known install dir).
 *   2. `codex exec` with a directive pointing at the pre-fetched data + the
 *      morning-brief prompt spec + the wiki rubric; capture the final message
 *      via --output-last-message.
 *   3. Salvage the StructuredBrief JSON, sanity-check it, POST to the dashboard
 *      ingest endpoint as provider=openai (the Codex tab).
 *
 * Env:
 *   VERCEL_INGEST_URL   dashboard base URL
 *   BRIEF_INGEST_KEY    ingest bearer key
 *   BRIEF_DATA_DIR      pre-fetched data dir (snapshot/breadth/screeners/technicals)
 *   WIKI_DIR            wiki-source/wiki dir for the trader rubric
 *   CODEX_EXE           optional explicit path to codex.exe
 *   CODEX_MODEL         optional model override
 *   CODEX_REASONING     optional reasoning effort (default "medium")
 *   --dry-run           generate + write file, do NOT post
 */
import { spawnSync, execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DRY_RUN = process.argv.includes("--dry-run");
const DATA_DIR = process.env.BRIEF_DATA_DIR || path.join(REPO_ROOT, "apps/market_dashboard_backend/data");
const WIKI_DIR = process.env.WIKI_DIR || path.join(REPO_ROOT, "packages/core-skills/wiki-source/wiki");

function log(msg) {
  process.stderr.write(`[codex-brief] ${msg}\n`);
}

/** Find the codex binary: explicit env → PATH → known Windows install dir. */
function resolveCodex() {
  if (process.env.CODEX_EXE && fs.existsSync(process.env.CODEX_EXE)) return process.env.CODEX_EXE;
  try {
    const which = process.platform === "win32" ? "where" : "which";
    const found = execSync(`${which} codex`, { encoding: "utf8" }).split(/\r?\n/)[0].trim();
    if (found && fs.existsSync(found)) return found;
  } catch {
    /* not on PATH */
  }
  // Windows desktop install: C:\Users\<u>\AppData\Local\OpenAI\Codex\bin\<hash>\codex.exe
  const binRoot = path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin");
  if (fs.existsSync(binRoot)) {
    for (const dir of fs.readdirSync(binRoot)) {
      const cand = path.join(binRoot, dir, "codex.exe");
      if (fs.existsSync(cand)) return cand;
    }
  }
  throw new Error("codex binary not found (set CODEX_EXE)");
}

function buildDirective() {
  const dateStr = new Date().toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return [
    `Generate today's (${dateStr}) StructuredBrief morning market brief for the Codex tab.`,
    ``,
    `SPEC: read the field shape + rubric in packages/core-skills/morning-brief/prompt.md and follow it exactly.`,
    `DATA (authoritative — copy values verbatim, never override with web search):`,
    `  ${path.relative(REPO_ROOT, DATA_DIR)}/snapshot.json, breadth.json, tv_screeners.json, index_technicals.json (where present).`,
    `RUBRIC: apply the wiki trader-style + entry-method rules in ${path.relative(REPO_ROOT, WIKI_DIR)} — this is the source of setup/screener scoring. Do not degrade it.`,
    ``,
    `SESSION BUDGET: make AT MOST 4 sequential web searches (overnight Asia/Europe + futures + VIX + 10Y + oil; pre-market movers + catalysts; earnings + economic calendar; top market-moving headlines + analyst rating changes). The wiki rubric + screener scoring need NO web search.`,
    ``,
    `OUTPUT: your FINAL message must be ONLY the StructuredBrief JSON object — first char "{", last char "}". No prose, no markdown fences. Fill every field from the data; use null when a value is genuinely unavailable.`,
  ].join("\n");
}

/** Pull the first complete JSON object out of the model's final message. */
function salvageJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [];
  if (fence?.[1]) candidates.push(fence[1]);
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(text.slice(start, end + 1));
  for (const c of candidates) {
    try {
      const o = JSON.parse(c);
      if (o && typeof o === "object" && !Array.isArray(o)) return o;
    } catch {
      /* next */
    }
  }
  return null;
}

async function postIngest(structured) {
  const base = (process.env.VERCEL_INGEST_URL || "").replace(/\/$/, "");
  const key = process.env.BRIEF_INGEST_KEY;
  if (!base || !key) throw new Error("VERCEL_INGEST_URL / BRIEF_INGEST_KEY not set");
  const inputHash = `codex-${new Date().toISOString().slice(0, 13)}`; // hour-bucketed provenance
  const res = await fetch(`${base}/api/morning-verdict/ingest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "openai",
      htmlBody: "",
      structuredJson: structured,
      generatedBy: "selfhosted-codex-subscription",
      inputHash,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ingest ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function main() {
  const codex = resolveCodex();
  log(`codex: ${codex} | data: ${DATA_DIR} | dry_run: ${DRY_RUN}`);
  const outFile = path.join(os.tmpdir(), `codex_brief_${Date.now()}.json`);

  const args = [
    "exec",
    "--skip-git-repo-check",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C", REPO_ROOT,
    "-c", `model_reasoning_effort="${process.env.CODEX_REASONING || "medium"}"`,
    ...(process.env.CODEX_MODEL ? ["-m", process.env.CODEX_MODEL] : []),
    "--output-last-message", outFile,
    "-", // prompt from stdin
  ];

  const proc = spawnSync(codex, args, {
    input: buildDirective(),
    encoding: "utf8",
    timeout: 12 * 60 * 1000, // 12-min ceiling
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.stderr) process.stderr.write(proc.stderr.slice(-2000));
  if (proc.status !== 0) {
    log(`codex exec exited ${proc.status}`);
  }

  const finalMsg = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : proc.stdout ?? "";
  const structured = salvageJson(finalMsg);
  if (!structured || typeof structured.mood !== "object") {
    log("FATAL: no valid StructuredBrief in codex output");
    process.exit(1);
  }
  log(`parsed StructuredBrief (mood.posture=${structured.mood?.posture ?? "?"})`);

  if (DRY_RUN) {
    const dst = path.join(__dirname, "codex_brief_output.json");
    fs.writeFileSync(dst, JSON.stringify(structured, null, 2));
    log(`dry-run: wrote ${dst}`);
    return 0;
  }

  const result = await postIngest(structured);
  log(`✓ pushed Codex tab — bucketAt=${result.bucketAt ?? "?"} aListGate=${result.aListGate ?? "?"}`);
  return 0;
}

main().then((c) => process.exit(c ?? 0)).catch((e) => {
  log(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
