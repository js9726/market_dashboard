/**
 * GET /api/broker-presets → returns all built-in presets + user's clones.
 *
 * Used by the broker-settings UI to populate the preset dropdown.
 */
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const presets = await prisma.brokerPreset.findMany({
    where: {
      OR: [
        { isBuiltIn: true },
        { userId: session.user.id },
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
