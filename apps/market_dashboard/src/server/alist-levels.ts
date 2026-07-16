/**
 * alist-levels.ts — deterministic auto-levels for REC candidates that arrive
 * without entry/stop (screener-score-only picks). Without a stop there is no
 * 1R, no MFE-R/MAE-R, and no outcome — the row is untrackable.
 *
 * Levels follow the wiki convention: entry = a REAL pivot (a prior-consolidation
 * high the stock must break through), stop = entry − 1.5×ATR(14) clamped by the
 * wiki risk ceiling, target = structural. This is market data, not estimation —
 * rows are tagged AUTO-LEVELS so the UI can distinguish them from operator/brief
 * levels. On any fetch failure levels stay null (fail-closed; UI shows NEEDS-LEVELS).
 *
 * 2026-07-16 (VCTR false-GO, operator-found): entry was previously
 * `Math.max(prevHigh, lastClose)` and the result was LABELLED a "pivot". On any
 * vertical day lastClose > prevHigh, so "pivot" was simply today's close — there
 * was no structure behind it, and the breakout trigger degenerated into "closed
 * higher two days running". A pivot must now be a real prior-consolidation high;
 * when none exists we fail closed with NEEDS-PIVOT rather than invent one.
 */
import yahooFinance from "yahoo-finance2";
import { computeAtr, type OhlcBar } from "@/lib/technical";
import { RISK_CEILING_ATR_MULT } from "@/server/alist-metrics";

export interface AutoLevels {
  entryZone: number;
  stop: number;
  target: number;
  rrr: number;
  atr: number;
  /** True when entryZone is a real prior-consolidation high (not the last close). */
  pivotFound: boolean;
  /** Diagnostic for the UI / logs when levels are refused or degraded. */
  note?: string;
}

const ATR_MULT = 1.5;
/** Bars to search back for a pivot (prior-consolidation high). */
const PIVOT_LOOKBACK = 40;
/** Ignore the most recent N bars — a pivot must PRE-date the current thrust. */
const PIVOT_EXCLUDE_RECENT = 2;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Find a real pivot: the highest high of the consolidation that PRE-dates the
 * current move, excluding the last `PIVOT_EXCLUDE_RECENT` bars so that today's
 * own thrust can never define the level it is supposed to break.
 *
 * Returns null when the stock is already above every prior high in the lookback
 * (i.e. it is in open air — there is nothing to break out of).
 */
export function findPivot(bars: OhlcBar[]): number | null {
  if (bars.length < PIVOT_EXCLUDE_RECENT + 5) return null;
  const window = bars.slice(-PIVOT_LOOKBACK, -PIVOT_EXCLUDE_RECENT);
  if (window.length < 5) return null;
  const pivot = Math.max(...window.map((b) => b.high));
  return Number.isFinite(pivot) && pivot > 0 ? pivot : null;
}

export function levelsFromBars(bars: OhlcBar[], entryHint?: number | null): AutoLevels | null {
  const atr = computeAtr(bars, 14);
  if (atr == null || bars.length < 2) return null;

  const pivot = findPivot(bars);
  const lastClose = bars[bars.length - 1].close;
  // An operator/brief hint always wins. Otherwise the entry MUST be a real pivot.
  const entry = entryHint ?? pivot;
  if (entry == null || !Number.isFinite(entry) || entry <= 0) return null;
  const pivotFound = entryHint != null || pivot != null;

  // Stop: ATR-based, then clamped by the wiki ceiling (they coincide at 1.5x, but
  // the clamp is explicit so a future ATR_MULT change cannot breach the ceiling).
  const rawStop = entry - ATR_MULT * atr;
  const ceiling = entry - RISK_CEILING_ATR_MULT * atr;
  const stop = Math.max(rawStop, ceiling);
  if (stop <= 0 || stop >= entry) return null;

  // Target is STRUCTURAL, not a hardcoded 2R. Previously `entry + 2*(entry-stop)`
  // with TARGET_R=2 made "R:R >= 2" a tautology that could never fail — a wider
  // stop just minted a more absurd target. Now: measure to the real overhead
  // level (the prior swing high / 52w-window high above entry) and let R:R be an
  // OUTCOME of structure. If there is no overhead level, fall back to the ATR
  // projection but report the honest rrr.
  const highs = bars.slice(-PIVOT_LOOKBACK).map((b) => b.high);
  const overhead = Math.max(...highs);
  const risk = entry - stop;
  const target = overhead > entry * 1.02 ? overhead : entry + 2 * risk;
  const rrr = risk > 0 ? (target - entry) / risk : 0;

  return {
    entryZone: round2(entry),
    stop: round2(stop),
    target: round2(target),
    rrr: Math.round(rrr * 100) / 100,
    atr: round2(atr),
    pivotFound,
    note: pivotFound
      ? undefined
      : `NEEDS-PIVOT: no prior-consolidation high in the last ${PIVOT_LOOKBACK} bars — price is in open air above all recent structure (last close ${round2(lastClose)}). The last close is not a pivot.`,
  };
}

/** Fetch ~3 months of daily bars and compute levels. Null on any failure. */
export async function computeAutoLevels(
  ticker: string,
  entryHint?: number | null,
): Promise<AutoLevels | null> {
  try {
    const period1 = new Date(Date.now() - 90 * 86400e3);
    // yahoo-finance2 typing is loose; same cast as cron/rescore-day14.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yf = yahooFinance as any;
    const rows: Array<{ high?: number | null; low?: number | null; close?: number | null }> =
      (await yf.historical(ticker, { period1, period2: new Date(), interval: "1d" })) ?? [];
    const bars: OhlcBar[] = rows
      .filter((q) => q.high != null && q.low != null && q.close != null)
      .map((q) => ({ high: q.high!, low: q.low!, close: q.close! }));
    return levelsFromBars(bars, entryHint);
  } catch (e) {
    console.warn(`[alist-levels] ${ticker} auto-levels failed (left null):`, e);
    return null;
  }
}
