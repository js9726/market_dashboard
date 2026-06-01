/**
 * GET /api/cron/track-positions — daily post-close path + savings tracker.
 *
 * For each ACTIVE tracked candidate (HELD, or REC with an entry) inside the
 * 14-session window, fetch daily OHLC, compute EMA8/EMA21/ATR14, append a
 * PositionDailyTrack row per session, and derive:
 *   - both 1R bases (logged stop + wiki ATR-floor stop)
 *   - per-session flags (close<8EMA, close<21EMA, hard-stop breach)
 *   - the two savings metrics (Realized-vs-full-R, Soft-tranche-vs-Hard)
 *   - day-14 MFE/MAE (R) + outcome + status
 *
 * Idempotent (upserts by (candidateId, sessionDate)). Safe to re-run.
 *
 * Auth: Vercel cron Bearer <CRON_SECRET>, ?secret=<BRIEF_INGEST_KEY>, or any
 * x-vercel-cron-signature.
 */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getOwnerUserId } from "@/server/a-list-extractor";
import { emaSeries, atrSeries, lowestLow, type Candle } from "@/server/indicators";
import { atrFloorStop, rUnit, realizedVsFullR, softVsHard } from "@/server/alist-metrics";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const WINDOW = 14; // trading sessions tracked after entry
const YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const ingestKey = process.env.BRIEF_INGEST_KEY;
  const authHeader = req.headers.get("authorization") ?? "";
  const urlSecret = new URL(req.url).searchParams.get("secret");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (ingestKey && urlSecret === ingestKey) return true;
  if (req.headers.get("x-vercel-cron-signature")) return true;
  return false;
}

async function fetchDailyCandles(yahooSymbol: string): Promise<Candle[]> {
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(yahooSymbol)}?interval=1d&range=3mo`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardBot/1.0)" },
  });
  if (!res.ok) throw new Error(`Yahoo chart ${yahooSymbol} HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[] }> };
      }>;
      error?: unknown;
    };
  };
  const r = json.chart?.result?.[0];
  const ts = r?.timestamp;
  const q = r?.indicators?.quote?.[0];
  if (!ts || !q) return [];
  const out: Candle[] = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c });
  }
  return out;
}

function dec(v: number | null | undefined): Prisma.Decimal | null {
  return v == null || !Number.isFinite(v) ? null : new Prisma.Decimal(Number(v.toFixed(4)));
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getOwnerUserId();
  if (!userId) {
    return NextResponse.json({ error: "No owner-role user found" }, { status: 503 });
  }

  // Candidates still in their tracking window: ACTIVE, with an entry reference,
  // picked within the last ~30 calendar days (covers 14 trading sessions).
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 35);
  const candidates = await prisma.aListCandidate.findMany({
    where: { userId, status: "ACTIVE", pickDate: { gte: since } },
    orderBy: { pickDate: "asc" },
  });

  let processed = 0;
  const errors: string[] = [];

  for (const cand of candidates) {
    try {
      const entry = cand.entryAvgCost?.toNumber() ?? cand.entryZone?.toNumber() ?? cand.day0Price?.toNumber() ?? null;
      if (entry == null || entry <= 0) continue;

      const entryRef = cand.entryFillAt ?? cand.pickDate;
      const entryDateStr = new Date(entryRef).toISOString().slice(0, 10);
      const qty = cand.heldQty?.toNumber() ?? 1;
      const loggedStop = cand.stop?.toNumber() ?? null;
      const target = cand.target?.toNumber() ?? null;

      const candles = await fetchDailyCandles(cand.ticker);
      if (candles.length === 0) continue;

      const closes = candles.map((c) => c.close);
      const ema8 = emaSeries(closes, 8);
      const ema21 = emaSeries(closes, 21);
      const atr14 = atrSeries(candles, 14);

      const entryIdx = candles.findIndex((c) => c.date >= entryDateStr);
      if (entryIdx < 0) continue;

      // ── 1R bases (both) ──────────────────────────────────────────────────
      const atrAtEntry = atr14[entryIdx];
      const fiveDayLow = lowestLow(candles, entryIdx, 5);
      const aStop = atrFloorStop({ entry, atr14: atrAtEntry, fiveDayLow, setup: cand.setupClassification });
      const rLogged = rUnit(entry, loggedStop);
      const rAtr = rUnit(entry, aStop);
      const rBase = rLogged ?? rAtr; // prefer the logged stop for R-denominated stats

      // ── Walk the window, append daily tracks, collect signals ────────────
      let maxClose = -Infinity;
      let minClose = Infinity;
      let exit8: number | null = null;
      let exit21: number | null = null;
      let hardHitLoggedAt: string | null = null;
      let hardHitAtrAt: string | null = null;
      let hitTarget = false;
      const lastIdx = Math.min(entryIdx + WINDOW, candles.length - 1);

      for (let i = entryIdx; i <= lastIdx; i++) {
        const c = candles[i];
        const e8 = ema8[i];
        const e21 = ema21[i];
        const closeBelow8 = e8 != null && c.close < e8;
        const closeBelow21 = e21 != null && c.close < e21;
        const hardLogged = loggedStop != null && c.low <= loggedStop;
        const hardAtr = aStop != null && c.low <= aStop;

        if (closeBelow8 && exit8 == null) exit8 = c.close;
        if (closeBelow21 && exit21 == null) exit21 = c.close;
        if (hardLogged && hardHitLoggedAt == null) hardHitLoggedAt = c.date;
        if (hardAtr && hardHitAtrAt == null) hardHitAtrAt = c.date;
        if (target != null && c.high >= target) hitTarget = true;
        maxClose = Math.max(maxClose, c.close);
        minClose = Math.min(minClose, c.close);

        const runMfeR = rBase ? (maxClose - entry) / rBase : null;
        const runMaeR = rBase ? (minClose - entry) / rBase : null;

        await prisma.positionDailyTrack.upsert({
          where: { candidateId_sessionDate: { candidateId: cand.id, sessionDate: new Date(`${c.date}T00:00:00.000Z`) } },
          create: {
            candidateId: cand.id,
            dayIndex: i - entryIdx,
            sessionDate: new Date(`${c.date}T00:00:00.000Z`),
            open: dec(c.open), high: dec(c.high), low: dec(c.low), close: dec(c.close),
            ema8: dec(e8), ema21: dec(e21), atr14: dec(atr14[i]),
            closeBelow8ema: closeBelow8, closeBelow21ema: closeBelow21,
            hardStopHitLogged: hardLogged, hardStopHitAtr: hardAtr,
            runMfeR: dec(runMfeR), runMaeR: dec(runMaeR),
          },
          update: {
            dayIndex: i - entryIdx,
            open: dec(c.open), high: dec(c.high), low: dec(c.low), close: dec(c.close),
            ema8: dec(e8), ema21: dec(e21), atr14: dec(atr14[i]),
            closeBelow8ema: closeBelow8, closeBelow21ema: closeBelow21,
            hardStopHitLogged: hardLogged, hardStopHitAtr: hardAtr,
            runMfeR: dec(runMfeR), runMaeR: dec(runMaeR),
          },
        });
      }

      // ── Savings metrics (provisional until the position closes) ──────────
      const markClose = candles[lastIdx].close;
      const realizedPnlUsd = (markClose - entry) * qty;
      const real = rBase ? realizedVsFullR({ qty, rUnitPerShare: rBase, realizedPnlUsd }) : null;
      const soft = rBase ? softVsHard({ entry, qty, rUnitPerShare: rBase, exit8emaClose: exit8, exit21emaClose: exit21 }) : null;

      const hardHitAt = hardHitLoggedAt ?? hardHitAtrAt;
      const hardBasis = hardHitLoggedAt && hardHitAtrAt ? "BOTH" : hardHitLoggedAt ? "LOGGED" : hardHitAtrAt ? "ATR" : null;

      const windowComplete = lastIdx >= entryIdx + WINDOW || lastIdx === candles.length - 1;
      let outcome: string | null = null;
      let status = cand.status;
      if (hitTarget) {
        outcome = "HIT_TARGET";
        status = "HIT_TARGET";
      } else if (hardHitAt) {
        outcome = "STOPPED_OUT";
        status = "STOPPED_OUT";
      } else if (windowComplete) {
        outcome = markClose >= entry ? "DRIFT" : "FADE";
      }

      const mfeR = rBase ? (maxClose - entry) / rBase : null;
      const maeR = rBase ? (minClose - entry) / rBase : null;

      await prisma.aListCandidate.update({
        where: { id: cand.id },
        data: {
          rUnitLogged: dec(rLogged),
          rUnitAtr: dec(rAtr),
          atrFloorStop: dec(aStop),
          realizedRLogged: real ? dec(real.realizedR) : null,
          saveRealizedUsd: real ? dec(real.saveUsd) : null,
          saveRealizedR: real ? dec(real.saveR) : null,
          soft8emaExit: dec(exit8),
          soft21emaExit: dec(exit21),
          saveSoftVsHardUsd: soft ? dec(soft.saveUsd) : null,
          saveSoftVsHardR: soft ? dec(soft.saveR) : null,
          hardStopHitAt: hardHitAt ? new Date(`${hardHitAt}T00:00:00.000Z`) : null,
          hardStopHitBasis: hardBasis,
          day14Mfe: dec(maxClose),
          day14Mae: dec(minClose),
          day14MfeR: dec(mfeR),
          day14MaeR: dec(maeR),
          day14Outcome: outcome,
          day14ComputedAt: windowComplete ? new Date() : cand.day14ComputedAt,
          status,
        },
      });
      processed++;
    } catch (e) {
      errors.push(`${cand.ticker}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    processed,
    errors: errors.length ? errors.slice(0, 10) : undefined,
  });
}
