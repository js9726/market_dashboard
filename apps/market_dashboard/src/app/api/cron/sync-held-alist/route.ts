/**
 * GET /api/cron/sync-held-alist — seed/refresh HELD rows on the merged A-List
 * from the owner's live positions. Idempotent; safe to run on every tick.
 *
 * Auth: Vercel cron `Authorization: Bearer <CRON_SECRET>`, or manual
 * `?secret=<BRIEF_INGEST_KEY>`, or any `x-vercel-cron-signature`.
 *
 * Pairs with /api/cron/track-positions (which fills the path + savings).
 */
import { NextResponse } from "next/server";
import { getOwnerUserId } from "@/server/a-list-extractor";
import { syncHeldPositions } from "@/server/alist-held-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  const ingestKey = process.env.BRIEF_INGEST_KEY;
  const authHeader = req.headers.get("authorization") ?? "";
  const urlSecret = new URL(req.url).searchParams.get("secret");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;
  if (ingestKey && urlSecret === ingestKey) return true;
  if (req.headers.get("x-vercel-cron-signature")) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = await getOwnerUserId();
  if (!userId) {
    return NextResponse.json({ error: "No owner-role user found" }, { status: 503 });
  }
  const result = await syncHeldPositions(userId);
  return NextResponse.json({ ok: true, ...result });
}
