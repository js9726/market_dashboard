"use client";

import { useMemo, useState } from "react";
import { useMorningVerdict } from "@/hooks/useMorningVerdict";
import type { StructuredBrief, BriefMover, BriefTraderView } from "@/types/structured-brief";
import FreshnessBadge from "./FreshnessBadge";
import { BRIEF_THRESHOLDS } from "@/lib/freshness";
import { selectFreshestBriefProvider } from "@/lib/brief/provider-selection";

type FilterKey = "All" | "Longs" | "Shorts" | "High conviction";
const FILTERS: FilterKey[] = ["All", "Longs", "Shorts", "High conviction"];

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asStructuredBrief(value: unknown): StructuredBrief | null {
  const obj = asObject(value);
  if (!obj || !("standout" in obj)) return null;
  return obj as unknown as StructuredBrief;
}

function formatPrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

function applyFilter(movers: BriefMover[], filter: FilterKey, standoutTicker: string | null): BriefMover[] {
  switch (filter) {
    case "Longs":
      return movers.filter((m) => (m.side ?? "").toUpperCase() === "LONG");
    case "Shorts":
      return movers.filter((m) => (m.side ?? "").toUpperCase() === "SHORT");
    case "High conviction":
      // BriefMover has no per-row score field yet — treat the standout as the
      // only "high conviction" row until the prompt adds `score` to movers.
      // TODO: when `score: number | null` is added to BriefMover, switch this
      // to `movers.filter((m) => (m.score ?? 0) >= 80)`.
      return standoutTicker ? movers.filter((m) => m.ticker === standoutTicker) : [];
    default:
      return movers;
  }
}

export default function SpotlightAndIdeas() {
  const verdict = useMorningVerdict();
  const [filter, setFilter] = useState<FilterKey>("All");

  const entry = verdict.data ? selectFreshestBriefProvider(verdict.data.providers)?.entry ?? null : null;
  const brief = asStructuredBrief(entry?.structured ?? entry?.verdict);
  const standout = brief?.standout ?? null;
  const movers: BriefMover[] = useMemo(() => brief?.movers ?? [], [brief?.movers]);
  const traderViews: BriefTraderView[] = brief?.traderLens ?? [];
  const filteredMovers = useMemo(
    () => applyFilter(movers, filter, standout?.ticker ?? null),
    [movers, filter, standout?.ticker],
  );

  const ticker = standout?.ticker ?? "-";
  const side = (standout?.side ?? "LONG").toUpperCase();
  const score = standout?.score ?? null;
  const isLong = side === "LONG";
  const sideStyle = {
    background: isLong ? "var(--gain-bg)" : "var(--loss-bg)",
    color: isLong ? "var(--gain-fg)" : "var(--loss-fg)",
  };

  return (
    <section className="conviction-grid">
      <div className="space-y-3">
        <div className="market-section-head">
          <div className="flex items-center gap-3">
            <p className="t-overline">Live Ideas</p>
            <FreshnessBadge timestamp={entry?.generatedAt} thresholds={BRIEF_THRESHOLDS} />
          </div>
          <p className="t-caption">
            {movers.length} idea{movers.length !== 1 ? "s" : ""}
            {filter !== "All" ? ` - ${filteredMovers.length} after filter` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = filter === f;
            return (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 text-xs font-bold transition ${
                  active
                    ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "border-[var(--line)] bg-[var(--bg-surface)] text-[var(--fg-2)] hover:text-[var(--fg-1)]"
                }`}
              >
                {f}
              </button>
            );
          })}
        </div>

        {filteredMovers.length === 0 ? (
          <p className="t-caption text-[var(--fg-3)]">
            {movers.length === 0
              ? "Awaiting structured movers..."
              : `No movers match "${filter}".`}
          </p>
        ) : (
          <div className="space-y-2">
            {filteredMovers.map((mover) => (
              <IdeaRow
                key={`${mover.ticker}-${mover.side ?? "side"}`}
                mover={mover}
                isStandout={mover.ticker === standout?.ticker}
              />
            ))}
          </div>
        )}
      </div>

      <aside className="spotlight-card">
        <div className="spotlight-gauge">{score ?? "-"}</div>
        <p className="t-overline">Spotlight</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="t-metric">{ticker}</span>
          <span className="rounded px-2 py-1 text-[10px] font-bold" style={sideStyle}>
            {side}
          </span>
        </div>
        <p className="t-caption t-mono mt-1">
          {standout?.sector ?? "-"}
          {standout?.rs != null ? ` - RS ${standout.rs}` : ""}
          {standout?.grade ? ` - ${standout.grade}` : ""}
        </p>
        <p className="t-body-small mt-4 border-t border-[var(--line)] pt-4">
          {standout?.thesis ?? "Awaiting structured verdict..."}
        </p>
        {standout?.entry != null || standout?.stop != null || standout?.target != null ? (
          <p className="t-caption t-mono mt-2">
            Entry <b>{formatPrice(standout?.entry)}</b> &nbsp; Stop{" "}
            <b>{formatPrice(standout?.stop)}</b> &nbsp; Target{" "}
            <b>{formatPrice(standout?.target)}</b> &nbsp; R/R{" "}
            <b>{formatPrice(standout?.rrr)}</b>
          </p>
        ) : null}
        {standout?.tags?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {standout.tags.map((tag) => (
              <span
                className="rounded bg-[var(--bg-raised)] px-2 py-1 text-[10px] font-bold text-[var(--fg-2)]"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-4 border-t border-[var(--line)] pt-4">
          <p className="t-overline text-[var(--fg-3)]">Trader Verdicts</p>
          {traderViews.length === 0 ? (
            <p className="t-caption mt-2 text-[var(--fg-3)]">
              Trader verdicts unavailable for this brief.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {traderViews.map((trader) => (
                <li key={trader.name} className="t-body-small">
                  <span className="t-overline text-[var(--fg-2)]">{trader.name}:</span>{" "}
                  <span className="text-[var(--fg-2)]">{trader.view}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </section>
  );
}

function IdeaRow({ mover, isStandout }: { mover: BriefMover; isStandout: boolean }) {
  const side = (mover.side ?? "LONG").toUpperCase();
  const isLong = side === "LONG";
  const sideStyle = {
    background: isLong ? "var(--gain-bg)" : "var(--loss-bg)",
    color: isLong ? "var(--gain-fg)" : "var(--loss-fg)",
  };
  const changeClass =
    mover.changePct == null ? "text-[var(--fg-3)]" :
    mover.changePct > 0 ? "gain" :
    mover.changePct < 0 ? "loss" : "";

  return (
    <article className={`idea-row ${isStandout ? "is-selected" : ""}`}>
      <div className="idea-row__side" style={sideStyle}>
        {side}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="idea-row__ticker">{mover.ticker}</span>
          {mover.changePct != null ? (
            <span className={`t-caption t-mono ${changeClass}`}>
              {mover.changePct >= 0 ? "+" : ""}{mover.changePct.toFixed(2)}%
            </span>
          ) : null}
          {isStandout ? (
            <span className="rounded bg-[var(--bg-raised)] px-2 py-1 text-[10px] font-bold text-[var(--fg-2)]">
              STANDOUT
            </span>
          ) : null}
        </div>
        {mover.why ? <p className="t-body-small mt-1">{mover.why}</p> : null}
        {mover.traderLens ? (
          <p className="t-caption mt-1 text-[var(--fg-3)]">
            <span className="t-overline">Lens:</span> {mover.traderLens}
          </p>
        ) : null}
      </div>
    </article>
  );
}
