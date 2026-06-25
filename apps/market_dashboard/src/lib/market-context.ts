/**
 * market-context.ts — the market backdrop ("the tape") captured at a moment in
 * time, so an A-list pick records what the market was doing on its entry day and
 * again on its exit day. That lets the page answer "was the loss the pick, or the
 * tape?" — a red trade in a −2% breadth-collapse tape reads very differently from
 * one in a green tape.
 *
 * Fields: SPY/QQQ daily %, advance/decline breadth (from the latest breadth
 * snapshot), and CNN Fear & Greed. All best-effort + null-safe; a missing source
 * leaves that field null rather than blocking the capture. Cached ~10 min so a
 * single cron run capturing many candidates does the fetches once.
 */
import { prisma } from "@/lib/prisma";
import { fetchFearGreed } from "@/lib/fear-greed";

export interface MarketContext {
  spyChg: number | null;
  qqqChg: number | null;
  breadthAdvance: number | null;
  breadthDecline: number | null;
  fearGreed: number | null;
  fearGreedLabel: string | null;
  asOf: string; // ISO capture time
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Last-bar daily % change for a liquid index ETF (Yahoo; single call). */
async function indexDayChange(symbol: string): Promise<number | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      chart?: { result?: Array<{ indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> };
    };
    const closes = (j.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []).filter(
      (x): x is number => typeof x === "number" && Number.isFinite(x),
    );
    if (closes.length < 2) return null;
    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    return prev > 0 ? Number((((last - prev) / prev) * 100).toFixed(2)) : null;
  } catch {
    return null;
  }
}

let cache: { value: MarketContext; at: number } | null = null;
const TTL_MS = 10 * 60 * 1000;

/** The market backdrop right now (cached ~10 min). */
export async function marketContextNow(now: number = Date.now()): Promise<MarketContext> {
  if (cache && now - cache.at < TTL_MS) return cache.value;

  const [spy, qqq, fg, breadthRow] = await Promise.all([
    indexDayChange("SPY"),
    indexDayChange("QQQ"),
    fetchFearGreed(now),
    prisma.marketBreadthSnapshot.findFirst({ orderBy: { refreshedAt: "desc" } }).catch(() => null),
  ]);

  const market = ((breadthRow?.snapshot as Record<string, unknown> | undefined)?.market ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const value: MarketContext = {
    spyChg: spy,
    qqqChg: qqq,
    breadthAdvance: num(market.advance),
    breadthDecline: num(market.decline),
    fearGreed: fg?.score ?? null,
    fearGreedLabel: fg?.label ?? null,
    asOf: new Date(now).toISOString(),
  };
  cache = { value, at: now };
  return value;
}
