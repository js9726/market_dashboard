import { google } from "googleapis";
export type { ColMap } from "./col-map";
export { DEFAULT_COL_MAP } from "./col-map";
import type { ColMap } from "./col-map";

export type RawTrade = {
  ticker: string;
  tradeDate: Date | null;
  buyPrice: number | null;
  quantity: number | null;
  pnl: number | null;
  exitPrice: number | null;
  side: string | null;
  fees: number | null;
  notes: string | null;
  rawRow: string[];
};

function makeClient(accessToken: string) {
  const oauth2 = new google.auth.OAuth2();
  oauth2.setCredentials({ access_token: accessToken });
  return google.sheets({ version: "v4", auth: oauth2 });
}

function parseNum(val: string | undefined): number | null {
  if (!val || val.trim() === "" || val.trim() === "-") return null;
  const cleaned = val.replace(/[$,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

function parseDate(val: string | undefined): Date | null {
  if (!val || val.trim() === "") return null;
  const s = val.trim();

  // YYYYMMDD with no separators (e.g. "20260124")
  if (/^\d{8}$/.test(s)) {
    const d = new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`);
    if (!isNaN(d.getTime())) return d;
  }

  // DD/MM/YY or DD/MM/YYYY (e.g. "28/01/25" or "28/01/2025")
  const ddmmyy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (ddmmyy) {
    const year = ddmmyy[3].length === 2 ? `20${ddmmyy[3]}` : ddmmyy[3];
    const d = new Date(`${year}-${ddmmyy[2].padStart(2, "0")}-${ddmmyy[1].padStart(2, "0")}`);
    if (!isNaN(d.getTime())) return d;
  }

  // Google Sheets serial number (days since Dec 30 1899; range 30000–100000 covers ~1982–2173)
  if (/^\d+$/.test(s)) {
    const serial = Number(s);
    if (serial > 30000 && serial < 100000) {
      const d = new Date((serial - 25569) * 86400000);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Standard parsing — ISO 8601, US MM/DD/YYYY, "Jan 24, 2026", etc.
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export async function fetchSheetRows(
  spreadsheetId: string,
  sheetTab: string,
  fromRow: number,
  accessToken: string
): Promise<string[][]> {
  const sheets = makeClient(accessToken);
  const range = `'${sheetTab}'!A${fromRow}:AZ`;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return (res.data.values as string[][] | null) ?? [];
}

export async function listSpreadsheetTabs(
  spreadsheetId: string,
  accessToken: string
): Promise<{ title: string; sheetId: number }[]> {
  const sheets = makeClient(accessToken);
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,sheetId)",
  });
  return (res.data.sheets ?? []).map((s) => ({
    title: s.properties?.title ?? "",
    sheetId: s.properties?.sheetId ?? 0,
  }));
}

export function parseTradeRows(rows: string[][], colMap: ColMap): RawTrade[] {
  // rows[0] is the header row — skip it
  const dataRows = rows.slice(1);
  const trades: RawTrade[] = [];

  for (const row of dataRows) {
    const ticker = row[colMap.ticker]?.trim() ?? "";
    if (!ticker) continue;

    trades.push({
      ticker,
      tradeDate: parseDate(row[colMap.date]),
      buyPrice: parseNum(row[colMap.buyPrice]),
      quantity: parseNum(row[colMap.quantity]),
      pnl: parseNum(row[colMap.pnl]),
      exitPrice: colMap.exitPrice !== null ? parseNum(row[colMap.exitPrice]) : null,
      side: colMap.side !== null ? (row[colMap.side]?.trim() || null) : null,
      fees: colMap.fees !== null ? parseNum(row[colMap.fees]) : null,
      notes: colMap.notes !== null ? (row[colMap.notes]?.trim() || null) : null,
      rawRow: row,
    });
  }

  return trades;
}

export async function appendTradeRow(
  spreadsheetId: string,
  sheetTab: string,
  colMap: ColMap,
  trade: {
    ticker: string;
    tradeDate: string;
    side: string | null;
    buyPrice: string;
    quantity: string;
    exitPrice: string;
    pnl: string;
    fees: string;
    notes: string;
  },
  accessToken: string
): Promise<void> {
  const sheets = makeClient(accessToken);

  // Determine the max column index we need to fill
  const colIndices = [
    colMap.ticker,
    colMap.date,
    colMap.buyPrice,
    colMap.quantity,
    colMap.pnl,
    colMap.exitPrice,
    colMap.side,
    colMap.fees,
    colMap.notes,
  ].filter((c): c is number => c !== null);
  const maxCol = Math.max(...colIndices);

  // Build sparse row array
  const row: string[] = new Array(maxCol + 1).fill("");
  row[colMap.ticker] = trade.ticker;
  row[colMap.date] = trade.tradeDate;
  row[colMap.buyPrice] = trade.buyPrice;
  row[colMap.quantity] = trade.quantity;
  row[colMap.pnl] = trade.pnl;
  if (colMap.exitPrice !== null) row[colMap.exitPrice] = trade.exitPrice;
  if (colMap.side !== null && trade.side) row[colMap.side] = trade.side;
  if (colMap.fees !== null) row[colMap.fees] = trade.fees;
  if (colMap.notes !== null) row[colMap.notes] = trade.notes;

  const range = `'${sheetTab}'!A:AZ`;
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
}
