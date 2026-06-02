/**
 * GET  /api/journal/entry?date=YYYY-MM-DD  -> DailyReflection | null
 * POST /api/journal/entry                  -> upsert by (userId, entryDate)
 *
 * Note: model renamed `JournalEntry` → `DailyReflection` in 2026-05 schema
 * migration. URL kept stable for backwards compat with DailyJournal.tsx.
 * The model name `JournalEntry` is now used for per-trade analysis (different
 * concept entirely — see /api/journal/[tradeId] route).
 *
 * Body (POST):
 *   {
 *     date:             "YYYY-MM-DD",            // required
 *     moodEmoji:        string | null,
 *     sleepHours:       number | null,           // 0..12
 *     marketConditions: string | null,           // one of MARKET_CONDITIONS
 *     notes:            string | null,
 *     tvLinks:          string[],                // free URL list (max 10)
 *     attachmentUrls:   string[],                // Vercel Blob URLs (max 5)
 *   }
 *
 * attachmentUrls are written by /api/journal/entry/attachments first via the
 * @vercel/blob client-upload flow, then submitted here as part of the entry.
 */
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  isValidMarketCondition,
  isValidMood,
  isValidSleepHours,
} from "@/lib/journal/mood";
import { sanitiseAttachmentUrls } from "@/lib/journal/attachments";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_RE.test(value)) return null;
  const d = new Date(value + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;
  const url = new URL(req.url);
  const date = parseDate(url.searchParams.get("date"));
  if (!date) {
    return NextResponse.json({ error: "Invalid or missing ?date=YYYY-MM-DD" }, { status: 400 });
  }
  const entry = await prisma.dailyReflection.findUnique({
    where: { userId_entryDate: { userId: userScopeId, entryDate: date } },
  });
  return NextResponse.json(entry);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const date = parseDate(body.date);
  if (!date) {
    return NextResponse.json({ error: "Invalid or missing date" }, { status: 400 });
  }

  const moodEmoji = typeof body.moodEmoji === "string" ? body.moodEmoji : null;
  if (moodEmoji != null && !isValidMood(moodEmoji)) {
    return NextResponse.json({ error: "Invalid moodEmoji" }, { status: 400 });
  }

  const sleepRaw = body.sleepHours;
  const sleepHours =
    typeof sleepRaw === "number" ? sleepRaw :
    typeof sleepRaw === "string" && sleepRaw.trim() !== "" ? Number(sleepRaw) :
    null;
  if (sleepHours != null && !isValidSleepHours(sleepHours)) {
    return NextResponse.json({ error: "sleepHours must be between 0 and 12" }, { status: 400 });
  }

  const marketConditions =
    typeof body.marketConditions === "string" && body.marketConditions.length > 0
      ? body.marketConditions
      : null;
  if (!isValidMarketCondition(marketConditions)) {
    return NextResponse.json({ error: "Invalid marketConditions" }, { status: 400 });
  }

  const notes = typeof body.notes === "string" ? body.notes : null;
  // Trade off: cap notes at 4 KB to keep DB rows compact. Anything longer
  // is almost certainly a paste error.
  if (notes != null && notes.length > 4096) {
    return NextResponse.json({ error: "notes exceeds 4 KB" }, { status: 400 });
  }

  const tvLinksRaw = body.tvLinks;
  const tvLinks: string[] = Array.isArray(tvLinksRaw)
    ? tvLinksRaw.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, 10)
    : [];

  // attachmentUrls — sanitised + de-duped + capped at MAX_ATTACHMENTS_PER_ENTRY (5).
  // Any URL not on a Vercel Blob host is silently dropped so a malicious client
  // can't store arbitrary off-platform URLs in our DB.
  const attachmentUrls = sanitiseAttachmentUrls(body.attachmentUrls);

  const entry = await prisma.dailyReflection.upsert({
    where: { userId_entryDate: { userId: userScopeId, entryDate: date } },
    create: {
      userId: userScopeId,
      entryDate: date,
      moodEmoji,
      sleepHours,
      marketConditions,
      notes,
      tvLinks,
      attachmentUrls,
    },
    update: {
      moodEmoji,
      sleepHours,
      marketConditions,
      notes,
      tvLinks,
      attachmentUrls,
    },
  });

  return NextResponse.json(entry);
}
