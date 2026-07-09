/**
 * /legal — beta disclaimer + privacy note (client-beta Phase 0.3).
 *
 * Public (excluded from session middleware) so invitees can read it BEFORE
 * signing in. Acceptance is recorded per-user via /api/user/disclaimer and
 * gates the Ideas tab (Phase 1). Plain-language terms — owner-reviewed copy,
 * not legal advice to the operator.
 */
import Link from "next/link";

export const metadata = { title: "Disclaimer & Privacy — Market Desk JS" };

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-gray-950 px-6 py-12 text-gray-300">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Disclaimer &amp; Privacy</h1>
          <p className="mt-1 text-sm text-gray-500">Market Desk JS — private beta. Last updated 2026-06-29.</p>
        </div>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">1. Educational purposes only — not financial advice</h2>
          <p className="text-sm leading-relaxed">
            Everything on this dashboard — trade ideas, entry zones, stops, targets, scores, verdicts,
            screeners, alerts, and commentary — is shared for <strong className="text-white">educational and
            informational purposes only</strong>. Nothing here is investment advice, a recommendation, or a
            solicitation to buy or sell any security. The owner is not a licensed financial adviser, and no
            adviser–client relationship is created by using this dashboard.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">2. Trading risk</h2>
          <p className="text-sm leading-relaxed">
            Trading stocks involves substantial risk of loss and is not suitable for everyone. Past results —
            including any track record, win-rate, or R-multiple shown here — <strong className="text-white">do
            not guarantee future performance</strong>. Ideas shown may be entered, exited, or abandoned by the
            owner at any time without notice. You are solely responsible for your own trading decisions,
            position sizing, and risk management. Never trade with money you cannot afford to lose.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">3. Data accuracy &amp; beta software</h2>
          <p className="text-sm leading-relaxed">
            This is beta software. Market data, scores, and analytics may be delayed, incomplete, or wrong.
            AI-generated content can contain errors. Features may change or break without notice. The
            dashboard is provided <strong className="text-white">as-is, without warranty of any kind</strong>.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">4. Your data &amp; privacy</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              <strong className="text-white">Your journal is yours alone.</strong> Trades, positions, journal
              entries, imports, and analytics are scoped to your account. Other members — including the
              owner&apos;s admin view — cannot browse your personal book.
            </li>
            <li>
              Market-wide data (morning brief, screeners, breadth, shared idea lists) is common to all members.
            </li>
            <li>
              Sign-in uses your Google account (name, email, avatar). No broker credentials are ever stored on
              our servers; broker data arrives only via files you import or a bridge you run on your own machine.
            </li>
            <li>
              You can request deletion of your account and personal data at any time by contacting the owner.
            </li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-white">5. No auto-trading</h2>
          <p className="text-sm leading-relaxed">
            This dashboard never places, modifies, or cancels orders in any brokerage account. There is no
            copy-trading. Acting on anything shown here is entirely your decision, made in your own account.
          </p>
        </section>

        <div className="border-t border-gray-800 pt-6 text-sm text-gray-500">
          <p>
            By accepting the disclaimer inside the dashboard you confirm you have read and understood the
            above. Questions? Contact the owner directly.
          </p>
          <p className="mt-4">
            <Link href="/dashboard" className="text-gray-400 underline hover:text-white">
              ← Back to dashboard
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
