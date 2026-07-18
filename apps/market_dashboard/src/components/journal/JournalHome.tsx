"use client";

/**
 * JournalHome — the Journal-surface landing (TradesViz-platform P1-🄺).
 *
 * The "when a client logs in" page: greeting + headline stats (today / week /
 * all-time P&L, win rate, expectancy, streak), open positions, most-recent
 * closed trades (each links to its chart-visualized detail page), and quick-nav
 * cards into the rest of the Journal surface. Read-only aggregation over the
 * caller's OWN book — /api/journal/stats + /api/journal/trades + /api/portfolio,
 * all user-scoped server-side.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/market-desk/Icon";
import CoachCard from "@/components/journal/CoachCard";
import GoalsAlertsCard from "@/components/journal/GoalsAlertsCard";

type Stats = {
  totalPnl: number;
  totalTrades: number;
  openTrades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number;
  currentStreak: number;
  fxUsdMyr?: number | null;
  calendarData?: { date: string; pnl: number | null; trades: number }[];
};

type TradeRow = {
  id: string;
  ticker: string;
  side?: string | null;
  tradeDate?: string | null;
  executedAt?: string | null;
  // /api/journal/trades spreads the Prisma record, so Decimal columns arrive as
  // STRINGS ("-123.45") — never assume number here. Open/LIVE rows carry
  // pnl:null with the sheet value moved to sheetPnl.
  pnl: number | string | null;
  pnlUsd?: number | string | null;
  source?: string | null;
};

/** Decimal-safe number coercion (Prisma Decimal → JSON string). */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
/** Realized P&L for a row, USD-true: prefer the converted pnlUsd. */
function rowPnl(t: TradeRow): number | null {
  return num(t.pnlUsd) ?? num(t.pnl);
}

type Position = { ticker: string; qty: number; unrealizedPl: number | null; stale?: boolean };
type Portfolio = { accounts: { isLive: boolean; positions: Position[] }[] } | null;

function fmtMoney(n: number | null | undefined, sign = false): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const s = n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return sign && n > 0 ? `+${s}` : s;
}
function tone(n: number | null | undefined): string {
  if (n == null || n === 0) return "text-[var(--fg-2)]";
  return n > 0 ? "gain" : "loss";
}
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function weekStartKey(): string {
  const d = new Date();
  const dow = d.getUTCDay(); // 0 Sun
  const diff = dow === 0 ? 6 : dow - 1; // week starts Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

function Tile({ label, value, valueClass, note }: { label: string; value: ReactNode; valueClass?: string; note?: string }) {
  return (
    <div className="market-panel p-4">
      <p className="t-overline text-[var(--fg-3)]">{label}</p>
      <p className={`mt-1 font-mono text-[22px] font-extrabold tabular-nums ${valueClass ?? "text-[var(--fg-1)]"}`}>{value}</p>
      {note ? <p className="t-caption mt-0.5 text-[var(--fg-3)]">{note}</p> : null}
    </div>
  );
}

function NavCard({ href, icon, title, desc }: { href: string; icon: string; title: string; desc: string }) {
  return (
    <Link
      href={href}
      className="market-panel flex items-center gap-3 p-4 transition hover:border-[var(--accent)]"
    >
      {/* Icon has NO default size — an unsized <svg> renders full-bleed and
          swallows the card (same defect Codex hit on Portfolio). Always size it. */}
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-[var(--bg-raised)] text-[var(--accent)]">
        <Icon className="h-4 w-4" name={icon} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold text-[var(--fg-1)]">{title}</span>
        <span className="block t-caption text-[var(--fg-3)]">{desc}</span>
      </span>
    </Link>
  );
}

export default function JournalHome() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let off = false;
    Promise.all([
      fetch("/api/journal/stats", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/journal/trades", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/portfolio", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([s, t, p]) => {
      if (off) return;
      setStats(s);
      const rows: TradeRow[] = Array.isArray(t?.trades) ? t.trades : Array.isArray(t) ? t : [];
      setTrades(rows);
      setPortfolio(p);
      setLoading(false);
    });
    return () => {
      off = true;
    };
  }, []);

  const { todayPnl, weekPnl } = useMemo(() => {
    const cal = stats?.calendarData ?? [];
    const tk = todayKey();
    const wk = weekStartKey();
    let today = 0;
    let week = 0;
    for (const d of cal) {
      if (d.pnl == null) continue;
      if (d.date === tk) today += d.pnl;
      if (d.date >= wk) week += d.pnl;
    }
    return { todayPnl: today, weekPnl: week };
  }, [stats]);

  const openPositions = useMemo(() => {
    const out: Position[] = [];
    for (const a of portfolio?.accounts ?? []) {
      if (!a.isLive) continue;
      for (const p of a.positions) out.push(p);
    }
    return out;
  }, [portfolio]);

  const recentClosed = useMemo(
    () =>
      trades
        .filter((t) => rowPnl(t) != null)
        .sort((a, b) => (b.executedAt ?? b.tradeDate ?? "").localeCompare(a.executedAt ?? a.tradeDate ?? ""))
        .slice(0, 8),
    [trades],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="t-overline text-[var(--fg-3)]">Journal</p>
          <h1 className="text-lg font-bold text-[var(--fg-1)]">Your trading dashboard</h1>
        </div>
        <Link
          href="/dashboard/portfolio/new"
          className="rounded-[var(--radius-sm)] border border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] px-3 py-1.5 text-xs font-bold text-[var(--accent)] transition hover:opacity-90"
        >
          + Log a trade
        </Link>
      </div>

      {/* Headline stat tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Tile label="Today P&L" value={loading ? "…" : fmtMoney(todayPnl, true)} valueClass={`font-mono ${tone(todayPnl)}`} />
        <Tile label="This week" value={loading ? "…" : fmtMoney(weekPnl, true)} valueClass={`font-mono ${tone(weekPnl)}`} />
        <Tile label="All-time P&L" value={loading ? "…" : fmtMoney(stats?.totalPnl, true)} valueClass={`font-mono ${tone(stats?.totalPnl)}`} note="USD" />
        <Tile label="Win rate" value={loading ? "…" : stats ? `${stats.winRate}%` : "—"} note={stats ? `${stats.totalTrades} closed` : undefined} />
        <Tile label="Expectancy" value={loading ? "…" : fmtMoney(stats?.expectancy, true)} valueClass={`font-mono ${tone(stats?.expectancy)}`} note="per trade" />
        <Tile label="Streak" value={loading ? "…" : stats ? `${stats.currentStreak > 0 ? "+" : ""}${stats.currentStreak}` : "—"} valueClass={`font-mono ${tone(stats?.currentStreak)}`} note={stats ? `PF ${stats.profitFactor}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Open positions */}
        <section className="market-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="t-overline text-[var(--fg-3)]">Open positions</p>
            <Link href="/dashboard/portfolio" className="t-caption text-[var(--accent)] hover:underline">
              Portfolio →
            </Link>
          </div>
          {loading ? (
            <p className="t-caption text-[var(--fg-3)]">Loading…</p>
          ) : openPositions.length === 0 ? (
            <p className="t-caption text-[var(--fg-3)]">No open positions. <Link href="/dashboard/portfolio/new" className="text-[var(--accent)] hover:underline">Log one</Link> or <Link href="/dashboard/portfolio/import" className="text-[var(--accent)] hover:underline">import a CSV</Link>.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {openPositions.slice(0, 6).map((p) => (
                <li key={p.ticker} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="font-semibold text-[var(--fg-1)]">
                    {p.ticker}
                    {p.stale ? <span className="ml-1 text-[var(--warn-fg,#f59e0b)]" title="stale quote">⏱</span> : null}
                  </span>
                  <span className="t-caption text-[var(--fg-3)]">{p.qty} sh</span>
                  <span className={`font-mono text-sm ${tone(p.unrealizedPl)}`}>{fmtMoney(p.unrealizedPl, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recent closed trades */}
        <section className="market-panel p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="t-overline text-[var(--fg-3)]">Recent trades</p>
            <Link href="/dashboard/trades" className="t-caption text-[var(--accent)] hover:underline">
              Trades Hub →
            </Link>
          </div>
          {loading ? (
            <p className="t-caption text-[var(--fg-3)]">Loading…</p>
          ) : recentClosed.length === 0 ? (
            <p className="t-caption text-[var(--fg-3)]">No closed trades yet — they appear here once you exit a position.</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {recentClosed.map((t) => (
                <li key={t.id}>
                  <Link href={`/dashboard/journal/trades/${t.id}`} className="flex items-center justify-between py-1.5 text-sm hover:opacity-80">
                    <span className="font-semibold text-[var(--fg-1)]">{t.ticker}</span>
                    <span className="t-caption text-[var(--fg-3)]">{(t.executedAt ?? t.tradeDate ?? "").slice(0, 10)}</span>
                    <span className={`font-mono text-sm ${tone(rowPnl(t))}`}>{fmtMoney(rowPnl(t), true)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Alerts + goals (TradesViz-platform P4) — rule breaches first. */}
      <GoalsAlertsCard />

      {/* AI coach over the journal (TradesViz-platform P3) */}
      <CoachCard />

      {/* Quick-nav into the rest of the Journal surface */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <NavCard href="/dashboard/trades" icon="journal" title="Trades Hub" desc="Every trade, tags, filters" />
        <NavCard href="/dashboard/journal/calendar" icon="analytics" title="Calendar" desc="P&L by day, drill in" />
        <NavCard href="/dashboard/analytics/pivot" icon="search" title="Explore" desc="Group by any field" />
        <NavCard href="/dashboard/analytics" icon="review" title="Analytics" desc="Edge, setups, coaching" />
        <NavCard href="/dashboard/journal/daily" icon="template" title="Daily journal" desc="Mood, plan, lessons" />
        <NavCard href="/dashboard/equity" icon="portfolio" title="Equity" desc="Account curve + drawdown" />
      </div>
    </div>
  );
}
