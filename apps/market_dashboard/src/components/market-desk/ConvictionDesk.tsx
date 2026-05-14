/**
 * Unified Conviction Desk — single scrollable page that blends what used to
 * be three separate pages (Conviction Desk + Morning Brief + Market Overview).
 *
 * Layout:
 *   1. MorningBriefHero  — live indices, trader read, standout, AI-selectable
 *                          full HTML brief, owner re-run controls
 *   2. LiveTapeRow        — sectors + watchlist, polled every 30s
 *   3. PipelineStages     — 6-stage pipeline cards (still hardcoded counts)
 *   4. SpotlightAndIdeas  — spotlight + live ideas row, verdict-driven
 */
import MorningBriefHero from "./MorningBriefHero";
import LiveTapeRow from "./LiveTapeRow";
import PipelineStages from "./PipelineStages";
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
      <PipelineStages />
      <SpotlightAndIdeas />
    </div>
  );
}
