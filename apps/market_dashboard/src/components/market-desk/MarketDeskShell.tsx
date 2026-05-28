"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import MarketTape from "./MarketTape";
import FailureBanner from "./FailureBanner";
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

const WORKFLOW_NAV: NavItem[] = [
  { href: "/dashboard", label: "Conviction Desk", icon: "dashboard", count: "5", exact: true },
  // A-List sits between the daily brief (Conviction Desk) and the executed
  // book (Portfolio). It's the strict-quality picks promoted from every brief,
  // tracked day-0 → day-14. See PLAN-pre-open-ci-and-journal-revamp.md.
  { href: "/dashboard/a-list", label: "A-List", icon: "review" },
  // Portfolio sits next — natural flow from "ideas" → "executed positions".
  // Gated behind brokerJournal flag; invisible for users who haven't opted in.
  { href: "/dashboard/portfolio", label: "Portfolio", icon: "portfolio", featureFlag: "brokerJournal" },
  // Equity timeline — Phase 6 (owner-only).
  { href: "/dashboard/equity", label: "Equity", icon: "analytics" },
  { href: "/dashboard/pitch", label: "New Pitch", icon: "plus" },
  { href: "/dashboard/bench", label: "Bench", icon: "template", count: "1" },
  { href: "/dashboard/settled", label: "Settled", icon: "review", count: "2" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "analytics" },
];

const TOOL_NAV: NavItem[] = [
  { href: "/dashboard/scanner", label: "Scanner", icon: "search" },
  { href: "/dashboard/themes", label: "Theme Radar", icon: "search" },
  { href: "/dashboard/rvol", label: "RVOL Overview", icon: "search" },
  { href: "/dashboard/analysis", label: "Multi-Agent Analysis", icon: "bolt" },
  { href: "/dashboard/leaderboard", label: "Leaderboard", icon: "review" },
  { href: "/dashboard/profile", label: "Profile", icon: "accounts" },
  { href: "/dashboard/rrg", label: "Rotation Graph", icon: "analytics" },
  { href: "/dashboard/chat", label: "AI Chat", icon: "bolt" },
  { href: "/dashboard/journal", label: "Journal", icon: "journal" },
  { href: "/dashboard/audits", label: "Trade Audits", icon: "review" },
  { href: "/dashboard/playbooks", label: "Playbooks", icon: "template" },
  { href: "/dashboard/replay", label: "Replay", icon: "replay" },
  { href: "/dashboard/settings", label: "Settings", icon: "accounts" },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Conviction Desk",
    subtitle: "Pipeline - Spotlight - Verdicts",
  },
  "/dashboard/a-list": {
    title: "A-List",
    subtitle: "Strict-quality picks - day-0 to day-14 outcome",
  },
  "/dashboard/equity": {
    title: "Equity Timeline",
    subtitle: "Daily total assets - drawdown periods highlighted",
  },
  "/dashboard/pitch": {
    title: "New Pitch",
    subtitle: "File a thesis",
  },
  "/dashboard/bench": {
    title: "Bench",
    subtitle: "Raw, pre-thesis ideas",
  },
  "/dashboard/settled": {
    title: "Settled",
    subtitle: "Closed positions - review",
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
    subtitle: "Trades - calendar - analytics",
  },
  "/dashboard/audits": {
    title: "Trade Audits",
    subtitle: "Monthly grade-A/B/C trade rubric reviews from llm_traders_wiki",
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
  const page = useMemo(
    () => PAGE_TITLES[pathname] ?? { title: "Market Desk JS", subtitle: "Working In Progress" },
    [pathname],
  );
  const workflowNav = useMemo(() => visibleNav(WORKFLOW_NAV), []);
  const toolNav = useMemo(() => visibleNav(TOOL_NAV), []);

  return (
    <div className="market-desk-shell">
      <MarketTape />
      <div className="market-desk-frame">
        <aside className="market-sidebar">
          <Link className="market-sidebar__brand" href="/dashboard">
            <span className="market-sidebar__mark">JS</span>
            <span>
              <span className="market-sidebar__name">Market Desk JS</span>
              <span className="market-sidebar__sub">Conviction Desk</span>
            </span>
          </Link>

          <nav className="market-nav" aria-label="Workflow">
            <span className="market-nav__label">Workflow</span>
            {workflowNav.map((item) => (
              <Link
                className={`market-nav__item ${
                  isActive(pathname, item.href, item.exact) ? "is-active" : ""
                }`}
                href={item.href}
                key={item.href}
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

        <main className="market-main">
          <header className="market-topbar">
            <div className="market-topbar__title">
              <h1>{page.title}</h1>
              <span className="market-topbar__subtitle">{page.subtitle}</span>
            </div>
            <div className="market-topbar__actions">
              <ThemeToggle />
              <button className="mds-button mds-button--icon" title="Notifications" type="button">
                <Icon name="eye" />
              </button>
              <Link className="mds-button mds-button--primary" href="/dashboard/pitch">
                <Icon name="plus" />
                New Pitch
              </Link>
              <button
                className="mds-button"
                onClick={() => signOut({ callbackUrl: "/login" })}
                type="button"
              >
                Sign out
              </button>
            </div>
          </header>
          {/* Phase 6: top-of-page alerts for stale brief / CI failure. */}
          <FailureBanner />
          <div className="market-page">{children}</div>
        </main>
      </div>
    </div>
  );
}
