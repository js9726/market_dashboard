/**
 * POST /api/journal/entries/ingest
 *
 * Machine endpoint. The post-close journaler (journal_close.yml → Claude SDK
 * runner) calls this with an AI-scored per-trade JournalEntry. Idempotent:
 * upserts on tradeRecordId, so re-running the journaler overwrites cleanly.
 *
 * This is the "final end to journaling the trade that day with AI assistance" —
 * each closed trade gets a 7-trader-rubric score, setup classification, entry
 * verdict, pattern note, and wiki references, persisted for study.
 *
 * Auth: `Authorization: Bearer <BRIEF_INGEST_KEY>`.
 *
 * Body:
 *   {
 *     tradeRecordId: string,         // required — links to the closed trade
 *     setupType: string,             // EP-FRESH | BO-CB | PB-21EMA | ...
 *     primingPattern?: string,
 *     setupJustification?: string,
 *     traderScores: object,          // { [trader]: { entry, risk, setup, total, wouldEnter, why } }
 *     fundamentalGrade?: "A"|"B"|"C",
 *     fundamentalData?: object,
 *     compositeScore: number,        // 0.00-10.00
 *     bestStyleMatch?: string,
 *     weakestDimension?: string,
 *     entryVerdict: "GOOD"|"ACCEPTABLE"|"POOR",
 *     evolutionNote?: string,
 *     patternNote?: string,          // vs last 5 trades
 *     wikiRefs?: string[],
 *     userId?: string                // defaults to owner
 *   }
 */
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const tradeRecordId = body.tradeRecordId as string | undefined;
  if (!tradeRecordId) {
    return NextResponse.json({ error: "tradeRecordId required" }, { status: 400 });
  }

  // Resolve the owning user from the trade record (keeps userId consistent).
  const trade = await prisma.tradeRecord.findUnique({
    where: { id: tradeRecordId },
    select: { id: true, userId: true },
  });
  if (!trade) {
    return NextResponse.json({ error: "trade not found" }, { status: 404 });
  }

  const setupType = (body.setupType as string) ?? "OTHER";
  const entryVerdict = (body.entryVerdict as string) ?? "ACCEPTABLE";
  const compositeScore = typeof body.compositeScore === "number" ? body.compositeScore : 0;

  const data = {
    userId: trade.userId,
    tradeRecordId: trade.id,
    setupType,
    primingPattern: (body.primingPattern as string) ?? null,
    setupJustification: (body.setupJustification as string) ?? null,
    traderScores: (body.traderScores as Prisma.InputJsonValue) ?? {},
    fundamentalGrade: (body.fundamentalGrade as string) ?? null,
    fundamentalData: (body.fundamentalData as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    compositeScore: new Prisma.Decimal(compositeScore),
    bestStyleMatch: (body.bestStyleMatch as string) ?? null,
    weakestDimension: (body.weakestDimension as string) ?? null,
    entryVerdict,
    evolutionNote: (body.evolutionNote as string) ?? null,
    patternNote: (body.patternNote as string) ?? null,
    wikiRefs: Array.isArray(body.wikiRefs) ? (body.wikiRefs as string[]) : [],
  };

  const existing = await prisma.journalEntry.findUnique({ where: { tradeRecordId: trade.id } });
  const row = existing
    ? await prisma.journalEntry.update({ where: { id: existing.id }, data })
    : await prisma.journalEntry.create({ data });

  return NextResponse.json({
    ok: true,
    id: row.id,
    tradeRecordId: trade.id,
    action: existing ? "updated" : "created",
    compositeScore,
    entryVerdict,
  });
}
