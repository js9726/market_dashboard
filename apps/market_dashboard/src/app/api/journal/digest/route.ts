/**
 * GET /api/journal/digest?days=7 - the weekly "what to learn" digest.
 * Session-authenticated. Computed live for the caller's own journal.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { buildWeeklyDigest } from "@/server/journal-digest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Multi-tenant: each user's own digest only.
  const userId = scopeUserId(session)!;
  const days = Math.min(parseInt(new URL(req.url).searchParams.get("days") ?? "7"), 90);
  const digest = await buildWeeklyDigest(userId, days);
  return NextResponse.json(digest);
}
