/**
 * /api/a-list/bars-ingest — authoritative daily-bar push from the local OpenD /
 * IBKR bridge (P2).
 *
 *  GET  → { tickers }: the plain tickers of every ACTIVE tracked candidate, so
 *         the bridge knows what to pull from OpenD.
 *  POST → { source, bars: { TICKER: [{date,open,high,low,close,volume}] } }:
 *         upserts BrokerDailyBar rows. The track-positions cron prefers these
 *         over Yahoo/Stooq when fresh, so MFE/MAE/stops use the broker's price
 *         basis.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>` or `?key=<BRIEF_INGEST_KEY>`.
 */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  if (req.headers.get("authorization") === `Bearer ${expected}`) return true;
  return new URL(req.url).searchParams.get("key") === expected;
}

/** Strip only a known market prefix ("US.GFS" → "GFS"). Class-share dots are
 *  part of the ticker ("BH.A") — slicing at the last dot mangled them to "A". */
function plain(t: string): string {
  return t.replace(/^(US|HK|SH|SZ|CN|SG)\./i, "").toUpperCase();
}

const dec = (v: unknown): Prisma.Decimal | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? new Prisma.Decimal(Number(n.toFixed(4))) : null;
};
const bigint = (v: unknown): bigint | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? BigInt(Math.round(n)) : null;
};

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 35);
  const cands = await prisma.aListCandidate.findMany({
    where: { status: "ACTIVE", pickDate: { gte: since } },
    select: { ticker: true },
  });
  const tickers = Array.from(new Set(cands.map((c) => plain(c.ticker)))).sort();
  return NextResponse.json({ tickers, count: tickers.length });
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: { source?: string; bars?: Record<string, Array<Record<string, unknown>>> };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source : "opend";
  const barsByTicker = body.bars ?? {};

  let upserted = 0;
  const tickers: string[] = [];
  for (const [rawTicker, bars] of Object.entries(barsByTicker)) {
    if (!Array.isArray(bars)) continue;
    const ticker = plain(rawTicker);
    const rows = bars
      .map((b) => {
        const dateStr = typeof b.date === "string" ? b.date.slice(0, 10) : null;
        if (!dateStr) return null;
        const date = new Date(`${dateStr}T00:00:00.000Z`);
        if (Number.isNaN(date.getTime())) return null;
        return { ticker, date, open: dec(b.open), high: dec(b.high), low: dec(b.low), close: dec(b.close), volume: bigint(b.volume), source };
      })
      .filter((r): r is NonNullable<typeof r> => r != null);
    if (!rows.length) continue;
    // Bulk replace (delete + createMany) — far faster than per-row upsert, which
    // gateway-timed out at ~25 tickers x 80 bars. Bars are daily/immutable, so a
    // re-push just refreshes the window.
    await prisma.brokerDailyBar.deleteMany({ where: { ticker, date: { in: rows.map((r) => r.date) } } });
    await prisma.brokerDailyBar.createMany({ data: rows });
    upserted += rows.length;
    tickers.push(ticker);
  }
  return NextResponse.json({ ok: true, upserted, tickers: tickers.length });
}
