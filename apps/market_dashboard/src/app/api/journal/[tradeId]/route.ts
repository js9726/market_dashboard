/**
 * GET  /api/journal/[tradeId] → JournalEntry | null
 * POST /api/journal/[tradeId] → upsert per-trade analysis
 *
 * The new `JournalEntry` model (NOT the renamed daily-reflection one) holds
 * trade-analyser output: setup classification, priming pattern, 7-trader
 * rubric, fundamental grade, evolution note. One row per TradeRecord.
 *
 * Body (POST):
 * {
 *   setupType:          string,            // EP-FRESH | POST-GAP-VCP | ...
 *   primingPattern?:    string,            // INSIDE-BAR | UPSIDE-REVERSAL | ...
 *   setupJustification?:string,
 *   traderScores:       Json,              // { traderName: { entry, risk, setup, total, wouldEnter, why } }
 *   fundamentalGrade?:  'A'|'B'|'C',
 *   fundamentalData?:   Json,
 *   compositeScore:     number,            // 0..10
 *   bestStyleMatch?:    string,
 *   weakestDimension?:  string,
 *   entryVerdict:       'GOOD'|'ACCEPTABLE'|'POOR',
 *   evolutionNote?:     string,
 *   patternNote?:       string,
 *   wikiRefs?:          string[]
 * }
 *
 * Auth: session-based. Caller must own the TradeRecord.
 */
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ tradeId: string }> };

const VALID_VERDICTS = new Set(["GOOD", "ACCEPTABLE", "POOR"]);
const VALID_GRADES = new Set(["A", "B", "C"]);

export async function GET(_req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { tradeId } = await params;
  const userScopeId = scopeUserId(session)!;

  const trade = await prisma.tradeRecord.findFirst({
    where: { id: tradeId, userId: userScopeId },
    select: { id: true },
  });
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  const entry = await prisma.journalEntry.findUnique({
    where: { tradeRecordId: tradeId },
  });
  return NextResponse.json(entry);
}

export async function POST(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { tradeId } = await params;
  const userScopeId = scopeUserId(session)!;

  const trade = await prisma.tradeRecord.findFirst({
    where: { id: tradeId, userId: userScopeId },
    select: { id: true },
  });
  if (!trade) return NextResponse.json({ error: "Trade not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const setupType = typeof body.setupType === "string" ? body.setupType.trim() : null;
  if (!setupType) return NextResponse.json({ error: "setupType required" }, { status: 400 });

  const entryVerdict = typeof body.entryVerdict === "string" ? body.entryVerdict.toUpperCase() : null;
  if (!entryVerdict || !VALID_VERDICTS.has(entryVerdict)) {
    return NextResponse.json({ error: "entryVerdict must be GOOD|ACCEPTABLE|POOR" }, { status: 400 });
  }

  const compositeScoreRaw = body.compositeScore;
  const compositeScore =
    typeof compositeScoreRaw === "number"
      ? compositeScoreRaw
      : typeof compositeScoreRaw === "string"
      ? Number(compositeScoreRaw)
      : NaN;
  if (!Number.isFinite(compositeScore) || compositeScore < 0 || compositeScore > 10) {
    return NextResponse.json({ error: "compositeScore must be 0..10" }, { status: 400 });
  }

  if (typeof body.traderScores !== "object" || body.traderScores == null) {
    return NextResponse.json({ error: "traderScores object required" }, { status: 400 });
  }

  const fundamentalGrade =
    typeof body.fundamentalGrade === "string" ? body.fundamentalGrade.toUpperCase() : null;
  if (fundamentalGrade && !VALID_GRADES.has(fundamentalGrade)) {
    return NextResponse.json({ error: "fundamentalGrade must be A|B|C" }, { status: 400 });
  }

  const data = {
    userId: userScopeId,
    tradeRecordId: tradeId,
    setupType,
    primingPattern: typeof body.primingPattern === "string" ? body.primingPattern : null,
    setupJustification:
      typeof body.setupJustification === "string" ? body.setupJustification : null,
    traderScores: body.traderScores as Prisma.InputJsonValue,
    fundamentalGrade,
    fundamentalData:
      body.fundamentalData != null && typeof body.fundamentalData === "object"
        ? (body.fundamentalData as Prisma.InputJsonValue)
        : Prisma.JsonNull,
    compositeScore: new Prisma.Decimal(compositeScore),
    bestStyleMatch: typeof body.bestStyleMatch === "string" ? body.bestStyleMatch : null,
    weakestDimension: typeof body.weakestDimension === "string" ? body.weakestDimension : null,
    entryVerdict,
    evolutionNote: typeof body.evolutionNote === "string" ? body.evolutionNote : null,
    patternNote: typeof body.patternNote === "string" ? body.patternNote : null,
    wikiRefs: Array.isArray(body.wikiRefs)
      ? (body.wikiRefs as unknown[]).filter((s): s is string => typeof s === "string")
      : [],
  };

  const entry = await prisma.journalEntry.upsert({
    where: { tradeRecordId: tradeId },
    create: data,
    update: {
      setupType: data.setupType,
      primingPattern: data.primingPattern,
      setupJustification: data.setupJustification,
      traderScores: data.traderScores,
      fundamentalGrade: data.fundamentalGrade,
      fundamentalData: data.fundamentalData,
      compositeScore: data.compositeScore,
      bestStyleMatch: data.bestStyleMatch,
      weakestDimension: data.weakestDimension,
      entryVerdict: data.entryVerdict,
      evolutionNote: data.evolutionNote,
      patternNote: data.patternNote,
      wikiRefs: data.wikiRefs,
    },
  });

  return NextResponse.json({ ok: true, entry });
}
