#!/usr/bin/env node
/**
 * One-off correction for moomoo fill timestamps (2026-10-21).
 *
 * Until 2026-10-21 the moomoo bridge stored OpenD's deal create_time, which is
 * wall-clock time in the security's own market (New York for US.*), as if it were
 * UTC. A US fill at 11:07 ET sits in TradeFill as 11:07Z instead of 15:07Z.
 *
 * Every shift is checked against broker truth. The input is an OpenD deal export
 * written by the FIXED backfill_deals.py, which carries the true UTC instant per
 * deal id. A fill is shifted only when its stored time equals that deal's
 * wall-clock digits read as UTC; a fill already at the true instant is left alone.
 * That makes a re-run harmless, including after the fixed bridge has inserted new
 * fills. Trade (TradeRecord) rows on the owner's moomoo accounts are shifted only
 * where executedAt or tradeDate equals a wrong deal time for the same ticker: the
 * reconciler copies episode open/close fill times into those fields.
 *
 * Prints counts only. Dry run unless --apply. --apply writes the production
 * database in one transaction and needs Jie's explicit OK.
 *
 * Usage (from apps/market_dashboard/, OpenD running):
 *   ../../packages/dashboard-bridge/.venv/Scripts/python.exe ../../packages/dashboard-bridge/backfill_deals.py --months 30 --out <tmp>/deals.json
 *   node --env-file=.env.local scripts/fix-moomoo-fill-timezones.mjs --deals <tmp>/deals.json
 *   node --env-file=.env.local scripts/fix-moomoo-fill-timezones.mjs --deals <tmp>/deals.json --apply
 */
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const dealsArg = process.argv.indexOf("--deals");
const DEALS_PATH = dealsArg > 0 ? process.argv[dealsArg + 1] : null;

// Mirrors MARKET_TZ in packages/dashboard-bridge/bridge/moomoo_sync.py.
const MARKET_TZ = {
  US: "America/New_York",
  HK: "Asia/Hong_Kong",
  MY: "Asia/Kuala_Lumpur",
  SG: "Asia/Singapore",
  SH: "Asia/Shanghai",
  SZ: "Asia/Shanghai",
  JP: "Asia/Tokyo",
};

const marketOf = (code) => String(code).split(".", 1)[0].toUpperCase();
const plainTicker = (t) => String(t).replace(/^[A-Za-z]{2}\./, "").toUpperCase();

/** The instant's wall-clock time in `timeZone`, read as UTC: what the old bridge stored. */
function wallClockAsUtc(instantMs, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(instantMs)).map((p) => [p.type, p.value]),
  );
  return Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
    new Date(instantMs).getUTCMilliseconds(),
  );
}

function loadDeals(path) {
  if (!path) throw new Error("--deals <export.json> is required (see the usage note)");
  const deals = JSON.parse(fs.readFileSync(path, "utf8"));
  const stale = deals.filter((d) => !/(Z|[+-]\d{2}:\d{2})$/.test(String(d.executedAt)));
  if (stale.length) {
    throw new Error(
      `${stale.length} deal(s) have no UTC offset: the export predates the fix. ` +
      "Regenerate it with the fixed backfill_deals.py.",
    );
  }
  const byId = new Map();
  const unknownMarket = deals.filter((d) => !MARKET_TZ[marketOf(d.ticker)]).length;
  for (const d of deals) {
    const zone = MARKET_TZ[marketOf(d.ticker)];
    if (!zone) continue;
    const truth = Date.parse(d.executedAt);
    byId.set(String(d.brokerFillId), { ticker: d.ticker, truth, wrong: wallClockAsUtc(truth, zone) });
  }
  return { deals, byId, unknownMarket };
}

const hoursLabel = (ms) => `${ms >= 0 ? "+" : ""}${ms / 3_600_000}h`;
const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);

async function main() {
  const { deals, byId, unknownMarket } = loadDeals(DEALS_PATH);
  const prisma = new PrismaClient();
  try {
    const owner = await prisma.user.findUnique({ where: { email: process.env.OWNER_EMAIL } });
    if (!owner) throw new Error("OWNER_EMAIL user not found");
    const accounts = (await prisma.userBrokerAccount.findMany({
      where: { userId: owner.id },
      select: { id: true, alias: true, preset: { select: { name: true } } },
    })).filter((a) => /moomoo/i.test(a.preset?.name ?? a.alias));
    const accountIds = accounts.map((a) => a.id);

    // ── TradeFill: match by deal id ──────────────────────────────────────
    const fills = await prisma.tradeFill.findMany({
      where: { brokerAccountId: { in: accountIds } },
      select: { id: true, brokerFillId: true, ticker: true, executedAt: true },
    });
    const fillShifts = [];
    const fillCounts = { alreadyCorrect: 0, mismatch: 0, noDeal: 0 };
    const shiftSizes = new Map();
    const dashboardDealIds = new Set();
    for (const f of fills) {
      const deal = f.brokerFillId ? byId.get(f.brokerFillId) : null;
      if (!deal) { fillCounts.noDeal++; continue; }
      dashboardDealIds.add(f.brokerFillId);
      const stored = f.executedAt.getTime();
      if (plainTicker(f.ticker) !== plainTicker(deal.ticker)) fillCounts.mismatch++;
      else if (stored === deal.truth) fillCounts.alreadyCorrect++;
      else if (stored === deal.wrong) {
        fillShifts.push({ id: f.id, from: f.executedAt, to: new Date(deal.truth) });
        bump(shiftSizes, hoursLabel(deal.truth - deal.wrong));
      } else fillCounts.mismatch++;
    }

    // ── Trade rows: executedAt / tradeDate copied from a fill ────────────
    const wrongToTruth = new Map();
    const truthKeys = new Set();
    for (const d of byId.values()) {
      wrongToTruth.set(`${plainTicker(d.ticker)}|${d.wrong}`, d.truth);
      truthKeys.add(`${plainTicker(d.ticker)}|${d.truth}`);
    }
    const trades = await prisma.tradeRecord.findMany({
      where: { userId: owner.id, brokerAccountId: { in: accountIds } },
      select: { id: true, ticker: true, executedAt: true, tradeDate: true },
    });
    const tradeShifts = [];
    const fieldCounts = {};
    for (const field of ["executedAt", "tradeDate"]) {
      fieldCounts[field] = { shift: 0, alreadyCorrect: 0, notFillDerived: 0, ambiguous: 0, empty: 0 };
    }
    for (const t of trades) {
      const data = {};
      const where = { id: t.id };
      for (const field of ["executedAt", "tradeDate"]) {
        const c = fieldCounts[field];
        const value = t[field];
        if (value == null) { c.empty++; continue; }
        const key = `${plainTicker(t.ticker)}|${value.getTime()}`;
        const truth = wrongToTruth.get(key);
        if (truth != null && truthKeys.has(key)) c.ambiguous++;
        else if (truth != null) {
          c.shift++;
          data[field] = new Date(truth);
          where[field] = value;
        } else if (truthKeys.has(key)) c.alreadyCorrect++;
        else c.notFillDerived++;
      }
      if (Object.keys(data).length) tradeShifts.push({ where, data });
    }

    // ── Report (counts only) ─────────────────────────────────────────────
    const byMarket = new Map();
    for (const d of deals) bump(byMarket, marketOf(d.ticker));
    console.log(`moomoo timestamp correction - ${APPLY ? "APPLY" : "DRY RUN (no writes)"}`);
    console.log(`deals in export: ${deals.length} (${[...byMarket].map(([m, n]) => `${m} ${n}`).join(", ")}); unknown market: ${unknownMarket}`);
    console.log(`owner moomoo accounts: ${accounts.length}`);
    console.log(`TradeFill rows: ${fills.length}`);
    console.log(`  shift to true UTC:         ${fillShifts.length} (${[...shiftSizes].map(([h, n]) => `${h} ${n}`).join(", ") || "none"})`);
    console.log(`  already correct:           ${fillCounts.alreadyCorrect}`);
    console.log(`  mismatch, left alone:      ${fillCounts.mismatch}`);
    console.log(`  no deal in export, left alone: ${fillCounts.noDeal}`);
    console.log(`Trade rows on those accounts: ${trades.length}`);
    for (const [field, c] of Object.entries(fieldCounts)) {
      console.log(
        `  ${field}: shift ${c.shift}, already correct ${c.alreadyCorrect}, ` +
        `not fill-derived ${c.notFillDerived}, ambiguous ${c.ambiguous}, empty ${c.empty}`,
      );
    }
    console.log(`deals not in the dashboard (bridge gap, not touched): ${byId.size - dashboardDealIds.size}`);

    if (!APPLY) return;
    if (!fillShifts.length && !tradeShifts.length) {
      console.log("nothing to write");
      return;
    }
    await prisma.$transaction(async (tx) => {
      for (const s of fillShifts) {
        const r = await tx.tradeFill.updateMany({ where: { id: s.id, executedAt: s.from }, data: { executedAt: s.to } });
        if (r.count !== 1) throw new Error("a fill changed during the run; rolled back, nothing written");
      }
      for (const s of tradeShifts) {
        const r = await tx.tradeRecord.updateMany({ where: s.where, data: s.data });
        if (r.count !== 1) throw new Error("a trade row changed during the run; rolled back, nothing written");
      }
    }, { maxWait: 20_000, timeout: 300_000 });
    console.log(`written: ${fillShifts.length} fill(s), ${tradeShifts.length} trade row(s). Re-run without --apply: expect shift 0.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
