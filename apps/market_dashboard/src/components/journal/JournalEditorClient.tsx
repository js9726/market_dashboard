"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/market-desk/Icon";
import TradePriceChart from "@/components/journal/TradePriceChart";
import {
  MAX_TRADE_METADATA_ITEMS,
  MAX_TRADE_METADATA_TEXT_LENGTH,
  MAX_TRADE_SCREENSHOT_URL_LENGTH,
  MAX_TRADE_THOUGHTS_LENGTH,
  normalizeTradeScreenshotUrl,
  type TradeMetadata,
  type TradeMetadataPatch,
} from "@/lib/journal/trade-metadata";

type TradeNav = { id: string; ticker: string } | null;

type TradeFill = {
  id: string;
  side: string;
  qty: number | null;
  price: number | null;
  executedAt: string;
  fees: number | null;
  currency: string | null;
  source: string;
};

type VerdictHistoryItem = {
  id: string;
  provider: string;
  model: string;
  kind: string;
  score: number | null;
  verdict: Record<string, unknown>;
  createdAt: string;
};

type JournalLogItem = {
  id: string;
  kind: string;
  body: string;
  createdAt: string;
};

type TimelineItem = {
  id: string;
  at: string;
  title: string;
  body: string | null;
  meta: string;
  dotClass: string;
};

type Trade = {
  id: string;
  ticker: string;
  side: string | null;
  buyPrice: number | null;
  quantity: number | null;
  exitPrice: number | null;
  pnl: number | null;
  fees: number | null;
  tradeDate: string | null;
  executedAt: string | null;
  industry: string | null;
  strategy: string | null;
  notes: string | null;
  thoughts: string | null;
  state: string | null;
  proposedEntry: number | null;
  proposedSL: number | null;
  proposedTP: number | null;
  rrr: number | null;
  riskPct: number | null;
  rewardPct: number | null;
  positionPct: number | null;
  currency: string | null;
  platform: string | null;
  tags: string[];
  screenshots: string[];
  mistakes: string[];
  fills: TradeFill[];
  verdictHistory: VerdictHistoryItem[];
  journalLogs: JournalLogItem[];
  newerTrade: TradeNav;
  olderTrade: TradeNav;
};

const SETUP_TYPES = [
  "EP-FRESH",
  "EP-SECOND",
  "POST-GAP-VCP",
  "BO-VCP",
  "BO-CB",
  "PB-21EMA",
  "MA-PULLBACK",
  "POCKET-PIVOT",
  "ORH-INTRADAY",
  "PARABOLIC",
  "CONTINUATION",
  "OTHER",
];

const PRIMING_PATTERNS = [
  "INSIDE-BAR",
  "UPSIDE-REVERSAL",
  "POSITIVE-EXPECTATION-BREAKER",
  "TIGHT-SETUP-DAY",
  "NONE",
];

const TRADERS = [
  "@markminervini",
  "@Clement_Ang17",
  "@jfsrev",
  "@TedHZhang",
  "@SRxTrades",
  "@PrimeTrading_",
  "@Qullamaggie",
];

const MISTAKE_OPTIONS = [
  "Chased entry",
  "No plan",
  "Oversized",
  "Moved stop",
  "Ignored stop",
  "Late exit",
  "Sold too early",
  "Averaged down",
  "Ignored market",
  "Earnings blind spot",
  "Revenge trade",
  "Missed review",
];

type TraderScore = {
  entry: number;
  risk: number;
  setup: number;
  wouldEnter: "Y" | "N" | "Cond";
  why: string;
};

const fieldClass =
  "mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] text-[var(--fg-1)] outline-none focus:border-[var(--accent)]";
const compactFieldClass =
  "rounded border border-[var(--line)] bg-[var(--bg-surface)] px-2 py-1.5 text-[12px] text-[var(--fg-1)] outline-none focus:border-[var(--accent)]";
const labelClass = "text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--fg-3)]";

function fmtMoney(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const prefix = currency?.toUpperCase() === "MYR" ? "RM" : currency?.toUpperCase() === "USD" || !currency ? "$" : `${currency} `;
  return `${prefix}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(value: number | null | undefined, digits = 2, suffix = ""): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${suffix}`;
}

function fmtSigned(value: number | null | undefined, currency: string | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${fmtMoney(value, currency)}`;
}

function fmtDate(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleDateString();
}

function fmtDateTime(value: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function fmtQuantity(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}

function delta(actual: number | null | undefined, planned: number | null | undefined, currency: string | null | undefined): string {
  if (actual == null || planned == null) return "-";
  return fmtSigned(actual - planned, currency);
}

function gradeClass(value: number | null | undefined): string {
  if (value == null) return "text-[var(--fg-3)]";
  if (value > 0) return "text-[var(--gain-fg)]";
  if (value < 0) return "text-[var(--loss-fg)]";
  return "text-[var(--fg-3)]";
}

function emptyScores(): Record<string, TraderScore> {
  return Object.fromEntries(
    TRADERS.map((t) => [t, { entry: 0, risk: 0, setup: 0, wouldEnter: "N", why: "" }]),
  ) as Record<string, TraderScore>;
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function metadataFromTrade(trade: Pick<Trade, "tags" | "screenshots" | "mistakes" | "thoughts">): TradeMetadata {
  return {
    tags: [...trade.tags],
    screenshots: [...trade.screenshots],
    mistakes: [...trade.mistakes],
    thoughts: trade.thoughts,
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function responseError(value: unknown, fallback: string): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function firstString(value: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

function verdictSummary(verdict: Record<string, unknown>) {
  const moderator = verdict.moderator;
  if (moderator && typeof moderator === "object" && !Array.isArray(moderator)) {
    const record = moderator as Record<string, unknown>;
    return {
      title: firstString(record, ["signal"]) ?? "Agent review",
      summary: firstString(record, ["reasoning", "consensus"]),
      lesson: firstString(record, ["lesson"]),
      bestMatch: firstString(record, ["consensus"]),
      weakest: null,
    };
  }
  return {
    title: firstString(verdict, ["overall_verdict", "verdict", "signal"]) ?? "AI review",
    summary: firstString(verdict, ["summary", "lesson", "reasoning"]),
    lesson: firstString(verdict, ["lesson"]),
    bestMatch: firstString(verdict, ["best_match"]),
    weakest: firstString(verdict, ["weakest_dimension"]),
  };
}

function buildTimeline(trade: Pick<Trade, "currency" | "fills" | "journalLogs" | "verdictHistory">): TimelineItem[] {
  const reflections: TimelineItem[] = trade.journalLogs.map((item) => ({
    id: `log-${item.id}`,
    at: item.createdAt,
    title: item.kind === "THOUGHT" ? "Trader reflection" : item.kind.replaceAll("_", " "),
    body: item.body,
    meta: "Journal note",
    dotClass: "bg-[var(--accent)]",
  }));
  const executions: TimelineItem[] = trade.fills.map((fill) => {
    const isBuy = fill.side.toUpperCase() === "BUY";
    return {
      id: `fill-${fill.id}`,
      at: fill.executedAt,
      title: `${isBuy ? "Bought" : "Sold"} ${fmtQuantity(fill.qty)} @ ${fmtMoney(fill.price, fill.currency ?? trade.currency)}`,
      body: fill.fees != null ? `Fees ${fmtMoney(fill.fees, fill.currency ?? trade.currency)}` : null,
      meta: `${fill.source} execution`,
      dotClass: isBuy ? "bg-[var(--gain-fg)]" : "bg-[var(--loss-fg)]",
    };
  });
  const reviews: TimelineItem[] = trade.verdictHistory.map((item) => {
    const summary = verdictSummary(item.verdict);
    return {
      id: `review-${item.id}`,
      at: item.createdAt,
      title: `AI review · ${summary.title}`,
      body: summary.summary ?? summary.lesson,
      meta: `${item.provider} / ${item.model}`,
      dotClass: "bg-[var(--warn-500)]",
    };
  });

  return [...reflections, ...executions, ...reviews]
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 40);
}

export default function JournalEditorClient({ trade }: { trade: Trade }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataSuccess, setMetadataSuccess] = useState<string | null>(null);
  const [coaching, setCoaching] = useState(false);
  const [coachError, setCoachError] = useState<string | null>(null);
  const [coachSuccess, setCoachSuccess] = useState<string | null>(null);
  const [coachResult, setCoachResult] = useState<Record<string, unknown> | null>(null);

  const [setupType, setSetupType] = useState("");
  const [primingPattern, setPrimingPattern] = useState("");
  const [setupJustification, setSetupJustification] = useState("");
  const [scores, setScores] = useState<Record<string, TraderScore>>(() => emptyScores());
  const [fundamentalGrade, setFundamentalGrade] = useState<"" | "A" | "B" | "C">("");
  const [entryVerdict, setEntryVerdict] = useState<"" | "GOOD" | "ACCEPTABLE" | "POOR">("");
  const [evolutionNote, setEvolutionNote] = useState("");
  const [patternNote, setPatternNote] = useState("");
  const [wikiRefs, setWikiRefs] = useState("");

  const [tags, setTags] = useState<string[]>(trade.tags);
  const [tagInput, setTagInput] = useState("");
  const [screenshots, setScreenshots] = useState<string[]>(trade.screenshots);
  const [screenshotInput, setScreenshotInput] = useState("");
  const [mistakes, setMistakes] = useState<string[]>(trade.mistakes);
  const [thoughts, setThoughts] = useState(trade.thoughts ?? "");
  const [savedMetadata, setSavedMetadata] = useState<TradeMetadata>(() => metadataFromTrade(trade));

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(`/api/journal/${trade.id}`, { signal: controller.signal });
        const entry = await response.json().catch(() => null);
        if (!response.ok) throw new Error(responseError(entry, "Could not load journal review"));
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const record = entry as Record<string, unknown>;
          setSetupType(typeof record.setupType === "string" ? record.setupType : "");
          setPrimingPattern(typeof record.primingPattern === "string" ? record.primingPattern : "");
          setSetupJustification(typeof record.setupJustification === "string" ? record.setupJustification : "");
          if (record.traderScores && typeof record.traderScores === "object" && !Array.isArray(record.traderScores)) {
            setScores((prev) => ({ ...prev, ...(record.traderScores as Record<string, TraderScore>) }));
          }
          setFundamentalGrade(record.fundamentalGrade === "A" || record.fundamentalGrade === "B" || record.fundamentalGrade === "C" ? record.fundamentalGrade : "");
          setEntryVerdict(record.entryVerdict === "GOOD" || record.entryVerdict === "ACCEPTABLE" || record.entryVerdict === "POOR" ? record.entryVerdict : "");
          setEvolutionNote(typeof record.evolutionNote === "string" ? record.evolutionNote : "");
          setPatternNote(typeof record.patternNote === "string" ? record.patternNote : "");
          setWikiRefs(stringArray(record.wikiRefs).join("\n"));
        }
      } catch (loadError) {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Could not load journal review");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [trade.id]);

  const metadataDirty =
    !sameStrings(tags, savedMetadata.tags) ||
    !sameStrings(screenshots, savedMetadata.screenshots) ||
    !sameStrings(mistakes, savedMetadata.mistakes);

  const compositeScore = useMemo(
    () =>
      TRADERS.reduce((sum, t) => {
        const s = scores[t];
        return sum + (Number(s.entry) + Number(s.risk) + Number(s.setup));
      }, 0) / TRADERS.length,
    [scores],
  );
  const timelineItems = useMemo(() => buildTimeline(trade), [trade]);

  function updateScore(trader: string, field: keyof TraderScore, value: string | number) {
    setScores((prev) => ({
      ...prev,
      [trader]: { ...prev[trader], [field]: value },
    }));
  }

  function clearMetadataStatus() {
    setMetadataError(null);
    setMetadataSuccess(null);
  }

  function addTag() {
    setMetadataSuccess(null);
    const next = tagInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!next.length) return;
    const overlong = next.find((item) => item.length > MAX_TRADE_METADATA_TEXT_LENGTH);
    if (overlong) {
      setMetadataError(`Tags cannot exceed ${MAX_TRADE_METADATA_TEXT_LENGTH} characters`);
      return;
    }
    const seen = new Set(tags.map((item) => item.toLocaleLowerCase("en-US")));
    const merged = [...tags];
    for (const item of next) {
      const key = item.toLocaleLowerCase("en-US");
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    if (merged.length > MAX_TRADE_METADATA_ITEMS) {
      setMetadataError(`A trade can have at most ${MAX_TRADE_METADATA_ITEMS} tags`);
      return;
    }
    setTags(merged);
    setTagInput("");
    clearMetadataStatus();
  }

  function addScreenshot() {
    setMetadataSuccess(null);
    if (screenshots.length >= MAX_TRADE_METADATA_ITEMS) {
      setMetadataError(`A trade can have at most ${MAX_TRADE_METADATA_ITEMS} screenshots`);
      return;
    }
    const normalized = normalizeTradeScreenshotUrl(screenshotInput);
    if (!normalized.ok) {
      setMetadataError(normalized.error);
      return;
    }
    if (!screenshots.includes(normalized.value)) setScreenshots((prev) => [...prev, normalized.value]);
    setScreenshotInput("");
    clearMetadataStatus();
  }

  function toggleMistake(item: string) {
    setMistakes((prev) => (prev.includes(item) ? prev.filter((m) => m !== item) : [...prev, item]));
    clearMetadataStatus();
  }

  function removeTag(tag: string) {
    setTags((prev) => prev.filter((item) => item !== tag));
    clearMetadataStatus();
  }

  function removeScreenshot(url: string) {
    setScreenshots((prev) => prev.filter((item) => item !== url));
    clearMetadataStatus();
  }

  async function saveMetadata() {
    const patch: TradeMetadataPatch = {};
    if (!sameStrings(tags, savedMetadata.tags)) patch.tags = tags;
    if (!sameStrings(screenshots, savedMetadata.screenshots)) patch.screenshots = screenshots;
    if (!sameStrings(mistakes, savedMetadata.mistakes)) patch.mistakes = mistakes;
    if (!Object.keys(patch).length) return;

    setMetadataSaving(true);
    setMetadataError(null);
    setMetadataSuccess(null);
    try {
      const res = await fetch(`/api/journal/trades/${trade.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseError(json, "Save failed"));
      const persisted = json && typeof json === "object" && !Array.isArray(json)
        ? (json as { trade?: Record<string, unknown> }).trade
        : null;
      if (!persisted) throw new Error("Save response did not include the trade metadata");
      const nextMetadata = {
        tags: stringArray(persisted.tags),
        screenshots: stringArray(persisted.screenshots),
        mistakes: stringArray(persisted.mistakes),
        thoughts: savedMetadata.thoughts,
      };
      setTags(nextMetadata.tags);
      setScreenshots(nextMetadata.screenshots);
      setMistakes(nextMetadata.mistakes);
      setSavedMetadata(nextMetadata);
      setMetadataSuccess("Trade anatomy saved");
    } catch (e) {
      setMetadataError(e instanceof Error ? e.message : String(e));
    } finally {
      setMetadataSaving(false);
    }
  }

  async function saveThoughtsAndReview() {
    setCoaching(true);
    setCoachError(null);
    setCoachSuccess(null);
    let thoughtsSaved = false;
    try {
      const metadataResponse = await fetch(`/api/journal/trades/${trade.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thoughts }),
      });
      const metadataJson = await metadataResponse.json().catch(() => null);
      if (!metadataResponse.ok) throw new Error(responseError(metadataJson, "Could not save thoughts"));
      const persisted = metadataJson && typeof metadataJson === "object" && !Array.isArray(metadataJson)
        ? (metadataJson as { trade?: Record<string, unknown> }).trade
        : null;
      if (!persisted) throw new Error("Save response did not include the trade");
      const persistedThoughts = typeof persisted.thoughts === "string" && persisted.thoughts.trim()
        ? persisted.thoughts.trim()
        : null;
      setThoughts(persistedThoughts ?? "");
      setSavedMetadata((previous) => ({ ...previous, thoughts: persistedThoughts }));
      thoughtsSaved = true;

      if (!persistedThoughts) {
        setCoachResult(null);
        setCoachSuccess("Thoughts cleared");
        router.refresh();
        return;
      }

      const reviewResponse = await fetch("/api/analysis/trade-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tradeId: trade.id, force: true, style: "trader-debate" }),
      });
      const reviewJson = await reviewResponse.json().catch(() => null);
      if (!reviewResponse.ok) throw new Error(responseError(reviewJson, "AI review failed"));
      if (!reviewJson || typeof reviewJson !== "object" || Array.isArray(reviewJson)) {
        throw new Error("AI review returned an invalid response");
      }
      const review = Object.fromEntries(
        Object.entries(reviewJson as Record<string, unknown>).filter(([key]) => key !== "_meta"),
      );
      setCoachResult(review);
      setCoachSuccess("Thoughts saved and AI review added to history");
      router.refresh();
    } catch (coachFailure) {
      const message = coachFailure instanceof Error ? coachFailure.message : "Review failed";
      setCoachError(thoughtsSaved ? `Thoughts saved, but ${message}` : message);
    } finally {
      setCoaching(false);
    }
  }

  async function saveReview() {
    setError(null);
    setSuccess(null);
    if (!setupType || !entryVerdict) {
      setError("Setup type and entry verdict are required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/journal/${trade.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setupType,
          primingPattern: primingPattern || undefined,
          setupJustification: setupJustification || undefined,
          traderScores: scores,
          fundamentalGrade: fundamentalGrade || undefined,
          compositeScore,
          entryVerdict,
          evolutionNote: evolutionNote || undefined,
          patternNote: patternNote || undefined,
          wikiRefs: wikiRefs.split("\n").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseError(json, "Save failed"));
      setSuccess("Journal review saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="market-panel p-6">
        <p className="t-caption">Loading journal entry...</p>
      </section>
    );
  }

  const normalizedState = trade.state?.toUpperCase() ?? null;
  const isOpen =
    normalizedState === "OPEN" ||
    normalizedState === "SEMI-OPEN" ||
    normalizedState === "PLANNING" ||
    (normalizedState == null && trade.pnl == null);
  const pendingResult = normalizedState === "PLANNING" ? "Planned" : isOpen ? "Open" : "Not recorded";
  const planRows = [
    {
      label: "Entry",
      planned: fmtMoney(trade.proposedEntry, trade.currency),
      actual: fmtMoney(trade.buyPrice, trade.currency),
      delta: delta(trade.buyPrice, trade.proposedEntry, trade.currency),
      tone: "text-[var(--fg-3)]",
    },
    {
      label: "Stop / exit",
      planned: fmtMoney(trade.proposedSL, trade.currency),
      actual: trade.exitPrice == null ? pendingResult : fmtMoney(trade.exitPrice, trade.currency),
      delta: trade.exitPrice == null ? "-" : delta(trade.exitPrice, trade.proposedSL, trade.currency),
      tone: "text-[var(--fg-3)]",
    },
    {
      label: "Target / exit",
      planned: fmtMoney(trade.proposedTP, trade.currency),
      actual: trade.exitPrice == null ? pendingResult : fmtMoney(trade.exitPrice, trade.currency),
      delta: trade.exitPrice == null ? "-" : delta(trade.exitPrice, trade.proposedTP, trade.currency),
      tone: "text-[var(--fg-3)]",
    },
    {
      label: "Risk / result",
      planned: fmtNum(trade.riskPct, 1, "%"),
      actual: trade.pnl == null ? pendingResult : fmtSigned(trade.pnl, trade.currency),
      delta: "-",
      tone: gradeClass(trade.pnl),
    },
  ];
  const latestCoachVerdict = coachResult ?? trade.verdictHistory[0]?.verdict ?? null;
  const latestCoachSummary = latestCoachVerdict ? verdictSummary(latestCoachVerdict) : null;
  const thoughtsCanSave = thoughts.trim().length > 0 || savedMetadata.thoughts != null;

  return (
    <div className="space-y-5">
      <header className="market-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link className="mds-button h-8 px-2 text-[11px]" href="/dashboard/trades">
                <Icon name="chevron-left" />
                Trades
              </Link>
              {trade.newerTrade ? (
                <Link
                  aria-label={`Open newer trade ${trade.newerTrade.ticker}`}
                  className="mds-button h-8 px-2 text-[11px]"
                  href={`/dashboard/journal/trades/${trade.newerTrade.id}`}
                >
                  <Icon name="chevron-left" />
                  {trade.newerTrade.ticker}
                </Link>
              ) : null}
              {trade.olderTrade ? (
                <Link
                  aria-label={`Open older trade ${trade.olderTrade.ticker}`}
                  className="mds-button h-8 px-2 text-[11px]"
                  href={`/dashboard/journal/trades/${trade.olderTrade.id}`}
                >
                  {trade.olderTrade.ticker}
                  <Icon name="chevron-right" />
                </Link>
              ) : null}
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fg-3)]">Trade detail</p>
            <h1 className="mt-1 flex flex-wrap items-baseline gap-3 text-[24px] font-extrabold leading-tight text-[var(--fg-1)]">
              <span className="t-ticker text-[24px]">{trade.ticker}</span>
              <span className="font-mono text-sm font-bold text-[var(--fg-3)]">
                {trade.side ?? "Side ?"} / {fmtQuantity(trade.quantity)} @ {fmtMoney(trade.buyPrice, trade.currency)}
              </span>
            </h1>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded bg-[var(--bg-raised)] px-2 py-1 font-mono text-[11px] text-[var(--fg-2)]">
                {fmtDate(trade.tradeDate ?? trade.executedAt)}
              </span>
              <span className="rounded bg-[var(--bg-raised)] px-2 py-1 font-mono text-[11px] text-[var(--fg-2)]">
                {trade.state ?? (isOpen ? "OPEN" : "CLOSE")}
              </span>
              {trade.platform ? (
                <span className="rounded bg-[var(--bg-raised)] px-2 py-1 font-mono text-[11px] text-[var(--fg-2)]">
                  {trade.platform}
                </span>
              ) : null}
              {trade.strategy ? (
                <span className="rounded bg-[var(--accent-soft-bg)] px-2 py-1 font-mono text-[11px] font-bold text-[var(--accent)]">
                  {trade.strategy}
                </span>
              ) : null}
              {trade.industry ? (
                <span className="rounded bg-[var(--bg-raised)] px-2 py-1 text-[11px] text-[var(--fg-2)]">
                  {trade.industry}
                </span>
              ) : null}
            </div>
            {trade.notes ? <p className="mt-3 max-w-3xl text-[12px] leading-relaxed text-[var(--fg-2)]">{trade.notes}</p> : null}
          </div>
          <div className="min-w-[180px] rounded border border-[var(--line)] bg-[var(--bg-raised)] p-3 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--fg-3)]">
              {isOpen ? "Position status" : "Realised P&L"}
            </p>
            <p className={`font-mono text-[24px] font-extrabold ${gradeClass(trade.pnl)}`}>
              {trade.pnl == null ? pendingResult : fmtSigned(trade.pnl, trade.currency)}
            </p>
            <p className="mt-1 text-[11px] text-[var(--fg-3)]">Fees {fmtMoney(trade.fees, trade.currency)}</p>
          </div>
        </div>
      </header>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,0.75fr)]">
        <TradePriceChart
          entry={trade.buyPrice}
          exit={trade.exitPrice}
          fills={trade.fills}
          stop={trade.proposedSL}
          target={trade.proposedTP}
          ticker={trade.ticker}
          tradeId={trade.id}
        />

        <section className="market-panel p-5">
          <div className="market-section-head">
            <div>
              <h2 className="text-sm font-extrabold text-[var(--fg-1)]">Trade Thesis &amp; AI Coach</h2>
              <p className="t-caption">Your decision record and latest persisted coaching verdict.</p>
            </div>
            <button
              aria-busy={coaching}
              className="mds-button mds-button--primary h-9 px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={coaching || !thoughtsCanSave}
              onClick={saveThoughtsAndReview}
              type="button"
            >
              <Icon className="h-4 w-4" name="bolt" />
              {coaching ? "Reviewing..." : "Save & review"}
            </button>
          </div>

          <label className={labelClass} htmlFor="trade-thoughts">Your thesis and reflection</label>
          <textarea
            className={`${fieldClass} min-h-40 resize-y leading-relaxed`}
            id="trade-thoughts"
            maxLength={MAX_TRADE_THOUGHTS_LENGTH}
            name="trade-thoughts"
            onChange={(event) => setThoughts(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !coaching && thoughtsCanSave) {
                event.preventDefault();
                void saveThoughtsAndReview();
              }
            }}
            placeholder="Setup, trigger, risk, emotions, and what changed after entry"
            value={thoughts}
          />
          <div className="mt-1 text-right font-mono text-[10px] text-[var(--fg-4)]">
            {thoughts.length}/{MAX_TRADE_THOUGHTS_LENGTH}
          </div>

          <div className="mt-4 border-t border-[var(--line)] pt-4">
            <p className={labelClass}>Latest AI feedback</p>
            {latestCoachSummary ? (
              <div className="mt-2 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded border border-[var(--accent)] px-2 py-1 text-[11px] font-extrabold text-[var(--accent)]">
                    {latestCoachSummary.title}
                  </span>
                  {latestCoachSummary.bestMatch ? <span className="text-[11px] text-[var(--fg-3)]">{latestCoachSummary.bestMatch}</span> : null}
                </div>
                {latestCoachSummary.summary ? <p className="text-[12px] leading-relaxed text-[var(--fg-1)]">{latestCoachSummary.summary}</p> : null}
                {latestCoachSummary.lesson && latestCoachSummary.lesson !== latestCoachSummary.summary ? (
                  <p className="text-[12px] leading-relaxed text-[var(--fg-2)]">{latestCoachSummary.lesson}</p>
                ) : null}
                {latestCoachSummary.weakest ? (
                  <p className="border-t border-[var(--line)] pt-3 text-[11px] text-[var(--fg-3)]">
                    Weakest dimension: <strong className="text-[var(--warn-500)]">{latestCoachSummary.weakest}</strong>
                  </p>
                ) : null}
              </div>
            ) : <p className="mt-2 text-[12px] text-[var(--fg-3)]">No persisted AI feedback yet.</p>}
          </div>

          <div aria-live="polite">
            {coachError ? <p className="mt-3 text-[12px] text-[var(--loss-fg)]" role="alert">{coachError}</p> : null}
            {coachSuccess ? <p className="mt-3 text-[12px] text-[var(--gain-fg)]" role="status">{coachSuccess}</p> : null}
          </div>
        </section>
      </div>

      <section className="market-panel overflow-hidden">
        <header className="border-b border-[var(--line)] px-5 py-4">
          <h2 className="text-sm font-extrabold text-[var(--fg-1)]">Journal Timeline</h2>
          <p className="t-caption">Reflections, executions, and AI reviews in one audit trail.</p>
        </header>
        {timelineItems.length ? (
          <ol className="divide-y divide-[var(--line)]">
            {timelineItems.map((item) => (
              <li className="flex gap-3 px-5 py-3" key={item.id}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.dotClass}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="text-[12px] font-extrabold text-[var(--fg-1)]">{item.title}</p>
                    <time className="font-mono text-[10px] text-[var(--fg-3)]" dateTime={item.at}>{fmtDateTime(item.at)}</time>
                  </div>
                  <p className="mt-0.5 font-mono text-[9px] uppercase text-[var(--fg-4)]">{item.meta}</p>
                  {item.body ? <p className="mt-2 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--fg-2)]">{item.body}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="px-5 py-5 text-[12px] text-[var(--fg-3)]">No timeline events have been recorded yet.</p>
        )}
      </section>

      <section className="market-panel p-5">
        <div className="market-section-head">
          <div>
            <h2 className="text-sm font-extrabold text-[var(--fg-1)]">Trade Anatomy</h2>
            <p className="t-caption">Plan versus actual, tags, screenshots, and mistake labels.</p>
          </div>
          <button
            aria-busy={metadataSaving}
            className="mds-button mds-button--primary h-9 px-3 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={metadataSaving || !metadataDirty}
            onClick={saveMetadata}
            type="button"
          >
            {metadataSaving ? "Saving..." : metadataDirty ? "Save anatomy" : "Saved"}
          </button>
        </div>

        <div className="mb-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
            <caption className="sr-only">Planned versus actual trade values</caption>
            <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-3 font-bold">Field</th>
                <th className="px-3 py-2 font-bold">Planned</th>
                <th className="px-3 py-2 font-bold">Actual</th>
                <th className="px-3 py-2 font-bold">Delta</th>
              </tr>
            </thead>
            <tbody>
              {planRows.map((row) => (
                <tr className="border-b border-[var(--line)] last:border-0" key={row.label}>
                  <td className="py-2 pr-3 font-bold text-[var(--fg-2)]">{row.label}</td>
                  <td className="px-3 py-2 font-mono text-[var(--fg-1)]">{row.planned}</td>
                  <td className="px-3 py-2 font-mono text-[var(--fg-1)]">{row.actual}</td>
                  <td className={`px-3 py-2 font-mono font-bold ${row.tone}`}>{row.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {trade.rrr != null || trade.rewardPct != null || trade.positionPct != null ? (
          <dl className="mb-5 grid grid-cols-1 gap-3 border-y border-[var(--line)] py-3 sm:grid-cols-3">
            <div>
              <dt className={labelClass}>Planned R:R</dt>
              <dd className="mt-1 font-mono text-[13px] font-bold text-[var(--fg-1)]">{fmtNum(trade.rrr)}</dd>
            </div>
            <div>
              <dt className={labelClass}>Planned reward</dt>
              <dd className="mt-1 font-mono text-[13px] font-bold text-[var(--fg-1)]">{fmtNum(trade.rewardPct, 1, "%")}</dd>
            </div>
            <div>
              <dt className={labelClass}>Planned position</dt>
              <dd className="mt-1 font-mono text-[13px] font-bold text-[var(--fg-1)]">{fmtNum(trade.positionPct, 1, "%")}</dd>
            </div>
          </dl>
        ) : null}

        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-[12px] font-extrabold text-[var(--fg-1)]">Execution fills</h3>
            <span className="font-mono text-[10px] text-[var(--fg-3)]">{trade.fills.length} linked</span>
          </div>
          {trade.fills.length ? (
            <div className="overflow-x-auto rounded border border-[var(--line)]">
              <table className="w-full min-w-[720px] text-left text-[11px]">
                <caption className="sr-only">Linked broker and manual execution fills</caption>
                <thead className="bg-[var(--bg-raised)] text-[10px] uppercase tracking-[0.1em] text-[var(--fg-3)]">
                  <tr>
                    <th className="px-3 py-2 font-bold">Executed</th>
                    <th className="px-3 py-2 font-bold">Side</th>
                    <th className="px-3 py-2 text-right font-bold">Quantity</th>
                    <th className="px-3 py-2 text-right font-bold">Price</th>
                    <th className="px-3 py-2 text-right font-bold">Fees</th>
                    <th className="px-3 py-2 font-bold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {trade.fills.map((fill) => (
                    <tr className="border-t border-[var(--line)]" key={fill.id}>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-[var(--fg-2)]">{fmtDateTime(fill.executedAt)}</td>
                      <td className={`px-3 py-2 font-bold ${fill.side.toUpperCase() === "BUY" ? "text-[var(--gain-fg)]" : "text-[var(--loss-fg)]"}`}>
                        {fill.side}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--fg-1)]">{fmtQuantity(fill.qty)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--fg-1)]">{fmtMoney(fill.price, fill.currency ?? trade.currency)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[var(--fg-2)]">{fmtMoney(fill.fees, fill.currency ?? trade.currency)}</td>
                      <td className="px-3 py-2 font-mono text-[var(--fg-3)]">{fill.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="rounded border border-dashed border-[var(--line)] px-3 py-3 text-[11px] text-[var(--fg-3)]">
              No execution fills are linked to this trade yet.
            </p>
          )}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <div>
              <label className={labelClass} htmlFor="trade-tags">Tags</label>
              <div className="mt-2 flex gap-2">
                <input
                  className={compactFieldClass}
                  id="trade-tags"
                  name="trade-tags"
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="gap-up, earnings, vcp"
                  value={tagInput}
                />
                <button
                  className="mds-button h-8 px-3 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={tags.length >= MAX_TRADE_METADATA_ITEMS}
                  onClick={addTag}
                  type="button"
                >
                  <Icon name="plus" />
                  Add
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {tags.length ? tags.map((tag) => (
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--line)] bg-[var(--bg-raised)] py-1 pl-2 pr-1 font-mono text-[11px] text-[var(--fg-2)]" key={tag}>
                    <span>{tag}</span>
                    <button
                      aria-label={`Remove tag ${tag}`}
                      className="rounded p-0.5 text-[var(--fg-3)] hover:bg-[var(--loss-bg)] hover:text-[var(--loss-fg)]"
                      onClick={() => removeTag(tag)}
                      title={`Remove ${tag}`}
                      type="button"
                    >
                      <Icon className="h-3 w-3" name="x" />
                    </button>
                  </span>
                )) : <span className="t-caption">No tags yet</span>}
              </div>
            </div>

            <fieldset>
              <legend className={labelClass}>Mistake classification</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {MISTAKE_OPTIONS.map((item) => {
                  const active = mistakes.includes(item);
                  return (
                    <button
                      aria-pressed={active}
                      className={`rounded border px-3 py-2 text-left text-[12px] font-bold ${
                        active
                          ? "border-[var(--loss-fg)] bg-[var(--loss-bg)] text-[var(--loss-fg)]"
                          : "border-[var(--line)] bg-[var(--bg-raised)] text-[var(--fg-2)]"
                      }`}
                      key={item}
                      onClick={() => toggleMistake(item)}
                      type="button"
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div>
            <label className={labelClass} htmlFor="trade-screenshot-url">Screenshot URLs</label>
            <div className="mt-2 flex gap-2">
              <input
                className={compactFieldClass}
                id="trade-screenshot-url"
                maxLength={MAX_TRADE_SCREENSHOT_URL_LENGTH}
                name="trade-screenshot-url"
                onChange={(e) => setScreenshotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addScreenshot();
                  }
                }}
                placeholder="https://..."
                type="url"
                value={screenshotInput}
              />
              <button
                className="mds-button h-8 px-3 text-[11px] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={screenshots.length >= MAX_TRADE_METADATA_ITEMS}
                onClick={addScreenshot}
                type="button"
              >
                <Icon name="plus" />
                Add
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {screenshots.length ? screenshots.map((url, idx) => (
                <div className="overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-raised)]" key={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary user-pasted chart URLs are outside Next Image remotePatterns. */}
                    <img
                      alt={`Trade screenshot ${idx + 1}`}
                      className="h-28 w-full object-cover"
                      decoding="async"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      src={url}
                    />
                  </a>
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <a className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--accent)] hover:underline" href={url} target="_blank" rel="noopener noreferrer">
                      {url}
                    </a>
                    <button
                      aria-label={`Remove screenshot ${idx + 1}`}
                      className="rounded p-1 text-[var(--fg-3)] hover:bg-[var(--loss-bg)] hover:text-[var(--loss-fg)]"
                      onClick={() => removeScreenshot(url)}
                      title="Remove screenshot"
                      type="button"
                    >
                      <Icon className="h-3.5 w-3.5" name="x" />
                    </button>
                  </div>
                </div>
              )) : <p className="t-caption">Paste chart or trade-review screenshot URLs here.</p>}
            </div>
          </div>
        </div>

        <div aria-live="polite">
          {metadataError ? <p className="mt-3 text-[12px] text-[var(--loss-fg)]" role="alert">{metadataError}</p> : null}
          {metadataSuccess ? <p className="mt-3 text-[12px] text-[var(--gain-fg)]" role="status">{metadataSuccess}</p> : null}
        </div>
      </section>

      <section className="market-panel p-5">
        <div className="market-section-head">
          <div>
            <h2 className="text-sm font-extrabold text-[var(--fg-1)]">AI Review History</h2>
            <p className="t-caption">Persisted trade verdicts, newest first.</p>
          </div>
          <Link className="mds-button h-9 px-3 text-[12px]" href="/dashboard/trades">
            <Icon name="trades" />
            Trades Hub
          </Link>
        </div>

        {trade.verdictHistory.length ? (
          <div className="space-y-2">
            {trade.verdictHistory.map((item, index) => {
              const summary = verdictSummary(item.verdict);
              return (
                <details className="group rounded border border-[var(--line)] bg-[var(--bg-raised)]" key={item.id} open={index === 0}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-[12px] text-[var(--fg-1)]">{summary.title}</span>
                        <span className="rounded border border-[var(--line)] px-1.5 py-0.5 font-mono text-[9px] uppercase text-[var(--fg-3)]">{item.kind}</span>
                      </div>
                      <p className="mt-1 truncate font-mono text-[10px] text-[var(--fg-3)]">
                        {item.provider} / {item.model} / {fmtDateTime(item.createdAt)}
                      </p>
                    </div>
                    {item.score != null ? (
                      <span className="font-mono text-[13px] font-extrabold text-[var(--accent)]">{item.score.toFixed(1)}</span>
                    ) : null}
                    <Icon className="h-4 w-4 text-[var(--fg-3)] transition-transform group-open:rotate-180" name="chevron-down" />
                  </summary>
                  <div className="border-t border-[var(--line)] px-3 py-3">
                    {summary.summary ? <p className="text-[12px] leading-relaxed text-[var(--fg-2)]">{summary.summary}</p> : null}
                    {summary.lesson && summary.lesson !== summary.summary ? (
                      <p className="mt-2 text-[12px] leading-relaxed text-[var(--fg-2)]">{summary.lesson}</p>
                    ) : null}
                    {summary.bestMatch || summary.weakest ? (
                      <dl className="mt-3 grid gap-3 border-t border-[var(--line)] pt-3 sm:grid-cols-2">
                        {summary.bestMatch ? (
                          <div>
                            <dt className={labelClass}>Best match / consensus</dt>
                            <dd className="mt-1 text-[12px] text-[var(--fg-1)]">{summary.bestMatch}</dd>
                          </div>
                        ) : null}
                        {summary.weakest ? (
                          <div>
                            <dt className={labelClass}>Weakest dimension</dt>
                            <dd className="mt-1 text-[12px] text-[var(--fg-1)]">{summary.weakest}</dd>
                          </div>
                        ) : null}
                      </dl>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <p className="rounded border border-dashed border-[var(--line)] px-3 py-4 text-[12px] text-[var(--fg-3)]">
            No AI review has been saved for this trade.
          </p>
        )}
      </section>

      <section className="market-panel p-5">
        <div className="market-section-head">
          <div>
            <h2 className="text-sm font-extrabold text-[var(--fg-1)]">Setup Classification</h2>
            <p className="t-caption">Wiki-grounded setup and priming pattern.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={labelClass}>
            Setup type
            <select className={fieldClass} onChange={(e) => setSetupType(e.target.value)} required value={setupType}>
              <option value="">Choose</option>
              {SETUP_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className={labelClass}>
            Priming pattern
            <select className={fieldClass} onChange={(e) => setPrimingPattern(e.target.value)} value={primingPattern}>
              <option value="">None</option>
              {PRIMING_PATTERNS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <label className={`${labelClass} mt-4 block`}>
          Setup rationale
          <textarea
            className={fieldClass}
            onChange={(e) => setSetupJustification(e.target.value)}
            placeholder="One-sentence wiki-cited explanation of why this setup classification fits"
            rows={2}
            value={setupJustification}
          />
        </label>
      </section>

      <section className="market-panel p-5">
        <div className="market-section-head">
          <div>
            <h2 className="text-sm font-extrabold text-[var(--fg-1)]">7-Trader Rubric</h2>
            <p className="t-caption">
              Composite <span className="font-mono font-bold text-[var(--fg-1)]">{compositeScore.toFixed(1)}</span> / 10
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-[12px]">
            <thead className="text-[10px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
              <tr className="border-b border-[var(--line)]">
                <th className="py-2 pr-3 font-bold">Trader</th>
                <th className="px-3 py-2 font-bold">Entry</th>
                <th className="px-3 py-2 font-bold">Risk</th>
                <th className="px-3 py-2 font-bold">Setup</th>
                <th className="px-3 py-2 font-bold">Total</th>
                <th className="px-3 py-2 font-bold">Enter?</th>
                <th className="py-2 pl-3 font-bold">Why</th>
              </tr>
            </thead>
            <tbody>
              {TRADERS.map((t) => {
                const s = scores[t];
                return (
                  <tr className="border-b border-[var(--line)] last:border-0" key={t}>
                    <td className="py-2 pr-3 font-bold text-[var(--fg-2)]">{t}</td>
                    <td className="px-3 py-2">
                      <input aria-label={`${t} entry score`} className={`${compactFieldClass} w-16 font-mono`} max={4} min={0} onChange={(e) => updateScore(t, "entry", Number(e.target.value))} type="number" value={s.entry} />
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label={`${t} risk score`} className={`${compactFieldClass} w-16 font-mono`} max={3} min={0} onChange={(e) => updateScore(t, "risk", Number(e.target.value))} type="number" value={s.risk} />
                    </td>
                    <td className="px-3 py-2">
                      <input aria-label={`${t} setup score`} className={`${compactFieldClass} w-16 font-mono`} max={3} min={0} onChange={(e) => updateScore(t, "setup", Number(e.target.value))} type="number" value={s.setup} />
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-[var(--fg-1)]">{Number(s.entry) + Number(s.risk) + Number(s.setup)}</td>
                    <td className="px-3 py-2">
                      <select aria-label={`${t} would enter`} className={`${compactFieldClass} w-24`} onChange={(e) => updateScore(t, "wouldEnter", e.target.value)} value={s.wouldEnter}>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                        <option value="Cond">Cond</option>
                      </select>
                    </td>
                    <td className="py-2 pl-3">
                      <input aria-label={`${t} rationale`} className={`${compactFieldClass} w-full`} onChange={(e) => updateScore(t, "why", e.target.value)} placeholder="One-line, wiki-cited" type="text" value={s.why} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="market-panel p-5">
        <div className="market-section-head">
          <div>
            <h2 className="text-sm font-extrabold text-[var(--fg-1)]">Verdict Notes</h2>
            <p className="t-caption">Outcome, evolution note, pattern note, and source refs.</p>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={labelClass}>
            Entry verdict
            <select className={fieldClass} onChange={(e) => setEntryVerdict(e.target.value as "" | "GOOD" | "ACCEPTABLE" | "POOR")} required value={entryVerdict}>
              <option value="">Choose</option>
              <option value="GOOD">GOOD</option>
              <option value="ACCEPTABLE">ACCEPTABLE</option>
              <option value="POOR">POOR</option>
            </select>
          </label>
          <label className={labelClass}>
            Fundamental grade
            <select className={fieldClass} onChange={(e) => setFundamentalGrade(e.target.value as "" | "A" | "B" | "C")} value={fundamentalGrade}>
              <option value="">None</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </label>
        </div>
        <label className={`${labelClass} mt-4 block`}>
          Evolution note
          <textarea className={fieldClass} onChange={(e) => setEvolutionNote(e.target.value)} rows={2} value={evolutionNote} />
        </label>
        <label className={`${labelClass} mt-4 block`}>
          Pattern note
          <textarea className={fieldClass} onChange={(e) => setPatternNote(e.target.value)} rows={2} value={patternNote} />
        </label>
        <label className={`${labelClass} mt-4 block`}>
          Wiki refs consulted
          <textarea
            className={`${fieldClass} font-mono`}
            onChange={(e) => setWikiRefs(e.target.value)}
            placeholder={"wiki/trader-styles.md\nwiki/qullamaggie-breakouts-episodic-pivots.md"}
            rows={3}
            value={wikiRefs}
          />
        </label>

        <div aria-live="polite">
          {error ? <p className="mt-3 text-[12px] text-[var(--loss-fg)]" role="alert">{error}</p> : null}
          {success ? <p className="mt-3 text-[12px] text-[var(--gain-fg)]" role="status">{success}</p> : null}
        </div>

        <div className="mt-5 flex justify-end">
          <button
            aria-busy={saving}
            className="mds-button mds-button--primary h-9 px-4 text-[12px] disabled:cursor-not-allowed disabled:opacity-50"
            disabled={saving}
            onClick={saveReview}
            type="button"
          >
            {saving ? "Saving..." : "Save journal review"}
          </button>
        </div>
      </section>
    </div>
  );
}
