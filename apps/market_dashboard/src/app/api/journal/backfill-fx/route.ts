/**
 * /api/journal/backfill-fx — recover USD P&L for legacy non-USD sheet trades
 * (TradesViz-platform P2-🄺 follow-up).
 *
 * WHY: the sheet denominates P&L in MYR at ONE fixed rate. Without that rate
 * stored, `resolveTradeUsd` fails closed (never assumes 1:1) and those rows keep
 * `pnlUsd = null` — so they are counted but EXCLUDED from every money metric
 * (pivot, stats, coaching). On the owner's book that is 93 of 216 closed trades
 * (43%) invisible to P&L analytics. This route reverses the sheet's conversion
 * for exactly those rows.
 *
 *   GET                      → DRY RUN. Never writes. Reports the stored rate,
 *                              a DETECTED rate (median |sheetMYR| / |brokerUSD|
 *                              over broker-anchored trades) with its dispersion,
 *                              the candidate count, and a preview of the impact.
 *   POST { commit: true,      → applies. `rate` overrides the stored rate for
 *          rate?: number }      this run (does NOT persist it — set that via
 *                              /api/journal/settings so sync/import use it too).
 *
 * Fails closed: with no stored AND no supplied rate it refuses to write (400).
 * A detected rate is a SUGGESTION only — it is never auto-applied, because it is
 * inferred from noisy sheet-vs-broker pairs and the operator is the authority on
 * the rate their own sheet used.
 *
 * Math is delegated to `resolveTradeUsd` (the single currency authority ladder) —
 * this route never does its own FX arithmetic.
 *
 * Auth: session; strictly the caller's OWN trades. Safe for clients to run on
 * their own book.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canSeePersonalBook, scopeUserId } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { detectFixedRate, resolveTradeUsd } from "@/lib/currency";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const cur = (t: { currencyCode: string | null; currency: string | null }) =>
  (t.currencyCode ?? t.currency ?? "").toUpperCase();

const SELECT = {
  id: true,
  ticker: true,
  pnl: true,
  pnlUsd: true,
  pnlSource: true,
  currency: true,
  currencyCode: true,
} as const;

async function loadContext(userId: string) {
  const [connection, closed] = await Promise.all([
    prisma.spreadsheetConnection.findUnique({ where: { userId }, select: { fixedFxRate: true } }),
    prisma.tradeRecord.findMany({ where: { userId, pnl: { not: null } }, select: SELECT }),
  ]);
  const storedRate = connection?.fixedFxRate != null ? Number(connection.fixedFxRate) : null;

  // Candidates: realized, non-USD, not yet converted.
  const candidates = closed.filter((t) => t.pnlUsd == null && num(t.pnl) != null && cur(t) !== "USD" && cur(t) !== "");

  // Anchors: rows whose USD side came from BROKER truth while the sheet value
  // stayed in the base currency — the only honest FX samples we have.
  const samples = closed
    .filter((t) => t.pnlSource === "broker" && num(t.pnl) != null && num(t.pnlUsd) != null)
    .map((t) => ({ sheetAbs: Math.abs(num(t.pnl)!), usdAbs: Math.abs(num(t.pnlUsd)!) }));
  const detectedRate = detectFixedRate(samples);

  return { storedRate, closed, candidates, samples, detectedRate };
}

/** Dispersion around the detected rate — how much to trust it. */
function dispersion(samples: { sheetAbs: number; usdAbs: number }[], rate: number | null) {
  if (!rate) return null;
  const ratios = samples
    .map((s) => s.sheetAbs / s.usdAbs)
    .filter((r) => Number.isFinite(r) && r > 0.5 && r < 50);
  if (!ratios.length) return null;
  const within = (p: number) => ratios.filter((r) => Math.abs(r - rate) / rate <= p).length;
  return {
    samples: ratios.length,
    withinPct2: within(0.02),
    withinPct5: within(0.05),
    withinPct10: within(0.1),
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const { storedRate, closed, candidates, samples, detectedRate } = await loadContext(userId);
  const rate = storedRate ?? null;

  // Preview only if a rate is actually stored — a detected rate is not applied.
  const preview = rate
    ? candidates.map((t) => {
        const r = resolveTradeUsd({
          ticker: t.ticker,
          rawPnl: num(t.pnl),
          fills: [],
          fixedRate: rate,
          sheetBaseCurrency: cur(t) || "MYR",
        });
        return { ticker: t.ticker, raw: num(t.pnl), currency: cur(t), pnlUsd: r.pnlUsd, pnlSource: r.pnlSource };
      })
    : [];
  const wouldWrite = preview.filter((p) => p.pnlUsd != null);
  const usdImpact = wouldWrite.reduce((s, p) => s + (p.pnlUsd ?? 0), 0);

  return NextResponse.json({
    dryRun: true,
    closedTrades: closed.length,
    alreadyConverted: closed.length - candidates.length,
    candidates: candidates.length,
    currencies: Array.from(new Set(candidates.map(cur))),
    storedRate,
    detectedRate,
    detectedDispersion: dispersion(samples, detectedRate),
    canWrite: rate != null,
    blockedReason: rate == null ? "No fixedFxRate stored. Set it via /api/journal/settings (or POST a rate here) — a detected rate is a suggestion, never auto-applied." : null,
    wouldWrite: wouldWrite.length,
    usdImpact: Math.round(usdImpact * 100) / 100,
    sample: wouldWrite.slice(0, 5),
    note: "GET never writes. POST { commit: true, rate? } to apply. Math delegated to resolveTradeUsd.",
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSeePersonalBook(session)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const userId = scopeUserId(session)!;

  const body = (await req.json().catch(() => ({}))) as { commit?: unknown; rate?: unknown };
  const override = num(body.rate);
  if (body.rate !== undefined && (override == null || override <= 0 || override >= 20)) {
    return NextResponse.json({ error: "rate must be a positive number under 20" }, { status: 400 });
  }

  const { storedRate, candidates } = await loadContext(userId);
  const rate = override ?? storedRate;
  if (rate == null) {
    return NextResponse.json(
      { error: "No FX rate available. Set fixedFxRate via /api/journal/settings or POST { rate } — never assumed 1:1." },
      { status: 400 },
    );
  }
  if (body.commit !== true) {
    return NextResponse.json({ error: "Refusing to write without { commit: true }. Use GET for a dry run." }, { status: 400 });
  }

  let updated = 0;
  let skipped = 0;
  let usdImpact = 0;
  for (const t of candidates) {
    const r = resolveTradeUsd({
      ticker: t.ticker,
      rawPnl: num(t.pnl),
      fills: [],
      fixedRate: rate,
      sheetBaseCurrency: cur(t) || "MYR",
    });
    if (r.pnlUsd == null) {
      skipped++;
      continue;
    }
    await prisma.tradeRecord.update({
      where: { id: t.id },
      data: {
        pnlUsd: new Prisma.Decimal(r.pnlUsd),
        pnlSource: r.pnlSource,
        fxRate: r.fxRate != null ? new Prisma.Decimal(r.fxRate) : null,
      },
    });
    updated++;
    usdImpact += r.pnlUsd;
  }

  return NextResponse.json({
    ok: true,
    rateUsed: rate,
    rateOrigin: override != null ? "request" : "stored",
    candidates: candidates.length,
    updated,
    skipped,
    usdImpact: Math.round(usdImpact * 100) / 100,
  });
}
