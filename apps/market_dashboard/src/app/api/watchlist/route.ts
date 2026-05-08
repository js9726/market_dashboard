import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth-helpers";

const TICKER_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function normalizeTicker(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toUpperCase();
  return TICKER_RE.test(t) ? t : null;
}

export async function GET() {
  const auth = await requireUserId();
  if (auth.error) return auth.error;

  const items = await prisma.watchlist.findMany({
    where: { userId: auth.userId },
    orderBy: { addedAt: "desc" },
    select: { id: true, ticker: true, addedAt: true },
  });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireUserId();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => ({}));
  const ticker = normalizeTicker((body as { ticker?: unknown }).ticker);
  if (!ticker) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const item = await prisma.watchlist.upsert({
    where: { userId_ticker: { userId: auth.userId, ticker } },
    create: { userId: auth.userId, ticker },
    update: {},
    select: { id: true, ticker: true, addedAt: true },
  });
  return NextResponse.json({ item }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await requireUserId();
  if (auth.error) return auth.error;

  const { searchParams } = new URL(request.url);
  const ticker = normalizeTicker(searchParams.get("ticker"));
  if (!ticker) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  await prisma.watchlist.deleteMany({
    where: { userId: auth.userId, ticker },
  });
  return NextResponse.json({ ok: true });
}
