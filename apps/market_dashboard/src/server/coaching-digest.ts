/**
 * coaching-digest.ts — R5 weekly coaching digest (deterministic, no LLM).
 *
 * Two questions in one digest, per the R5 decision:
 *   1. EDGE — does each lane pay? Expectancy per (setup × champion), and how the
 *      TRIGGERED subset does (forward MFE in R + win-rate).
 *   2. EXECUTION — are you acting on the signal? triggered-and-taken vs
 *      triggered-and-missed (the order-queuing leak) vs chased-untriggered
 *      (off-book entries), plus MFE-capture on closed picks.
 * Then a single rule-based "do this differently" line for the #1 leak.
 *
 * Multi-tenant: scoped to one userId. Reads AListCandidate only (triggers +
 * outcomes already live there). Thin while trigger data is young; it sharpens
 * forward — consistent with the ship-and-forward-validate decision.
 */
import { prisma } from "@/lib/prisma";

export interface EdgeRow {
  setup: string;
  champion: string;
  n: number;
  triggered: number;
  taken: number;
  winRate: number | null; // of picks with a forward outcome
  avgMfeR: number | null;
}

export interface CoachingDigest {
  window: { from: string; to: string };
  totalPicks: number;
  edge: EdgeRow[];
  execution: {
    triggeredTaken: number;
    triggeredMissed: number;
    chasedOffBook: number;
    onBookEntries: number;
  };
  mfeCapture: number | null; // avg realizedR / availableMfeR on closed held picks
  topLeak: string;
}

const num = (d: { toNumber(): number } | null | undefined): number | null => (d == null ? null : d.toNumber());
const taken = (c: { isHeld: boolean; convertedTradeId: string | null }) => c.isHeld || c.convertedTradeId != null;

export async function computeCoachingDigest(userId: string, days = 120): Promise<CoachingDigest> {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  const picks = await prisma.aListCandidate.findMany({
    where: { userId, pickDate: { gte: from } },
    select: {
      ticker: true, pickDate: true, setupClassification: true, championPersona: true,
      triggerState: true, isHeld: true, onBook: true, convertedTradeId: true,
      day14Outcome: true, day14MfeR: true, realizedRLogged: true,
    },
  });

  // ── Edge per (setup × champion) ──────────────────────────────────────────
  const groups = new Map<string, typeof picks>();
  for (const p of picks) {
    const key = `${p.setupClassification ?? "?"}|${p.championPersona ?? "?"}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  const edge: EdgeRow[] = [];
  for (const [key, rows] of Array.from(groups.entries())) {
    if (rows.length < 2) continue;
    const [setup, champion] = key.split("|");
    const withOutcome = rows.filter((r) => r.day14MfeR != null);
    const wins = withOutcome.filter((r) => r.day14Outcome === "HIT_TARGET" || (num(r.day14MfeR) ?? 0) >= 1).length;
    const mfes = withOutcome.map((r) => num(r.day14MfeR) ?? 0);
    edge.push({
      setup,
      champion,
      n: rows.length,
      triggered: rows.filter((r) => r.triggerState === "TRIGGERED").length,
      taken: rows.filter(taken).length,
      winRate: withOutcome.length ? Math.round((wins / withOutcome.length) * 100) : null,
      avgMfeR: mfes.length ? +(mfes.reduce((a, b) => a + b, 0) / mfes.length).toFixed(2) : null,
    });
  }
  edge.sort((a, b) => b.n - a.n);

  // ── Execution ────────────────────────────────────────────────────────────
  const triggered = picks.filter((p) => p.triggerState === "TRIGGERED");
  const triggeredTaken = triggered.filter(taken).length;
  const triggeredMissed = triggered.length - triggeredTaken;
  const heldPicks = picks.filter(taken);
  const chasedOffBook = heldPicks.filter((p) => p.onBook === false).length;
  const onBookEntries = heldPicks.filter((p) => p.onBook === true).length;

  // ── MFE capture on closed held picks ─────────────────────────────────────
  const captures = heldPicks
    .map((p) => ({ realized: num(p.realizedRLogged), mfe: num(p.day14MfeR) }))
    .filter((x): x is { realized: number; mfe: number } => x.realized != null && x.mfe != null && x.mfe > 0.2)
    .map((x) => x.realized / x.mfe);
  const mfeCapture = captures.length ? +(captures.reduce((a, b) => a + b, 0) / captures.length).toFixed(2) : null;

  // ── Top leak (rule-based, ranked) ────────────────────────────────────────
  const worstEdge = edge.filter((e) => e.n >= 3 && e.avgMfeR != null).sort((a, b) => (a.avgMfeR ?? 0) - (b.avgMfeR ?? 0))[0];
  let topLeak: string;
  if (triggeredMissed >= 2 && triggeredMissed >= triggeredTaken) {
    topLeak = `Order-queuing leak: ${triggeredMissed} triggered A-list pick(s) went untaken vs ${triggeredTaken} taken — you're missing the entries your own triggers flagged.`;
  } else if (chasedOffBook >= 2 && chasedOffBook > onBookEntries) {
    topLeak = `Chasing leak: ${chasedOffBook} of your entries were off-book/untriggered vs ${onBookEntries} on-book — wait for the trigger instead of freelancing.`;
  } else if (mfeCapture != null && mfeCapture < 0.4) {
    topLeak = `Exit leak: you captured only ${Math.round(mfeCapture * 100)}% of the available move (MFE) on closed picks — exits, not entries, are the problem.`;
  } else if (worstEdge && (worstEdge.avgMfeR ?? 0) < 0) {
    topLeak = `Setup leak: ${worstEdge.setup} / ${worstEdge.champion} is not paying (avg ${worstEdge.avgMfeR}R over ${worstEdge.n}) — raise the bar or skip this lane.`;
  } else {
    topLeak = "No dominant leak yet — trigger/outcome data is still young. The digest sharpens as more picks fire and close.";
  }

  return {
    window: { from: from.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) },
    totalPicks: picks.length,
    edge: edge.slice(0, 12),
    execution: { triggeredTaken, triggeredMissed, chasedOffBook, onBookEntries },
    mfeCapture,
    topLeak,
  };
}
