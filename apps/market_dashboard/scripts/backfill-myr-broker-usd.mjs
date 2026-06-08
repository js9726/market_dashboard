#!/usr/bin/env node
/**
 * Backfill broker-true USD P&L onto closed MooMoo trades whose sheet P&L is in
 * MYR. The sheet records MYR (via a fixed rate); the broker (MooMoo) is the USD
 * source of truth. For each ticker we compute FIFO realized USD from the
 * account's TradeFills and, when exactly ONE closed MYR TradeRecord exists for
 * that ticker (unambiguous), set pnlUsd + pnlSource="broker" + fxRate (implied).
 *
 * Affin Hwang (Malaysian .KL) and multi-trade tickers are left untouched — the
 * UI shows their native RM until the fixed sheet rate is configured.
 *
 * Idempotent. Usage (from apps/market_dashboard/):
 *   node --env-file=.env.local scripts/backfill-myr-broker-usd.mjs --dry-run
 *   node --env-file=.env.local scripts/backfill-myr-broker-usd.mjs
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY = process.argv.includes("--dry-run");

const plainTicker = (t) => t.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

// FIFO realized (net of fees), longs + shorts — mirrors server/realized-pnl.ts.
function fifoRealized(fills) {
  const lots = [];
  let gross = 0, fees = 0, closed = 0;
  for (const f of fills) {
    let signed = (f.side.toUpperCase() === "BUY" ? 1 : -1) * Number(f.qty);
    const px = Number(f.price);
    fees += Number(f.fees || 0);
    while (Math.abs(signed) > 1e-9 && lots.length > 0 && sgn(lots[0].qty) === -sgn(signed)) {
      const lot = lots[0];
      const mt = Math.min(Math.abs(signed), Math.abs(lot.qty));
      gross += lot.qty > 0 ? (px - lot.price) * mt : (lot.price - px) * mt;
      closed += 1;
      lot.qty -= sgn(lot.qty) * mt;
      signed -= sgn(signed) * mt;
      if (Math.abs(lot.qty) < 1e-9) lots.shift();
    }
    if (Math.abs(signed) > 1e-9) lots.push({ qty: signed, price: px });
  }
  return { netUsd: Number((gross - fees).toFixed(2)), closed };
}

async function main() {
  const owner = await prisma.user.findUnique({ where: { email: process.env.OWNER_EMAIL } });
  if (!owner) throw new Error("OWNER_EMAIL user not found");
  const mm = await prisma.userBrokerAccount.findMany({
    where: { userId: owner.id, alias: { contains: "moomoo", mode: "insensitive" } },
    select: { id: true },
  });
  const fills = await prisma.tradeFill.findMany({
    where: { brokerAccountId: { in: mm.map((a) => a.id) }, currency: "USD" },
    orderBy: { executedAt: "asc" },
    select: { ticker: true, side: true, qty: true, price: true, fees: true },
  });
  const byTicker = new Map();
  for (const f of fills) {
    const k = plainTicker(f.ticker);
    if (!byTicker.has(k)) byTicker.set(k, []);
    byTicker.get(k).push(f);
  }

  let set = 0, skipMulti = 0, skipNoMatch = 0, skipNoRealized = 0;
  for (const [tk, fl] of byTicker) {
    const r = fifoRealized(fl);
    if (r.closed === 0) { skipNoRealized++; continue; }
    const recs = await prisma.tradeRecord.findMany({
      where: {
        userId: owner.id, ticker: tk, currencyCode: "MYR",
        platform: { contains: "Moo" },
        NOT: { state: { in: ["OPEN", "SEMI-OPEN", "PLANNING"] } },
      },
      select: { id: true, pnl: true },
    });
    if (recs.length === 0) { skipNoMatch++; continue; }
    if (recs.length > 1) { skipMulti++; continue; }
    const rec = recs[0];
    const sheetPnl = rec.pnl != null ? Number(rec.pnl) : null;
    const rate = sheetPnl && r.netUsd ? Math.abs(sheetPnl / r.netUsd) : null;
    if (!DRY) {
      await prisma.tradeRecord.update({
        where: { id: rec.id },
        data: { pnlUsd: r.netUsd, pnlSource: "broker", fxRate: rate ? Number(rate.toFixed(6)) : null },
      });
    }
    set++;
    if (set <= 10) console.log(`  ${tk.padEnd(6)} brokerUSD=${r.netUsd}  sheetMYR=${sheetPnl}  impliedRate=${rate ? rate.toFixed(3) : "-"}`);
  }
  console.log(`\n${DRY ? "[dry-run] would set" : "Set"} pnlUsd on ${set} MooMoo trades. Skipped: multi-trade=${skipMulti}, no-closed-MYR-match=${skipNoMatch}, no-realized=${skipNoRealized}.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
