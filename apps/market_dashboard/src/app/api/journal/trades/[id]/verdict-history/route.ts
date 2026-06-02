import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;

  const { id } = await params;

  const trade = await prisma.tradeRecord.findUnique({
    where: { id, userId: userScopeId },
    select: { id: true },
  });
  if (!trade) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const history = await prisma.tradeVerdictHistory.findMany({
    where: { tradeId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, model: true, provider: true, verdict: true, score: true, createdAt: true },
  });

  return NextResponse.json(history);
}
