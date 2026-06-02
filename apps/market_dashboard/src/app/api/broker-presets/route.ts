/**
 * GET /api/broker-presets → returns all built-in presets + user's clones.
 *
 * Used by the broker-settings UI to populate the preset dropdown.
 */
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const presets = await prisma.brokerPreset.findMany({
    where: {
      OR: [
        { isBuiltIn: true },
        { userId: userScopeId },
      ],
    },
    select: {
      id: true,
      name: true,
      region: true,
      currency: true,
      isBuiltIn: true,
      feeFormula: true,
    },
    orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
  });
  return NextResponse.json({ presets });
}
