/**
 * Unified Conviction Desk — single scrollable page that blends what used to
 * be three separate pages (Conviction Desk + Morning Brief + Market Overview).
 *
 * Layout:
 *   1. MorningBriefHero  — live indices, trader read, standout, AI-selectable
 *                          full HTML brief, owner re-run controls
 *   2. LiveTapeRow        — compact sector strip + watchlist, polled every 30s
 *   3. SpotlightAndIdeas  — spotlight + live ideas row, verdict-driven
 *
 * Deep market-internals tools (RVOL / Theme Radar / Rotation) live on the
 * dedicated /dashboard/internals tab. The fake hardcoded PipelineStages was
 * removed 2026-06-01 to keep the desk client-facing clean.
 */
import MorningBriefHero from "./MorningBriefHero";
import LiveTapeRow from "./LiveTapeRow";
import SpotlightAndIdeas from "./SpotlightAndIdeas";
import TvScreenerHits from "./TvScreenerHits";
import WatchlistEditor from "./WatchlistEditor";

interface ConvictionDeskProps {
  isOwner?: boolean;
}

export default function ConvictionDesk({ isOwner = false }: ConvictionDeskProps) {
  return (
    <div className="space-y-5">
      <MorningBriefHero isOwner={isOwner} />
      <TvScreenerHits />
      {/* Watchlist editor is owner-only — other viewers see the live tape but can't edit */}
      {isOwner && <WatchlistEditor />}
      <LiveTapeRow />
      <SpotlightAndIdeas />
    </div>
  );
}
