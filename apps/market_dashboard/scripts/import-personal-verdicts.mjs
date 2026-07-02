#!/usr/bin/env node
/**
 * One-time backfill: import operator's local verdict JSONs into Postgres.
 *
 * Reads verdicts/{YYYY}/*.json from jie_wiki and inserts as
 * TradeVerdictHistory rows tagged provider='backfill-2026-05-07'.
 *
 * Matches each verdict to a Trade row by (userId, ticker, tradeDate).
 * Idempotent: skips rows already imported (same tradeId + kind + provider tag).
 *
 * Usage (from apps/market_dashboard/):
 *   node --env-file=.env.local scripts/import-personal-verdicts.mjs --dry-run
 *   node --env-file=.env.local scripts/import-personal-verdicts.mjs
 *   node --env-file=.env.local scripts/import-personal-verdicts.mjs --user jane@x.com
 *
 * Env vars (loaded by --env-file=.env.local):
 *   DATABASE_URL            Required for Prisma client init
 *   OWNER_EMAIL             Default operator email if --user not given
 *   WIKI_VERDICTS_DIR       Override path to jie_wiki/verdicts (optional)
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WIKI_ROOT =
  process.env.JIE_WIKI_ROOT ||
  process.env.LLM_TRADERS_WIKI_ROOT ||
  path.resolve(__dirname, "../../../../jie_wiki");
const DEFAULT_WIKI_DIR = path.join(DEFAULT_WIKI_ROOT, "verdicts");
const PROVIDER_TAG = "backfill-2026-05-07";

function parseArgs(argv) {
  const args = { dryRun: false, user: null, sourceDir: null, ownerLabel: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--verbose" || a === "-v") args.verbose = true;
    else if (a === "--user") args.user = argv[++i];
    else if (a.startsWith("--user=")) args.user = a.slice("--user=".length);
    else if (a === "--source-dir") args.sourceDir = argv[++i];
    else if (a.startsWith("--source-dir=")) args.sourceDir = a.slice("--source-dir=".length);
    else if (a === "--owner-label") args.ownerLabel = argv[++i];
    else if (a.startsWith("--owner-label=")) args.ownerLabel = a.slice("--owner-label=".length);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const operatorEmail =
    args.user || process.env.OWNER_EMAIL || "jieshengooi2697@gmail.com";
  // Source dir: use --source-dir if given, otherwise infer from owner label, else legacy default.
  const ownerLabel = args.ownerLabel || (operatorEmail.startsWith("2525yu") ? "XX" : "JS");
  const wikiVerdictsDir =
    args.sourceDir ||
    process.env.WIKI_VERDICTS_DIR ||
    path.join(DEFAULT_WIKI_DIR, ownerLabel.toLowerCase());

  const prisma = new PrismaClient();

  console.log(`Mode:        ${args.dryRun ? "DRY-RUN (no DB writes)" : "LIVE (inserting rows)"}`);
  console.log(`User:        ${operatorEmail}`);
  console.log(`OwnerLabel:  ${ownerLabel}`);
  console.log(`Verdicts:    ${wikiVerdictsDir}`);
  console.log(`Provider:    ${PROVIDER_TAG}`);
  console.log("");

  // Verify operator user exists
  const user = await prisma.user.findUnique({
    where: { email: operatorEmail },
    select: { id: true, email: true, role: true },
  });
  if (!user) {
    console.error(`ERROR: User not found: ${operatorEmail}`);
    console.error(`Hint: sign in once at the SaaS app to create your User row.`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`User row found: id=${user.id}, role=${user.role}\n`);

  // Walk year directories
  const stats = {
    filesScanned: 0,
    day0Imported: 0,
    day14Imported: 0,
    alreadyExists: 0,
    noMatchingTrade: 0,
    parseError: 0,
    insertError: 0,
  };
  const noMatchSamples = [];

  let yearDirs;
  try {
    yearDirs = await fs.readdir(wikiVerdictsDir);
  } catch (err) {
    console.error(`ERROR: cannot read ${wikiVerdictsDir}: ${err.message}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  for (const yearDir of yearDirs.sort()) {
    if (!/^\d{4}$/.test(yearDir)) continue;
    const yearPath = path.join(wikiVerdictsDir, yearDir);
    const yearStat = await fs.stat(yearPath);
    if (!yearStat.isDirectory()) continue;

    const files = await fs.readdir(yearPath);
    for (const file of files.sort()) {
      if (!file.endsWith(".json")) continue;
      stats.filesScanned++;

      const match = file.match(/^(\d{4}-\d{2}-\d{2})_([A-Z0-9.\-]+)_(day0|day14)\.json$/);
      if (!match) {
        if (args.verbose) console.warn(`skip unparseable: ${file}`);
        continue;
      }
      const [, dateStr, ticker, kindRaw] = match;
      const isDay0 = kindRaw === "day0";
      const dbKind = isDay0 ? "day-0" : "day-14-rescore";
      const filePath = path.join(yearPath, file);

      let content;
      try {
        content = JSON.parse(await fs.readFile(filePath, "utf8"));
      } catch (err) {
        console.error(`parse error: ${file} — ${err.message}`);
        stats.parseError++;
        continue;
      }

      // Match Trade row by (userId, ticker, tradeDate)
      const tradeDate = new Date(dateStr + "T00:00:00.000Z");
      const tradeDateNext = new Date(tradeDate.getTime() + 24 * 60 * 60 * 1000);
      const trade = await prisma.tradeRecord.findFirst({
        where: {
          userId: user.id,
          ticker: ticker.toUpperCase(),
          tradeDate: { gte: tradeDate, lt: tradeDateNext },
        },
        select: { id: true, tradeDate: true, ticker: true },
      });

      if (!trade) {
        stats.noMatchingTrade++;
        if (noMatchSamples.length < 10) noMatchSamples.push(`${ticker} ${dateStr}`);
        if (args.verbose) console.warn(`no match: ${ticker} ${dateStr}`);
        continue;
      }

      // Idempotency: skip if same kind already imported with this provider tag
      const existing = await prisma.tradeVerdictHistory.findFirst({
        where: { tradeId: trade.id, kind: dbKind, provider: PROVIDER_TAG },
        select: { id: true },
      });
      if (existing) {
        stats.alreadyExists++;
        continue;
      }

      // Build the row data
      const data = isDay0
        ? {
            tradeId: trade.id,
            ticker: ticker.toUpperCase(),
            tradeDate: trade.tradeDate,
            model: content.model || "deepseek-chat",
            provider: PROVIDER_TAG,
            style: "trader-debate",
            kind: "day-0",
            verdict: content,
            score:
              typeof content.composite_technical_score === "number"
                ? content.composite_technical_score
                : null,
          }
        : {
            tradeId: trade.id,
            ticker: ticker.toUpperCase(),
            tradeDate: trade.tradeDate,
            model: "heuristic-no-llm",
            provider: PROVIDER_TAG,
            style: "trader-debate",
            kind: "day-14-rescore",
            verdict: { source: "backfill", file, rescore_timestamp: content.rescore_timestamp },
            outcomeMetrics: content,
            score: null,
          };

      if (args.dryRun) {
        if (isDay0) stats.day0Imported++;
        else stats.day14Imported++;
        if (args.verbose) {
          console.log(`would insert: ${file} -> tradeId=${trade.id} kind=${dbKind}`);
        }
        continue;
      }

      try {
        await prisma.tradeVerdictHistory.create({ data });
        if (isDay0) stats.day0Imported++;
        else stats.day14Imported++;
        if ((stats.day0Imported + stats.day14Imported) % 25 === 0) {
          console.log(
            `progress: ${stats.day0Imported} day-0 + ${stats.day14Imported} day-14 inserted`
          );
        }
      } catch (err) {
        console.error(`insert error ${file}: ${err.message}`);
        stats.insertError++;
      }
    }
  }

  console.log("\n=== Backfill complete ===");
  console.table(stats);

  if (stats.noMatchingTrade > 0) {
    console.log(`\nFirst ${noMatchSamples.length} unmatched (Trade row not found in DB):`);
    noMatchSamples.forEach((s) => console.log(`  - ${s}`));
    console.log(
      `Hint: sync your journal Google Sheet via the SaaS app first; then re-run this script.`
    );
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
