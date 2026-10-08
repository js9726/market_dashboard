import { isLiveQuoteFresh } from "@/lib/live-quote-freshness";
import type { BriefSymbolEvidence, StructuredBrief } from "@/types/structured-brief";
import type { ComposedSnapshot } from "./snapshot";

const MAX_INPUT_AGE_MS = 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function marketDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** A new file/cache timestamp must not bless an earlier market session. */
export function isBriefInputFresh(observedAt: unknown, now = new Date()): observedAt is string {
  if (typeof observedAt !== "string" || !observedAt.includes("T")) return false;
  const date = new Date(observedAt);
  const age = now.getTime() - date.getTime();
  return Number.isFinite(age) && age >= -CLOCK_SKEW_MS && age < MAX_INPUT_AGE_MS
    && marketDate(date) === marketDate(now);
}

export function isSymbolEvidenceFresh(row: BriefSymbolEvidence, now = new Date()): boolean {
  return Boolean(row?.source) && isBriefInputFresh(row.observedAt, now)
    && (row.kind === "screener" || (row.kind === "quote" && isLiveQuoteFresh(row.observedAt, now)));
}

/** Snapshot-only generation has no search evidence or validated trade plan. */
export function reconcileSnapshotBrief(brief: StructuredBrief, snapshot: ComposedSnapshot, now = new Date()): StructuredBrief {
  const symbols = Object.fromEntries(Object.entries(snapshot.symbolEvidence ?? {})
    .filter(([, row]) => isSymbolEvidenceFresh(row, now)));
  const movers = (brief.movers ?? []).flatMap((mover) => {
    const ticker = mover.ticker.trim().toUpperCase();
    const row = symbols[ticker];
    if (!row || row.changePct == null) return [];
    return [{ ticker, side: null, changePct: row.changePct, rvol: row.rvol,
      observedAt: row.observedAt, source: row.source, why: null, traderLens: null }];
  });
  return {
    ...brief,
    marketEvidence: { version: 1, status: "verified", symbols },
    movers,
    standout: null,
    traderLens: null,
    news: null,
    earnings: null,
    ratings: null,
    calendar: null,
    alert: null,
    citations: null,
    industryMovers: snapshot.industryMovers,
    industryNarrative: null,
    indicesNarrative: null,
    sectorsNarrative: null,
    breadth: snapshot.breadth ? { up: snapshot.breadth.advance, down: snapshot.breadth.decline } : null,
    indices: (brief.indices ?? []).flatMap((index) => {
      const row = snapshot.indices[index.symbol];
      return row ? [{ ...index, level: row.price, changePct: row.changePct, note: null, citation: null }] : [];
    }),
    sectorsThemes: (brief.sectorsThemes ?? []).flatMap((sector) => {
      const row = snapshot.sectors[sector.symbol];
      return row ? [{ ...sector, changePct: row.changePct, rs: null, note: null }] : [];
    }),
    watchlist: (brief.watchlist ?? []).flatMap((stock) => {
      const row = symbols[stock.ticker.trim().toUpperCase()];
      return row ? [{ ...stock, level: row.price, changePct: row.changePct, abc: null, note: null }] : [];
    }),
  };
}

/** External JSON may remain viewable as a brief, but cannot assert source proof. */
export function markIngestUnverified(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return { ...value, marketEvidence: { version: 1, status: "unverified", symbols: {} } };
}

/** Recheck at read/render time: generation time is never market-data time. */
export function liveIdeasFromBrief(value: unknown, now = new Date()): StructuredBrief | null {
  if (!value || typeof value !== "object") return null;
  const brief = value as StructuredBrief;
  const evidence = brief.marketEvidence;
  if (evidence?.version !== 1 || evidence.status !== "verified" || !evidence.symbols) return null;
  const movers = (Array.isArray(brief.movers) ? brief.movers : []).flatMap((mover) => {
    const ticker = typeof mover?.ticker === "string" ? mover.ticker.trim().toUpperCase() : "";
    const row = evidence.symbols[ticker];
    if (!row || !isSymbolEvidenceFresh(row, now) || !Number.isFinite(row.changePct)) return [];
    return [{ ticker, side: null, changePct: row.changePct, rvol: row.rvol,
      observedAt: row.observedAt, source: row.source, why: null, traderLens: null }];
  });
  if (!movers.length) return null;
  return { ...brief, movers, standout: null, traderLens: null };
}

export function ideasObservedAt(brief: StructuredBrief | null): string | null {
  const dates = (brief?.movers ?? []).map((row) => row.observedAt)
    .filter((at): at is string => Boolean(at) && Number.isFinite(Date.parse(at!)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return dates[0] ?? null;
}
