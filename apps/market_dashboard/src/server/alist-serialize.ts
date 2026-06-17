/**
 * alist-serialize.ts — single source of truth for the JSON shape returned by
 * /api/a-list/today and /api/a-list/history (and consumed by AListTable).
 *
 * Emits REC/HELD badges, the entry grade, the HELD block, both 1R bases, and
 * the two savings metrics. Keeping it here stops the two routes from drifting.
 */
import type { AListCandidate, Prisma } from "@prisma/client";

function num(d: Prisma.Decimal | null): number | null {
  return d == null ? null : d.toNumber();
}

export function serializeCandidate(r: AListCandidate) {
  const badges: string[] = [];
  const isRec = r.source === "AUTO" || r.source === "MANUAL" || r.day0Score != null;
  if (isRec) badges.push("REC");
  if (r.isHeld) badges.push("HELD");

  return {
    id: r.id,
    pickDate: r.pickDate.toISOString().slice(0, 10),
    ticker: r.ticker,
    setup: r.setupClassification,
    screenSource: r.screenSource,
    sector: r.sector,
    industry: r.industry,
    source: r.source,
    badges,
    onBook: r.onBook,
    entry: num(r.entryZone),
    stop: num(r.stop),
    target: num(r.target),
    rrr: num(r.rrr),
    score: r.day0Score,
    verdict: r.day0Verdict,
    rvol: num(r.day0Rvol),
    thesis: r.day0Thesis,
    traderLens: r.day0TraderLens,
    // Conviction breakdown (wiki/trader-styles.md) + best-match persona.
    conviction: {
      setup: r.setupScore,
      entry: r.entryScore,
      theme: r.themeScore,
      sentiment: r.sentimentScore,
    },
    championPersona: r.championPersona,
    // Entry-trigger lifecycle (R3.2): the "should I take it" signal.
    trigger: r.triggerState
      ? { state: r.triggerState, at: r.triggerStateAt?.toISOString() ?? null, reason: r.triggerReason }
      : null,
    // Multi-agent Conviction verdict (R4): ENTER/WAIT/PASS + breakdown+reasoning.
    agent: r.agentVerdict
      ? { verdict: r.agentVerdict, at: r.agentConvictionAt?.toISOString() ?? null, analysis: r.agentConviction }
      : null,
    briefProvider: r.day0BriefProvider,
    briefBucketAt: r.day0BriefBucketAt?.toISOString() ?? null,
    day0Price: num(r.day0Price),
    status: r.status,
    convertedTradeId: r.convertedTradeId,

    // ── HELD lane ──────────────────────────────────────────────────────────
    isHeld: r.isHeld,
    entryGrade: r.entryGrade,
    entryGradeJson: r.entryGradeJson,
    held: r.isHeld
      ? {
          positionId: r.heldPositionId,
          entryFillAt: r.entryFillAt?.toISOString() ?? null,
          entryAvgCost: num(r.entryAvgCost),
          qty: num(r.heldQty),
        }
      : null,

    // ── 1R bases + savings ─────────────────────────────────────────────────
    rUnitLogged: num(r.rUnitLogged),
    rUnitAtr: num(r.rUnitAtr),
    atrFloorStop: num(r.atrFloorStop),
    savings: {
      realizedR: num(r.realizedRLogged),
      saveRealizedR: num(r.saveRealizedR),
      saveRealizedUsd: num(r.saveRealizedUsd),
      saveSoftVsHardR: num(r.saveSoftVsHardR),
      saveSoftVsHardUsd: num(r.saveSoftVsHardUsd),
      soft8emaExit: num(r.soft8emaExit),
      soft21emaExit: num(r.soft21emaExit),
      hardStopHitAt: r.hardStopHitAt?.toISOString() ?? null,
      hardStopHitBasis: r.hardStopHitBasis,
    },

    day14: r.day14ComputedAt
      ? {
          mfe: num(r.day14Mfe),
          mae: num(r.day14Mae),
          mfeR: num(r.day14MfeR),
          maeR: num(r.day14MaeR),
          score: num(r.day14Score),
          outcome: r.day14Outcome,
          verdict: r.day14Verdict,
          computedAt: r.day14ComputedAt.toISOString(),
        }
      : null,
    tags: r.tags,
    notes: r.notes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export type SerializedCandidate = ReturnType<typeof serializeCandidate>;
