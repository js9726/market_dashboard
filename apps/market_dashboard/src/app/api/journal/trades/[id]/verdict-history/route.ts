import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const trade = await prisma.trade.findUnique({
    where: { id, userId: session.user.id },
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
