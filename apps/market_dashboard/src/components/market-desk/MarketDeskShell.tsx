"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";
import MarketTape from "./MarketTape";
import FailureBanner from "./FailureBanner";
import DisclaimerBanner from "./DisclaimerBanner";
import { features } from "@/lib/features";

// Nav items can declare a `featureFlag` (key of features) — when the flag is
// false, the item is filtered out at render time. Keeps nav arrays declarative.
type NavItem = {
  href: string;
  label: string;
  icon: string;
  count?: string;
  exact?: boolean;
  featureFlag?: keyof typeof features;
};

// Two-surface IA (TradesViz-platform P1-🄺): the JOURNAL surface (your book —
// journal-first, the client landing) is separated from the MARKET DESK surface
// (ideas/research). Journal-family routes render in the light data-mode, the
// desk in dark (bound by route in the layout).
const JOURNAL_NAV: NavItem[] = [
  { href: "/dashboard/journal", label: "Journal", icon: "journal", exact: true },
  { href: "/dashboard/trades", label: "Trades Hub", icon: "review" },
  { href: "/dashboard/journal/calendar", label: "Calendar", icon: "analytics" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "review" },
  // Portfolio + Equity — the executed book. Portfolio gated behind the
  // brokerJournal flag; invisible for users who haven't opted in.
  { href: "/dashboard/portfolio", label: "Portfolio", icon: "portfolio", featureFlag: "brokerJournal" },
  { href: "/dashboard/equity", label: "Equity", icon: "analytics" },
];

const DESK_NAV: NavItem[] = [
  { href: "/dashboard", label: "Conviction Desk", icon: "dashboard", count: "5", exact: true },
  // A-List — strict-quality picks promoted from every brief, tracked day-0 → 14.
  { href: "/dashboard/a-list", label: "A-List", icon: "bolt" },
  { href: "/dashboard/internals", label: "Market Internals", icon: "analytics" },
  { href: "/dashboard/scanner", label: "Scanner", icon: "search" },
  { href: "/dashboard/analysis", label: "Multi-Agent Analysis", icon: "bolt" },
  { href: "/dashboard/chat", label: "AI Chat", icon: "bolt" },
];

const TOOL_NAV: NavItem[] = [
  { href: "/dashboard/leaderboard", label: "Leaderboard", icon: "review" },
  { href: "/dashboard/profile", label: "Profile", icon: "accounts" },
  // Playbooks + Replay are placeholder pages — hidden from nav until real
  // (TradesViz-platform P0; Playbooks returns in P1, Replay in P5).
  { href: "/dashboard/settings", label: "Settings", icon: "accounts" },
  { href: "/dashboard/guide", label: "Guide", icon: "template" },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Conviction Desk",
    subtitle: "Pipeline - Spotlight - Verdicts",
  },
  "/dashboard/a-list": {
    title: "A-List",
    subtitle: "GO≥75 picks · Active vs Closed · tracked day-0 to day-14, held to broker exit",
  },
  "/dashboard/trades": {
    title: "Trades Hub",
    subtitle: "A-List - Journal - Trade Audits - Analytics",
  },
  "/dashboard/equity": {
    title: "Equity Timeline",
    subtitle: "Daily total assets - drawdown periods highlighted",
  },
  "/dashboard/internals": {
    title: "Market Internals",
    subtitle: "Sectors - RVOL - Theme Radar - Rotation",
  },
  "/dashboard/analytics": {
    title: "Conviction Analytics",
    subtitle: "How conviction maps to outcome",
  },
  "/dashboard/scanner": {
    title: "Scanner",
    subtitle: "Watchlist and setup candidates",
  },
  "/dashboard/themes": {
    title: "Theme Radar",
    subtitle: "Heating - Accumulate - Cooling",
  },
  "/dashboard/rvol": {
    title: "RVOL Overview",
    subtitle: "Relative volume + distance from 52W high",
  },
  "/dashboard/rrg": {
    title: "Rotation Graph",
    subtitle: "Industry ETFs - RS vs 1M momentum",
  },
  "/dashboard/leaderboard": {
    title: "Leaderboard",
    subtitle: "Composite score - consistency over raw P&L",
  },
  "/dashboard/profile": {
    title: "Profile",
    subtitle: "Username - bio - public visibility",
  },
  "/dashboard/analysis": {
    title: "Multi-Agent Analysis",
    subtitle: "Data + Fundamental + Technical + Risk + Moderator",
  },
  "/dashboard/chat": {
    title: "AI Chat",
    subtitle: "Ticker analysis",
  },
  "/dashboard/journal": {
    title: "Journal",
    subtitle: "Your trading dashboard - stats, positions, recent trades",
  },
  "/dashboard/journal/calendar": {
    title: "Calendar",
    subtitle: "P&L by day - click a day to drill into trades and notes",
  },
  "/dashboard/journal/daily": {
    title: "Daily Journal",
    subtitle: "Mood - sleep - market conditions - plan adherence - lessons",
  },
  "/dashboard/audits": {
    title: "Trade Audits",
    subtitle: "Monthly grade-A/B/C trade rubric reviews from jie_wiki",
  },
  // ── Phase 0 multi-broker journal pages (feature-gated) ────────────────────
  "/dashboard/portfolio": {
    title: "Portfolio",
    subtitle: "Live broker positions and P&L",
  },
  "/dashboard/portfolio/new": {
    title: "New trade",
    subtitle: "Manually log a trade with auto-calculated fees",
  },
  "/dashboard/portfolio/import": {
    title: "CSV import",
    subtitle: "Bulk import from Schwab, Fidelity, IBKR, or moomoo exports",
  },
  "/dashboard/settings/brokers": {
    title: "Broker accounts",
    subtitle: "Link brokers, configure fee presets, manage bridge tokens",
  },
  "/dashboard/guide": {
    title: "Guide",
    subtitle: "How to journal - manual entry, CSV import, live bridge",
  },
};

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const THEME_STORAGE_KEY = "mds-theme-mode";

function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") setMode(stored);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.body.setAttribute("data-mode", mode);
    document.body.classList.add("ds-base");
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  }, [mode]);

  return (
    <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--bg-surface)] p-1">
      {(["dark", "light"] as const).map((item) => (
        <button
          aria-pressed={mode === item}
          className={`mds-button h-7 rounded-full border-0 px-3 text-[11px] ${
            mode === item ? "mds-button--primary" : ""
          }`}
          key={item}
          onClick={() => setMode(item)}
          type="button"
        >
          <Icon name={item === "dark" ? "moon" : "sun"} />
          {item.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function visibleNav(items: NavItem[]): NavItem[] {
  return items.filter((i) => !i.featureFlag || features[i.featureFlag]);
}

export default function MarketDeskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isCompact, setIsCompact] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const navCloseRef = useRef<HTMLButtonElement>(null);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const page = useMemo(() => {
    if (PAGE_TITLES[pathname]) return PAGE_TITLES[pathname];
    if (pathname.startsWith("/dashboard/journal/trades/")) {
      return { title: "Trade Detail", subtitle: "Anatomy - executions - review history" };
    }
    return { title: "Market Desk JS", subtitle: "Working In Progress" };
  }, [pathname]);
  const journalNav = useMemo(() => visibleNav(JOURNAL_NAV), []);
  const deskNav = useMemo(() => visibleNav(DESK_NAV), []);
  const toolNav = useMemo(() => visibleNav(TOOL_NAV), []);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 980px)");
    const update = () => {
      setIsCompact(query.matches);
      if (!query.matches) setNavOpen(false);
    };

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isCompact || !navOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
        window.requestAnimationFrame(() => navToggleRef.current?.focus());
      }
    };

    document.body.style.overflow = "hidden";
    window.requestAnimationFrame(() => navCloseRef.current?.focus());
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isCompact, navOpen]);

  return (
    <div className="market-desk-shell">
      <MarketTape />
      <div className="market-desk-frame">
        <aside
          aria-hidden={isCompact && !navOpen}
          className={`market-sidebar ${navOpen ? "is-open" : ""}`}
          id="market-navigation"
          inert={isCompact && !navOpen}
        >
          <button
            aria-label="Close navigation"
            className="mds-button mds-button--icon market-sidebar__close"
            onClick={() => {
              setNavOpen(false);
              window.requestAnimationFrame(() => navToggleRef.current?.focus());
            }}
            ref={navCloseRef}
            title="Close navigation"
            type="button"
          >
            <Icon name="x" />
          </button>
          <Link className="market-sidebar__brand" href="/dashboard" onClick={() => setNavOpen(false)}>
            <span className="market-sidebar__mark">JS</span>
            <span>
              <span className="market-sidebar__name">Market Desk JS</span>
              <span className="market-sidebar__sub">Conviction Desk</span>
            </span>
          </Link>

          <nav className="market-nav" aria-label="Journal">
            <span className="market-nav__label">Journal</span>
            {journalNav.map((item) => (
              <Link
                className={`market-nav__item ${
                  isActive(pathname, item.href, item.exact) ? "is-active" : ""
                }`}
                href={item.href}
                key={item.href}
                onClick={() => setNavOpen(false)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.count ? <span className="market-nav__count">{item.count}</span> : null}
              </Link>
            ))}
          </nav>

          <nav className="market-nav" aria-label="Market Desk">
            <span className="market-nav__label">Market Desk</span>
            {deskNav.map((item) => (
              <Link
                className={`market-nav__item ${
                  isActive(pathname, item.href, item.exact) ? "is-active" : ""
                }`}
                href={item.href}
                key={item.href}
                onClick={() => setNavOpen(false)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.count ? <span className="market-nav__count">{item.count}</span> : null}
              </Link>
            ))}
          </nav>

          <nav className="market-nav" aria-label="Tools">
            <span className="market-nav__label">Tools</span>
            {toolNav.map((item) => (
              <Link
                className={`market-nav__item ${isActive(pathname, item.href) ? "is-active" : ""}`}
                href={item.href}
                key={item.href}
                onClick={() => setNavOpen(false)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="market-sidebar__foot">
            <div className="market-regime">
              <div className="market-regime__row">
                <span className="t-overline">Regime</span>
                <span className="market-regime__pill">RISK-OFF</span>
              </div>
              <div className="t-metric mt-2">32</div>
              <p className="t-caption mt-1">Fear & Greed - Raise the bar.</p>
            </div>
          </div>
        </aside>

        {isCompact && navOpen ? (
          <button
            aria-label="Close navigation"
            className="market-sidebar__backdrop"
            onClick={() => {
              setNavOpen(false);
              window.requestAnimationFrame(() => navToggleRef.current?.focus());
            }}
            type="button"
          />
        ) : null}

        <main
          aria-hidden={isCompact && navOpen}
          className="market-main"
          inert={isCompact && navOpen}
        >
          <header className="market-topbar">
            <div className="market-topbar__leading">
              <button
                aria-controls="market-navigation"
                aria-expanded={navOpen}
                aria-label="Open navigation"
                className="mds-button mds-button--icon market-mobile-nav-toggle"
                onClick={() => setNavOpen(true)}
                ref={navToggleRef}
                title="Open navigation"
                type="button"
              >
                <Icon name="dashboard" />
              </button>
              <div className="market-topbar__title">
                <h1>{page.title}</h1>
                <span className="market-topbar__subtitle">{page.subtitle}</span>
              </div>
            </div>
            <div className="market-topbar__actions">
              <ThemeToggle />
              <button
                aria-label="Open system alerts"
                className="mds-button mds-button--icon"
                onClick={() => {
                  const alerts = document.getElementById("system-alerts") as HTMLDetailsElement | null;
                  if (!alerts) return;
                  alerts.open = true;
                  alerts.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                title="System alerts"
                type="button"
              >
                <Icon className="h-4 w-4" name="eye" />
              </button>
              <button
                className="mds-button"
                onClick={() => signOut({ callbackUrl: "/login" })}
                type="button"
              >
                Sign out
              </button>
            </div>
          </header>
          {/* Client-beta Phase 0.3: one-time disclaimer acceptance. */}
          <DisclaimerBanner />
          {/* Phase 6: top-of-page alerts for stale brief / CI failure. */}
          <FailureBanner />
          <div className="market-page">{children}</div>
        </main>
      </div>
    </div>
  );
}
