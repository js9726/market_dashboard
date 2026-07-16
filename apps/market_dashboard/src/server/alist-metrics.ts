/**
 * alist-metrics.ts — pure functions for the HELD-lane (bought position)
 * day-0->14 savings metrics. No DB access; all inputs are explicit so the
 * post-close cron, a one-off backfill, and unit tests share one implementation.
 *
 * Locked by the 2026-05-30 conviction-redesign decisions:
 *   - TWO 1R bases: the stop you logged at entry, AND the wiki ATR-floor stop.
 *   - TWO savings metrics: Realized-vs-full-R, and Soft-tranche-vs-Hard-stop.
 *
 * Wiki sources: jie_wiki/wiki/risk-management.md
 *   - "Stop distance floor by setup type" (ATR-floor rule)
 *   - "Trimming / Scaling Out" (SRxTrades 8EMA/21EMA tranche model)
 */

export type Side = "LONG" | "SHORT";

function dir(side: Side): number {
  return side === "LONG" ? 1 : -1;
}

/**
 * Wiki ATR-floor multiplier by setup type (risk-management.md):
 *   BO-CB/BO-VCP/EP-FRESH/POST-GAP-VCP/MA-PULLBACK -> 1.5x ATR(14)
 *   PB-21EMA -> 1.2x   |   EP-SECOND/CONTINUATION -> 1.3x
 *   PARABOLIC/ORH-INTRADAY -> 0 (tight stops intentional, no floor)
 *
 * A 0 here means "no FLOOR" — it must never widen the stop. See atrFloorStop.
 */
export function atrFloorMultiplier(setup: string | null | undefined): number {
  switch ((setup ?? "").toUpperCase()) {
    case "PB-21EMA":
      return 1.2;
    case "EP-SECOND":
    case "CONTINUATION":
      return 1.3;
    case "PARABOLIC":
    case "ORH-INTRADAY":
      return 0;
    default:
      return 1.5;
  }
}

/**
 * Wiki risk CEILING (risk-management.md "Stop distance band ... FLOOR and CEILING",
 * Qullamaggie ATR/ADR guardrail): a stop may never sit further than 1.5xATR(14)
 * from entry. Wider than this and the setup has lost its asymmetry.
 */
export const RISK_CEILING_ATR_MULT = 1.5;

/** The widest permissible stop for `entry`. Null when ATR is unknown. */
export function riskCeilingStop(entry: number, atr14: number | null, side: Side = "LONG"): number | null {
  if (atr14 == null || !(atr14 > 0)) return null;
  return entry - RISK_CEILING_ATR_MULT * atr14 * dir(side);
}

/**
 * Wiki stop = FLOOR clamped by CEILING (risk-management.md, updated 2026-07-16).
 *
 * For a long: `mult x ATR(14)` below entry OR the 5-day low, whichever is WIDER
 * (further from entry) — then clamped so it is never wider than 1.5xATR.
 *
 * Two behaviours this function must NEVER exhibit again (2026-07-16 VCTR false-GO):
 *   1. Returning an unbounded stop because the 5-day low was far away. The floor
 *      protects against too-TIGHT stops; it is not a licence for unbounded risk.
 *      A structural low beyond the ceiling means "no valid stop exists" -> the
 *      admission path must PASS the candidate (see evaluateRiskGate), and the
 *      measurement path clamps to the ceiling rather than inventing 12% risk.
 *   2. Widening a `mult === 0` setup (PARABOLIC/ORH-INTRADAY) to the 5-day low.
 *      "No floor" means KEEP IT TIGHT. Previously mult 0 -> atrStop null -> the
 *      5-day low was the only candidate, so the most extended setups silently got
 *      the WIDEST stops - the exact inverse of the wiki intent.
 */
export function atrFloorStop(args: {
  entry: number;
  atr14: number | null;
  fiveDayLow: number | null;
  setup?: string | null;
  side?: Side;
}): number | null {
  const { entry, atr14, fiveDayLow, setup, side = "LONG" } = args;
  const mult = atrFloorMultiplier(setup);
  const ceiling = riskCeilingStop(entry, atr14, side);

  // mult === 0 -> tight stops are intentional: never widen to the 5-day low.
  if (mult === 0) return ceiling != null && fiveDayLow != null
    ? (side === "LONG" ? Math.max(fiveDayLow, ceiling) : Math.min(fiveDayLow, ceiling))
    : fiveDayLow ?? ceiling;

  const atrStop = atr14 != null ? entry - mult * atr14 * dir(side) : null;
  // "wider" = further from entry. For longs that's the LOWER price; shorts the higher.
  const candidates = [atrStop, fiveDayLow].filter((v): v is number => v != null);
  if (candidates.length === 0) return null;
  const floored = side === "LONG" ? Math.min(...candidates) : Math.max(...candidates);
  if (ceiling == null) return floored;
  // Clamp: never wider than the ceiling.
  return side === "LONG" ? Math.max(floored, ceiling) : Math.min(floored, ceiling);
}

export interface RiskGateResult {
  ok: boolean;
  /** Risk expressed in ATR multiples, |entry-stop| / ATR. Null when inputs missing. */
  riskAtr: number | null;
  /** Risk as a fraction of entry price (0.124 = 12.4%). Null when inputs missing. */
  riskPct: number | null;
  reason: string;
}

/**
 * HARD risk gate for the ADMISSION path (a-list-gate-and-screener.md "Hard pre-gates").
 * Fail-closed: missing ATR or stop => FAIL, never "assume it passed".
 *
 * Risk must be measured to the PATTERN stop (trigger-day LoD / wedge low / base low),
 * not a mechanical swing low - see entry-methods.md Rule 2 (HPE 2026-07-09).
 */
export function evaluateRiskGate(args: {
  entry: number;
  stop: number | null;
  atr14: number | null;
  side?: Side;
}): RiskGateResult {
  const { entry, stop, atr14, side = "LONG" } = args;
  if (!Number.isFinite(entry) || entry <= 0)
    return { ok: false, riskAtr: null, riskPct: null, reason: "RISK-GATE-FAIL: entry missing" };
  if (stop == null || !Number.isFinite(stop))
    return { ok: false, riskAtr: null, riskPct: null, reason: "RISK-GATE-FAIL: no stop (fail-closed)" };
  if (atr14 == null || !(atr14 > 0))
    return { ok: false, riskAtr: null, riskPct: null, reason: "RISK-GATE-FAIL: no ATR(14) (fail-closed)" };

  const risk = (entry - stop) * dir(side);
  if (!(risk > 0))
    return { ok: false, riskAtr: null, riskPct: null, reason: "RISK-GATE-FAIL: stop on wrong side of entry" };

  const riskAtr = risk / atr14;
  const riskPct = risk / entry;
  // Epsilon: a stop set EXACTLY at the ceiling must pass. Float error makes
  // (entry - (entry - 1.5*atr))/atr evaluate to 1.5000000000000002.
  if (riskAtr > RISK_CEILING_ATR_MULT + 1e-9)
    return {
      ok: false,
      riskAtr,
      riskPct,
      reason: `RISK-GATE-FAIL: risk ${(riskPct * 100).toFixed(1)}% = ${riskAtr.toFixed(2)}xATR exceeds the ${RISK_CEILING_ATR_MULT}xATR ceiling`,
    };
  return { ok: true, riskAtr, riskPct, reason: `risk ${(riskPct * 100).toFixed(1)}% = ${riskAtr.toFixed(2)}xATR` };
}

/** 1R per share = |entry - stop|. Null if stop missing or degenerate. */
export function rUnit(entry: number, stop: number | null): number | null {
  if (stop == null) return null;
  const r = Math.abs(entry - stop);
  return r > 0 ? r : null;
}

export interface EntryGradeInput {
  score: number | null;
  verdict: string | null; // "GO" | "WAIT" | "PASS"
  rvol: number | null;
  setup?: string | null; // setup class — RVOL is judged conditionally on it
}
export interface EntryGrade {
  grade: "A" | "B" | "C" | null; // null = off-book / ungraded (no REC at entry)
  passedBar: boolean; // cleared the A-list REC bar (GO>=75 / GO / setup-conditional RVOL)
  reasons: string[];
}

/**
 * Grade a (held) entry against the A-list REC bar (wiki/a-list-gate-and-screener.md):
 * Conviction >=75 AND verdict GO AND a setup-conditional RVOL (breakout/EP need a
 * >=1.5x surge; a pullback does not). A = cleared the bar; B = near-miss with real
 * merit; C = off-spec. An OFF-BOOK entry (no REC pick existed at your entry) is
 * NOT graded — returning a failing "C" for the mere absence of a pick mislabels a
 * good discretionary call (e.g. ONTO +1.88R) as a failure. It stays ungraded and
 * is judged by its outcome (MFE/MAE) + the "off-book" tag instead.
 */
export function gradeEntryVsBar(i: EntryGradeInput): EntryGrade {
  if (i.score == null && i.verdict == null && i.rvol == null) {
    return { grade: null, passedBar: false, reasons: ["off-book — no REC pick at entry"] };
  }
  const reasons: string[] = [];
  const scoreOk = i.score != null && i.score >= 75;
  const verdictOk = (i.verdict ?? "").toUpperCase() === "GO";
  // A pullback's volume expansion comes at the trigger, not at entry, so it is
  // not gated on the surge here (consistent with the screener/extractor gate).
  const isPullback = /(^PB|PULLBACK|MA-|POST-GAP)/.test((i.setup ?? "").toUpperCase());
  const rvolOk = isPullback || (i.rvol != null && i.rvol >= 1.5);
  if (!scoreOk) reasons.push(`score ${i.score ?? "?"} < 75`);
  if (!verdictOk) reasons.push(`verdict ${i.verdict ?? "?"} != GO`);
  if (!rvolOk) reasons.push(`rvol ${i.rvol ?? "?"} < 1.5x (breakout/EP surge)`);
  const passedBar = scoreOk && verdictOk && rvolOk;
  let grade: "A" | "B" | "C";
  if (passedBar) grade = "A";
  else if ((i.score ?? 0) >= 65 && (rvolOk || verdictOk)) grade = "B";
  else grade = "C";
  return { grade, passedBar, reasons };
}

export interface RealizedSavingsInput {
  qty: number;
  rUnitPerShare: number; // 1R per share for the chosen base (logged or ATR)
  realizedPnlUsd: number; // actual realized P&L ($), + profit / - loss
}
export interface RealizedSavings {
  fullRLossUsd: number; // $ lost riding to the full -1R hard stop
  realizedR: number; // realized P&L in R
  saveUsd: number; // full-R loss avoided + any profit (= fullRLoss + realizedPnl)
  saveR: number; // realizedR + 1
}

/** Realized-vs-full-R: how much better than a clean -1R loss you actually did. */
export function realizedVsFullR(i: RealizedSavingsInput): RealizedSavings {
  const fullRLossUsd = i.rUnitPerShare * i.qty;
  const realizedR = fullRLossUsd > 0 ? i.realizedPnlUsd / fullRLossUsd : 0;
  const saveUsd = fullRLossUsd + i.realizedPnlUsd;
  const saveR = realizedR + 1;
  return { fullRLossUsd, realizedR, saveUsd, saveR };
}

export interface SoftVsHardInput {
  entry: number;
  qty: number;
  rUnitPerShare: number;
  /** Close on the first session that closed below the 8EMA (first partial). */
  exit8emaClose: number | null;
  /** Close on the first session that closed below the 21EMA (full exit). */
  exit21emaClose: number | null;
  /** Fraction sold at the 8EMA break (SRxTrades tranche). Default 0.5. */
  trancheAt8ema?: number;
}
export interface SoftVsHard {
  softExitPnlUsd: number; // blended tranche exit P&L
  hardExitPnlUsd: number; // -1R (full hard stop)
  saveUsd: number; // soft - hard
  saveR: number;
  blendedExit: number | null; // N/A when no structural break occurred
}

/**
 * Soft-tranche-vs-Hard: value of exiting on structure (8EMA partial + 21EMA
 * full, per SRxTrades) instead of riding to the full -1R hard stop. If neither
 * MA broke (the trade never failed structurally) there is no soft exit, so the
 * comparison is N/A and saveUsd is 0.
 */
export function softVsHard(i: SoftVsHardInput): SoftVsHard {
  const hardExitPnlUsd = -i.rUnitPerShare * i.qty;
  if (i.exit8emaClose == null && i.exit21emaClose == null) {
    return { softExitPnlUsd: 0, hardExitPnlUsd, saveUsd: 0, saveR: 0, blendedExit: null };
  }
  const w8 = i.exit8emaClose != null ? (i.trancheAt8ema ?? 0.5) : 0;
  const w21 = 1 - w8;
  const p8 = i.exit8emaClose ?? i.exit21emaClose!;
  const p21 = i.exit21emaClose ?? i.exit8emaClose!;
  const blendedExit = w8 * p8 + w21 * p21;
  const softExitPnlUsd = (blendedExit - i.entry) * i.qty;
  const saveUsd = softExitPnlUsd - hardExitPnlUsd;
  const saveR = i.rUnitPerShare > 0 ? saveUsd / (i.rUnitPerShare * i.qty) : 0;
  return { softExitPnlUsd, hardExitPnlUsd, saveUsd, saveR, blendedExit };
}
