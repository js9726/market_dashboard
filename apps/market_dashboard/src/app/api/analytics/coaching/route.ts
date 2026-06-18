/**
 * GET /api/analytics/coaching — R5 weekly coaching digest for the caller.
 *
 * Multi-tenant: scoped to the signed-in user's own A-list picks (edge +
 * execution + the #1 leak). Members + owner only (personal book).
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { computeCoachingDigest } from "@/server/coaching-digest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const days = Math.min(365, Math.max(14, Number(new URL(req.url).searchParams.get("days")) || 120));
  try {
    const digest = await computeCoachingDigest(userId, days);
    return NextResponse.json(digest, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    console.error("[analytics/coaching] failed:", e);
    return NextResponse.json({ error: "compute failed" }, { status: 500 });
  }
}
