/**
 * alist-maintenance.ts — REC-lane hygiene.
 *
 * 1. expireStaleRecCandidates — flips ACTIVE REC rows whose entry-validity
 *    window (lib/alist-validity.ts: EP/parabolic 2 sessions, unclassified 3,
 *    base setups 5) has lapsed to EXPIRED with a tagged reason. Day-0→14
 *    outcome tracking continues regardless; this only stops a dead pick from
 *    masquerading as actionable.
 *
 * 2. dedupeRecCandidates — collapses the cross-day duplicate chains created
 *    before ingest learned to refresh-in-place (SJM/ASH/CBRL/TREX/... on
 *    consecutive days, 2026-06). Keeps the EARLIEST row (true day-0), carries
 *    the best score / latest RVOL forward, tags re-qualification dates, and
 *    deletes later duplicates that carry no HELD link and no day-14 data.
 */
import { prisma } from "@/lib/prisma";
import { isEntryExpired, sessionsBetween, validitySessions } from "@/lib/alist-validity";

function tagsWith(existing: unknown, tag: string): string[] {
  const arr = Array.isArray(existing) ? existing.filter((t): t is string => typeof t === "string") : [];
  if (!arr.includes(tag)) arr.push(tag);
  return arr;
}

export async function expireStaleRecCandidates(
  userId: string,
  now: Date = new Date(),
): Promise<{ expired: number; tickers: string[] }> {
  const rows = await prisma.aListCandidate.findMany({
    where: { userId, isHeld: false, status: "ACTIVE" },
    select: { id: true, ticker: true, pickDate: true, setupClassification: true, tags: true },
  });

  const tickers: string[] = [];
  for (const r of rows) {
    if (!isEntryExpired(r.pickDate, r.setupClassification, now)) continue;
    const elapsed = sessionsBetween(r.pickDate, now);
    const window = validitySessions(r.setupClassification);
    await prisma.aListCandidate.update({
      where: { id: r.id },
      data: {
        status: "EXPIRED",
        tags: tagsWith(r.tags, `expired:entry-window ${window}s elapsed ${elapsed}s`),
      },
    });
    tickers.push(r.ticker);
  }
  return { expired: tickers.length, tickers };
}

export async function dedupeRecCandidates(
  userId: string,
  opts: { dryRun?: boolean; windowDays?: number } = {},
): Promise<{ merged: number; kept: number; actions: string[] }> {
  const dryRun = opts.dryRun ?? false;
  const windowDays = opts.windowDays ?? 21;
  const since = new Date(Date.now() - windowDays * 86400e3);

  const rows = await prisma.aListCandidate.findMany({
    where: { userId, isHeld: false, pickDate: { gte: since } },
    orderBy: { pickDate: "asc" },
  });

  const byTicker = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byTicker.get(r.ticker) ?? [];
    arr.push(r);
    byTicker.set(r.ticker, arr);
  }

  let merged = 0;
  let kept = 0;
  const actions: string[] = [];

  for (const [ticker, chain] of Array.from(byTicker.entries())) {
    if (chain.length < 2) continue;
    const keeper = chain[0];
    kept++;
    let bestScore = keeper.day0Score ?? null;
    let latestRvol = keeper.day0Rvol;
    let keeperTags = tagsWith(keeper.tags, `dedup:${chain.length} sightings`);

    for (const dup of chain.slice(1)) {
      // Never touch rows that became positions or already have outcome data.
      if (dup.isHeld || dup.heldPositionId != null || dup.day14ComputedAt != null) {
        actions.push(`skip ${ticker} ${dup.pickDate.toISOString().slice(0, 10)} (held/outcome data)`);
        continue;
      }
      if (dup.day0Score != null && (bestScore == null || dup.day0Score > bestScore)) bestScore = dup.day0Score;
      if (dup.day0Rvol != null) latestRvol = dup.day0Rvol;
      keeperTags = tagsWith(keeperTags, `requalified:${dup.pickDate.toISOString().slice(0, 10)}`);
      actions.push(
        `${dryRun ? "[dry] " : ""}merge ${ticker} ${dup.pickDate.toISOString().slice(0, 10)} → keeper ${keeper.pickDate.toISOString().slice(0, 10)}`,
      );
      merged++;
      if (!dryRun) {
        await prisma.aListCandidate.delete({ where: { id: dup.id } });
      }
    }

    if (!dryRun) {
      await prisma.aListCandidate.update({
        where: { id: keeper.id },
        data: { day0Score: bestScore, day0Rvol: latestRvol, tags: keeperTags },
      });
    }
  }

  return { merged, kept, actions };
}
