/**
 * trade-snapshot.ts — entry-date market-context builder (WS3, 2026-06).
 *
 * Replaces the v0 all-null `snapshotFromTrade()`. Given a trade's entry date +
 * industry, it pulls the market regime, mood/posture, and sector/industry theme
 * that existed AT THE TIME OF THE TRADE so the 7-trader rubric / agent pipeline
 * can score the entry against the conditions it was actually taken in.
 *
 * Sources (all DB-backed, one row per trading day):
 *   - MarketBreadthSnapshot.snapshot  → sentiment (advance/decline), %>50DMA,
 *                                        sector + industry breadth.
 *   - MorningBriefCache.structuredJson → mood label + posture, sector/industry
 *                                        momentum, hot-theme radar.
 *   - ScreenerSnapshot.snapshot        → industry momentum overlay (Perf.1M/W of
 *                                        the ticker's industry peers that day).
 *
 * FAIL-CLOSED CONTRACT: when the snapshot for the entry date is missing (no row
 * on or before that date), the corresponding factor is left `null` and a note is
 * pushed to `contextNotes`. We NEVER fabricate a value or fall back to "today".
 *
 * The function only EXTENDS the existing SnapshotInput shape (technical fields
 * stay null here — they are PR-2 territory). It is safe to feed straight into
 * the agent-moderator prompt or the trader-debate scorer.
 */
import { prisma } from "@/lib/prisma";
import type { SnapshotInput } from "@/lib/agent-moderator/handler";
import type { BreadthSnapshot } from "@/types/breadth";
import type {
  StructuredBrief,
  BriefSectorTheme,
  BriefIndustryMover,
} from "@/types/structured-brief";

/** Screener snapshot file shape (mirrors server/screener-scanner ScreenerFile). */
interface ScreenerFileLike {
  fetched_at?: string;
  screeners?: { id?: string; name?: string; hits?: Record<string, unknown>[] }[];
}

export type TradeSnapshotInput = {
  ticker: string;
  /** Entry date — the day the snapshot is keyed on. */
  tradeDate?: Date | string | null;
  /** Ticker's industry (from TradeRecord.industry); used for theme matching. */
  industry?: string | null;
  /** Ticker's sector if known (rarely on the row; optional). */
  sector?: string | null;
};

/** Normalise a Date/string into a UTC midnight `Date` (or null). */
function toUtcDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function lc(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

/** Case-insensitive contains either way (handles "Semiconductors" vs "Semiconductor"). */
function loosely(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = lc(a);
  const y = lc(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** Map advance/decline counts into a coarse risk regime label. */
function sentimentFromAdvanceDecline(
  advance: number | null,
  decline: number | null,
): "risk-on" | "risk-off" | "mixed" | null {
  if (advance == null || decline == null) return null;
  const total = advance + decline;
  if (total <= 0) return null;
  const upShare = advance / total;
  if (upShare >= 0.6) return "risk-on";
  if (upShare <= 0.4) return "risk-off";
  return "mixed";
}

/**
 * Build the entry-date market-context snapshot. Returns an extended SnapshotInput
 * (technical fields null — populated by a later PR) plus `contextNotes` listing
 * every producer that had no data for the entry date.
 */
export async function buildTradeSnapshot(
  trade: TradeSnapshotInput,
): Promise<SnapshotInput> {
  const contextNotes: string[] = [];

  const entryDate = toUtcDate(trade.tradeDate);
  const dayLabel = entryDate ? isoDay(entryDate) : "unknown date";

  // Start from the existing all-null technical shape so callers/types are happy.
  const snapshot: SnapshotInput = {
    currentPrice: null,
    rsi14: null,
    macdSignal: null,
    emaHierarchy: null,
    adx: null,
    volumeRatio: null,
    atrPct: null,
    earningsDays: null,
    halts90d: null,
    sector: trade.sector ?? null,
    industry: trade.industry ?? null,
    // Entry-date context (filled below; null until proven).
    marketSentiment: null,
    breadthPctAbove50: null,
    advanceDecline: null,
    marketMood: null,
    marketPosture: null,
    sectorMomentumPct: null,
    industryMomentumPct: null,
    themeOnRadar: null,
    themeNote: null,
    contextNotes: null,
  };

  if (!entryDate) {
    contextNotes.push("no entry date on trade — market context not keyed");
    snapshot.contextNotes = contextNotes;
    return snapshot;
  }

  // Run the three lookups in parallel. Each is "row whose bucketDate is on/before
  // the entry date" — i.e. the freshest snapshot that existed at entry time.
  const [breadthRow, briefRow, screenerRow] = await Promise.all([
    prisma.marketBreadthSnapshot.findFirst({
      where: { bucketDate: { lte: entryDate } },
      orderBy: { bucketDate: "desc" },
    }),
    prisma.morningBriefCache.findFirst({
      where: { bucketAt: { lte: new Date(entryDate.getTime() + 24 * 60 * 60 * 1000 - 1) }, structuredJson: { not: null as never } },
      orderBy: { bucketAt: "desc" },
    }),
    prisma.screenerSnapshot.findFirst({
      where: { bucketDate: { lte: entryDate } },
      orderBy: { bucketDate: "desc" },
    }),
  ]);

  // ── 1. Market sentiment + breadth (MarketBreadthSnapshot) ──────────────────
  if (breadthRow) {
    const b = breadthRow.snapshot as unknown as BreadthSnapshot;
    const advance = num(b?.market?.advance);
    const decline = num(b?.market?.decline);
    snapshot.advanceDecline = { advance, decline };
    snapshot.marketSentiment = sentimentFromAdvanceDecline(advance, decline);

    // Universe-wide %>50DMA: weighted average of sector rows (n-weighted) — the
    // breadth snapshot doesn't store a single scalar, so derive it.
    const sectors = Array.isArray(b?.sectors) ? b.sectors : [];
    const totalN = sectors.reduce((s, r) => s + (num(r.n) ?? 0), 0);
    if (totalN > 0) {
      const weighted = sectors.reduce(
        (s, r) => s + (num(r.pct_above_50sma) ?? 0) * (num(r.n) ?? 0),
        0,
      );
      snapshot.breadthPctAbove50 = Math.round((weighted / totalN) * 10) / 10;
    }

    // Sector + industry momentum from breadth %>50DMA for the ticker's groups.
    if (trade.sector) {
      const sec = sectors.find((r) => loosely(r.sector, trade.sector));
      if (sec) snapshot.sectorMomentumPct = num(sec.pct_above_50sma);
    }
    if (trade.industry) {
      const industries = Array.isArray(b?.industries) ? b.industries : [];
      const ind = industries.find((r) => loosely(r.industry, trade.industry));
      if (ind) {
        snapshot.industryMomentumPct = num(ind.pct_above_50sma);
        // Hot if the industry's breadth ranks in the strong tail (>=70% above 50DMA).
        if (snapshot.industryMomentumPct != null && snapshot.industryMomentumPct >= 70) {
          snapshot.themeOnRadar = true;
          snapshot.themeNote = `${trade.industry}: ${snapshot.industryMomentumPct}% of names > 50-DMA (breadth, ${isoDay(breadthRow.bucketDate)})`;
        }
      }
    }

    if (isoDay(breadthRow.bucketDate) !== dayLabel) {
      contextNotes.push(
        `breadth snapshot is from ${isoDay(breadthRow.bucketDate)} (nearest on/before ${dayLabel})`,
      );
    }
  } else {
    contextNotes.push(`no breadth snapshot for ${dayLabel}`);
  }

  // ── 2. Mood / posture + theme momentum (MorningBriefCache.structuredJson) ──
  if (briefRow?.structuredJson) {
    const brief = briefRow.structuredJson as unknown as StructuredBrief;
    snapshot.marketMood = brief?.mood?.label ?? null;
    snapshot.marketPosture = brief?.mood?.posture ?? null;

    const briefDay = isoDay(toUtcDate(briefRow.bucketAt) ?? entryDate);

    // Sector theme momentum: prefer the brief's own changePct for the ticker's
    // sector when breadth didn't supply it.
    if (snapshot.sectorMomentumPct == null && trade.sector && Array.isArray(brief?.sectorsThemes)) {
      const sec = brief.sectorsThemes.find((s: BriefSectorTheme) => loosely(s.name, trade.sector) || loosely(s.symbol, trade.sector));
      if (sec) snapshot.sectorMomentumPct = num(sec.changePct);
    }

    // Industry momentum + hot-theme radar from the brief's industryMovers.
    if (trade.industry && Array.isArray(brief?.industryMovers)) {
      const mover = brief.industryMovers.find((m: BriefIndustryMover) => loosely(m.industry, trade.industry));
      if (mover) {
        if (snapshot.industryMomentumPct == null) {
          snapshot.industryMomentumPct = num(mover.perf1M) ?? num(mover.changePct);
        }
        // A flagged industry mover = the theme was on the radar that day.
        if (snapshot.themeOnRadar !== true) {
          snapshot.themeOnRadar = true;
          const parts = [
            mover.changePct != null ? `${mover.changePct >= 0 ? "+" : ""}${mover.changePct}% day` : null,
            mover.perf1M != null ? `${mover.perf1M >= 0 ? "+" : ""}${mover.perf1M}% 1M` : null,
            mover.note ?? null,
          ].filter(Boolean);
          snapshot.themeNote = `${mover.industry} flagged in ${briefDay} brief${parts.length ? " (" + parts.join(", ") + ")" : ""}`;
        }
      }
    }

    if (briefDay !== dayLabel) {
      contextNotes.push(`morning brief is from ${briefDay} (nearest on/before ${dayLabel})`);
    }
  } else {
    contextNotes.push(`no morning brief (structured) for ${dayLabel}`);
  }

  // ── 3. Industry momentum overlay (ScreenerSnapshot) ────────────────────────
  // If neither breadth nor brief gave the ticker's industry momentum, derive a
  // proxy from the average Perf.1M of the ticker's industry peers in the screener
  // hits for that day.
  if (snapshot.industryMomentumPct == null && trade.industry) {
    if (screenerRow) {
      const file = screenerRow.snapshot as unknown as ScreenerFileLike;
      const hits = (file?.screeners ?? []).flatMap((s) => s.hits ?? []);
      const peers = hits.filter((h) => loosely(h["industry"] as string, trade.industry));
      const perfs = peers.map((h) => num(h["Perf.1M"])).filter((x): x is number => x != null);
      if (perfs.length) {
        const avg = perfs.reduce((a, b) => a + b, 0) / perfs.length;
        snapshot.industryMomentumPct = Math.round(avg * 10) / 10;
        if (snapshot.themeOnRadar == null) {
          snapshot.themeOnRadar = peers.length >= 2; // 2+ peers screening = a live theme
          snapshot.themeNote = `${trade.industry}: ${peers.length} peer(s) in screener (avg ${snapshot.industryMomentumPct}% 1M, ${isoDay(screenerRow.bucketDate)})`;
        }
      }
    } else {
      contextNotes.push(`no screener snapshot for ${dayLabel}`);
    }
  }

  // If the theme radar was never resolved either way, record that explicitly.
  if (snapshot.themeOnRadar == null && trade.industry) {
    snapshot.themeOnRadar = false;
    snapshot.themeNote = `${trade.industry} not found in entry-date breadth/brief/screener — theme status unverified`;
  }

  snapshot.contextNotes = contextNotes.length ? contextNotes : null;
  return snapshot;
}
