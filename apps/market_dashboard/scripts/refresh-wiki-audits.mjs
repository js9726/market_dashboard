#!/usr/bin/env node
/**
 * Refresh local wiki trade verdict artifacts before posting them to the app.
 *
 * The old package script ran --backfill-entered and --rescore, but skipped
 * --audit. That left WikiTradeVerdict rows fresh while WikiAudit stopped at the
 * last manually generated month. This script keeps the monthly audit markdown
 * in lockstep with any day-14 verdicts that exist on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HUB_ROOT = path.resolve(APP_ROOT, "..", "..", "..");
const WIKI_ROOT =
  process.env.JIE_WIKI_ROOT ||
  process.env.LLM_TRADERS_WIKI_ROOT ||
  path.join(HUB_ROOT, "jie_wiki");
const VERDICTS_ROOT = path.join(WIKI_ROOT, "verdicts");

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function run(args) {
  const result = spawnSync("python", args, {
    cwd: WIKI_ROOT,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function monthsWithDay14(operator) {
  const opRoot = path.join(VERDICTS_ROOT, operator.toLowerCase());
  if (!fs.existsSync(opRoot)) return [];
  const months = new Set();
  for (const yearEntry of fs.readdirSync(opRoot, { withFileTypes: true })) {
    if (!yearEntry.isDirectory() || !/^\d{4}$/.test(yearEntry.name)) continue;
    const yearRoot = path.join(opRoot, yearEntry.name);
    for (const file of fs.readdirSync(yearRoot)) {
      const m = file.match(/^(\d{4}-\d{2})-\d{2}_[A-Z0-9.-]+_day14\.json$/);
      if (m) months.add(m[1]);
    }
  }
  return Array.from(months).sort();
}

if (!fs.existsSync(WIKI_ROOT)) {
  console.error(`[wiki:refresh] source missing: ${WIKI_ROOT}`);
  process.exit(2);
}

const operators = (argValue("--operators") ?? "JS,XX")
  .split(",")
  .map((op) => op.trim().toUpperCase())
  .filter(Boolean);

for (const operator of operators) {
  console.log(`[wiki:refresh] ${operator}: backfill entered flags`);
  run(["scripts/audit_trades.py", "--backfill-entered", "--journal-user", operator]);

  console.log(`[wiki:refresh] ${operator}: rescore eligible day-0 verdicts`);
  run(["scripts/audit_trades.py", "--rescore", "--journal-user", operator]);

  const months = monthsWithDay14(operator);
  if (months.length === 0) {
    console.log(`[wiki:refresh] ${operator}: no day-14 verdicts, no audits to generate`);
    continue;
  }

  for (const month of months) {
    console.log(`[wiki:refresh] ${operator}: audit ${month}`);
    run(["scripts/audit_trades.py", "--audit", month, "--journal-user", operator]);
  }
}
