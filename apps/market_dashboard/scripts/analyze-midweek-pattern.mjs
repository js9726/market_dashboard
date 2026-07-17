/**
 * analyze-midweek-pattern.mjs — durable, re-runnable evidence for the
 * 2026-07-13 wiki calibration "midweek-entry winners get cut early"
 * (jie_wiki/wiki/risk-management.md "Operator calibration 2026-07-13").
 *
 * Committed in response to Codex's 2026-07-17 review finding: the original
 * analysis ran in ephemeral session scripts with no stable artifact. This
 * script reproduces it against the CURRENT database and writes the output to
 * docs/evidence/midweek-pattern.json so the calibration stays auditable and
 * re-testable as the journal grows.
 *
 * Read-only. Run from apps/market_dashboard:
 *   node --env-file=.env.local scripts/analyze-midweek-pattern.mjs
 *
 * Method (mirrors the aggregation rules of server/journal-pivot.ts):
 *   - closed trades only (pnl != null), reconciler ":dup" twins excluded
 *     (NULL-safe), paper accounts excluded, USD-true P&L (pnlUsd ?? USD-raw).
 *   - Day-of-week table on ENTRY date (tradeDate).
 *   - Sign test: per half-year with n>=5 in both groups, is avgWin(Tue+Wed)
 *     below avgWin(other weekdays)? Same for profit factor.
 *   - Holding-time split (tradeDate -> executedAt, 0..120d) for winners/losers.
 */
import { PrismaClient } from "@prisma/client";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const prisma = new PrismaClient();
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const num = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n) => Math.round(n * 100) / 100;

const owner = await prisma.user.findUnique({ where: { email: process.env.OWNER_EMAIL } });
if (!owner) {
  console.error("OWNER_EMAIL user not found");
  process.exit(1);
}

const rows = await prisma.tradeRecord.findMany({
  where: {
    userId: owner.id,
    pnl: { not: null },
    OR: [{ brokerOrderId: null }, { NOT: { brokerOrderId: { endsWith: ":dup" } } }],
    AND: [{ OR: [{ brokerAccountId: null }, { brokerAccount: { isLive: true } }] }],
  },
  select: { ticker: true, tradeDate: true, executedAt: true, pnl: true, pnlUsd: true, currencyCode: true, currency: true, state: true },
});

const usd = (t) => {
  const c = num(t.pnlUsd);
  if (c != null) return c;
  const raw = num(t.pnl);
  if (raw == null) return null;
  const code = (t.currencyCode ?? t.currency ?? "").toUpperCase();
  return code === "" || code === "USD" ? raw : null;
};
const when = (t) => t.tradeDate ?? t.executedAt;
const weekday = rows.filter((t) => {
  const d = when(t);
  return d && d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && usd(t) != null;
});
const weekendDated = rows.filter((t) => when(t) && [0, 6].includes(when(t).getUTCDay())).length;

function agg(list) {
  if (!list.length) return null;
  const p = list.map(usd);
  const wins = p.filter((x) => x > 0);
  const losses = p.filter((x) => x < 0);
  const gw = wins.reduce((a, b) => a + b, 0);
  const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
  return {
    n: list.length,
    totalPnl: r2(p.reduce((a, b) => a + b, 0)),
    winRate: r2((wins.length / list.length) * 100),
    avgWin: wins.length ? r2(gw / wins.length) : null,
    avgLoss: losses.length ? r2(-gl / losses.length) : null,
    profitFactor: gl > 0 ? r2(gw / gl) : null,
  };
}

// 1) Day-of-week table
const dowTable = {};
for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri"]) {
  dowTable[d] = agg(weekday.filter((t) => DOW[when(t).getUTCDay()] === d));
}

// 2) Half-year sign test
const half = (d) => `${d.getUTCFullYear()}-H${d.getUTCMonth() < 6 ? 1 : 2}`;
const grp = (t) => (["Tue", "Wed"].includes(DOW[when(t).getUTCDay()]) ? "tueWed" : "other");
const periods = {};
for (const t of weekday) (periods[half(when(t))] ??= { tueWed: [], other: [] })[grp(t)].push(t);
const periodTable = [];
let worseAvgWin = 0;
let worsePf = 0;
let comparable = 0;
for (const k of Object.keys(periods).sort()) {
  const tw = agg(periods[k].tueWed);
  const ot = agg(periods[k].other);
  periodTable.push({ period: k, tueWed: tw, other: ot });
  if (tw && ot && tw.n >= 5 && ot.n >= 5 && tw.avgWin != null && ot.avgWin != null) {
    comparable++;
    if (tw.avgWin < ot.avgWin) worseAvgWin++;
    if (tw.profitFactor != null && ot.profitFactor != null && tw.profitFactor < ot.profitFactor) worsePf++;
  }
}

// 3) Holding-time split (winners cut short?)
const hold = (t) => (t.tradeDate && t.executedAt ? (t.executedAt - t.tradeDate) / 86400000 : null);
const holdStats = {};
for (const g of ["tueWed", "other"]) {
  const of = (pred) => weekday.filter((t) => grp(t) === g && pred(usd(t)) && hold(t) != null && hold(t) >= 0 && hold(t) < 120);
  const avg = (l) => (l.length ? r2(l.reduce((s, t) => s + hold(t), 0) / l.length) : null);
  const winners = of((p) => p > 0);
  const losers = of((p) => p < 0);
  holdStats[g] = { winnersAvgHoldDays: avg(winners), winnersN: winners.length, losersAvgHoldDays: avg(losers), losersN: losers.length };
}

const out = {
  generatedAt: new Date().toISOString(),
  method: "closed trades, :dup-excluded (NULL-safe), live accounts only, USD-true P&L, entry-date DOW",
  totals: { closedRows: rows.length, weekdayMeasured: weekday.length, weekendDated },
  dayOfWeek: dowTable,
  signTest: {
    comparablePeriods: comparable,
    avgWinWorseOnTueWed: worseAvgWin,
    profitFactorWorseOnTueWed: worsePf,
    holds: comparable > 0 && worseAvgWin === comparable && worsePf === comparable,
  },
  periodTable,
  holdingSplit: holdStats,
  calibrationRef: "jie_wiki/wiki/risk-management.md 'Operator calibration 2026-07-13'",
};

const here = dirname(fileURLToPath(import.meta.url));
const outPath = join(here, "..", "docs", "evidence", "midweek-pattern.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ signTest: out.signTest, holdingSplit: out.holdingSplit, totals: out.totals }, null, 1));
console.log("written:", outPath);
await prisma.$disconnect();
