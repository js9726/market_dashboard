/**
 * GET /api/journal/digest?days=7 — the weekly "what to learn" digest.
 * Owner session (allowed viewers see the owner's digest). Computed live.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { buildWeeklyDigest } from "@/server/journal-digest";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let userId = session.user.id;
  const role = (session.user as { role?: string }).role;
  if (role !== "owner") {
    const owner = await prisma.user.findFirst({
      where: { role: "owner" },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    if (owner) userId = owner.id;
  }
  const days = Math.min(parseInt(new URL(req.url).searchParams.get("days") ?? "7"), 90);
  const digest = await buildWeeklyDigest(userId, days);
  return NextResponse.json(digest);
}
