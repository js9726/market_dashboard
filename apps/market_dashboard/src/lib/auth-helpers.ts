import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export type AuthorizedRequest = { userId: string; error?: undefined };
export type UnauthorizedRequest = { userId?: undefined; error: NextResponse };

export async function requireUserId(): Promise<AuthorizedRequest | UnauthorizedRequest> {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { userId: session.user.id };
}

/**
 * Auth + daily LLM scan quota gate. Returns {userId} on success or {error} response on failure.
 *
 * Quota fields live on User: dailyScansUsed, dailyScansLimit, lastQuotaResetAt.
 * Reset is handled by /api/cron/reset-quotas (TODO Phase B+).
 *
 * Increment AFTER the LLM call succeeds via incrementScanCount(userId).
 * Wrapping order matters: a failed LLM call (5xx) should NOT consume quota.
 */
export async function requireUserIdAndQuota(): Promise<AuthorizedRequest | UnauthorizedRequest> {
  const auth = await requireUserId();
  if (auth.error) return auth;

  const user = await prisma.user.findUnique({
    where: { id: auth.userId },
    select: { dailyScansUsed: true, dailyScansLimit: true, role: true },
  });

  if (!user) {
    return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  }
  if (user.role === "owner") return { userId: auth.userId };
  if (user.dailyScansUsed >= user.dailyScansLimit) {
    return {
      error: NextResponse.json(
        {
          error: "Daily scan quota exceeded",
          dailyScansUsed: user.dailyScansUsed,
          dailyScansLimit: user.dailyScansLimit,
        },
        { status: 429 }
      ),
    };
  }
  return { userId: auth.userId };
}

/** Increment dailyScansUsed by 1. Call only after a successful LLM call. */
export async function incrementScanCount(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { dailyScansUsed: { increment: 1 } },
  });
}
