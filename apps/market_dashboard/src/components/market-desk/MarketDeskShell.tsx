"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import Icon from "./Icon";
import MarketTape from "./MarketTape";

const WORKFLOW_NAV = [
  { href: "/dashboard", label: "Conviction Desk", icon: "dashboard", count: "5", exact: true },
  { href: "/dashboard/pitch", label: "New Pitch", icon: "plus" },
  { href: "/dashboard/bench", label: "Bench", icon: "template", count: "1" },
  { href: "/dashboard/settled", label: "Settled", icon: "review", count: "2" },
  { href: "/dashboard/analytics", label: "Analytics", icon: "analytics" },
];

const TOOL_NAV = [
  { href: "/dashboard/scanner", label: "Scanner", icon: "search" },
  { href: "/dashboard/themes", label: "Theme Radar", icon: "search" },
  { href: "/dashboard/chat", label: "AI Chat", icon: "bolt" },
  { href: "/dashboard/journal", label: "Journal", icon: "journal" },
  { href: "/dashboard/playbooks", label: "Playbooks", icon: "template" },
  { href: "/dashboard/replay", label: "Replay", icon: "replay" },
  { href: "/dashboard/settings", label: "Settings", icon: "accounts" },
];

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Conviction Desk",
    subtitle: "Pipeline - Spotlight - Verdicts",
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
  "/dashboard/chat": {
    title: "AI Chat",
    subtitle: "Ticker analysis",
  },
  "/dashboard/journal": {
    title: "Journal",
    subtitle: "Trades - calendar - analytics",
  },
};

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ThemeToggle() {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", mode);
    document.body.setAttribute("data-mode", mode);
    document.body.classList.add("ds-base");
  }, [mode]);

  return (
    <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--bg-surface)] p-1">
      {(["dark", "light"] as const).map((item) => (
        <button
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

export default function MarketDeskShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const page = useMemo(
    () => PAGE_TITLES[pathname] ?? { title: "Market Desk JS", subtitle: "Working In Progress" },
    [pathname],
  );

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
            {WORKFLOW_NAV.map((item) => (
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
            {TOOL_NAV.map((item) => (
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
          <div className="market-page">{children}</div>
        </main>
      </div>
    </div>
  );
}
