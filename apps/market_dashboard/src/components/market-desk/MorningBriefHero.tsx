"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useMorningVerdict, type BriefProviderName } from "@/hooks/useMorningVerdict";
import { useLiveQuotes, type LiveQuoteRow } from "@/hooks/useLiveQuotes";
import type { StructuredBrief } from "@/types/structured-brief";
import MarketBreadthPanels from "./MarketBreadthPanels";
import FreshnessBadge from "./FreshnessBadge";
import { BRIEF_THRESHOLDS, LIVE_QUOTE_THRESHOLDS } from "@/lib/freshness";

const INDICES = [
  { symbol: "SPX", fallbackSymbol: "SPY" },
  { symbol: "NDX", fallbackSymbol: "QQQ" },
  { symbol: "RUT", fallbackSymbol: "IWM" },
  { symbol: "DJI", fallbackSymbol: "DIA" },
  { symbol: "VIX", fallbackSymbol: "^VIX" },
];

const PROVIDER_LABEL: Record<BriefProviderName, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini 2.5",
  openai: "GPT-4o",
  claude: "Claude",
};

interface BriefView {
  moodLabel?: string | null;
  moodSummary?: string | null;
  posture?: string | null;
  standout?: StructuredBrief["standout"];
  traders?: StructuredBrief["traderLens"];
  breadth?: StructuredBrief["breadth"];
  fearGreed?: StructuredBrief["fearGreed"];
  structured?: StructuredBrief | null;
}

interface LegacyVerdictShape {
  mood?: string;
  posture?: string;
  standout?: StructuredBrief["standout"];
  traders?: StructuredBrief["traderLens"];
  breadth?: StructuredBrief["breadth"];
  fearGreed?: StructuredBrief["fearGreed"];
}

interface MorningBriefHeroProps {
  isOwner?: boolean;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asBriefView(payload: unknown): BriefView {
  const obj = asObject(payload);
  if (!obj) return {};

  const mood = asObject(obj.mood);
  if (mood) {
    const structured = obj as unknown as StructuredBrief;
    return {
      moodLabel: typeof mood.label === "string" ? mood.label : null,
      moodSummary: typeof mood.summary === "string" ? mood.summary : null,
      posture: typeof mood.posture === "string" ? mood.posture : null,
      standout: structured.standout ?? null,
      traders: structured.traderLens ?? [],
      breadth: structured.breadth ?? null,
      fearGreed: structured.fearGreed ?? null,
      structured,
    };
  }

  const legacy = obj as LegacyVerdictShape;
  return {
    moodLabel: legacy.mood ?? null,
    moodSummary: legacy.mood ?? null,
    posture: legacy.posture ?? null,
    standout: legacy.standout ?? null,
    traders: legacy.traders ?? [],
    breadth: legacy.breadth ?? null,
    fearGreed: legacy.fearGreed ?? null,
    structured: null,
  };
}

function formatNumber(value: number | null | undefined): string {
  if (value == null) return "-";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function changeClass(value: number | null | undefined): string {
  if (value == null) return "text-[var(--fg-3)]";
  if (value > 0) return "gain";
  if (value < 0) return "loss";
  return "";
}

function providerEntries(data: ReturnType<typeof useMorningVerdict>["data"]) {
  return data ? (Object.keys(data.providers) as BriefProviderName[]) : [];
}

export default function MorningBriefHero({ isOwner = false }: MorningBriefHeroProps) {
  const verdict = useMorningVerdict();
  const liveQuotes = useLiveQuotes();
  const [selected, setSelected] = useState<BriefProviderName>("deepseek");
  const [rerunMessage, setRerunMessage] = useState<string | null>(null);

  const availableProviders = useMemo<BriefProviderName[]>(() => {
    return providerEntries(verdict.data).filter((p) => verdict.data?.providers[p]);
  }, [verdict.data]);

  const effectiveProvider: BriefProviderName | null = useMemo(() => {
    if (!verdict.data) return null;
    if (verdict.data.providers[selected]) return selected;
    return availableProviders[0] ?? null;
  }, [selected, availableProviders, verdict.data]);

  const entry = effectiveProvider && verdict.data ? verdict.data.providers[effectiveProvider] : null;
  const briefView = asBriefView(entry?.structured ?? entry?.verdict);
  const briefSummary =
    briefView.moodLabel && briefView.moodSummary && briefView.moodLabel !== briefView.moodSummary
      ? `${briefView.moodLabel}: ${briefView.moodSummary}`
      : briefView.moodSummary ?? briefView.moodLabel ?? "Live brief loading...";

  async function handleRerun(provider: BriefProviderName) {
    setRerunMessage(`Re-running ${PROVIDER_LABEL[provider]}...`);
    const res = await verdict.rerunProvider(provider);
    if (res.ok) {
      setRerunMessage(`${PROVIDER_LABEL[provider]} refreshed.`);
      setSelected(provider);
    } else if (res.retryInSec) {
      setRerunMessage(`Rate limited. Try again in ${res.retryInSec}s.`);
    } else {
      setRerunMessage(`Re-run failed: ${res.error ?? "unknown"}`);
    }
    setTimeout(() => setRerunMessage(null), 6000);
  }

  const dateLabel = new Date().toLocaleDateString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <section className="conviction-brief">
      <div className="conviction-brief__head">
        <div>
          <div className="flex items-center gap-3">
            <p className="t-overline">Morning Brief</p>
            <FreshnessBadge timestamp={entry?.generatedAt} thresholds={BRIEF_THRESHOLDS} />
          </div>
          <h2>
            {dateLabel}
            {briefView.posture ? ` - ${briefView.posture}` : ""}
          </h2>
          <p className="t-body-small">{briefSummary}</p>
        </div>
        <div className="conviction-brief__meta">
          <BreadthMetric verdict={briefView} />
          <FearGreedMetric verdict={briefView} />
          <PostureMetric verdict={briefView} />
        </div>
      </div>

      <div className="conviction-brief__body">
        <IndicesCard
          quotes={liveQuotes.bySymbol}
          activeSource={liveQuotes.activeSource}
          briefIndices={briefView.structured?.indices ?? null}
        />
        <TradersCard verdict={briefView} />
        <StandoutCard verdict={briefView} />
      </div>

      <div className="border-t border-[var(--line)] px-5 py-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="t-overline text-[var(--fg-3)]">Brief by</span>
          <div className="flex gap-1 rounded-md bg-[var(--bg-raised)] p-1">
            {(Object.keys(PROVIDER_LABEL) as BriefProviderName[]).map((provider) => {
              const providerEntry = verdict.data?.providers[provider];
              const isActive = effectiveProvider === provider;
              return (
                <button
                  key={provider}
                  type="button"
                  disabled={!providerEntry}
                  onClick={() => setSelected(provider)}
                  className={`rounded px-2.5 py-1 text-[11px] font-bold transition ${
                    isActive
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : providerEntry
                        ? "text-[var(--fg-2)] hover:text-[var(--fg-1)]"
                        : "text-[var(--fg-3)] opacity-40 cursor-not-allowed"
                  }`}
                  title={
                    providerEntry
                      ? `${PROVIDER_LABEL[provider]} generated ${new Date(providerEntry.generatedAt).toLocaleTimeString()}`
                      : `${PROVIDER_LABEL[provider]} not generated for this bucket`
                  }
                >
                  {PROVIDER_LABEL[provider]}
                  {providerEntry?.stale ? <span className="ml-1 text-[9px] opacity-60">stale</span> : null}
                </button>
              );
            })}
          </div>
          {entry ? (
            <FreshnessBadge timestamp={entry.generatedAt} thresholds={BRIEF_THRESHOLDS} />
          ) : null}
        </div>
        {isOwner ? (
          <div className="flex items-center gap-2">
            {(Object.keys(PROVIDER_LABEL) as BriefProviderName[]).map((provider) => (
              <button
                key={provider}
                type="button"
                onClick={() => handleRerun(provider)}
                disabled={verdict.rerunning === provider}
                className="mds-button h-7 rounded px-2 text-[10px] font-bold"
                title={`Force-regenerate ${PROVIDER_LABEL[provider]} for the current bucket`}
              >
                {verdict.rerunning === provider ? "..." : "Refresh"} {PROVIDER_LABEL[provider]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {rerunMessage ? (
        <div className="border-t border-[var(--line)] bg-[var(--bg-raised)] px-5 py-2 t-caption">
          {rerunMessage}
        </div>
      ) : null}

      <MarketBreadthPanels />

      <div className="border-t border-[var(--line)] p-5">
        {verdict.loading && !entry ? (
          <p className="t-body-small">Loading brief...</p>
        ) : verdict.error && !entry ? (
          <p className="t-body-small text-[var(--loss-fg)]">Failed to load: {verdict.error}</p>
        ) : !entry ? (
          <p className="t-body-small">No brief generated yet for the current bucket.</p>
        ) : entry.error ? (
          <p className="t-body-small text-[var(--loss-fg)]">Provider failed: {entry.error}</p>
        ) : briefView.structured ? (
          <BriefDetails brief={briefView.structured} />
        ) : entry.html ? (
          <div dangerouslySetInnerHTML={{ __html: entry.html }} />
        ) : (
          <p className="t-body-small">Brief payload is empty.</p>
        )}
      </div>
    </section>
  );
}

function IndicesCard({
  quotes,
  activeSource,
  briefIndices,
}: {
  quotes: Map<string, LiveQuoteRow>;
  activeSource: string | null;
  briefIndices: StructuredBrief["indices"];
}) {
  const briefBySymbol = new Map((briefIndices ?? []).map((row) => [row.symbol, row]));

  // Freshest quote across SPY/QQQ/IWM/DIA — used to badge the panel header.
  const freshestObservedAt = INDICES.reduce<string | null>((latest, { symbol, fallbackSymbol }) => {
    const q = quotes.get(symbol) ?? quotes.get(fallbackSymbol);
    if (!q) return latest;
    if (!latest) return q.observedAt;
    return new Date(q.observedAt).getTime() > new Date(latest).getTime() ? q.observedAt : latest;
  }, null);

  return (
    <div className="conviction-brief__card">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="t-overline text-[var(--fg-3)]">
          Indices {activeSource ? <span className="t-caption">- {activeSource}</span> : null}
        </p>
        <FreshnessBadge timestamp={freshestObservedAt} thresholds={LIVE_QUOTE_THRESHOLDS} />
      </div>
      <ul className="compact-list">
        {INDICES.map(({ symbol, fallbackSymbol }) => {
          const quote = quotes.get(symbol);
          const fallbackQuote = quotes.get(fallbackSymbol);
          const symbolBriefRow = briefBySymbol.get(symbol);
          const fallbackBriefRow = briefBySymbol.get(fallbackSymbol);
          const briefRow = symbolBriefRow ?? fallbackBriefRow;
          const activeQuote = quote ?? fallbackQuote;
          const displaySymbol = quote || symbolBriefRow ? symbol : fallbackSymbol;
          const price = activeQuote?.price ?? briefRow?.level ?? null;
          const changePct = activeQuote?.changePct ?? briefRow?.changePct ?? null;
          return (
            <li key={symbol}>
              <span className="t-ticker">{displaySymbol}</span>
              <span>{formatNumber(price)}</span>
              <span className={changeClass(changePct)}>
                {formatPct(changePct)}
                {activeQuote?.stale ? <span className="ml-1 text-[9px] opacity-60">stale</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TradersCard({ verdict }: { verdict: BriefView }) {
  const traders = verdict.traders ?? [];
  if (traders.length === 0) {
    return (
      <div className="conviction-brief__card">
        <p className="t-overline text-[var(--fg-3)]">Trader read</p>
        <p className="t-caption mt-2">Awaiting verdict...</p>
      </div>
    );
  }
  return (
    <div className="conviction-brief__card">
      <p className="t-overline text-[var(--fg-3)]">Trader read</p>
      <ul className="space-y-2 mt-2">
        {traders.slice(0, 5).map((trader) => (
          <li key={trader.name} className="t-body-small">
            <b>{trader.name}:</b>{" "}
            <span className="text-[var(--fg-2)]">{trader.view}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StandoutCard({ verdict }: { verdict: BriefView }) {
  const standout = verdict.standout;
  if (!standout?.ticker) {
    return (
      <div className="conviction-brief__card conviction-brief__card--standout">
        <p className="t-overline">Today&apos;s Standout</p>
        <p className="t-caption mt-3">Awaiting verdict...</p>
      </div>
    );
  }

  const isLong = (standout.side ?? "LONG").toUpperCase() === "LONG";
  const bg = isLong ? "var(--gain-bg)" : "var(--loss-bg)";
  const fg = isLong ? "var(--gain-fg)" : "var(--loss-fg)";

  return (
    <div className="conviction-brief__card conviction-brief__card--standout">
      <p className="t-overline">Today&apos;s Standout</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="t-metric">{standout.ticker}</span>
        <span className="rounded px-2 py-1 text-[10px] font-bold" style={{ background: bg, color: fg }}>
          {(standout.side ?? "LONG").toUpperCase()}
        </span>
        {standout.score != null ? (
          <span className="rounded px-2 py-1 font-mono text-[11px] font-bold" style={{ background: bg, color: fg }}>
            GO {standout.score}
          </span>
        ) : null}
      </div>
      {standout.thesis ? <p className="t-body-small mt-3">{standout.thesis}</p> : null}
    </div>
  );
}

function BriefDetails({ brief }: { brief: StructuredBrief }) {
  const watchlist = brief.watchlist?.slice(0, 8) ?? [];
  const movers = brief.movers?.slice(0, 8) ?? [];
  const industryMovers = brief.industryMovers?.slice(0, 6) ?? [];
  const calendar = brief.calendar?.slice(0, 5) ?? [];
  const sectors = brief.sectorsThemes?.slice(0, 6) ?? [];
  const citations = brief.citations?.slice(0, 5) ?? [];

  return (
    <div className="brief-placeholder-grid">
      <BriefPanel title="Index read" span="wide">
        <p className="t-body-small">{brief.indicesNarrative ?? "No index narrative yet."}</p>
      </BriefPanel>

      <BriefPanel title="Rotation">
        <p className="t-body-small">{brief.sectorsNarrative ?? "No sector read yet."}</p>
        {sectors.length ? (
          <ul className="brief-chip-list mt-3">
            {sectors.map((sector) => (
              <li key={sector.symbol}>
                <span className="t-ticker">{sector.symbol}</span>
                <span className={changeClass(sector.changePct)}>{formatPct(sector.changePct)}</span>
                {sector.rs != null ? <span>RS {formatNumber(sector.rs)}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </BriefPanel>

      <BriefPanel title="Industry movers">
        <p className="t-body-small">{brief.industryNarrative ?? "No industry read yet."}</p>
        <IndustryMoverRows rows={industryMovers} />
      </BriefPanel>

      <BriefPanel title="Watchlist">
        <StructuredRows
          rows={watchlist.map((row) => ({
            key: row.ticker,
            main: row.ticker,
            metric: formatPct(row.changePct),
            metricClass: changeClass(row.changePct),
            note: `${row.abc ?? "-"} ${row.note ?? ""}`.trim(),
          }))}
          empty="No watchlist rows."
        />
      </BriefPanel>

      <BriefPanel title="Movers">
        <StructuredRows
          rows={movers.map((mover) => ({
            key: `${mover.ticker}-${mover.side ?? "side"}`,
            main: mover.ticker,
            metric: formatPct(mover.changePct),
            metricClass: changeClass(mover.changePct),
            note: mover.why ?? "",
          }))}
          empty="No mover rows."
        />
      </BriefPanel>

      <BriefPanel title="Calendar">
        <StructuredRows
          rows={calendar.map((item, index) => ({
            key: `${item.time ?? "time"}-${index}`,
            main: item.time ?? "-",
            metric: item.name ?? "-",
            note: item.consensus ?? "",
          }))}
          empty="No calendar rows."
        />
      </BriefPanel>

      <BriefPanel title="Sources" span="wide">
        {brief.alert ? <p className="t-body-small mb-3 text-[var(--accent)]">{brief.alert}</p> : null}
        <ul className="space-y-1">
          {citations.length ? (
            citations.map((citation, index) => (
              <li key={index} className="t-caption text-[var(--fg-3)]">
                {citation}
              </li>
            ))
          ) : (
            <li className="t-caption text-[var(--fg-3)]">Snapshot-fed DeepSeek refresh.</li>
          )}
        </ul>
      </BriefPanel>
    </div>
  );
}

function formatIndustryLeaders(
  leaders: NonNullable<StructuredBrief["industryMovers"]>[number]["leaders"] | null | undefined,
): string {
  return (leaders ?? [])
    .slice(0, 3)
    .map((leader) => `${leader.ticker} ${formatPct(leader.changePct)}`)
    .join(", ");
}

function IndustryMoverRows({ rows }: { rows: NonNullable<StructuredBrief["industryMovers"]> }) {
  if (rows.length === 0) {
    return <p className="t-caption mt-3 text-[var(--fg-3)]">No industry mover rows.</p>;
  }

  return (
    <ul className="brief-rows brief-rows--industry mt-3">
      {rows.map((row) => {
        const leaders = formatIndustryLeaders(row.leaders);
        const context = [
          row.sector,
          leaders ? `Leaders: ${leaders}` : null,
          row.breadthPct != null ? `${formatNumber(row.breadthPct)}% >50SMA` : null,
          row.deltaWow != null ? `WoW ${formatPct(row.deltaWow)}` : null,
          row.note,
        ]
          .filter(Boolean)
          .join(" - ");

        return (
          <li key={row.industry}>
            <span className="font-semibold text-[var(--fg-1)]">{row.industry}</span>
            <span className={changeClass(row.changePct)}>{formatPct(row.changePct)}</span>
            <span>{context || "No driver note."}</span>
          </li>
        );
      })}
    </ul>
  );
}

function BriefPanel({
  title,
  span,
  children,
}: {
  title: string;
  span?: "wide";
  children: ReactNode;
}) {
  return (
    <div className={`brief-panel ${span === "wide" ? "brief-panel--wide" : ""}`}>
      <p className="t-overline text-[var(--fg-3)]">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function StructuredRows({
  rows,
  empty,
}: {
  rows: Array<{ key: string; main: string; metric: string; metricClass?: string; note: string }>;
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="t-caption text-[var(--fg-3)]">{empty}</p>;
  }

  return (
    <ul className="brief-rows">
      {rows.map((row) => (
        <li key={row.key}>
          <span className="t-ticker">{row.main}</span>
          <span className={row.metricClass ?? "text-[var(--fg-2)]"}>{row.metric}</span>
          <span>{row.note}</span>
        </li>
      ))}
    </ul>
  );
}

function BreadthMetric({ verdict }: { verdict: BriefView }) {
  const up = verdict.breadth?.up ?? null;
  const down = verdict.breadth?.down ?? null;
  return (
    <div className="conviction-brief__metric">
      <span className="t-overline text-[var(--fg-3)]">Breadth</span>
      <span className="conviction-brief__value">
        {up == null && down == null ? "-" : `${up ?? "?"}/${down ?? "?"}`}
      </span>
      <span className="t-caption">UP / DOWN</span>
    </div>
  );
}

function FearGreedMetric({ verdict }: { verdict: BriefView }) {
  const score = verdict.fearGreed?.score;
  return (
    <div className="conviction-brief__metric">
      <span className="t-overline text-[var(--fg-3)]">Fear &amp; Greed</span>
      <span className="conviction-brief__value">{score ?? "-"}</span>
      <span className="t-caption">{verdict.fearGreed?.label ?? ""}</span>
    </div>
  );
}

function PostureMetric({ verdict }: { verdict: BriefView }) {
  const posture = verdict.posture ?? "-";
  const cls =
    posture.toUpperCase().includes("RAISE") || posture.toUpperCase().includes("PASS")
      ? "loss"
      : posture.toUpperCase().includes("GO")
        ? "gain"
        : "";
  return (
    <div className="conviction-brief__metric">
      <span className="t-overline text-[var(--fg-3)]">Posture</span>
      <span className={`conviction-brief__value ${cls} text-base`}>{posture}</span>
      <span className="t-caption">From brief</span>
    </div>
  );
}
