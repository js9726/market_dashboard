/**
 * journal-sync.ts — shared sheet→DB sync core (TradesViz-platform, 2026-07-16).
 * Used by BOTH:
 *   - POST /api/journal/sync        (manual Sync button, session-scoped)
 *   - GET  /api/cron/sync-journal   (nightly machine sync, all connected users)
 *
 * Wipe-and-recreate of the connection's TradeRecords from the sheet, with:
 *   - write-time USD conversion via the stored fixed FX rate (resolveTradeUsd)
 *   - WEEKEND-ROLL normalization of entry dates (operator-approved 2026-07-13/16):
 *     the operator plans on weekends and records the PLAN date, but markets are
 *     shut — a Sunday/Saturday entry date is a recorded-date error. Sundays roll
 *     +1 to Monday; Saturdays roll +2 to Monday; US tickers roll past US market
 *     holidays (e.g. Sat 2026-02-14 → Tue 2026-02-17, Presidents' Day Monday).
 *     `.KL` (Bursa) rows roll to Monday only — no Bursa holiday calendar is
 *     maintained (documented limitation). The raw sheet row is preserved
 *     verbatim in `rawRow`, so the original date stays auditable.
 */
import { prisma } from "@/lib/prisma";
import { getGoogleAccessToken } from "@/lib/token-refresh";
import { fetchSheetRows, parseTradeRows, DEFAULT_COL_MAP, type ColMap } from "@/lib/google-sheets";
import { resolveTradeUsd } from "@/lib/currency";

export class JournalSyncError extends Error {
  constructor(
    message: string,
    public readonly code: "NO_CONNECTION" | "REAUTH_REQUIRED" | "GOOGLE_AUTH" | "SHEETS_FETCH" | "DB_WRITE",
  ) {
    super(message);
  }
}

// ── US market holiday check (roll-target correctness) ────────────────────────
// Only holidays that can BE a roll target matter (Mondays/Tuesdays reached from
// a weekend date): the four formula Mondays + fixed-date holidays observed on
// Monday when they fall on Sunday. Good Friday/Thanksgiving can never be a
// Monday, so they are irrelevant here.
function nthMondayOfMonth(year: number, month0: number, n: number): number {
  const first = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const firstMonday = 1 + ((8 - first) % 7);
  return firstMonday + (n - 1) * 7;
}
function lastMondayOfMonth(year: number, month0: number): number {
  const lastDate = new Date(Date.UTC(year, month0 + 1, 0));
  return lastDate.getUTCDate() - ((lastDate.getUTCDay() + 6) % 7);
}
export function isUsMarketHoliday(d: Date): boolean {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const dow = d.getUTCDay();
  // Formula Mondays: MLK (3rd Mon Jan), Presidents (3rd Mon Feb),
  // Memorial (last Mon May), Labor (1st Mon Sep).
  if (dow === 1) {
    if (m === 0 && day === nthMondayOfMonth(y, 0, 3)) return true;
    if (m === 1 && day === nthMondayOfMonth(y, 1, 3)) return true;
    if (m === 4 && day === lastMondayOfMonth(y, 4)) return true;
    if (m === 8 && day === nthMondayOfMonth(y, 8, 1)) return true;
  }
  // Fixed-date holidays (New Year, Juneteenth, Independence, Christmas):
  // the date itself, or Monday observance when the holiday fell on Sunday.
  const fixed: Array<[number, number]> = [
    [0, 1],
    [5, 19],
    [6, 4],
    [11, 25],
  ];
  for (const [fm, fd] of fixed) {
    if (m === fm && day === fd) return true;
    if (dow === 1 && m === fm && day === fd + 1) {
      const actual = new Date(Date.UTC(y, fm, fd));
      if (actual.getUTCDay() === 0) return true; // Sun holiday → Mon observed
    }
  }
  return false;
}

/** Roll a weekend-dated ENTRY date forward to the next real trading day. */
export function rollWeekendEntryDate(date: Date, ticker: string): { date: Date; rolled: boolean } {
  const dow = date.getUTCDay();
  if (dow !== 0 && dow !== 6) return { date, rolled: false };
  let d = new Date(date.getTime() + (dow === 0 ? 1 : 2) * 86400000); // → Monday
  if (!ticker.toUpperCase().endsWith(".KL")) {
    // US names: skip market holidays (e.g. Presidents' Day Monday → Tuesday).
    let guard = 0;
    while (isUsMarketHoliday(d) && guard++ < 3) d = new Date(d.getTime() + 86400000);
  }
  return { date: d, rolled: true };
}

export interface JournalSyncResult {
  synced: number;
  open: number;
  closed: number;
  datesResolved: number;
  weekendRolled: number;
  sampleRawDates: string[];
  connectionId: string;
}

export async function syncUserJournal(userId: string): Promise<JournalSyncResult> {
  const connection = await prisma.spreadsheetConnection.findUnique({ where: { userId } });
  if (!connection) throw new JournalSyncError("No spreadsheet connected", "NO_CONNECTION");

  let accessToken: string;
  try {
    accessToken = await getGoogleAccessToken(userId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new JournalSyncError(msg, msg === "REAUTH_REQUIRED" ? "REAUTH_REQUIRED" : "GOOGLE_AUTH");
  }

  const colMap: ColMap = Object.keys(connection.colMap as object).length
    ? (connection.colMap as ColMap)
    : DEFAULT_COL_MAP;

  let rows: string[][];
  try {
    rows = await fetchSheetRows(connection.spreadsheetId, connection.sheetTab, connection.headerRow, accessToken);
  } catch (e) {
    throw new JournalSyncError(e instanceof Error ? e.message : String(e), "SHEETS_FETCH");
  }

  const trades = parseTradeRows(rows, colMap);
  const fixedRate = connection.fixedFxRate != null ? Number(connection.fixedFxRate) : null;

  let weekendRolled = 0;
  const data = trades.map((t) => {
    let tradeDate = t.tradeDate;
    if (tradeDate) {
      const roll = rollWeekendEntryDate(tradeDate, t.ticker);
      if (roll.rolled) {
        tradeDate = roll.date;
        weekendRolled++;
      }
    }
    const usd = resolveTradeUsd({ ticker: t.ticker, rawPnl: t.pnl, fixedRate, sheetBaseCurrency: "MYR" });
    return {
      userId,
      connectionId: connection.id,
      ticker: t.ticker,
      tradeDate,
      buyPrice: t.buyPrice,
      quantity: t.quantity,
      pnl: t.pnl,
      pnlUsd: usd.pnlUsd,
      currencyCode: usd.currencyCode,
      fxRate: usd.fxRate,
      pnlSource: usd.pnlSource,
      exitPrice: t.exitPrice,
      side: t.side,
      fees: t.fees,
      notes: t.notes,
      rawRow: t.rawRow,
      proposedEntry: t.proposedEntry,
      proposedSL: t.proposedSL,
      proposedTP: t.proposedTP,
      rrr: t.rrr,
      riskPct: t.riskPct,
      rewardPct: t.rewardPct,
      positionPct: t.positionPct,
      currency: t.currency,
      platform: t.platform,
      industry: t.industry,
      strategy: t.strategy,
      state: t.state,
    };
  });

  try {
    await prisma.$transaction([
      prisma.tradeRecord.deleteMany({ where: { connectionId: connection.id } }),
      prisma.tradeRecord.createMany({ data }),
      prisma.spreadsheetConnection.update({ where: { id: connection.id }, data: { lastSyncedAt: new Date() } }),
    ]);
  } catch (e) {
    throw new JournalSyncError(e instanceof Error ? e.message : String(e), "DB_WRITE");
  }

  const OPEN_STATES = ["OPEN", "SEMI-OPEN", "PLANNING"];
  const open = trades.filter((t) => (t.state ? OPEN_STATES.includes(t.state.toUpperCase()) : t.pnl === null)).length;
  return {
    synced: trades.length,
    open,
    closed: trades.length - open,
    datesResolved: trades.filter((t) => t.tradeDate !== null).length,
    weekendRolled,
    sampleRawDates: rows.slice(1, 4).map((r) => r[colMap.date]),
    connectionId: connection.id,
  };
}
