/**
 * alist-tranche-sim.ts — 3-lot scale-out simulation for TRIGGERED picks (pure).
 *
 * Answers the operator question: "if I had bought the trigger, would it have
 * paid before the stop — selling in three portions on the way up?"
 *
 * Model (wiki-doctrine, daily bars, pessimistic):
 *   - Entry  = close of the trigger day (buying the confirmed signal).
 *   - Stop   = low of the trigger day (LoD doctrine), with an ATR floor: if the
 *     LoD stop is tighter than 0.75×ATR14 the ATR-floor stop is used instead
 *     (wiki/rubric-stop-too-tight — sub-ATR stops get whipsawed by noise).
 *   - 3 equal lots exit at +1R / +2R / +3R (bar high touches the level).
 *   - After the +1R lot fills, the stop for the remaining lots rises to
 *     breakeven (follow-through doctrine: de-risk once cushioned).
 *   - Pessimistic tie-break: if a bar spans both the stop and a target, the
 *     stop is assumed to hit first.
 *   - The window runs 14 sessions past the trigger day; lots still open at the
 *     end are marked at the final close (shown as unrealized).
 */

export interface SimBar {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface TrancheEvent {
  kind: "T1" | "T2" | "T3" | "STOP" | "MARK"; // MARK = open lots marked at window end
  date: string;
  dayIndex: number; // sessions after the trigger day
  price: number;
  lots: number; // how many lots exited on this event
  r: number; // per-lot R at this event
}

export interface TrancheSim {
  basis: "trigger-day-close";
  startDate: string; // trigger day
  entry: number;
  stop: number;
  stopSource: "lod" | "atr-floor";
  rUnit: number;
  events: TrancheEvent[];
  lotsClosed: number; // 0..3 (excludes MARK)
  blendedR: number | null; // mean per-lot R across all 3 lots (MARK lots at mark)
  realizedR: number | null; // mean R of CLOSED lots only, null until one closes
  done: boolean; // all lots exited via T-levels/stop, or window complete
  windowSessions: number;
}

const WINDOW = 14;
const TARGETS_R = [1, 2, 3] as const;
const ATR_STOP_FLOOR = 0.75; // min stop distance as a fraction of ATR14

/**
 * Simulate the 3-lot plan. `bars[0]` must be the trigger-day bar; subsequent
 * bars are the forward sessions (as many as exist so far, up to the caller).
 * `atr14` is the ATR at the trigger day (for the stop floor); null skips it.
 */
export function simulateTranches(bars: SimBar[], atr14: number | null): TrancheSim | null {
  if (bars.length === 0) return null;
  const d0 = bars[0];
  const entry = d0.close;
  if (!(entry > 0)) return null;

  let stop = d0.low;
  let stopSource: TrancheSim["stopSource"] = "lod";
  if (atr14 != null && atr14 > 0 && entry - stop < atr14 * ATR_STOP_FLOOR) {
    stop = entry - atr14 * ATR_STOP_FLOOR;
    stopSource = "atr-floor";
  }
  const rUnit = entry - stop;
  if (!(rUnit > 0)) return null;

  const targets = TARGETS_R.map((m) => entry + m * rUnit);
  const events: TrancheEvent[] = [];
  let nextTarget = 0; // index into targets
  let lotsOpen = 3;
  let activeStop = stop;
  const lastIdx = Math.min(WINDOW, bars.length - 1);

  for (let i = 1; i <= lastIdx && lotsOpen > 0; i++) {
    const b = bars[i];
    // Pessimistic: stop is checked before targets within the same bar.
    if (b.low <= activeStop) {
      const r = (activeStop - entry) / rUnit;
      events.push({ kind: "STOP", date: b.date, dayIndex: i, price: activeStop, lots: lotsOpen, r: Number(r.toFixed(2)) });
      lotsOpen = 0;
      break;
    }
    while (nextTarget < targets.length && lotsOpen > 0 && b.high >= targets[nextTarget]) {
      const kind = (["T1", "T2", "T3"] as const)[nextTarget];
      events.push({ kind, date: b.date, dayIndex: i, price: targets[nextTarget], lots: 1, r: TARGETS_R[nextTarget] });
      lotsOpen--;
      nextTarget++;
      if (kind === "T1") activeStop = Math.max(activeStop, entry); // breakeven after first scale
    }
  }

  const windowComplete = bars.length - 1 >= WINDOW;
  const lotsClosed = 3 - lotsOpen;
  if (lotsOpen > 0 && windowComplete) {
    const last = bars[lastIdx];
    const r = (last.close - entry) / rUnit;
    events.push({ kind: "MARK", date: last.date, dayIndex: lastIdx, price: last.close, lots: lotsOpen, r: Number(r.toFixed(2)) });
  }

  const done = lotsOpen === 0 || windowComplete;
  let blendedR: number | null = null;
  let realizedR: number | null = null;
  const closed = events.filter((e) => e.kind !== "MARK");
  if (closed.length > 0) {
    const sumClosed = closed.reduce((a, e) => a + e.r * e.lots, 0);
    const nClosed = closed.reduce((a, e) => a + e.lots, 0);
    realizedR = Number((sumClosed / nClosed).toFixed(2));
  }
  if (done) {
    const sumAll = events.reduce((a, e) => a + e.r * e.lots, 0);
    const nAll = events.reduce((a, e) => a + e.lots, 0);
    if (nAll > 0) blendedR = Number((sumAll / nAll).toFixed(2));
  }

  return {
    basis: "trigger-day-close",
    startDate: d0.date,
    entry: Number(entry.toFixed(4)),
    stop: Number(stop.toFixed(4)),
    stopSource,
    rUnit: Number(rUnit.toFixed(4)),
    events,
    lotsClosed,
    blendedR,
    realizedR,
    done,
    windowSessions: lastIdx,
  };
}
