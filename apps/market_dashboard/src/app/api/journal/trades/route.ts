import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = 50;
  const symbol = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const side = searchParams.get("side") ?? "";
  const result = searchParams.get("result") ?? "";

  const where = {
    userId: session.user.id,
    ...(symbol ? { ticker: { contains: symbol } } : {}),
    ...(side ? { side } : {}),
    ...(result === "win" ? { pnl: { gt: 0 } } : result === "loss" ? { pnl: { lte: 0 } } : result === "open" ? { pnl: null } : {}),
  };

  const [total, trades] = await Promise.all([
    prisma.trade.count({ where }),
    prisma.trade.findMany({
      where,
      orderBy: { tradeDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    trades,
    total,
    page,
    pages: Math.ceil(total / limit),
  });
}
