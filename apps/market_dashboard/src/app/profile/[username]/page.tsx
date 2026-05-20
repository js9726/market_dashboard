/**
 * Public profile page — /profile/[username]
 *
 * Auth-bypassed via the middleware allow-list. Renders ONLY for users that
 * opted in (publicProfileEnabled=true). For everyone else this page returns
 * notFound() so private profiles don't leak through.
 *
 * No edit affordances here — that lives at /dashboard/profile behind auth.
 */
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { computeComposite } from "@/lib/profile/composite";
import { tierInfo } from "@/lib/profile/tiers";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ username: string }>;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function maxDrawdown(pnls: number[]): number {
  let equity = 0;
  let peak = 0;
  let worst = 0;
  for (const p of pnls) {
    equity += p;
    if (equity > peak) peak = equity;
    if (peak > 0) worst = Math.max(worst, (peak - equity) / peak);
  }
  return worst;
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { username } = await params;
  const handle = username.toLowerCase().replace(/^@/, "");

  // Prisma may throw if the migration hasn't been applied (column missing) or
  // if the DB is unreachable. Treat any error as "not found" so we never leak
  // a 500 to public viewers — a missing profile is indistinguishable from a
  // private one by design.
  type UserShape = {
    id: string;
    name: string | null;
    image: string | null;
    bio: string | null;
    dashboardTagline: string | null;
    publicProfileEnabled: boolean;
    username: string | null;
    trades: {
      pnl: unknown;
      buyPrice: unknown;
      quantity: unknown;
      tradeDate: Date | null;
    }[];
  };

  let user: UserShape | null = null;
  try {
    user = (await prisma.user.findUnique({
      where: { username: handle },
      select: {
        id: true,
        name: true,
        image: true,
        bio: true,
        dashboardTagline: true,
        publicProfileEnabled: true,
        username: true,
        trades: {
          where: { pnl: { not: null } },
          select: { pnl: true, buyPrice: true, quantity: true, tradeDate: true },
          orderBy: { tradeDate: "asc" },
        },
      },
    })) as UserShape | null;
  } catch (err) {
    console.error("[profile/username] DB lookup failed:", err);
    notFound();
  }

  if (!user || !user.publicProfileEnabled) notFound();

  const pnls: number[] = [];
  const pctReturns: number[] = [];
  let wins = 0;
  for (const t of user.trades) {
    const pnl = Number(t.pnl);
    if (Number.isNaN(pnl)) continue;
    pnls.push(pnl);
    if (pnl > 0) wins++;
    const bp = t.buyPrice != null ? Number(t.buyPrice) : null;
    const qty = t.quantity != null ? Number(t.quantity) : null;
    if (bp != null && qty != null && bp > 0 && qty !== 0) {
      const cost = bp * Math.abs(qty);
      if (cost > 0) pctReturns.push(pnl / cost);
    }
  }

  const composite = computeComposite({
    closedTrades: pnls.length,
    wins,
    totalPnl: pnls.reduce((a, b) => a + b, 0),
    maxDrawdownPct: maxDrawdown(pnls),
    pnlStdDevPct: stddev(pctReturns),
  });

  const tier = tierInfo(composite.tier);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-start gap-4">
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.image}
            alt=""
            className="h-16 w-16 rounded-full border border-[var(--line)] bg-[var(--bg-raised)]"
          />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--bg-raised)] text-xl font-bold">
            {(user.name?.[0] ?? user.username?.[0] ?? "?").toUpperCase()}
          </div>
        )}
        <div className="flex-1">
          <h1 className="text-2xl font-bold">@{user.username}</h1>
          {user.name ? <p className="text-[var(--fg-2)]">{user.name}</p> : null}
          {user.dashboardTagline ? (
            <p className="mt-1 text-sm text-[var(--fg-3)]">{user.dashboardTagline}</p>
          ) : null}
        </div>
        <span
          className="rounded px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.1em]"
          style={{
            background: composite.tier === "unranked" ? "var(--bg-raised)" : `${tier.color}22`,
            color: composite.tier === "unranked" ? "var(--fg-3)" : tier.color,
          }}
        >
          {tier.label}
        </span>
      </header>

      {user.bio ? (
        <p className="mt-6 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-4 text-sm leading-relaxed">
          {user.bio}
        </p>
      ) : null}

      <section className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Composite Score" value={composite.score != null ? composite.score.toFixed(1) : "-"} />
        <Stat label="Closed Trades" value={composite.metrics.closedTrades.toString()} />
        <Stat
          label="Win Rate"
          value={composite.components.winRate != null
            ? `${(composite.components.winRate * 100).toFixed(1)}%`
            : "-"}
        />
        <Stat
          label="Total P&L"
          value={composite.metrics.totalPnl >= 0
            ? `+$${composite.metrics.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
            : `-$${Math.abs(composite.metrics.totalPnl).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
        />
        <Stat label="Max Drawdown" value={`${(composite.metrics.maxDrawdownPct * 100).toFixed(1)}%`} />
        <Stat label="Win-Rate sub" value={`${composite.components.winRateScore}/100`} />
        <Stat label="Drawdown sub" value={`${composite.components.drawdownScore}/100`} />
        <Stat label="Consistency sub" value={`${composite.components.consistencyScore}/100`} />
      </section>

      <p className="mt-10 text-center text-xs text-[var(--fg-3)]">
        Public profiles show aggregate stats only. Individual trades and notes stay private.
      </p>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-4">
      <p className="t-overline">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold">{value}</p>
    </div>
  );
}
