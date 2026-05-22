/**
 * POST /api/trades/import
 *
 * Machine-auth endpoint. Called by the trade-analyser Claude CLI skill after
 * scoring a trade from Google Sheets. Creates or updates the trade record in
 * Postgres and attaches the full wiki-aware verdict as a TradeVerdictHistory row.
 *
 * Auth: Authorization: Bearer <BRIEF_INGEST_KEY>
 *
 * Body shape:
 * {
 *   // ── Core trade fields (from Google Sheet columns) ──────────────────────
 *   ticker:        string               // Col B: Stock Counter
 *   tradeDate?:    string (ISO)         // Col F: Date
 *   side?:         "Long" | "Short"     // Col D
 *   buyPrice?:     number               // Col S: actual buy price
 *   quantity?:     number               // Col T: actual qty
 *   exitPrice?:    number | null        // average exit price (Col AH)
 *   pnl?:          number | null        // Col AP: P&L w/ comm
 *   fees?:         number               // Col V + Col AN
 *   notes?:        string               // Col AV
 *   state?:        string               // Col AO: OPEN | CLOSE | SEMI-OPEN | PLANNING
 *   currency?:     string               // Col C
 *   platform?:     string               // Col E
 *   industry?:     string               // Col G
 *   strategy?:     string               // Col H (setup code e.g. "EP-FRESH")
 *
 *   // ── Pre-trade plan (proposed columns) ─────────────────────────────────
 *   proposedEntry?: number              // Col J
 *   proposedSL?:    number              // Col K
 *   proposedTP?:    number              // Col L
 *   rrr?:           number              // Col P
 *   riskPct?:       number              // Col M (numeric, e.g. -1.74)
 *   rewardPct?:     number              // Col N
 *   positionPct?:   number              // Col Q
 *
 *   // ── Raw row (optional) ─────────────────────────────────────────────────
 *   rawRow?:        object              // full sheet row for re-parsing
 *
 *   // ── Wiki-aware verdict (optional) ─────────────────────────────────────
 *   verdict?:        object             // full verdict JSON from trade-analyser skill
 *   verdictScore?:   number             // composite score 0-10
 *   verdictProvider?: string            // e.g. "claude-cli-trade-analyser"
 *   verdictModel?:    string            // e.g. "claude-opus-4-5"
 *   verdictStyle?:    string            // e.g. "wiki-aware" | "trader-debate"
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   tradeId: string,
 *   action: "created" | "updated",
 *   verdictId?: string   // TradeVerdictHistory row id (if verdict was provided)
 * }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// ── Auth ────────────────────────────────────────────────────────────────────

function authorized(req: Request): boolean {
  const expected = process.env.BRIEF_INGEST_KEY;
  if (!expected) return false;
  return req.headers.get("authorization") === `Bearer ${expected}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toDecimal(v: unknown): Prisma.Decimal | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? new Prisma.Decimal(n) : null;
}

function toDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// ── Owner + connection resolution ─────────────────────────────────────────────

const SHEET_ID = "140dOBA2S9la3vfW0rir5_H_nbvbgV4uGLysHl-1o19g";
const SHEET_TAB = "T.Journal [JS]";

async function resolveOwnerConnection(): Promise<{ userId: string; connectionId: string }> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) throw new Error("OWNER_EMAIL not set — cannot resolve owner for trade import");

  const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) throw new Error(`Owner user not found for email: ${ownerEmail}`);

  // Find or create the SpreadsheetConnection for the owner
  let connection = await prisma.spreadsheetConnection.findUnique({
    where: { userId: owner.id },
  });

  if (!connection) {
    connection = await prisma.spreadsheetConnection.create({
      data: {
        userId: owner.id,
        spreadsheetId: SHEET_ID,
        sheetTab: SHEET_TAB,
        headerRow: 14,
        // Correct column mapping verified 2026-05-15:
        // B=ticker, F=date, S=buyPrice, T=qty, AP=pnl, AO=state
        colMap: {
          ticker: "B",
          date: "F",
          buyPrice: "S",
          qty: "T",
          pnl: "AP",
          exitPrice: "AH",
          side: "D",
          fees: "V",
          notes: "AV",
          state: "AO",
        },
      },
    });
  }

  return { userId: owner.id, connectionId: connection.id };
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ticker = typeof body.ticker === "string" ? body.ticker.trim().toUpperCase() : null;
  if (!ticker) {
    return NextResponse.json({ error: "ticker is required" }, { status: 400 });
  }

  // ── Resolve owner + connection ────────────────────────────────────────────
  let ownerId: string;
  let connectionId: string;
  try {
    const resolved = await resolveOwnerConnection();
    ownerId = resolved.userId;
    connectionId = resolved.connectionId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const tradeDate = toDate(body.tradeDate);

  // ── Find existing trade (match on connectionId + ticker + tradeDate) ──────
  // If tradeDate is null, match on connectionId + ticker + null date only.
  const existing = await prisma.tradeRecord.findFirst({
    where: {
      connectionId,
      ticker,
      tradeDate: tradeDate ?? null,
    },
    orderBy: { syncedAt: "desc" },
  });

  const tradeData = {
    ticker,
    tradeDate,
    side: typeof body.side === "string" ? body.side : null,
    buyPrice: toDecimal(body.buyPrice),
    quantity: toDecimal(body.quantity),
    exitPrice: toDecimal(body.exitPrice),
    pnl: toDecimal(body.pnl),
    fees: toDecimal(body.fees),
    notes: typeof body.notes === "string" ? body.notes : null,
    state: typeof body.state === "string" ? body.state : null,
    currency: typeof body.currency === "string" ? body.currency : null,
    platform: typeof body.platform === "string" ? body.platform : null,
    industry: typeof body.industry === "string" ? body.industry : null,
    strategy: typeof body.strategy === "string" ? body.strategy : null,
    proposedEntry: toDecimal(body.proposedEntry),
    proposedSL: toDecimal(body.proposedSL),
    proposedTP: toDecimal(body.proposedTP),
    rrr: toDecimal(body.rrr),
    riskPct: toDecimal(body.riskPct),
    rewardPct: toDecimal(body.rewardPct),
    positionPct: toDecimal(body.positionPct),
    rawRow: (body.rawRow as Prisma.InputJsonValue) ?? {},
    syncedAt: new Date(),
  };

  // ── Upsert trade ──────────────────────────────────────────────────────────
  let trade: { id: string };
  let action: "created" | "updated";

  if (existing) {
    trade = await prisma.tradeRecord.update({
      where: { id: existing.id },
      data: tradeData,
      select: { id: true },
    });
    action = "updated";
  } else {
    trade = await prisma.tradeRecord.create({
      data: {
        userId: ownerId,
        connectionId,
        ...tradeData,
      },
      select: { id: true },
    });
    action = "created";
  }

  // ── Attach verdict (if provided) ──────────────────────────────────────────
  let verdictId: string | undefined;
  if (body.verdict != null) {
    const verdictJson = body.verdict as Prisma.InputJsonValue;
    const verdictScore = typeof body.verdictScore === "number" ? body.verdictScore : null;
    const provider = typeof body.verdictProvider === "string" ? body.verdictProvider : "cli";
    const model = typeof body.verdictModel === "string" ? body.verdictModel : "unknown";
    const style =
      typeof body.verdictStyle === "string" ? body.verdictStyle : "wiki-aware";

    // Save in history (always, so we keep a full audit trail per run)
    const history = await prisma.tradeVerdictHistory.create({
      data: {
        tradeId: trade.id,
        ticker,
        tradeDate,
        model,
        provider,
        style,
        kind: "day-0",
        verdict: verdictJson,
        score: verdictScore,
      },
      select: { id: true },
    });
    verdictId = history.id;

    // Also update the live cache on the Trade row itself
    await prisma.tradeRecord.update({
      where: { id: trade.id },
      data: {
        verdict: verdictJson,
        verdictScore,
        verdictGeneratedAt: new Date(),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    tradeId: trade.id,
    action,
    ...(verdictId ? { verdictId } : {}),
  });
}
