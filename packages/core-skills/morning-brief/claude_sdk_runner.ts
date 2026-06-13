/**
 * claude_sdk_runner.ts — Phase 3c (real Agent SDK, not metered API)
 * =================================================================
 * Generates the "Claude" tab morning brief by driving the morning-brief SKILL
 * through the Claude Agent SDK — i.e. the same Claude Code that runs locally,
 * authenticated by the user's SUBSCRIPTION (CLAUDE_CODE_OAUTH_TOKEN), NOT the
 * metered Anthropic API token.
 *
 * Why this replaces the old @anthropic-ai/sdk implementation:
 *   - Old: a hand-rolled single API call billed per-token against ANTHROPIC_API_KEY.
 *   - New: query() drives Claude Code's agent loop, loads the morning-brief
 *     skill (prompt.md + wiki + tools), and runs the skill's full PATH A
 *     workflow — including the Step 4 push to the dashboard ingest endpoint.
 *
 * Auth precedence (the whole point — subscription over API billing):
 *   1. CLAUDE_CODE_OAUTH_TOKEN  → Claude Code subscription (Max/Pro). Preferred.
 *      Generate once with `claude setup-token`; store as a GH secret for CI.
 *   2. Logged-in Claude Code CLI (local runs) — uses ~/.claude credentials.
 *   3. ANTHROPIC_API_KEY — fallback ONLY. Logs a warning (this is metered).
 *
 * Usage:
 *   npm run brief         # generate + push (skill does the push in Step 4)
 *   npm run brief:dry     # --dry-run: generate, write file, do NOT push
 *
 * Env:
 *   CLAUDE_CODE_OAUTH_TOKEN   subscription auth (preferred)
 *   VERCEL_INGEST_URL         dashboard base URL (skill's push step reads this)
 *   BRIEF_INGEST_KEY          ingest secret (skill's push step reads this)
 *   CLAUDE_MODEL              optional model override
 *   WIKI_DIR / BRIEF_DATA_DIR optional path overrides for CI
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run");
const MODEL = process.env.CLAUDE_MODEL; // undefined => skill/CLI default
// Repo root = up from packages/core-skills/morning-brief
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function log(msg: string) {
  process.stderr.write(`[brief-sdk] ${msg}\n`);
}

function checkAuth(): "subscription" | "api" | "cli-login" {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return "subscription";
  // The SDK will use the logged-in CLI creds if present; we can't easily probe
  // that here, so treat "no oauth token but no api key" as cli-login.
  if (!process.env.ANTHROPIC_API_KEY) return "cli-login";
  return "api";
}

/**
 * The directive given to the skill-driven agent. We don't re-implement the
 * brief logic here — we tell Claude Code to RUN the morning-brief skill, which
 * already encodes the full PATH A workflow (read screeners/watchlist, compute
 * technicals, WebSearch, emit StructuredBrief, push via ingest_to_dashboard.py).
 */
function buildDirective(): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const pushClause = DRY_RUN
    ? "Do NOT push to the dashboard (dry run). Instead WRITE the StructuredBrief JSON to claude_brief_output.json in the morning-brief skill directory."
    : "Complete the skill through Step 4 — push the StructuredBrief to the dashboard via ingest_to_dashboard.py so it lands on the Claude tab. Then confirm the bucketAt returned.";

  return [
    `Run the morning-brief skill to generate today's (${dateStr}) market brief for the Claude tab.`,
    ``,
    `Follow the skill's PATH A workflow:`,
    `- Use the pre-fetched live data already on disk where available (snapshot.json, breadth.json, tv_screeners.json, index_technicals.json, opend_live.json in the backend data dir / skill dir).`,
    `- Apply the wiki trader-style + entry-method rubric from packages/core-skills/wiki-source/wiki.`,
    `- Emit a single valid StructuredBrief JSON object (the schema is in prompt.md).`,
    `- ${pushClause}`,
    ``,
    `SESSION BUDGET — this runs on a metered subscription session window; staying inside it is REQUIRED:`,
    `- Run web searches SEQUENTIALLY, one at a time. Do NOT fire many parallel WebSearch calls in a single turn, and do NOT spawn parallel sub-agents.`,
    `- Make AT MOST 4 web searches total, each a CONSOLIDATED query covering several sections:`,
    `    1. Overnight Asia + Europe markets, US index futures, VIX, 10Y yield, oil.`,
    `    2. Top pre-market movers and their specific catalysts.`,
    `    3. Today's earnings (BMO/AMC) + high-importance economic calendar.`,
    `    4. The most market-moving overnight/pre-market headlines + notable analyst rating changes.`,
    `- The wiki trader-style rubric and screener scoring need NO web search — apply them from the skill + pre-fetched data. Do NOT degrade or skip them.`,
    `- This is an automated cron run, not an interactive session. Do not ask questions.`,
  ].join("\n");
}

async function run(): Promise<number> {
  const auth = checkAuth();
  log(`auth mode: ${auth}${auth === "api" ? " (WARNING: metered API billing — set CLAUDE_CODE_OAUTH_TOKEN for subscription)" : ""}`);
  log(`dry_run: ${DRY_RUN} | repo_root: ${REPO_ROOT} | model: ${MODEL ?? "(default)"}`);

  let resultText = "";
  let success = false;

  try {
    const response = query({
      prompt: buildDirective(),
      options: {
        // Run from the repo root so CLAUDE.md + the skill are discoverable.
        cwd: REPO_ROOT,
        // Load project settings + CLAUDE.md so the skill's conventions apply.
        settingSources: ["project"],
        // Enable ONLY the morning-brief skill (context filter).
        skills: ["morning-brief"],
        // Tools the skill needs to read data, run its python push, search the web.
        allowedTools: ["Read", "Glob", "Grep", "Bash", "WebSearch", "Skill", "Write"],
        // Headless cron run — no interactive permission prompts.
        permissionMode: "bypassPermissions",
        ...(MODEL ? { model: MODEL } : {}),
        // Bound the agent loop so a stuck run can't spin forever in CI. Lowered
        // 40→28: with searches consolidated to ≤4 sequential queries (see the
        // SESSION BUDGET directive), the brief needs far fewer turns, and a
        // tighter cap keeps a runaway from burning the subscription session.
        maxTurns: 28,
        stderr: (d: string) => {
          // Surface only the meaningful lines (skip raw token noise).
          const t = d.trim();
          if (t && !t.startsWith("{")) process.stderr.write(`  [cc] ${t}\n`);
        },
      },
    });

    for await (const message of response) {
      if (message.type === "assistant") {
        // Light progress signal — first 120 chars of each assistant turn.
        const block = message.message?.content?.find?.((b: { type: string }) => b.type === "text") as
          | { text?: string } | undefined;
        if (block?.text) log(`… ${block.text.slice(0, 120).replace(/\n/g, " ")}`);
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          resultText = message.result ?? "";
          success = true;
        } else {
          log(`result subtype=${message.subtype}`);
        }
      }
    }
  } catch (e) {
    log(`FATAL: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }

  if (!success) {
    log("agent did not return a success result");
    return 1;
  }

  log("✓ skill run complete");
  // The skill itself handles the push (Step 4) and/or file write (dry-run).
  // resultText is the agent's final summary — print it for the CI log.
  if (resultText) process.stdout.write(resultText.slice(0, 800) + "\n");
  return 0;
}

run().then((code) => process.exit(code));
