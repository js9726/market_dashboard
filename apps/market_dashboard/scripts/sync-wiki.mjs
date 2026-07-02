#!/usr/bin/env node
/**
 * Sync jie_wiki verdict artifacts for the dashboard.
 *
 * Default: writes a local dev fallback under public/wiki/.
 *   npm run sync:wiki
 *
 * Deploy-safe path: posts the same payload to Postgres through the dashboard.
 *   npm run sync:wiki -- --post
 *   npm run sync:wiki -- --post --dry-run
 *
 * Multi-operator: scans every immediate subdir under jie_wiki/verdicts/
 * (e.g. js/, xx/, ...) and tags every audit + trade row with the operator label
 * (uppercased dir name). Existing single-operator data continues to work — the
 * Postgres rows default to operatorLabel='JS'.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..", "..");
const WIKI_ROOT =
  process.env.JIE_WIKI_ROOT ||
  process.env.LLM_TRADERS_WIKI_ROOT ||
  path.join(REPO_ROOT, "jie_wiki");
const VERDICTS_ROOT = path.join(WIKI_ROOT, "verdicts");
const PUBLIC_DEST = path.join(APP_ROOT, "public", "wiki");

const args = new Set(process.argv.slice(2));
const post = args.has("--post");
const dryRun = args.has("--dry-run");
const DASHBOARD_ROOT = path.resolve(APP_ROOT, "..", "..");

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function loadEnv() {
  for (const p of [
    path.join(APP_ROOT, ".env.local"),
    path.join(APP_ROOT, ".env"),
    path.join(DASHBOARD_ROOT, ".env"),
  ]) {
    if (!fs.existsSync(p)) continue;
    const raw = fs.readFileSync(p, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function relSource(p) {
  return path.relative(REPO_ROOT, p).replace(/\\/g, "/");
}

function apiTradeUrl(operatorLabel, date, ticker, stage) {
  const op = encodeURIComponent(operatorLabel);
  return `/api/wiki/trades/${date}/${encodeURIComponent(ticker)}/${stage}?operator=${op}`;
}

function readJsonFile(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

if (!fs.existsSync(VERDICTS_ROOT)) {
  console.error(`[sync:wiki] source missing: ${VERDICTS_ROOT}`);
  console.error("[sync:wiki] expected JIE_WIKI_ROOT or ../jie_wiki next to market_dashboard.");
  process.exit(2);
}

const AUDIT_RE = /^_audit_(\d{4})-(\d{2})\.md$/;
const TRADE_RE = /^(\d{4})-(\d{2})-(\d{2})_([A-Z0-9.-]+)_(day0|day14)\.json$/;
// Operator subdir: lowercase letters only, 2+ chars (js, xx, abc...). Filters out
// "_audit_*.md" siblings and any future non-operator files in verdicts/.
const OPERATOR_DIR_RE = /^[a-z]{2,}$/;

const audits = [];
const trades = [];
const tradeMap = new Map();
const operators = new Set();

const operatorDirs = fs
  .readdirSync(VERDICTS_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && OPERATOR_DIR_RE.test(entry.name));

if (operatorDirs.length === 0) {
  console.error(`[sync:wiki] no operator subdirs found under ${VERDICTS_ROOT}`);
  console.error("[sync:wiki] expected at least one of: js/, xx/, ...");
  process.exit(2);
}

for (const opDir of operatorDirs) {
  const operatorLabel = opDir.name.toUpperCase();
  operators.add(operatorLabel);
  const opPath = path.join(VERDICTS_ROOT, opDir.name);

  // Audit markdown files live at verdicts/{op}/_audit_YYYY-MM.md
  for (const entry of fs.readdirSync(opPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const m = entry.name.match(AUDIT_RE);
    if (!m) continue;
    const [, year, month] = m;
    const period = `${year}-${month}`;
    const sourcePath = path.join(opPath, entry.name);
    const markdown = fs.readFileSync(sourcePath, "utf8");
    const stats = fs.statSync(sourcePath);
    audits.push({
      operatorLabel,
      period,
      markdown,
      sourcePath: relSource(sourcePath),
      sizeBytes: stats.size,
    });
  }

  // Trade verdict JSONs live at verdicts/{op}/{year}/{date}_{ticker}_{stage}.json
  for (const yearDir of fs.readdirSync(opPath, { withFileTypes: true })) {
    if (!yearDir.isDirectory() || !/^\d{4}$/.test(yearDir.name)) continue;
    const yearPath = path.join(opPath, yearDir.name);
    for (const file of fs.readdirSync(yearPath)) {
      const m = file.match(TRADE_RE);
      if (!m) continue;
      const [, y, mo, d, ticker, stage] = m;
      const date = `${y}-${mo}-${d}`;
      const sourcePath = path.join(yearPath, file);
      const key = `${operatorLabel}_${date}_${ticker}`;
      let row = tradeMap.get(key);
      if (!row) {
        row = { operatorLabel, date, ticker, year: yearDir.name };
        tradeMap.set(key, row);
        trades.push(row);
      }
      row[`${stage}Json`] = readJsonFile(sourcePath);
      row[`${stage}SourcePath`] = relSource(sourcePath);
    }
  }
}

audits.sort((a, b) => b.period.localeCompare(a.period) || a.operatorLabel.localeCompare(b.operatorLabel));

// Aggregate drift suggestions across all audits. Mirror the server-side parser
// at src/app/api/wiki/audits/route.ts so the local fallback shows the same
// summary the production list endpoint does.
const SUGGESTION_LINE_RE = /^-\s+`([^`]+)`:\s+(.+)$/;
const TRADE_CTX_RE = /^(.*)\s*\(trade:\s*([A-Z0-9.-]{1,16})\s+(\d{4}-\d{2}-\d{2})\)\s*$/;

const driftRows = [];
const driftByRubric = {};
for (const audit of audits) {
  let inSuggestions = false;
  for (const raw of audit.markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^##\s+Suggested\s+wiki\s+updates/i.test(line)) {
      inSuggestions = true;
      continue;
    }
    if (line.startsWith("## ")) {
      inSuggestions = false;
      continue;
    }
    if (!inSuggestions) continue;
    const m = line.match(SUGGESTION_LINE_RE);
    if (!m) continue;
    const ctx = m[2].match(TRADE_CTX_RE);
    driftRows.push({
      rubric: m[1],
      reason: ctx ? ctx[1].trimEnd() : m[2].trim(),
      operatorLabel: audit.operatorLabel,
      period: audit.period,
      ticker: ctx ? ctx[2] : undefined,
      tradeDate: ctx ? ctx[3] : undefined,
    });
    driftByRubric[m[1]] = (driftByRubric[m[1]] ?? 0) + 1;
  }
}
driftRows.sort(
  (a, b) =>
    b.period.localeCompare(a.period) ||
    a.operatorLabel.localeCompare(b.operatorLabel) ||
    a.rubric.localeCompare(b.rubric),
);
trades.sort(
  (a, b) =>
    b.date.localeCompare(a.date) ||
    a.operatorLabel.localeCompare(b.operatorLabel) ||
    a.ticker.localeCompare(b.ticker),
);

const manifest = {
  generated_at: new Date().toISOString(),
  source: relSource(VERDICTS_ROOT),
  operators: Array.from(operators).sort(),
  audits_count: audits.length,
  trades_count: trades.length,
  drift_suggestions: driftRows,
  drift_by_rubric: driftByRubric,
  audits: audits.map((audit) => ({
    operatorLabel: audit.operatorLabel,
    period: audit.period,
    url: `/api/wiki/audits/${audit.period}?operator=${encodeURIComponent(audit.operatorLabel)}`,
    size_bytes: audit.sizeBytes,
  })),
  trades: trades.map((trade) => {
    // Prefer the freshest P&L: day14 (after rescore) > day0 (entry snapshot, usually empty).
    const pnlUser =
      trade.day14Json?.pnl_user ??
      trade.day0Json?.pnl_user ??
      null;
    const intent =
      trade.day14Json?.intent ??
      trade.day0Json?.intent ??
      "journal";
    return {
      operatorLabel: trade.operatorLabel,
      intent,
      date: trade.date,
      ticker: trade.ticker,
      year: trade.year,
      pnl_user: pnlUser,
      day0_url: trade.day0Json ? apiTradeUrl(trade.operatorLabel, trade.date, trade.ticker, "day0") : undefined,
      day14_url: trade.day14Json ? apiTradeUrl(trade.operatorLabel, trade.date, trade.ticker, "day14") : undefined,
    };
  }),
};

console.log(
  `[sync:wiki] found ${operators.size} operator(s) [${manifest.operators.join(", ")}], ` +
    `${audits.length} audit(s), ${trades.length} trade verdict(s).`,
);

if (dryRun) {
  console.log("[sync:wiki] dry-run only; no local files written and no ingest attempted.");
  process.exit(0);
}

rmrf(PUBLIC_DEST);
ensureDir(path.join(PUBLIC_DEST, "audits"));
ensureDir(path.join(PUBLIC_DEST, "trades"));

for (const audit of audits) {
  const sourcePath = path.join(REPO_ROOT, audit.sourcePath);
  // Mirror the operator structure so the file-based fallback can serve them.
  copyFile(
    sourcePath,
    path.join(PUBLIC_DEST, "audits", audit.operatorLabel, `_audit_${audit.period}.md`),
  );
}

for (const trade of trades) {
  for (const stage of ["day0", "day14"]) {
    const sourcePath = trade[`${stage}SourcePath`];
    if (!sourcePath) continue;
    copyFile(
      path.join(REPO_ROOT, sourcePath),
      path.join(
        PUBLIC_DEST,
        "trades",
        trade.operatorLabel,
        trade.year,
        `${trade.date}_${trade.ticker}_${stage}.json`,
      ),
    );
  }
}

fs.writeFileSync(path.join(PUBLIC_DEST, "index.json"), JSON.stringify(manifest, null, 2));
console.log(`[sync:wiki] wrote local fallback to ${PUBLIC_DEST}`);

if (post) {
  loadEnv();
  const base = (argValue("--post-url") ?? process.env.VERCEL_INGEST_URL ?? process.env.NEXTAUTH_URL ?? "").replace(/\/$/, "");
  const key = process.env.BRIEF_INGEST_KEY ?? "";
  if (!base || !key) {
    console.error("[sync:wiki] --post requires VERCEL_INGEST_URL (or NEXTAUTH_URL) and BRIEF_INGEST_KEY.");
    process.exit(2);
  }

  // Build ingest payload — pull intent out of the verdict JSON so the ingest
  // endpoint can tag each row. Default to "journal" when missing (legacy data).
  const tradePayload = trades.map((trade) => {
    const intent =
      trade.day14Json?.intent ??
      trade.day0Json?.intent ??
      "journal";
    return {
      operatorLabel: trade.operatorLabel,
      intent,
      date: trade.date,
      ticker: trade.ticker,
      year: trade.year,
      day0Json: trade.day0Json,
      day14Json: trade.day14Json,
      day0SourcePath: trade.day0SourcePath,
      day14SourcePath: trade.day14SourcePath,
    };
  });

  const response = await fetch(`${base}/api/wiki/audits/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ audits, trades: tradePayload }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`[sync:wiki] ingest failed HTTP ${response.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`[sync:wiki] ingest ok: ${body}`);
}
