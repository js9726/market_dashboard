/**
 * Bridge sync endpoint — Phase 3.
 *
 * POST /api/bridge/sync
 *
 * Auth:
 *   Authorization: Bearer <plaintext-token>
 *   X-Timestamp:   <unix-seconds>
 *
 *   Server hashes the bearer token and looks up BrokerBridgeToken by hash.
 *   Timestamp must be within ±300 seconds of server time (replay protection).
 *
 * Body:
 *   {
 *     brokerAccountAlias: string,         // matches UserBrokerAccount.alias for the user
 *     brokerType:         string,         // for diagnostics (e.g. "MOOMOO_FUTUMY")
 *     syncedAt:           string (ISO),
 *     positions: [
 *       { ticker, qty, avgCost, currency }
 *     ],
 *     fills: [
 *       { brokerFillId, ticker, side, qty, price, executedAt, fees?, currency? }
 *     ]
 *   }
 *
 * Side effects:
 *   - Upserts UserBrokerAccount by alias (if no row exists, returns 404 — user
 *     must create the account in /dashboard/settings/brokers first).
 *   - Inserts new TradeFill rows (dedup on brokerFillId).
 *   - Replaces Position rows for the account (bridge is authoritative — the
 *     broker knows truth).
 *   - Updates BrokerBridgeToken.lastHeartbeat.
 *
 * Response:
 *   { ok, fillsInserted, fillsSkipped, positionsUpserted, positionsRemoved }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const TIMESTAMP_TOLERANCE_SEC = 300;  // ±5 minutes

type IncomingFill = {
  brokerFillId: string;
  ticker: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  executedAt: string;
  fees?: number | null;
  currency?: string;
};

type IncomingPosition = {
  ticker: string;
  qty: number;
  avgCost: number;
  currency: string;
};

type IncomingEquity = {
  snapshotDate: string; // YYYY-MM-DD
  totalAssets: number;
  cash: number;
  marketVal: number;
  unrealizedPl?: number | null;
  realizedPlDay?: number | null;
  equityPctChange?: number | null;
  currencyCode?: string;
};

type Body = {
  brokerAccountAlias?: string;
  brokerType?: string;
  syncedAt?: string;
  positions?: IncomingPosition[];
  fills?: IncomingFill[];
  /** Phase 4 — daily equity snapshot. Optional for backward-compat. */
  equity?: IncomingEquity | null;
};

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function hashToken(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex");
}

export async function POST(req: Request) {
  // ── Auth: bearer token + timestamp ──────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const tsHeader = req.headers.get("x-timestamp") ?? "";
  if (!authHeader.startsWith("Bearer ")) return err("Bearer token required", 401);
  if (!tsHeader) return err("X-Timestamp header required", 401);

  const plaintextToken = authHeader.slice("Bearer ".length).trim();
  if (!plaintextToken) return err("Empty token", 401);

  const ts = Number(tsHeader);
  if (!Number.isFinite(ts)) return err("Invalid timestamp", 401);
  const drift = Math.abs(Math.floor(Date.now() / 1000) - ts);
  if (drift > TIMESTAMP_TOLERANCE_SEC) {
    return err(`Timestamp drift ${drift}s exceeds tolerance ${TIMESTAMP_TOLERANCE_SEC}s`, 401);
  }

  const tokenHash = hashToken(plaintextToken);
  const tokenRow = await prisma.brokerBridgeToken.findUnique({
    where: { tokenHash },
    include: { user: { select: { id: true, role: true } } },
  });
  if (!tokenRow || tokenRow.revokedAt) return err("Invalid or revoked token", 401);

  // ── Validate body ───────────────────────────────────────────────────────
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return err("Invalid JSON body");
  }

  const alias = body.brokerAccountAlias;
  if (!alias || typeof alias !== "string") return err("brokerAccountAlias required");
  if (!Array.isArray(body.positions)) return err("positions array required");
  if (!Array.isArray(body.fills)) return err("fills array required");

  // ── Resolve UserBrokerAccount ──────────────────────────────────────────
  const account = await prisma.userBrokerAccount.findFirst({
    where: { userId: tokenRow.userId, alias, isActive: true },
    include: { preset: true },
  });
  if (!account) {
    return err(
      `No active broker account with alias '${alias}' for this user. Create it in /dashboard/settings/brokers first.`,
      404,
    );
  }

  const accountCurrency = account.displayCurrency ?? account.preset.currency;

  // ── Insert new fills (dedup on brokerFillId) ────────────────────────────
  let fillsInserted = 0;
  let fillsSkipped = 0;
  let fillsFeeUpdated = 0;

  for (const f of body.fills) {
    try {
      if (!f.brokerFillId || !f.ticker || !f.side || f.qty == null || f.price == null) {
        fillsSkipped++;
        continue;
      }
      const existing = await prisma.tradeFill.findUnique({
        where: {
          brokerAccount_brokerFillId: {
            brokerAccountId: account.id,
            brokerFillId: f.brokerFillId,
          },
        },
      });
      if (existing) {
        // Backfill a late-arriving fee onto an already-stored fill (a deal can
        // sync before its order fee is finalized by the broker).
        if (existing.fees == null && f.fees != null) {
          await prisma.tradeFill.update({
            where: { id: existing.id },
            data: { fees: new Prisma.Decimal(f.fees) },
          });
          fillsFeeUpdated++;
        }
        fillsSkipped++;
        continue;
      }
      await prisma.tradeFill.create({
        data: {
          brokerAccountId: account.id,
          brokerFillId: f.brokerFillId,
          ticker: f.ticker.toUpperCase(),
          side: f.side.toUpperCase(),
          qty: new Prisma.Decimal(Math.abs(f.qty)),
          price: new Prisma.Decimal(f.price),
          executedAt: new Date(f.executedAt),
          fees: f.fees != null ? new Prisma.Decimal(f.fees) : null,
          currency: f.currency ?? accountCurrency,
          source: "BRIDGE",
        },
      });
      fillsInserted++;
    } catch (e) {
      console.error("[bridge/sync] fill insert failed:", e);
      fillsSkipped++;
    }
  }

  // ── Replace Position snapshot (bridge is authoritative) ─────────────────
  // Strategy: full replace per (brokerAccountId, ticker) — upsert each incoming
  // position, then delete any rows for this account that aren't in the payload.
  const incomingTickers = new Set<string>();
  let positionsUpserted = 0;
  const now = new Date();

  for (const p of body.positions) {
    if (!p.ticker || p.qty == null || p.avgCost == null) continue;
    const ticker = p.ticker.toUpperCase();
    incomingTickers.add(ticker);

    try {
      await prisma.position.upsert({
        where: {
          brokerAccountId_ticker: {
            brokerAccountId: account.id,
            ticker,
          },
        },
        create: {
          brokerAccountId: account.id,
          ticker,
          qty: new Prisma.Decimal(p.qty),
          avgCost: new Prisma.Decimal(p.avgCost),
          currency: p.currency ?? accountCurrency,
          openedAt: now,
          lastFillAt: now,
          asOf: now,
        },
        update: {
          qty: new Prisma.Decimal(p.qty),
          avgCost: new Prisma.Decimal(p.avgCost),
          currency: p.currency ?? accountCurrency,
          asOf: now,
        },
      });
      positionsUpserted++;
    } catch (e) {
      console.error("[bridge/sync] position upsert failed:", e);
    }
  }

  // Delete positions for this account that the broker no longer reports
  const removed = await prisma.position.deleteMany({
    where: {
      brokerAccountId: account.id,
      ticker: { notIn: Array.from(incomingTickers) },
    },
  });

  // ── Phase 4: equity snapshot (optional, best-effort) ────────────────────
  // Upserts on (userId, brokerAccountId, snapshotDate). Latest capture per
  // day wins — bridge runs every 60s, so the final snapshot before the user
  // closes their PC is what the /equity timeline shows for that day.
  let equityUpserted = false;
  if (body.equity && body.equity.snapshotDate && body.equity.totalAssets != null) {
    try {
      const e = body.equity;
      // Normalize snapshotDate to UTC midnight for clean date-keyed grouping.
      const snapshotDate = new Date(`${e.snapshotDate}T00:00:00.000Z`);
      const data = {
        userId: tokenRow.userId,
        brokerAccountId: account.id,
        snapshotDate,
        capturedAt: now,
        totalAssets: new Prisma.Decimal(e.totalAssets),
        cash: new Prisma.Decimal(e.cash),
        marketVal: new Prisma.Decimal(e.marketVal),
        unrealizedPl: e.unrealizedPl != null ? new Prisma.Decimal(e.unrealizedPl) : null,
        realizedPlDay: e.realizedPlDay != null ? new Prisma.Decimal(e.realizedPlDay) : null,
        equityPctChange: e.equityPctChange != null ? new Prisma.Decimal(e.equityPctChange) : null,
        currencyCode: e.currencyCode ?? accountCurrency,
        source: "moomoo",
      };
      await prisma.equitySnapshot.upsert({
        where: {
          userId_brokerAccountId_snapshotDate: {
            userId: tokenRow.userId,
            brokerAccountId: account.id,
            snapshotDate,
          },
        },
        create: data,
        update: {
          capturedAt: data.capturedAt,
          totalAssets: data.totalAssets,
          cash: data.cash,
          marketVal: data.marketVal,
          unrealizedPl: data.unrealizedPl,
          realizedPlDay: data.realizedPlDay,
          equityPctChange: data.equityPctChange,
          currencyCode: data.currencyCode,
        },
      });
      equityUpserted = true;
    } catch (e) {
      console.error("[bridge/sync] equity upsert failed (non-fatal):", e);
    }
  }

  // ── Heartbeat ──────────────────────────────────────────────────────────
  await prisma.brokerBridgeToken.update({
    where: { id: tokenRow.id },
    data: { lastHeartbeat: now },
  });

  return NextResponse.json({
    ok: true,
    fillsInserted,
    fillsSkipped,
    fillsFeeUpdated,
    positionsUpserted,
    positionsRemoved: removed.count,
    equityUpserted,
  });
}
