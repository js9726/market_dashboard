"use client";

/**
 * InternalsView — consolidates the deep market-internals tools that used to be
 * three scattered Tools-nav pages into one sub-tabbed surface:
 *   RVOL Momentum · Theme Radar · Rotation Graph.
 * The at-a-glance sector strip stays on the Conviction Desk (LiveTapeRow).
 */
import { useState } from "react";
import RvolOverview from "@/components/market-desk/RvolOverview";
import ThemeRadar from "@/components/market-desk/ThemeRadar";
import RotationGraph from "@/components/market-desk/RotationGraph";
import Icon from "@/components/market-desk/Icon";

type TabKey = "rvol" | "themes" | "rotation";

const TABS: { id: TabKey; label: string; icon: string }[] = [
  { id: "rvol", label: "RVOL Momentum", icon: "search" },
  { id: "themes", label: "Theme Radar", icon: "search" },
  { id: "rotation", label: "Rotation Graph", icon: "analytics" },
];

export default function InternalsView() {
  const [tab, setTab] = useState<TabKey>("rvol");
  return (
    <div className="space-y-5">
      <nav
        aria-label="Market Internals"
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-1"
      >
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              aria-pressed={active}
              className={`mds-button h-9 shrink-0 rounded border-0 px-3 text-[12px] ${
                active ? "mds-button--primary" : ""
              }`}
              key={t.id}
              onClick={() => setTab(t.id)}
              type="button"
            >
              <Icon name={t.icon} />
              {t.label}
            </button>
          );
        })}
      </nav>
      {tab === "rvol" && <RvolOverview />}
      {tab === "themes" && <ThemeRadar />}
      {tab === "rotation" && <RotationGraph />}
    </div>
  );
}
