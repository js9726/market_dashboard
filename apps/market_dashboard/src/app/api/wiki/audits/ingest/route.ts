import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseAudit } from "@/lib/wiki/audits";

export const dynamic = "force-dynamic";

interface AuditInput {
  operatorLabel?: string;
  period: string;
  markdown: string;
  sourcePath?: string;
  sizeBytes?: number;
}

interface TradeInput {
  operatorLabel?: string;
  /** "journal" | "analysis" — default "journal". Screener picks have their own input type. */
  intent?: string;
  date: string;
  ticker: string;
  year: string;
  day0Json?: unknown;
  day14Json?: unknown;
  day0SourcePath?: string;
  day14SourcePath?: string;
}

interface ScreenerPickInput {
  operatorLabel?: string;
  pickDate: string;
  ticker: string;
  setupClassification?: string;
  screenSource: string;
  notes?: string;
  sourceUrl?: string;
  convertedTradeId?: string;
}

const VALID_INTENTS = new Set(["journal", "analysis"]);

function normaliseIntent(raw: string | undefined): string {
  if (!raw) return "journal";
  const lower = raw.trim().toLowerCase();
  return VALID_INTENTS.has(lower) ? lower : "journal";
}

const OPERATOR_RE = /^[A-Z]{2,8}$/;

function normaliseOperator(raw: string | undefined): string {
  if (!raw) return "JS";
  const trimmed = raw.trim().toUpperCase();
  return OPERATOR_RE.test(trimmed) ? trimmed : "JS";
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

  let body: {
    audits?: AuditInput[];
    trades?: TradeInput[];
    screenerPicks?: ScreenerPickInput[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const audits = Array.isArray(body.audits) ? body.audits : [];
  const trades = Array.isArray(body.trades) ? body.trades : [];
  const screenerPicks = Array.isArray(body.screenerPicks) ? body.screenerPicks : [];
  if (audits.length === 0 && trades.length === 0 && screenerPicks.length === 0) {
    return NextResponse.json(
      { error: "audits, trades, or screenerPicks required" },
      { status: 400 },
    );
  }

  let auditsUpserted = 0;
  let tradesUpserted = 0;
  let screenerPicksUpserted = 0;

  for (const audit of audits) {
    if (!audit.period || !validPeriod(audit.period) || typeof audit.markdown !== "string") {
      return NextResponse.json({ error: `Invalid audit payload for ${audit.period ?? "unknown"}` }, { status: 400 });
    }
    const operatorLabel = normaliseOperator(audit.operatorLabel);
    const parsed = parseAudit(audit.markdown, audit.period, operatorLabel);
    await prisma.wikiAudit.upsert({
      where: { operatorLabel_period: { operatorLabel, period: audit.period } },
      create: {
        operatorLabel,
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
    const operatorLabel = normaliseOperator(trade.operatorLabel);
    const intent = normaliseIntent(trade.intent);
    const tradeDate = dateOnly(trade.date);
    await prisma.wikiTradeVerdict.upsert({
      where: {
        operatorLabel_tradeDate_ticker: { operatorLabel, tradeDate, ticker: trade.ticker },
      },
      create: {
        operatorLabel,
        intent,
        tradeDate,
        ticker: trade.ticker,
        year: trade.year,
        day0Json: (trade.day0Json ?? null) as never,
        day14Json: (trade.day14Json ?? null) as never,
        day0SourcePath: trade.day0SourcePath ?? null,
        day14SourcePath: trade.day14SourcePath ?? null,
      },
      update: {
        intent,
        year: trade.year,
        day0Json: (trade.day0Json ?? null) as never,
        day14Json: (trade.day14Json ?? null) as never,
        day0SourcePath: trade.day0SourcePath ?? null,
        day14SourcePath: trade.day14SourcePath ?? null,
      },
    });
    tradesUpserted += 1;
  }

  for (const pick of screenerPicks) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(pick.pickDate) ||
      !pick.ticker ||
      !pick.screenSource
    ) {
      return NextResponse.json(
        { error: `Invalid screener pick payload for ${pick.ticker ?? "unknown"}` },
        { status: 400 },
      );
    }
    const operatorLabel = normaliseOperator(pick.operatorLabel);
    const pickDate = dateOnly(pick.pickDate);
    const ticker = pick.ticker.trim().toUpperCase();
    const screenSource = pick.screenSource.trim();
    await prisma.wikiScreenerPick.upsert({
      where: {
        operatorLabel_pickDate_ticker_screenSource: {
          operatorLabel,
          pickDate,
          ticker,
          screenSource,
        },
      },
      create: {
        operatorLabel,
        pickDate,
        ticker,
        screenSource,
        setupClassification: pick.setupClassification ?? null,
        notes: pick.notes ?? null,
        sourceUrl: pick.sourceUrl ?? null,
        convertedTradeId: pick.convertedTradeId ?? null,
      },
      update: {
        setupClassification: pick.setupClassification ?? null,
        notes: pick.notes ?? null,
        sourceUrl: pick.sourceUrl ?? null,
        convertedTradeId: pick.convertedTradeId ?? null,
      },
    });
    screenerPicksUpserted += 1;
  }

  return NextResponse.json({
    ok: true,
    auditsUpserted,
    tradesUpserted,
    screenerPicksUpserted,
  });
}
