/**
 * /api/cron/reset-quotas
 *
 * Daily LLM scan-quota reset (the TODO from lib/auth-helpers.ts). Resets
 * dailyScansUsed for every user whose lastQuotaResetAt is before midnight
 * Eastern Time today. Idempotent: a second run the same ET day matches zero
 * rows. Scheduled at 04:05 + 05:05 UTC (midnight EDT / midnight EST — the
 * off-season run is a no-op).
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { etMidnightUtc } from "@/lib/quota";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    const keyParam = new URL(request.url).searchParams.get("secret");
    if (authHeader !== `Bearer ${cronSecret}` && keyParam !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const cutoff = etMidnightUtc(new Date());
  const { count } = await prisma.user.updateMany({
    where: { lastQuotaResetAt: { lt: cutoff } },
    data: { dailyScansUsed: 0, lastQuotaResetAt: new Date() },
  });

  return NextResponse.json({ ok: true, reset: count, cutoff: cutoff.toISOString() });
}
