/**
 * /dashboard/guide — "How to journal" onboarding guide (client-beta Phase 0.2).
 *
 * The first page a fresh member should read: the three ways to get trades in,
 * what the dashboard does with them, and where everything lives. Server
 * component, static content — no data fetches.
 */
import Link from "next/link";

export const metadata = { title: "Guide — Market Desk JS" };

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-bold text-[var(--accent-fg)]">
        {n}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-[var(--fg-1)]">{title}</h3>
        <div className="t-body-small mt-1 space-y-2 text-[var(--fg-2)]">{children}</div>
      </div>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8 p-5">
      <section className="market-panel space-y-5 p-6">
        <div>
          <p className="t-overline text-[var(--fg-3)]">Start here</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--fg-1)]">How to journal your trades</h2>
          <p className="t-body-small mt-2">
            Your journal is private — only you can see your trades, positions, and analytics. Get your trades
            in one of three ways, and the dashboard does the rest: journal entries, R-multiples, MFE/MAE
            tracking, digests, and coaching analytics.
          </p>
        </div>

        <Step n={1} title="Log a trade manually (fastest to try)">
          <p>
            Go to{" "}
            <Link href="/dashboard/portfolio/new" className="text-[var(--accent)] underline">
              Portfolio → New trade
            </Link>
            . Enter ticker, side, quantity, price, and (optionally) your stop — fees are auto-calculated from
            your broker preset. The trade lands in your{" "}
            <Link href="/dashboard/trades" className="text-[var(--accent)] underline">
              Trades Hub
            </Link>{" "}
            immediately.
          </p>
        </Step>

        <Step n={2} title="Import your broker history (CSV)">
          <p>
            Export your trade/order history from your broker, then upload it at{" "}
            <Link href="/dashboard/portfolio/import" className="text-[var(--accent)] underline">
              Portfolio → CSV import
            </Link>
            . Supported: <strong>moomoo</strong>, <strong>IBKR</strong>, Schwab, Fidelity. Duplicates are
            detected on re-import, so importing the same file twice is safe.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>moomoo app:</strong> Account → All Orders (or Filled Orders) → Export — choose CSV.
            </li>
            <li>
              <strong>IBKR:</strong> Client Portal → Performance &amp; Reports → Flex Queries or Activity
              Statement → CSV export.
            </li>
          </ul>
        </Step>

        <Step n={3} title="Optional: live bridge (power users)">
          <p>
            Run a small bridge program on your own PC that pushes your positions and fills automatically —
            near-realtime portfolio with zero manual work. Generate your personal bridge token under{" "}
            <Link href="/dashboard/settings/brokers" className="text-[var(--accent)] underline">
              Settings → Broker accounts
            </Link>{" "}
            and follow the setup instructions there. Your broker credentials never leave your machine — the
            bridge only sends positions and fills.
          </p>
        </Step>
      </section>

      <section className="market-panel space-y-3 p-6">
        <p className="t-overline text-[var(--fg-3)]">What you get</p>
        <ul className="t-body-small list-disc space-y-2 pl-5 text-[var(--fg-2)]">
          <li>
            <Link href="/dashboard/trades" className="text-[var(--accent)] underline">Trades Hub</Link> — every
            trade with entry grade, R-multiple, and outcome; your personal A-list lanes.
          </li>
          <li>
            <Link href="/dashboard/journal" className="text-[var(--accent)] underline">Journal</Link> — calendar
            view, per-trade notes, AI-scored reviews, weekly digest.
          </li>
          <li>
            <Link href="/dashboard/analytics" className="text-[var(--accent)] underline">Analytics</Link> — how
            your conviction maps to outcomes; the coaching digest names your #1 leak (entries, exits, or
            discipline).
          </li>
          <li>
            <Link href="/dashboard/equity" className="text-[var(--accent)] underline">Equity</Link> — your
            account curve with drawdown periods highlighted.
          </li>
          <li>
            <Link href="/dashboard" className="text-[var(--accent)] underline">Conviction Desk</Link> — the
            shared market plane: morning brief, screeners, breadth, and the A-list GO/WATCH board (same for
            every member).
          </li>
        </ul>
      </section>

      <section className="market-panel space-y-2 p-6">
        <p className="t-overline text-[var(--fg-3)]">Ground rules</p>
        <p className="t-body-small text-[var(--fg-2)]">
          Everything on the shared plane is educational, not financial advice — read the{" "}
          <Link href="/legal" className="text-[var(--accent)] underline">disclaimer &amp; privacy note</Link>.
          Your personal book is isolated to your account; nobody else can browse it. The dashboard never
          touches your brokerage account — no orders, no copy-trading, ever.
        </p>
      </section>
    </div>
  );
}
