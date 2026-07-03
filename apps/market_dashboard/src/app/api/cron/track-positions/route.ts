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
 * Resilience (2026-06): the previous version processed every ACTIVE candidate
 * SEQUENTIALLY with a single Yahoo fetch each — at ~88 candidates that blew the
 * 60s serverless budget (FUNCTION_INVOCATION_TIMEOUT) and wrote ZERO rows, so
 * MFE/MAE never populated. Now it (a) runs candidates in bounded parallel
 * batches, (b) puts a hard per-request timeout on each price fetch, and
 * (c) falls back Yahoo -> Stooq so one rate-limited feed can't stall the run.
 * A future local OpenD/IBKR bridge push supersedes these cloud feeds.
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
import { reconcileClosedHeld } from "@/server/alist-close";
import { evaluateTrigger, preScreenStructure } from "@/lib/alist-triggers";
import { simulateTranches } from "@/lib/alist-tranche-sim";
import { runConvictionAnalysis, type ConvictionInput } from "@/server/conviction-analysis";
import { marketContextNow } from "@/lib/market-context";

// Cap LLM Conviction analyses per cron run so a day with many triggers can't
// blow the function budget; the rest get picked up next run.
const MAX_ANALYSES_PER_RUN = 5;
// How many candidates to price-fetch concurrently. Keeps the whole run inside
// the function budget while bounding parallel pressure on the price feeds.
const FETCH_CONCURRENCY = 8;
// Hard ceiling per price fetch so a single hung request can't eat the budget.
const FETCH_TIMEOUT_MS = 9000;

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

async function fetchYahooCandles(yahooSymbol: string): Promise<Candle[]> {
  const url = `${YAHOO_CHART_URL}/${encodeURIComponent(yahooSymbol)}?interval=1d&range=3mo`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardBot/1.0)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Yahoo chart ${yahooSymbol} HTTP ${res.status}`);
  const json = (await res.json()) as {
    chart?: {
      result?: Array<{
        timestamp?: number[];
        indicators?: { quote?: Array<{ open?: (number | null)[]; high?: (number | null)[]; low?: (number | null)[]; close?: (number | null)[]; volume?: (number | null)[] }> };
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
    out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: q.volume?.[i] ?? null });
  }
  return out;
}

/** Stooq daily CSV fallback (keyless, separate infra from Yahoo — the two rarely
 *  rate-limit at the same time). Format: Date,Open,High,Low,Close,Volume. */
async function fetchStooqCandles(symbol: string): Promise<Candle[]> {
  const stooqSymbol = `${symbol.toLowerCase()}.us`;
  const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(stooqSymbol)}&i=d`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; MarketDashboardBot/1.0)" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Stooq ${symbol} HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2 || !/^date,/i.test(lines[0])) return [];
  const out: Candle[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;
    const [date, o, h, l, c, v] = cols;
    const O = parseFloat(o), H = parseFloat(h), L = parseFloat(l), C = parseFloat(c);
    if (![O, H, L, C].every(Number.isFinite)) continue;
    const vol = v != null && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null;
    out.push({ date, open: O, high: H, low: L, close: C, volume: vol });
  }
  return out.slice(-90); // match Yahoo's ~3mo window
}

/** Authoritative OpenD/IBKR bars pushed by the local bridge (P2). Preferred over
 *  the cloud feeds when fresh (latest bar within ~4 days) and deep enough for the
 *  EMA/ATR windows — so MFE/MAE use the broker's own price basis. */
async function fetchBrokerBars(symbol: string): Promise<Candle[]> {
  const ticker = symbol.includes(".") ? symbol.slice(symbol.lastIndexOf(".") + 1).toUpperCase() : symbol.toUpperCase();
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 120);
  const rows = await prisma.brokerDailyBar.findMany({
    where: { ticker, date: { gte: since } },
    orderBy: { date: "asc" },
  });
  if (rows.length < 20) return [];
  const latest = rows[rows.length - 1].date;
  if (Date.now() - latest.getTime() > 4 * 86_400_000) return []; // stale → use cloud
  return rows
    .map((r) => ({
      date: r.date.toISOString().slice(0, 10),
      open: r.open?.toNumber() ?? 0,
      high: r.high?.toNumber() ?? 0,
      low: r.low?.toNumber() ?? 0,
      close: r.close?.toNumber() ?? 0,
      volume: r.volume != null ? Number(r.volume) : null,
    }))
    .filter((c) => c.close > 0);
}

/** Resilient daily candles: broker bridge (OpenD/IBKR) first, then Yahoo, then
 *  Stooq. Returns [] only when every source is unavailable for this symbol. */
async function fetchDailyCandles(symbol: string): Promise<Candle[]> {
  try {
    const b = await fetchBrokerBars(symbol);
    if (b.length) return b;
  } catch {
    /* fall through to cloud feeds */
  }
  try {
    const y = await fetchYahooCandles(symbol);
    if (y.length) return y;
  } catch {
    /* fall through to Stooq */
  }
  try {
    const s = await fetchStooqCandles(symbol);
    if (s.length) return s;
  } catch {
    /* no source available */
  }
  return [];
}

/** Relative volume per bar vs the trailing 50-day average volume. */
function rvolSeries(candles: Candle[]): (number | null)[] {
  return candles.map((_, i) => {
    const start = Math.max(0, i - 50);
    const window = candles.slice(start, i).filter((b) => b.volume != null && b.volume > 0);
    if (window.length < 10) return null;
    const avg = window.reduce((a, b) => a + (b.volume ?? 0), 0) / window.length;
    const v = candles[i].volume;
    return avg > 0 && v != null ? v / avg : null;
  });
}

function dec(v: number | null | undefined): Prisma.Decimal | null {
  return v == null || !Number.isFinite(v) ? null : new Prisma.Decimal(Number(v.toFixed(4)));
}

type CandidateRow = Awaited<ReturnType<typeof prisma.aListCandidate.findMany>>[number];
interface CandResult {
  ticker: string;
  processed: boolean;
  error?: string;
  triggered?: { candId: string; input: ConvictionInput };
}

/** Process one candidate: fetch the path, append daily tracks, derive savings +
 *  day-14 MFE/MAE/outcome, and (REC only) advance the entry trigger. Pure of
 *  shared state so candidates can run concurrently. */
async function processCandidate(cand: CandidateRow): Promise<CandResult> {
  try {
    const entry = cand.entryAvgCost?.toNumber() ?? cand.entryZone?.toNumber() ?? cand.day0Price?.toNumber() ?? null;
    if (entry == null || entry <= 0) return { ticker: cand.ticker, processed: false };

    const entryRef = cand.entryFillAt ?? cand.pickDate;
    const entryDateStr = new Date(entryRef).toISOString().slice(0, 10);
    const qty = cand.heldQty?.toNumber() ?? 1;
    const loggedStop = cand.stop?.toNumber() ?? null;
    const target = cand.target?.toNumber() ?? null;

    let triggerUpdate: { triggerState?: string; triggerStateAt?: Date | null; triggerReason?: string } = {};
    let triggered: CandResult["triggered"];
    let statusOverride: string | null = null;
    let trancheSimJson: Prisma.InputJsonValue | null = null;
    let day0RvolFix: number | null = null;

    const candles = await fetchDailyCandles(cand.ticker);
    if (candles.length === 0) return { ticker: cand.ticker, processed: false, error: "no price feed (Yahoo + Stooq both unavailable)" };

    const closes = candles.map((c) => c.close);
    const ema8 = emaSeries(closes, 8);
    const ema21 = emaSeries(closes, 21);
    const atr14 = atrSeries(candles, 14);
    const rvol = rvolSeries(candles);

    const entryIdx = candles.findIndex((c) => c.date >= entryDateStr);
    if (entryIdx < 0) return { ticker: cand.ticker, processed: false };

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

      const vol = c.volume != null && Number.isFinite(c.volume) ? BigInt(Math.round(c.volume)) : null;
      const trackData = {
        dayIndex: i - entryIdx,
        open: dec(c.open), high: dec(c.high), low: dec(c.low), close: dec(c.close),
        volume: vol, rvol: dec(rvol[i]),
        ema8: dec(e8), ema21: dec(e21), atr14: dec(atr14[i]),
        closeBelow8ema: closeBelow8, closeBelow21ema: closeBelow21,
        hardStopHitLogged: hardLogged, hardStopHitAtr: hardAtr,
        runMfeR: dec(runMfeR), runMaeR: dec(runMaeR),
      };
      await prisma.positionDailyTrack.upsert({
        where: { candidateId_sessionDate: { candidateId: cand.id, sessionDate: new Date(`${c.date}T00:00:00.000Z`) } },
        create: { candidateId: cand.id, sessionDate: new Date(`${c.date}T00:00:00.000Z`), ...trackData },
        update: trackData,
      });
    }

    // ── Entry-trigger lifecycle (REC picks only — HELD is already entered) ──
    if (!cand.isHeld) {
      // Day-0 RVOL re-stamp: screener ingest captures a pre-market RVOL (0.0-0.2x
      // junk). Once the pick day's full candle exists, stamp the close RVOL so
      // the board shows a real number and the scorer sees real volume.
      const d0Rvol = rvol[entryIdx];
      const storedRvol = cand.day0Rvol?.toNumber() ?? null;
      if (d0Rvol != null && (storedRvol == null || storedRvol < 0.5) && candles[entryIdx].date <= new Date(Date.now() - 12 * 3600_000).toISOString().slice(0, 10)) {
        day0RvolFix = d0Rvol;
      }

      const triggerPath = candles.slice(entryIdx, lastIdx + 1).map((c, k) => ({
        date: c.date, open: c.open, high: c.high, low: c.low, close: c.close,
        ema8: ema8[entryIdx + k], ema21: ema21[entryIdx + k], rvol: rvol[entryIdx + k],
      }));
      const prev = cand.triggerState;

      // Wiki pre-screen (entry-methods 2026-07-02): a wide-and-loose or
      // distribution-heavy daily structure is auto-PASS — no trigger applies.
      // Only gate picks that haven't already fired.
      let trig = null as ReturnType<typeof evaluateTrigger> | null;
      if (prev == null || prev === "ARMED") {
        const historyBars = candles.slice(Math.max(0, entryIdx - 21), entryIdx + 1).map((c, k, arr) => {
          const idx = entryIdx - (arr.length - 1) + k;
          return { date: c.date, open: c.open, high: c.high, low: c.low, close: c.close, ema8: ema8[idx], ema21: ema21[idx], rvol: rvol[idx] };
        });
        const screen = preScreenStructure(historyBars);
        if (!screen.pass) {
          trig = { state: "INVALIDATED", dayIndex: null, date: candles[lastIdx].date, reason: screen.reason };
        }
      }
      trig = trig ?? evaluateTrigger(cand.setupClassification, triggerPath, cand.entryZone?.toNumber() ?? null);

      // Only advance / record changes — never regress a fired trigger to ARMED.
      const terminalNow = trig.state === "TRIGGERED" || trig.state === "INVALIDATED";
      const prevTerminal = prev === "TRIGGERED" || prev === "INVALIDATED";
      if (!prevTerminal || terminalNow) {
        triggerUpdate = {
          triggerState: trig.state,
          triggerStateAt: trig.date ? new Date(`${trig.date}T00:00:00.000Z`) : (prev !== trig.state ? new Date() : cand.triggerStateAt),
          triggerReason: trig.reason,
        };
      }

      // Declutter: a REC whose trigger died (window expired or thesis broken)
      // is no longer an entry candidate — retire the row so the Active board
      // only shows actionable picks. (HELD rows are never status-flipped here.)
      const effState = triggerUpdate.triggerState ?? prev;
      if ((effState === "EXPIRED" || effState === "INVALIDATED") && cand.status === "ACTIVE" && !hitTarget && !hardHitLoggedAt && !hardHitAtrAt) {
        statusOverride = "EXPIRED";
      }

      // ── 3-lot scale-out simulation from the trigger day (recomputed each run
      //    until done) — "would the trigger have paid before the stop?" ──────
      const trigDate = (triggerUpdate.triggerStateAt ?? cand.triggerStateAt)?.toISOString().slice(0, 10) ?? trig.date;
      if ((effState === "TRIGGERED") && trigDate) {
        const trigIdx = candles.findIndex((c) => c.date >= trigDate);
        if (trigIdx >= 0) {
          const sim = simulateTranches(candles.slice(trigIdx), atr14[trigIdx] ?? atrAtEntry);
          if (sim) trancheSimJson = sim as unknown as Prisma.InputJsonValue;
        }
      }

      // Queue the LLM Conviction verdict for TRIGGERED picks that don't have one
      // yet — includes the backlog (earlier flips cut off by the per-run cap),
      // which drains MAX_ANALYSES_PER_RUN per day.
      if (effState === "TRIGGERED" && cand.agentConvictionAt == null) {
        triggered = {
          candId: cand.id,
          input: {
            ticker: cand.ticker,
            setup: cand.setupClassification,
            sector: cand.sector,
            triggerState: effState,
            triggerReason: triggerUpdate.triggerReason ?? cand.triggerReason ?? trig.reason,
            entryZone: cand.entryZone?.toNumber() ?? null,
            stop: cand.stop?.toNumber() ?? aStop ?? null,
            target: cand.target?.toNumber() ?? null,
            rvol: day0RvolFix ?? cand.day0Rvol?.toNumber() ?? rvol[lastIdx] ?? null,
            rsRating: null,
            day0Thesis: cand.day0Thesis,
            algo: { setup: cand.setupScore, entry: cand.entryScore, theme: cand.themeScore, sentiment: cand.sentimentScore },
            recentPath: triggerPath.slice(-6).map((b) => ({ date: b.date, close: b.close, ema8: b.ema8, ema21: b.ema21, rvol: b.rvol })),
          },
        };
      }
    }

    // ── Savings metrics (provisional until the position closes) ──────────
    const markClose = candles[lastIdx].close;
    const realizedPnlUsd = (markClose - entry) * qty;
    const real = rBase ? realizedVsFullR({ qty, rUnitPerShare: rBase, realizedPnlUsd }) : null;
    const soft = rBase ? softVsHard({ entry, qty, rUnitPerShare: rBase, exit8emaClose: exit8, exit21emaClose: exit21 }) : null;

    const hardHitAt = hardHitLoggedAt ?? hardHitAtrAt;
    const hardBasis = hardHitLoggedAt && hardHitAtrAt ? "BOTH" : hardHitLoggedAt ? "LOGGED" : hardHitAtrAt ? "ATR" : null;

    // Truly complete only after 14 full sessions have elapsed since entry —
    // NOT merely because we've reached the latest candle (that happens every
    // day for an in-progress position, which would prematurely stamp a day-14
    // outcome like DRIFT on a position still being held).
    const windowComplete = lastIdx >= entryIdx + WINDOW;
    let outcome: string | null = null;
    let status = cand.status;
    if (cand.isHeld) {
      // HELD: the broker is the source of truth for open/closed — reconcileClosedHeld
      // flips it once the position is gone. The price path must NOT retire a
      // position you may still be holding; it only stamps a rule-based outcome
      // label after the window completes. The hard-stop *breach* is still captured
      // via hardStopHitAt/Basis above as a learning flag, not a terminal status.
      if (windowComplete) outcome = markClose >= entry ? "DRIFT" : "FADE";
    } else if (hitTarget) {
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

    // Exit-day market backdrop for a REC pick that just resolved (P4). HELD exits
    // are captured by reconcileClosedHeld instead (broker-truth).
    const captureExit = !cand.isHeld && (outcome === "HIT_TARGET" || outcome === "STOPPED_OUT") && cand.exitMarket == null;
    const exitMkt = captureExit ? await marketContextNow() : null;

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
        // Terminal outcomes (target/stop) win; otherwise a dead trigger retires the REC.
        status: status !== "ACTIVE" ? status : (statusOverride ?? status),
        ...(exitMkt ? { exitMarket: exitMkt as unknown as Prisma.InputJsonValue } : {}),
        ...(trancheSimJson ? { trancheSim: trancheSimJson } : {}),
        ...(day0RvolFix != null ? { day0Rvol: dec(day0RvolFix) } : {}),
        ...triggerUpdate,
      },
    });
    return { ticker: cand.ticker, processed: true, triggered };
  } catch (e) {
    return { ticker: cand.ticker, processed: false, error: e instanceof Error ? e.message : String(e) };
  }
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
  // Newest first: if the run is ever cut short by the function budget, fresh
  // picks (the actionable ones) are guaranteed to have been evaluated.
  const candidates = await prisma.aListCandidate.findMany({
    where: { userId, status: "ACTIVE", pickDate: { gte: since } },
    orderBy: { pickDate: "desc" },
  });

  // Housekeeping: anything ACTIVE that fell out of the 35-day window can never
  // trigger or track again — retire it so the Active board stays actionable.
  const staleRetired = await prisma.aListCandidate.updateMany({
    where: { userId, status: "ACTIVE", isHeld: false, pickDate: { lt: since } },
    data: { status: "EXPIRED" },
  });

  // ── Process in bounded-parallel batches so the whole run fits the budget ──
  const results: CandResult[] = [];
  for (let i = 0; i < candidates.length; i += FETCH_CONCURRENCY) {
    const slice = candidates.slice(i, i + FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((c) => processCandidate(c)));
    for (let k = 0; k < settled.length; k++) {
      const s = settled[k];
      if (s.status === "fulfilled") results.push(s.value);
      else results.push({ ticker: slice[k].ticker, processed: false, error: String(s.reason) });
    }
  }

  const processed = results.filter((r) => r.processed).length;
  const errors = results.filter((r) => r.error).map((r) => `${r.ticker}: ${r.error}`);
  const newlyTriggered = results.flatMap((r) => (r.triggered ? [r.triggered] : []));

  // ── Multi-agent Conviction verdict on freshly-TRIGGERED picks (R4) ────────
  // Runs only on the trigger flip, bounded per run, never fails the cron.
  let analyzed = 0;
  if (process.env.LLM_DISABLED !== "1") {
    for (const item of newlyTriggered.slice(0, MAX_ANALYSES_PER_RUN)) {
      try {
        const verdict = await runConvictionAnalysis(item.input);
        if (!verdict) continue;
        await prisma.aListCandidate.update({
          where: { id: item.candId },
          data: {
            agentConviction: verdict as unknown as Prisma.InputJsonValue,
            agentVerdict: verdict.moderator,
            agentConvictionAt: new Date(),
          },
        });
        analyzed++;
      } catch (e) {
        errors.push(`analyze ${item.input.ticker}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Auto-close: held candidates whose broker position is gone (operator exited
  // / stopped out). Flips ACTIVE → STOPPED_OUT|CLOSED with realized R so manual
  // broker exits register without hand-entry. Best-effort; never fails the cron.
  let autoClosed: string[] = [];
  try {
    const rc = await reconcileClosedHeld(prisma, userId);
    autoClosed = rc.closed.map((c) => `${c.ticker}(${c.realizedR ?? "?"}R ${c.outcome})`);
  } catch (e) {
    errors.push(`reconcile: ${e instanceof Error ? e.message : String(e)}`);
  }

  return NextResponse.json({
    ok: true,
    candidates: candidates.length,
    processed,
    staleRetired: staleRetired.count,
    triggered: newlyTriggered.length,
    analyzed,
    autoClosed,
    errors: errors.length ? errors.slice(0, 10) : undefined,
  });
}
