"use client";

import { useMemo, useState } from "react";
import AListView from "@/components/a-list/AListView";
import JournalShell from "@/components/journal/JournalShell";
import AuditsView from "@/components/audits/AuditsView";
import AnalyticsView from "@/components/audits/AnalyticsView";
import Icon from "@/components/market-desk/Icon";

type TabKey = "a-list" | "journal" | "audits" | "analytics";

const TABS: { id: TabKey; label: string; icon: string }[] = [
  { id: "a-list", label: "A-List", icon: "review" },
  { id: "journal", label: "Journal", icon: "journal" },
  { id: "audits", label: "Trade Audits", icon: "review" },
  { id: "analytics", label: "Analytics", icon: "analytics" },
];

export default function TradesHubView() {
  const [tab, setTab] = useState<TabKey>("a-list");
  const content = useMemo(() => {
    switch (tab) {
      case "journal":
        return <JournalShell />;
      case "audits":
        return <AuditsView />;
      case "analytics":
        return <AnalyticsView />;
      default:
        return <AListView />;
    }
  }, [tab]);

  return (
    <div className="space-y-5">
      <nav
        aria-label="Trades Hub"
        className="inline-flex max-w-full gap-1 overflow-x-auto rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-1"
      >
        {TABS.map((item) => {
          const active = item.id === tab;
          return (
            <button
              aria-pressed={active}
              className={`mds-button h-9 shrink-0 rounded border-0 px-3 text-[12px] ${
                active ? "mds-button--primary" : ""
              }`}
              key={item.id}
              onClick={() => setTab(item.id)}
              type="button"
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          );
        })}
      </nav>
      {content}
    </div>
  );
}
