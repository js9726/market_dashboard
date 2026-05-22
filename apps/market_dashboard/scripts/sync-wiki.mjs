#!/usr/bin/env node
/**
 * Sync llm_traders_wiki verdict artifacts for the dashboard.
 *
 * Default: writes a local dev fallback under public/wiki/.
 *   npm run sync:wiki
 *
 * Deploy-safe path: posts the same payload to Postgres through the dashboard.
 *   npm run sync:wiki -- --post
 *   npm run sync:wiki -- --post --dry-run
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..", "..");
const WIKI_SOURCE = path.join(REPO_ROOT, "llm_traders_wiki", "verdicts", "js");
const PUBLIC_DEST = path.join(APP_ROOT, "public", "wiki");

const args = new Set(process.argv.slice(2));
const post = args.has("--post");
const dryRun = args.has("--dry-run");

function argValue(name) {
  const prefix = `${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(APP_ROOT, name);
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

function apiTradeUrl(date, ticker, stage) {
  return `/api/wiki/trades/${date}/${encodeURIComponent(ticker)}/${stage}`;
}

function readJsonFile(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

if (!fs.existsSync(WIKI_SOURCE)) {
  console.error(`[sync:wiki] source missing: ${WIKI_SOURCE}`);
  console.error("[sync:wiki] expected ../llm_traders_wiki next to market_dashboard.");
  process.exit(2);
}

const AUDIT_RE = /^_audit_(\d{4})-(\d{2})\.md$/;
const TRADE_RE = /^(\d{4})-(\d{2})-(\d{2})_([A-Z0-9.-]+)_(day0|day14)\.json$/;

const audits = [];
const trades = [];
const tradeMap = new Map();

for (const entry of fs.readdirSync(WIKI_SOURCE, { withFileTypes: true })) {
  if (!entry.isFile()) continue;
  const m = entry.name.match(AUDIT_RE);
  if (!m) continue;
  const [, year, month] = m;
  const period = `${year}-${month}`;
  const sourcePath = path.join(WIKI_SOURCE, entry.name);
  const markdown = fs.readFileSync(sourcePath, "utf8");
  const stats = fs.statSync(sourcePath);
  audits.push({
    period,
    markdown,
    sourcePath: relSource(sourcePath),
    sizeBytes: stats.size,
  });
}
audits.sort((a, b) => b.period.localeCompare(a.period));

for (const yearDir of fs.readdirSync(WIKI_SOURCE, { withFileTypes: true })) {
  if (!yearDir.isDirectory() || !/^\d{4}$/.test(yearDir.name)) continue;
  const yearPath = path.join(WIKI_SOURCE, yearDir.name);
  for (const file of fs.readdirSync(yearPath)) {
    const m = file.match(TRADE_RE);
    if (!m) continue;
    const [, y, mo, d, ticker, stage] = m;
    const date = `${y}-${mo}-${d}`;
    const sourcePath = path.join(yearPath, file);
    const key = `${date}_${ticker}`;
    let row = tradeMap.get(key);
    if (!row) {
      row = { date, ticker, year: yearDir.name };
      tradeMap.set(key, row);
      trades.push(row);
    }
    row[`${stage}Json`] = readJsonFile(sourcePath);
    row[`${stage}SourcePath`] = relSource(sourcePath);
  }
}
trades.sort((a, b) => b.date.localeCompare(a.date) || a.ticker.localeCompare(b.ticker));

const manifest = {
  generated_at: new Date().toISOString(),
  source: relSource(WIKI_SOURCE),
  audits_count: audits.length,
  trades_count: trades.length,
  audits: audits.map((audit) => ({
    period: audit.period,
    url: `/api/wiki/audits/${audit.period}`,
    size_bytes: audit.sizeBytes,
  })),
  trades: trades.map((trade) => ({
    date: trade.date,
    ticker: trade.ticker,
    year: trade.year,
    day0_url: trade.day0Json ? apiTradeUrl(trade.date, trade.ticker, "day0") : undefined,
    day14_url: trade.day14Json ? apiTradeUrl(trade.date, trade.ticker, "day14") : undefined,
  })),
};

console.log(`[sync:wiki] found ${audits.length} audit(s) + ${trades.length} trade verdict(s).`);

if (dryRun) {
  console.log("[sync:wiki] dry-run only; no local files written and no ingest attempted.");
  process.exit(0);
}

rmrf(PUBLIC_DEST);
ensureDir(path.join(PUBLIC_DEST, "audits"));
ensureDir(path.join(PUBLIC_DEST, "trades"));

for (const audit of audits) {
  const sourcePath = path.join(REPO_ROOT, audit.sourcePath);
  copyFile(sourcePath, path.join(PUBLIC_DEST, "audits", `_audit_${audit.period}.md`));
}

for (const trade of trades) {
  for (const stage of ["day0", "day14"]) {
    const sourcePath = trade[`${stage}SourcePath`];
    if (!sourcePath) continue;
    copyFile(
      path.join(REPO_ROOT, sourcePath),
      path.join(PUBLIC_DEST, "trades", trade.year, `${trade.date}_${trade.ticker}_${stage}.json`),
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

  const response = await fetch(`${base}/api/wiki/audits/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ audits, trades }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`[sync:wiki] ingest failed HTTP ${response.status}: ${body.slice(0, 500)}`);
    process.exit(1);
  }
  console.log(`[sync:wiki] ingest ok: ${body}`);
}
