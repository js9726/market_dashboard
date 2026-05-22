import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAudit } from "@/lib/wiki/audits";

export const dynamic = "force-dynamic";

interface AuditInput {
  period: string;
  markdown: string;
  sourcePath?: string;
  sizeBytes?: number;
}

interface TradeInput {
  date: string;
  ticker: string;
  year: string;
  day0Json?: unknown;
  day14Json?: unknown;
  day0SourcePath?: string;
  day14SourcePath?: string;
}

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

function validPeriod(period: string): boolean {
  return /^\d{4}-\d{2}$/.test(period);
}

function dateOnly(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { audits?: AuditInput[]; trades?: TradeInput[] };
  try {
    body = (await req.json()) as { audits?: AuditInput[]; trades?: TradeInput[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audits = Array.isArray(body.audits) ? body.audits : [];
  const trades = Array.isArray(body.trades) ? body.trades : [];
  if (audits.length === 0 && trades.length === 0) {
    return NextResponse.json({ error: "audits or trades required" }, { status: 400 });
  }

  let auditsUpserted = 0;
  let tradesUpserted = 0;

  for (const audit of audits) {
    if (!audit.period || !validPeriod(audit.period) || typeof audit.markdown !== "string") {
      return NextResponse.json({ error: `Invalid audit payload for ${audit.period ?? "unknown"}` }, { status: 400 });
    }
    const parsed = parseAudit(audit.markdown, audit.period);
    await prisma.wikiAudit.upsert({
      where: { period: audit.period },
      create: {
        period: audit.period,
        markdown: audit.markdown,
        parsedJson: parsed as never,
        sourcePath: audit.sourcePath ?? null,
        sizeBytes: audit.sizeBytes ?? audit.markdown.length,
      },
      update: {
        markdown: audit.markdown,
        parsedJson: parsed as never,
        sourcePath: audit.sourcePath ?? null,
        sizeBytes: audit.sizeBytes ?? audit.markdown.length,
      },
    });
    auditsUpserted += 1;
  }

  for (const trade of trades) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trade.date) || !trade.ticker || !trade.year) {
      return NextResponse.json({ error: `Invalid trade payload for ${trade.ticker ?? "unknown"}` }, { status: 400 });
    }
    const tradeDate = dateOnly(trade.date);
    await prisma.wikiTradeVerdict.upsert({
      where: { tradeDate_ticker: { tradeDate, ticker: trade.ticker } },
      create: {
        tradeDate,
        ticker: trade.ticker,
        year: trade.year,
        day0Json: (trade.day0Json ?? null) as never,
        day14Json: (trade.day14Json ?? null) as never,
        day0SourcePath: trade.day0SourcePath ?? null,
        day14SourcePath: trade.day14SourcePath ?? null,
      },
      update: {
        year: trade.year,
        day0Json: (trade.day0Json ?? null) as never,
        day14Json: (trade.day14Json ?? null) as never,
        day0SourcePath: trade.day0SourcePath ?? null,
        day14SourcePath: trade.day14SourcePath ?? null,
      },
    });
    tradesUpserted += 1;
  }

  return NextResponse.json({ ok: true, auditsUpserted, tradesUpserted });
}
