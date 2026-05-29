/**
 * a-list-extractor.ts
 * ====================
 * Identify A-list candidates from a generated StructuredBrief and upsert them
 * into the AListCandidate table.
 *
 * Filter (matches PLAN-pre-open-ci-and-journal-revamp.md):
 *   1. score >= 80
 *   2. verdict == "GO" (or "WAIT" when configured permissively)
 *   3. RVOL >= 1.5x
 *
 * Sources scanned in the brief:
 *   - brief.standout         (single top pick)
 *   - brief.movers[]         (5-8 named movers with thesis + rvol)
 *   - brief.industryMovers[].leaders[]  (cross-reference for sector + RVOL)
 *   - brief.screenerScores[] (full TV screener with per-ticker score)
 *
 * Idempotent: re-running the same brief upserts by (pickDate, ticker).
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const MIN_SCORE = 80;
const MIN_RVOL = 1.5;
const ACCEPTABLE_VERDICTS = new Set(["GO"]);

type BriefAnyShape = Record<string, unknown>;

interface ExtractedCandidate {
  ticker: string;
  setupClassification?: string | null;
  screenSource?: string | null;
  sector?: string | null;
  industry?: string | null;
  entryZone?: number | null;
  stop?: number | null;
  target?: number | null;
  rrr?: number | null;
  day0Score?: number | null;
  day0Verdict?: string | null;
  day0Rvol?: number | null;
  day0Thesis?: string | null;
  day0TraderLens?: string | null;
  day0Price?: number | null;
  tags?: string[];
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/**
 * Walk the structured brief and gather every candidate that meets the filter.
 * Returns a deduped list keyed by ticker (first-seen wins, with later sources
 * merging in their fields).
 */
export function extractCandidates(brief: BriefAnyShape | null): ExtractedCandidate[] {
  if (!brief || typeof brief !== "object") return [];

  const found = new Map<string, ExtractedCandidate>();
  const promote = (c: ExtractedCandidate) => {
    const t = c.ticker.toUpperCase();
    const existing = found.get(t);
    if (!existing) {
      found.set(t, { ...c, ticker: t });
    } else {
      // merge: prefer non-null new fields, accumulate tags
      const existingRecord = existing as unknown as Record<string, unknown>;
      for (const k of Object.keys(c) as (keyof ExtractedCandidate)[]) {
        if (k === "tags") continue;
        if (existingRecord[k] == null && c[k] != null) {
          existingRecord[k] = c[k];
        }
      }
      if (c.tags) {
        existing.tags = Array.from(new Set([...(existing.tags ?? []), ...c.tags]));
      }
    }
  };

  const meetsFilter = (score: number | null, verdict: string | null, rvol: number | null): boolean => {
    if (score == null || score < MIN_SCORE) return false;
    if (verdict == null || !ACCEPTABLE_VERDICTS.has(verdict.toUpperCase())) return false;
    if (rvol == null || rvol < MIN_RVOL) return false;
    return true;
  };

  // ── Standout (highest-conviction) ──────────────────────────────────────
  const standout = brief.standout as Record<string, unknown> | undefined;
  if (standout && typeof standout === "object") {
    const ticker = asStr(standout.ticker);
    if (ticker) {
      // Standout typically has score >= 80 and is hand-picked by the LLM,
      // so include even if rvol isn't explicitly carried (we'll fill from
      // movers / screenerScores in subsequent passes).
      promote({
        ticker,
        setupClassification: asStr(standout.tags && Array.isArray(standout.tags) ? (standout.tags as string[]).find(t => /^[A-Z][A-Z-]+$/.test(t)) ?? null : null),
        sector: asStr(standout.sector),
        entryZone: asNum(standout.entry),
        stop: asNum(standout.stop),
        target: asNum(standout.target),
        rrr: asNum(standout.rrr),
        day0Score: asNum(standout.score),
        day0Verdict: "GO", // standout is implicitly GO
        day0Thesis: asStr(standout.thesis),
        tags: Array.isArray(standout.tags) ? (standout.tags as unknown[]).filter((t): t is string => typeof t === "string") : undefined,
      });
    }
  }

  // ── Movers (named with thesis + rvol) ──────────────────────────────────
  const movers = brief.movers as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(movers)) {
    for (const m of movers) {
      const ticker = asStr(m.ticker);
      const rvol = asNum(m.rvol);
      const score = asNum(m.score) ?? asNum(m.day0Score);
      const verdict = asStr(m.verdict) ?? "GO";
      if (!ticker) continue;
      // Movers don't always carry score — only promote if it does AND meets bar.
      // But always merge if a matching standout candidate already exists.
      const willPromote = score != null ? meetsFilter(score, verdict, rvol) : found.has(ticker.toUpperCase());
      if (!willPromote) continue;
      promote({
        ticker,
        day0Score: score,
        day0Verdict: verdict,
        day0Rvol: rvol,
        day0Thesis: asStr(m.thesis),
        day0TraderLens: asStr(m.traderLens),
        day0Price: asNum(m.level) ?? asNum(m.price),
      });
    }
  }

  // ── Industry movers leaders (for sector + RVOL fill-in) ────────────────
  const industryMovers = brief.industryMovers as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(industryMovers)) {
    for (const im of industryMovers) {
      const sector = asStr(im.sector);
      const industry = asStr(im.industry);
      const leaders = im.leaders as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(leaders)) continue;
      for (const l of leaders) {
        const ticker = asStr(l.ticker);
        if (!ticker) continue;
        const upper = ticker.toUpperCase();
        // Only fill in if already in found list (don't promote new ones from leaders).
        if (!found.has(upper)) continue;
        const existing = found.get(upper)!;
        if (!existing.sector) existing.sector = sector;
        if (!existing.industry) existing.industry = industry;
        if (existing.day0Rvol == null) existing.day0Rvol = asNum(l.rvol);
        if (!existing.screenSource) existing.screenSource = asStr(l.source);
      }
    }
  }

  // ── Screener scores (full per-ticker dict) ─────────────────────────────
  const screenerScores = brief.screenerScores as Record<string, Record<string, unknown>> | undefined;
  if (screenerScores && typeof screenerScores === "object") {
    for (const [rawTicker, val] of Object.entries(screenerScores)) {
      if (!val || typeof val !== "object") continue;
      const score = asNum(val.score);
      const verdict = asStr(val.verdict);
      // RVOL not always in screenerScores — accept candidates that have rvol
      // already filled from movers, or skip if we never saw it.
      const ticker = rawTicker.toUpperCase();
      if (found.has(ticker)) {
        const existing = found.get(ticker)!;
        if (existing.day0Score == null) existing.day0Score = score;
        if (!existing.day0Verdict) existing.day0Verdict = verdict;
        if (!existing.day0Thesis) existing.day0Thesis = asStr(val.note);
      } else {
        // New from screener — only promote if RVOL is present and passes filter
        const rvol = asNum(val.rvol);
        if (meetsFilter(score, verdict, rvol)) {
          promote({
            ticker,
            day0Score: score,
            day0Verdict: verdict,
            day0Rvol: rvol,
            day0Thesis: asStr(val.note),
          });
        }
      }
    }
  }

  // ── Final filter: require ALL three criteria after merging ──────────────
  // (RVOL may have been filled in late from industryMovers / screener)
  const final: ExtractedCandidate[] = [];
  for (const c of Array.from(found.values())) {
    if (meetsFilter(c.day0Score ?? null, c.day0Verdict ?? null, c.day0Rvol ?? null)) {
      final.push(c);
    }
  }
  return final;
}

function dec(v: number | null | undefined): Prisma.Decimal | null {
  return v == null || Number.isNaN(v) ? null : new Prisma.Decimal(v);
}

function fmt(v: number | null | undefined): string {
  return v == null || Number.isNaN(v) ? "-" : String(v);
}

function decimalNumber(v: Prisma.Decimal | null | undefined): number | null {
  return v == null ? null : v.toNumber();
}

function changeLine(label: string, before: number | string | null | undefined, after: number | string | null | undefined): string | null {
  if (before == null && after == null) return null;
  if (String(before ?? "") === String(after ?? "")) return null;
  return `${label} ${before ?? "-"} -> ${after ?? "-"}`;
}

function buildAuditNotes(c: ExtractedCandidate, rerankLines: string[]): string {
  const parts = [
    "A-LIST",
    c.screenSource ? `source=${c.screenSource}` : null,
    c.setupClassification ? `setup=${c.setupClassification}` : null,
    c.day0Verdict ? `verdict=${c.day0Verdict}` : null,
    c.day0Score != null ? `score=${c.day0Score}` : null,
    c.day0Rvol != null ? `rvol=${fmt(c.day0Rvol)}x` : null,
    c.entryZone != null ? `entry=${fmt(c.entryZone)}` : null,
    c.stop != null ? `stop=${fmt(c.stop)}` : null,
    c.target != null ? `target=${fmt(c.target)}` : null,
    c.rrr != null ? `rrr=${fmt(c.rrr)}` : null,
    c.day0TraderLens ? `lens=${c.day0TraderLens}` : null,
  ].filter(Boolean);
  const rerank = rerankLines.length ? `RERANK ${rerankLines.join("; ")}` : null;
  return [parts.join(" | "), rerank, c.day0Thesis].filter(Boolean).join("\n");
}

/**
 * Persist the extracted candidates for a given pickDate + brief reference.
 * Idempotent — upserts on (userId, pickDate, ticker). Re-runs are safe.
 *
 * Multi-operator: candidates are scoped to a single user. The brief itself is
 * shared (one MorningBriefCache per bucket), but each user gets their own
 * A-list. For V1 this is always the owner user; future iterations can fan out
 * to every user with their own filter preferences.
 */
export async function upsertCandidates(
  userId: string,
  pickDate: Date,
  candidates: ExtractedCandidate[],
  briefBucketAt: Date,
  briefProvider: string,
  operatorLabel: string = "JS",
): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;

  for (const c of candidates) {
    const existing = await prisma.aListCandidate.findUnique({
      where: {
        userId_pickDate_ticker: { userId, pickDate, ticker: c.ticker },
      },
    });
    const rerankLines = existing
      ? [
          changeLine("score", existing.day0Score, c.day0Score),
          changeLine("verdict", existing.day0Verdict, c.day0Verdict),
          changeLine("setup", existing.setupClassification, c.setupClassification),
          changeLine("entry", decimalNumber(existing.entryZone), c.entryZone),
          changeLine("stop", decimalNumber(existing.stop), c.stop),
          changeLine("target", decimalNumber(existing.target), c.target),
          changeLine("rrr", decimalNumber(existing.rrr), c.rrr),
        ].filter((line): line is string => Boolean(line))
      : [];

    const data = {
      userId,
      operatorLabel,
      pickDate,
      ticker: c.ticker,
      source: "AUTO",
      setupClassification: c.setupClassification ?? null,
      screenSource: c.screenSource ?? null,
      sector: c.sector ?? null,
      industry: c.industry ?? null,
      entryZone: dec(c.entryZone),
      stop: dec(c.stop),
      target: dec(c.target),
      rrr: dec(c.rrr),
      day0Score: c.day0Score ?? null,
      day0Verdict: c.day0Verdict ?? null,
      day0Rvol: dec(c.day0Rvol),
      day0Thesis: c.day0Thesis ?? null,
      day0TraderLens: c.day0TraderLens ?? null,
      day0BriefBucketAt: briefBucketAt,
      day0BriefProvider: briefProvider,
      day0Price: dec(c.day0Price),
      tags: (c.tags as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
    };

    if (existing) {
      await prisma.aListCandidate.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      await prisma.aListCandidate.create({ data });
      inserted++;
    }

    await prisma.wikiScreenerPick.upsert({
      where: {
        operatorLabel_pickDate_ticker_screenSource: {
          operatorLabel,
          pickDate,
          ticker: c.ticker,
          screenSource: "a-list",
        },
      },
      create: {
        operatorLabel,
        pickDate,
        ticker: c.ticker,
        setupClassification: c.setupClassification ?? null,
        screenSource: "a-list",
        notes: buildAuditNotes(c, rerankLines),
        sourceUrl: c.screenSource ? `brief://${briefProvider}/${c.screenSource}` : `brief://${briefProvider}`,
      },
      update: {
        setupClassification: c.setupClassification ?? null,
        notes: buildAuditNotes(c, rerankLines),
        sourceUrl: c.screenSource ? `brief://${briefProvider}/${c.screenSource}` : `brief://${briefProvider}`,
      },
    });
  }

  return { inserted, updated };
}

/**
 * Resolve the owner user that the brief A-list should be scoped to.
 * For V1 there's a single owner; future iterations may fan-out to multi-owner.
 */
export async function getOwnerUserId(): Promise<string | null> {
  const owner = await prisma.user.findFirst({
    where: { role: "owner" },
    select: { id: true },
    orderBy: { createdAt: "asc" }, // earliest owner if multiple
  });
  return owner?.id ?? null;
}
