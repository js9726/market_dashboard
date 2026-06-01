/**
 * journal-digest.ts — the "what to learn" weekly digest.
 *
 * Per-trade journaling already runs post-close (journal_close.yml → Claude Agent
 * SDK → /api/journal/entries/ingest). This adds the reflection layer the user
 * asked for ("auto + nightly digest, zero per-trade effort"): a deterministic
 * weekly summary that leans on the new HELD tracker data — on-book vs off-book
 * R, Soft-vs-Hard savings, and stop-too-tight counts vs the wiki ATR-floor.
 */
import { prisma } from "@/lib/prisma";

export interface WeeklyDigest {
  periodDays: number;
  from: string;
  to: string;
  trades: { closed: number; wins: number; losses: number; winRatePct: number | null };
  discipline: {
    onBookCount: number;
    offBookCount: number;
    onBookAvgR: number | null;
    offBookAvgR: number | null;
    stopTooTightCount: number;
    gradeDist: { A: number; B: number; C: number };
  };
  savings: { avgSoftVsHardR: number | null; totalSoftVsHardUsd: number; avgRealizedR: number | null };
  journal: { entries: number; avgComposite: number | null; topWeakness: string | null; topSetup: string | null };
  takeaways: string[];
}

function avg(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
function mode(xs: string[]): string | null {
  if (!xs.length) return null;
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0][0];
}
function r1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 100) / 100;
}

export async function buildWeeklyDigest(userId: string, periodDays = 7): Promise<WeeklyDigest> {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - periodDays);

  const closed = await prisma.tradeRecord.findMany({
    where: { userId, pnl: { not: null }, OR: [{ tradeDate: { gte: from } }, { syncedAt: { gte: from } }] },
    select: { pnl: true },
  });
  const pnls = closed.map((t) => t.pnl?.toNumber() ?? 0);
  const wins = pnls.filter((p) => p > 0).length;
  const losses = pnls.filter((p) => p < 0).length;
  const decided = wins + losses;

  const held = await prisma.aListCandidate.findMany({
    where: { userId, isHeld: true, updatedAt: { gte: from } },
    select: {
      onBook: true, entryGrade: true, realizedRLogged: true,
      saveSoftVsHardR: true, saveSoftVsHardUsd: true, rUnitLogged: true, rUnitAtr: true,
    },
  });
  const onBookR: number[] = [];
  const offBookR: number[] = [];
  const softR: number[] = [];
  const realizedRs: number[] = [];
  let softUsd = 0;
  let stopTooTight = 0;
  const gradeDist = { A: 0, B: 0, C: 0 };
  for (const h of held) {
    const rr = h.realizedRLogged?.toNumber();
    if (rr != null) {
      realizedRs.push(rr);
      (h.onBook ? onBookR : offBookR).push(rr);
    }
    const sv = h.saveSoftVsHardR?.toNumber();
    if (sv != null) softR.push(sv);
    const svUsd = h.saveSoftVsHardUsd?.toNumber();
    if (svUsd != null) softUsd += svUsd;
    const rl = h.rUnitLogged?.toNumber();
    const ra = h.rUnitAtr?.toNumber();
    if (rl != null && ra != null && ra > 0 && rl < ra * 0.8) stopTooTight++;
    if (h.entryGrade === "A") gradeDist.A++;
    else if (h.entryGrade === "B") gradeDist.B++;
    else if (h.entryGrade === "C") gradeDist.C++;
  }

  const entries = await prisma.journalEntry.findMany({
    where: { userId, createdAt: { gte: from } },
    select: { compositeScore: true, weakestDimension: true, setupType: true },
  });
  const composites = entries.map((e) => e.compositeScore?.toNumber()).filter((n): n is number => n != null);
  const topWeakness = mode(entries.map((e) => e.weakestDimension).filter((s): s is string => !!s));
  const topSetup = mode(entries.map((e) => e.setupType).filter((s): s is string => !!s));

  const onBookAvgR = avg(onBookR);
  const offBookAvgR = avg(offBookR);
  const avgSoftVsHardR = avg(softR);

  const takeaways: string[] = [];
  if (offBookR.length && onBookAvgR != null && offBookAvgR != null && offBookAvgR < onBookAvgR) {
    takeaways.push(
      `Off-book trades averaged ${r1(offBookAvgR)}R vs ${r1(onBookAvgR)}R on-book — buying your own A-list paid; freelance entries dragged the week.`,
    );
  }
  if (stopTooTight > 0) {
    takeaways.push(
      `${stopTooTight} position(s) had a logged stop tighter than the wiki ATR-floor — likely whipsaw risk; widen toward 1.5×ATR / 5-day low.`,
    );
  }
  if (avgSoftVsHardR != null && avgSoftVsHardR > 0) {
    takeaways.push(`Exiting on 8/21EMA structure would have saved an avg +${r1(avgSoftVsHardR)}R vs riding to the hard stop.`);
  }
  if (topWeakness) takeaways.push(`Recurring weak dimension across journal entries: ${topWeakness}.`);
  if (gradeDist.C > gradeDist.A) {
    takeaways.push(`More C-grade than A-grade entries this period (${gradeDist.C} vs ${gradeDist.A}) — tighten entry selection toward the A-list bar.`);
  }
  if (!takeaways.length) takeaways.push("Not enough closed/held activity this period to surface a pattern yet.");

  return {
    periodDays,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    trades: { closed: closed.length, wins, losses, winRatePct: decided ? Math.round((wins / decided) * 100) : null },
    discipline: {
      onBookCount: onBookR.length,
      offBookCount: offBookR.length,
      onBookAvgR: r1(onBookAvgR),
      offBookAvgR: r1(offBookAvgR),
      stopTooTightCount: stopTooTight,
      gradeDist,
    },
    savings: { avgSoftVsHardR: r1(avgSoftVsHardR), totalSoftVsHardUsd: Math.round(softUsd), avgRealizedR: r1(avg(realizedRs)) },
    journal: { entries: entries.length, avgComposite: r1(avg(composites)), topWeakness, topSetup },
    takeaways,
  };
}
