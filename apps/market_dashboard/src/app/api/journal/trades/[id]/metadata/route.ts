import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { features } from "@/lib/features";
import { parseTradeMetadataPatch } from "@/lib/journal/trade-metadata";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!features.brokerJournal) {
    return NextResponse.json({ error: "Journal feature unavailable" }, { status: 404 });
  }
  if (!canSeePersonalBook(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const userScopeId = scopeUserId(session)!;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = parseTradeMetadataPatch(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const data: Prisma.TradeRecordUncheckedUpdateInput = {};
  if (parsed.value.tags !== undefined) data.tags = parsed.value.tags as Prisma.InputJsonValue;
  if (parsed.value.screenshots !== undefined) data.screenshots = parsed.value.screenshots as Prisma.InputJsonValue;
  if (parsed.value.mistakes !== undefined) data.mistakes = parsed.value.mistakes as Prisma.InputJsonValue;

  try {
    const updated = await prisma.tradeRecord.update({
      where: { id, userId: userScopeId },
      data,
      select: {
        id: true,
        tags: true,
        screenshots: true,
        mistakes: true,
      },
    });
    return NextResponse.json({ ok: true, trade: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Trade not found" }, { status: 404 });
    }
    throw error;
  }
}
