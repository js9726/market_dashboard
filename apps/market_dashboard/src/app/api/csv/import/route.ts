/**
 * POST /api/csv/import — two-step CSV trade import.
 *
 * Step 1 (preview): client sends { brokerAccountId, csvText, commit: false }
 *   → server detects broker, parses rows, returns preview + suggested mapping
 *   → no DB writes
 *
 * Step 2 (commit): client sends { brokerAccountId, csvText, commit: true, mapping?: {...} }
 *   → server parses with confirmed mapping, writes TradeFill rows
 *   → returns { imported, skipped, errors }
 *
 * Auth: session-based. Caller must own brokerAccountId.
 *
 * Idempotency: TradeFill has UNIQUE(brokerAccountId, brokerFillId). On reimport,
 * existing fills with the same brokerFillId are skipped. For CSVs without a
 * stable fill id, we generate one from sha256(ticker|side|qty|price|executedAt)
 * so the same row imported twice is deduped.
 */
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import {
  BROKER_FORMATS,
  detectBrokerFormat,
  parseCsv,
  parseNumeric,
  type BrokerFormat,
} from "@/lib/csv-broker-formats";
import { reconcileBrokerTrades } from "@/server/trade-reconciler";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type ParsedRow = {
  ticker: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  executedAt: string;
  fees: number | null;
  notes: string | null;
  // Stable identifier for dedup
  brokerFillId: string;
};

type Body = {
  brokerAccountId?: string;
  csvText?: string;
  commit?: boolean;
  formatName?: string;  // override auto-detect
};

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normaliseSide(raw: string, fmt: BrokerFormat, qtyValue: number): "BUY" | "SELL" | null {
  if (fmt.name === "IBKR Flex") {
    // IBKR uses signed quantity
    return qtyValue >= 0 ? "BUY" : "SELL";
  }
  const lower = raw.toLowerCase().trim();
  if (fmt.sideMap.buy.some((s) => lower.includes(s.toLowerCase()))) return "BUY";
  if (fmt.sideMap.sell.some((s) => lower.includes(s.toLowerCase()))) return "SELL";
  return null;
}

function normaliseTicker(raw: string, fmt: BrokerFormat): string {
  const t = raw.trim().toUpperCase();
  if (!t) return t;
  if (t.includes(".")) return t;  // already prefixed
  return fmt.defaultPrefix ? `${fmt.defaultPrefix}.${t}` : t;
}

function generateFillId(row: ParsedRow): string {
  const sig = `${row.ticker}|${row.side}|${row.qty}|${row.price}|${row.executedAt}`;
  return "csv:" + crypto.createHash("sha256").update(sig).digest("hex").slice(0, 24);
}

function parseRows(rows: string[][], fmt: BrokerFormat): { parsed: ParsedRow[]; errors: string[] } {
  if (rows.length < 2) return { parsed: [], errors: ["CSV has no data rows"] };
  const headers = rows[0].map((h) => h.trim());
  const headerIndex = (name: string) =>
    headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));

  const tickerIdx = headerIndex(fmt.map.ticker);
  const dateIdx = headerIndex(fmt.map.date);
  const sideIdx = headerIndex(fmt.map.side);
  const qtyIdx = headerIndex(fmt.map.qty);
  const priceIdx = headerIndex(fmt.map.price);
  const feeIdxs = (fmt.map.fees ?? []).map(headerIndex).filter((i) => i >= 0);

  if (tickerIdx < 0 || dateIdx < 0 || qtyIdx < 0 || priceIdx < 0) {
    return {
      parsed: [],
      errors: [`Missing required columns. Found: ${headers.join(", ")}`],
    };
  }

  const parsed: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    try {
      const rawTicker = (row[tickerIdx] ?? "").trim();
      const rawDate = (row[dateIdx] ?? "").trim();
      const rawSide = (row[sideIdx] ?? "").trim();
      const qtyRaw = parseNumeric(row[qtyIdx] ?? "");
      const priceRaw = parseNumeric(row[priceIdx] ?? "");

      if (!rawTicker || !rawDate || qtyRaw == null || priceRaw == null) {
        errors.push(`Row ${i + 1}: missing required fields`);
        continue;
      }

      const side = normaliseSide(rawSide, fmt, qtyRaw);
      if (!side) {
        errors.push(`Row ${i + 1}: could not determine side from '${rawSide}'`);
        continue;
      }

      const date = new Date(rawDate);
      if (Number.isNaN(date.getTime())) {
        errors.push(`Row ${i + 1}: unparseable date '${rawDate}'`);
        continue;
      }

      const fees = feeIdxs.reduce((sum, idx) => {
        const v = parseNumeric(row[idx] ?? "");
        return sum + Math.abs(v ?? 0);
      }, 0);

      const parsedRow: ParsedRow = {
        ticker: normaliseTicker(rawTicker, fmt),
        side,
        qty: Math.abs(qtyRaw),
        price: Math.abs(priceRaw),
        executedAt: date.toISOString(),
        fees: feeIdxs.length > 0 ? fees : null,
        notes: null,
        brokerFillId: "",  // populated below
      };
      parsedRow.brokerFillId = generateFillId(parsedRow);
      parsed.push(parsedRow);
    } catch (e) {
      errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { parsed, errors };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return err("Unauthorized", 401);
  if (!canSeePersonalBook(session)) return err("Forbidden", 403);
  const userScopeId = scopeUserId(session)!;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return err("Invalid JSON body");
  }

  if (!body.brokerAccountId || !body.csvText) {
    return err("brokerAccountId and csvText required");
  }

  // Verify ownership of the broker account
  const brokerAccount = await prisma.userBrokerAccount.findFirst({
    where: { id: body.brokerAccountId, userId: userScopeId, isActive: true },
    include: { preset: true },
  });
  if (!brokerAccount) return err("brokerAccountId not found or not owned", 403);

  const rows = parseCsv(body.csvText);
  if (rows.length === 0) return err("CSV is empty");

  // Auto-detect or use override
  let format: BrokerFormat | null = null;
  if (body.formatName) {
    format = BROKER_FORMATS.find((f) => f.name === body.formatName) ?? null;
    if (!format) return err(`Unknown formatName '${body.formatName}'`);
  } else {
    format = detectBrokerFormat(rows[0]);
    if (!format) {
      return NextResponse.json({
        ok: false,
        detected: null,
        headers: rows[0],
        message: "Could not auto-detect broker format. Specify formatName explicitly.",
        availableFormats: BROKER_FORMATS.map((f) => f.name),
      });
    }
  }

  const { parsed, errors } = parseRows(rows, format);

  if (!body.commit) {
    // Preview only
    return NextResponse.json({
      ok: true,
      detected: format.name,
      rows: parsed.slice(0, 20),
      totalRows: parsed.length,
      errors,
      preview: true,
    });
  }

  // Commit: insert TradeFills + upsert Positions
  const currency = brokerAccount.displayCurrency ?? brokerAccount.preset.currency;
  let imported = 0;
  let skipped = 0;
  const commitErrors: string[] = [...errors];

  for (const row of parsed) {
    try {
      // Skip if a fill with the same id already exists for this account
      const existing = await prisma.tradeFill.findUnique({
        where: {
          brokerAccount_brokerFillId: {
            brokerAccountId: brokerAccount.id,
            brokerFillId: row.brokerFillId,
          },
        },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await prisma.tradeFill.create({
        data: {
          brokerAccountId: brokerAccount.id,
          brokerFillId: row.brokerFillId,
          ticker: row.ticker,
          side: row.side,
          qty: new Prisma.Decimal(row.qty),
          price: new Prisma.Decimal(row.price),
          executedAt: new Date(row.executedAt),
          fees: row.fees != null ? new Prisma.Decimal(row.fees) : null,
          currency,
          source: "CSV",
        },
      });

      // Upsert Position
      const existingPos = await prisma.position.findUnique({
        where: { brokerAccountId_ticker: { brokerAccountId: brokerAccount.id, ticker: row.ticker } },
      });
      if (row.side === "BUY") {
        if (existingPos) {
          const oldQty = Number(existingPos.qty);
          const oldCost = Number(existingPos.avgCost);
          const newQty = oldQty + row.qty;
          const newCost = newQty > 0 ? (oldQty * oldCost + row.qty * row.price) / newQty : row.price;
          await prisma.position.update({
            where: { id: existingPos.id },
            data: {
              qty: new Prisma.Decimal(newQty),
              avgCost: new Prisma.Decimal(newCost),
              lastFillAt: new Date(row.executedAt),
              asOf: new Date(),
            },
          });
        } else {
          await prisma.position.create({
            data: {
              brokerAccountId: brokerAccount.id,
              ticker: row.ticker,
              qty: new Prisma.Decimal(row.qty),
              avgCost: new Prisma.Decimal(row.price),
              currency,
              openedAt: new Date(row.executedAt),
              lastFillAt: new Date(row.executedAt),
            },
          });
        }
      } else {
        if (existingPos) {
          const newQty = Number(existingPos.qty) - row.qty;
          if (newQty <= 0.0001) {
            await prisma.position.delete({ where: { id: existingPos.id } });
          } else {
            await prisma.position.update({
              where: { id: existingPos.id },
              data: {
                qty: new Prisma.Decimal(newQty),
                lastFillAt: new Date(row.executedAt),
                asOf: new Date(),
              },
            });
          }
        }
      }

      imported++;
    } catch (e) {
      commitErrors.push(`${row.ticker} ${row.side}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Reconcile fills → journal TradeRecords for THIS account immediately, so the
  // imported trades appear in the journal right away instead of waiting for the
  // nightly reconcile cron (client-beta Phase 0 fix). Best-effort — the import
  // itself already succeeded; the nightly run remains the backstop.
  let journalled: { created: number; linked: number; closed: number } | null = null;
  try {
    const rec = await reconcileBrokerTrades({ brokerAccountId: brokerAccount.id });
    journalled = { created: rec.recordsCreated, linked: rec.fillsLinked, closed: rec.recordsClosed };
  } catch (e) {
    commitErrors.push(`journal reconcile deferred to nightly run: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Remember mapping for next time
  try {
    await prisma.csvImportMapping.upsert({
      where: { userId_brokerName: { userId: userScopeId, brokerName: format.name } },
      create: {
        userId: userScopeId,
        brokerName: format.name,
        columnMap: format.map as unknown as Prisma.InputJsonValue,
      },
      update: { columnMap: format.map as unknown as Prisma.InputJsonValue },
    });
  } catch {
    // mapping persist is best-effort; never fail the import on this
  }

  return NextResponse.json({
    ok: true,
    detected: format.name,
    imported,
    skipped,
    journalled,
    errors: commitErrors.slice(0, 50),
  });
}
