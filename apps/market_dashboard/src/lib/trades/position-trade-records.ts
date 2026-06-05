import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export const OPEN_TRADE_STATES = ["OPEN", "SEMI-OPEN", "PLANNING"] as const;

export function brokerKey(value: string | null | undefined): string {
  const normalized = (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized.includes("moomoo") || normalized.includes("futu")) return "moomoo";
  if (normalized.includes("ibkr") || normalized.includes("interactivebrokers")) return "ibkr";
  if (normalized.includes("tiger")) return "tiger";
  return normalized || "unknown";
}

export function plainTicker(ticker: string): string {
  return ticker.replace(/^[A-Za-z]{2}\./, "").toUpperCase();
}

export function isOpenishTrade(state: string | null, pnl: unknown): boolean {
  return (state != null && OPEN_TRADE_STATES.includes(state.toUpperCase() as (typeof OPEN_TRADE_STATES)[number])) ||
    (state == null && pnl == null);
}

export function activeTradePriority(row: {
  source?: string | null;
  state?: string | null;
  pnl?: unknown;
}): number {
  const state = row.state?.toUpperCase() ?? "";
  if (row.source === "LIVE" && isOpenishTrade(row.state ?? null, row.pnl)) return 0;
  if (state === "OPEN" || (state === "" && row.pnl == null)) return 1;
  if (state === "SEMI-OPEN") return 2;
  if (state === "PLANNING") return 3;
  return 4;
}

export async function materializeOpenPositionTradeRecords(
  userId: string,
  options: { symbol?: string } = {},
): Promise<{ created: number; updated: number; skippedExisting: number }> {
  const symbol = options.symbol?.trim().toUpperCase() ?? "";
  const positions = await prisma.position.findMany({
    where: { brokerAccount: { userId } },
    include: { brokerAccount: { select: { id: true, alias: true } } },
    orderBy: { openedAt: "desc" },
  });

  let created = 0;
  let updated = 0;
  let skippedExisting = 0;

  for (const position of positions) {
    const ticker = plainTicker(position.ticker);
    if (symbol && !ticker.includes(symbol) && !position.ticker.toUpperCase().includes(symbol)) continue;

    const openRows = await prisma.tradeRecord.findMany({
      where: {
        userId,
        ticker,
        OR: [{ state: { in: [...OPEN_TRADE_STATES] } }, { state: null, pnl: null }],
      },
      select: { id: true, brokerAccountId: true, platform: true },
    });
    const existingOpenRow = openRows.find((row) =>
      row.brokerAccountId === position.brokerAccountId ||
      brokerKey(row.platform) === brokerKey(position.brokerAccount.alias)
    );
    if (existingOpenRow) {
      skippedExisting++;
      continue;
    }

    const brokerOrderId = `position:${ticker}`;
    const qty = Number(position.qty);
    const side = qty < 0 ? "Short" : "Long";
    const quantity = Math.abs(qty);
    const rawRow = {
      source: "POSITION_SNAPSHOT",
      ticker: position.ticker,
      brokerAlias: position.brokerAccount.alias,
      brokerAccountId: position.brokerAccountId,
      openedAt: position.openedAt.toISOString(),
      lastFillAt: position.lastFillAt.toISOString(),
      asOf: position.asOf.toISOString(),
    } satisfies Prisma.InputJsonObject;

    const existingMaterialized = await prisma.tradeRecord.findUnique({
      where: {
        brokerAccount_brokerOrderId: {
          brokerAccountId: position.brokerAccountId,
          brokerOrderId,
        },
      },
      select: { id: true },
    });

    await prisma.tradeRecord.upsert({
      where: {
        brokerAccount_brokerOrderId: {
          brokerAccountId: position.brokerAccountId,
          brokerOrderId,
        },
      },
      update: {
        tradeDate: position.openedAt,
        executedAt: position.openedAt,
        buyPrice: position.avgCost,
        quantity,
        side,
        state: "OPEN",
        pnl: null,
        exitPrice: null,
        platform: position.brokerAccount.alias,
        currency: position.currency,
        currencyCode: position.currency,
        pnlUsd: null,
        pnlSource: "broker",
        rawRow,
        syncedAt: new Date(),
      },
      create: {
        userId,
        connectionId: null,
        source: "BRIDGE",
        brokerAccountId: position.brokerAccountId,
        brokerOrderId,
        ticker,
        tradeDate: position.openedAt,
        executedAt: position.openedAt,
        buyPrice: position.avgCost,
        quantity,
        pnl: null,
        exitPrice: null,
        side,
        fees: null,
        notes: "Auto-created from live broker position so the journal can score the open trade.",
        rawRow,
        currency: position.currency,
        currencyCode: position.currency,
        pnlUsd: null,
        pnlSource: "broker",
        platform: position.brokerAccount.alias,
        state: "OPEN",
      },
    });
    if (existingMaterialized) updated++;
    else created++;
  }

  return { created, updated, skippedExisting };
}
