/**
 * POST /api/a-list/[id]/day14
 *
 * Machine-only endpoint. Called by day14_rescore.py (via journal_close.yml
 * cron at 16:30 ET) to update an A-list candidate with its day-14 outcome.
 *
 * Phase 5 of pre-open CI + journal revamp plan.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>` (same key as ingest).
 *
 * Body:
 *   {
 *     outcome: "HIT_TARGET" | "STOPPED_OUT" | "PARTIAL" | "FADE" | "DRIFT",
 *     mfe:     number,    // max favourable excursion in $
 *     mae:     number,    // max adverse excursion in $
 *     mfeR:    number,    // MFE in R units (R = entry - stop)
 *     maeR:    number,    // MAE in R units
 *     score:   number,    // 0-10
 *     verdict?: string,   // optional AI commentary
 *   }
 *
 * Side effects:
 *   - Updates day14* fields on the AListCandidate row.
 *   - Auto-flips status: ACTIVE → HIT_TARGET / STOPPED_OUT / EXPIRED
 *     (matches Round 6 answer: "After day-14 outcome computed").
 */
import { NextResponse } from "next/server";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  const got = req.headers.get("authorization");
  return got === `Bearer ${expected}`;
}

const VALID_OUTCOMES = new Set(["HIT_TARGET", "STOPPED_OUT", "PARTIAL", "FADE", "DRIFT"]);

function statusFromOutcome(outcome: string): string {
  switch (outcome) {
    case "HIT_TARGET": return "HIT_TARGET";
    case "STOPPED_OUT": return "STOPPED_OUT";
    case "PARTIAL":
    case "FADE":
    case "DRIFT":
    default:
      return "EXPIRED";
  }
}

function dec(v: number | null | undefined): Prisma.Decimal | null {
  return v == null || Number.isNaN(v) ? null : new Prisma.Decimal(v);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "candidate id required" }, { status: 400 });
  }

  let body: {
    outcome?: string;
    mfe?: number;
    mae?: number;
    mfeR?: number;
    maeR?: number;
    score?: number;
    verdict?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const outcome = body.outcome?.toUpperCase();
  if (!outcome || !VALID_OUTCOMES.has(outcome)) {
    return NextResponse.json({ error: "Invalid outcome" }, { status: 400 });
  }

  const existing = await prisma.aListCandidate.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
  }

  const updated = await prisma.aListCandidate.update({
    where: { id },
    data: {
      day14Outcome: outcome,
      day14Mfe: dec(body.mfe),
      day14Mae: dec(body.mae),
      day14MfeR: dec(body.mfeR),
      day14MaeR: dec(body.maeR),
      day14Score: dec(body.score),
      day14Verdict: body.verdict ?? null,
      day14ComputedAt: new Date(),
      // Auto-flip status per the Round 6 answer (after day-14 outcome
      // computed). Manual status overrides are preserved — only ACTIVE flips.
      status: existing.status === "ACTIVE" ? statusFromOutcome(outcome) : existing.status,
    },
  });

  return NextResponse.json({
    ok: true,
    id: updated.id,
    ticker: updated.ticker,
    status: updated.status,
    day14Outcome: updated.day14Outcome,
  });
}
