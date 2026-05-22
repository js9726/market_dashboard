import { auth } from "@/auth";
import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ date: string; ticker: string; stage: string }>;
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function GET(_req: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { date, ticker, stage } = await context.params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z0-9.-]{1,16}$/i.test(ticker)) {
    return NextResponse.json({ error: "Invalid trade key" }, { status: 400 });
  }
  if (stage !== "day0" && stage !== "day14") {
    return NextResponse.json({ error: "Invalid stage" }, { status: 400 });
  }

  const normalizedTicker = ticker.toUpperCase();
  try {
    const row = await prisma.wikiTradeVerdict.findUnique({
      where: { tradeDate_ticker: { tradeDate: dateOnly(date), ticker: normalizedTicker } },
    });
    const payload = stage === "day0" ? row?.day0Json : row?.day14Json;
    if (payload) return NextResponse.json(payload);
  } catch {
    // Local dev fallback below. Production should have the Prisma table.
  }

  const year = date.slice(0, 4);
  const filePath = path.join(
    process.cwd(),
    "public",
    "wiki",
    "trades",
    year,
    `${date}_${normalizedTicker}_${stage}.json`,
  );
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: `No ${stage} verdict for ${normalizedTicker} ${date}` }, { status: 404 });
    }
    const msg = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: `Read failed: ${msg}` }, { status: 500 });
  }
}
