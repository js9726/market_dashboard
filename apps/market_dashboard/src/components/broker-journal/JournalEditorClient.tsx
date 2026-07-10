"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Icon from "@/components/market-desk/Icon";

type TradeNav = { id: string; ticker: string } | null;

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

export default function JournalEditorClient({ trade }: { trade: Trade }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataSuccess, setMetadataSuccess] = useState<string | null>(null);

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

  useEffect(() => {
    fetch(`/api/journal/${trade.id}`)
      .then((r) => r.json())
      .then((entry) => {
        if (entry) {
          setSetupType(entry.setupType ?? "");
          setPrimingPattern(entry.primingPattern ?? "");
          setSetupJustification(entry.setupJustification ?? "");
          if (entry.traderScores && typeof entry.traderScores === "object") {
            setScores((prev) => ({ ...prev, ...(entry.traderScores as Record<string, TraderScore>) }));
          }
          setFundamentalGrade(entry.fundamentalGrade ?? "");
          setEntryVerdict(entry.entryVerdict ?? "");
          setEvolutionNote(entry.evolutionNote ?? "");
          setPatternNote(entry.patternNote ?? "");
          setWikiRefs(Array.isArray(entry.wikiRefs) ? entry.wikiRefs.join("\n") : "");
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [trade.id]);

  const compositeScore = useMemo(
    () =>
      TRADERS.reduce((sum, t) => {
        const s = scores[t];
        return sum + (Number(s.entry) + Number(s.risk) + Number(s.setup));
      }, 0) / TRADERS.length,
    [scores],
  );

  function updateScore(trader: string, field: keyof TraderScore, value: string | number) {
    setScores((prev) => ({
      ...prev,
      [trader]: { ...prev[trader], [field]: value },
    }));
  }

  function addTag() {
    const next = tagInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (!next.length) return;
    setTags((prev) => Array.from(new Set([...prev, ...next])));
    setTagInput("");
    setMetadataSuccess(null);
  }

  function addScreenshot() {
    const clean = screenshotInput.trim();
    if (!clean) return;
    try {
      const url = new URL(clean);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Screenshot URL must be http(s)");
      setScreenshots((prev) => Array.from(new Set([...prev, url.href])));
      setScreenshotInput("");
      setMetadataError(null);
      setMetadataSuccess(null);
    } catch (e) {
      setMetadataError(e instanceof Error ? e.message : "Invalid screenshot URL");
    }
  }

  function toggleMistake(item: string) {
    setMistakes((prev) => (prev.includes(item) ? prev.filter((m) => m !== item) : [...prev, item]));
    setMetadataSuccess(null);
  }

  async function saveMetadata() {
    setMetadataSaving(true);
    setMetadataError(null);
    setMetadataSuccess(null);
    try {
      const res = await fetch(`/api/journal/trades/${trade.id}/metadata`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, screenshots, mistakes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setMetadataSuccess("Trade anatomy saved");
    } catch (e) {
      setMetadataError(e instanceof Error ? e.message : String(e));
    } finally {
      setMetadataSaving(false);
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
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
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

  const isOpen = trade.pnl == null;
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
      actual: trade.exitPrice == null ? (isOpen ? "Open" : "-") : fmtMoney(trade.exitPrice, trade.currency),
      delta: trade.exitPrice == null ? "-" : delta(trade.exitPrice, trade.proposedSL, trade.currency),
      tone: "text-[var(--fg-3)]",
    },
    {
      label: "Target / exit",
      planned: fmtMoney(trade.proposedTP, trade.currency),
      actual: trade.exitPrice == null ? (isOpen ? "Open" : "-") : fmtMoney(trade.exitPrice, trade.currency),
      delta: trade.exitPrice == null ? "-" : delta(trade.exitPrice, trade.proposedTP, trade.currency),
      tone: "text-[var(--fg-3)]",
    },
    {
      label: "Risk / result",
      planned: fmtNum(trade.riskPct, 1, "%"),
      actual: trade.pnl == null ? "Open" : fmtSigned(trade.pnl, trade.currency),
      delta: "-",
      tone: gradeClass(trade.pnl),
    },
  ];

  return (
    <div className="space-y-5">
      <header className="market-panel p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link className="mds-button h-8 px-2 text-[11px]" href="/dashboard/portfolio">
                <Icon name="chevron-left" />
                Portfolio
              </Link>
              {trade.newerTrade ? (
                <Link className="mds-button h-8 px-2 text-[11px]" href={`/dashboard/journal/trades/${trade.newerTrade.id}`}>
                  <Icon name="chevron-left" />
                  {trade.newerTrade.ticker}
                </Link>
              ) : null}
              {trade.olderTrade ? (
                <Link className="mds-button h-8 px-2 text-[11px]" href={`/dashboard/journal/trades/${trade.olderTrade.id}`}>
                  {trade.olderTrade.ticker}
                  <Icon name="chevron-right" />
                </Link>
              ) : null}
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--fg-3)]">Trade detail</p>
            <h1 className="mt-1 flex flex-wrap items-baseline gap-3 text-[24px] font-extrabold leading-tight text-[var(--fg-1)]">
              <span className="t-ticker text-[24px]">{trade.ticker}</span>
              <span className="font-mono text-sm font-bold text-[var(--fg-3)]">
                {trade.side ?? "Side ?"} / {fmtNum(trade.quantity, 0)} @ {fmtMoney(trade.buyPrice, trade.currency)}
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
            </div>
          </div>
          <div className="min-w-[180px] rounded border border-[var(--line)] bg-[var(--bg-raised)] p-3 text-right">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--fg-3)]">Realised P&L</p>
            <p className={`font-mono text-[24px] font-extrabold ${gradeClass(trade.pnl)}`}>
              {trade.pnl == null ? "Open" : fmtSigned(trade.pnl, trade.currency)}
            </p>
            <p className="mt-1 text-[11px] text-[var(--fg-3)]">Fees {fmtMoney(trade.fees, trade.currency)}</p>
          </div>
        </div>
      </header>

      <section className="market-panel p-5">
        <div className="market-section-head">
          <div>
            <h2 className="text-sm font-extrabold text-[var(--fg-1)]">Trade Anatomy</h2>
            <p className="t-caption">Plan versus actual, tags, screenshots, and mistake labels.</p>
          </div>
          <button className="mds-button mds-button--primary h-9 px-3 text-[12px]" disabled={metadataSaving} onClick={saveMetadata} type="button">
            {metadataSaving ? "Saving..." : "Save anatomy"}
          </button>
        </div>

        <div className="mb-5 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[12px]">
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

        <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <div>
              <label className={labelClass}>Tags</label>
              <div className="mt-2 flex gap-2">
                <input
                  className={compactFieldClass}
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
                <button className="mds-button h-8 px-3 text-[11px]" onClick={addTag} type="button">
                  <Icon name="plus" />
                  Add
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {tags.length ? tags.map((tag) => (
                  <button
                    className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 font-mono text-[11px] text-[var(--fg-2)] hover:border-[var(--loss-fg)]"
                    key={tag}
                    onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
                    type="button"
                  >
                    {tag}
                  </button>
                )) : <span className="t-caption">No tags yet</span>}
              </div>
            </div>

            <div>
              <label className={labelClass}>Mistake classification</label>
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
            </div>
          </div>

          <div>
            <label className={labelClass}>Screenshot URLs</label>
            <div className="mt-2 flex gap-2">
              <input
                className={compactFieldClass}
                onChange={(e) => setScreenshotInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addScreenshot();
                  }
                }}
                placeholder="https://..."
                value={screenshotInput}
              />
              <button className="mds-button h-8 px-3 text-[11px]" onClick={addScreenshot} type="button">
                <Icon name="plus" />
                Add
              </button>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {screenshots.length ? screenshots.map((url, idx) => (
                <div className="overflow-hidden rounded border border-[var(--line)] bg-[var(--bg-raised)]" key={url}>
                  <a href={url} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary user-pasted chart URLs are outside Next Image remotePatterns. */}
                    <img alt={`Trade screenshot ${idx + 1}`} className="h-28 w-full object-cover" src={url} />
                  </a>
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <a className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--accent)] hover:underline" href={url} target="_blank" rel="noreferrer">
                      {url}
                    </a>
                    <button className="text-[11px] font-bold text-[var(--loss-fg)]" onClick={() => setScreenshots((prev) => prev.filter((item) => item !== url))} type="button">
                      Remove
                    </button>
                  </div>
                </div>
              )) : <p className="t-caption">Paste chart or trade-review screenshot URLs here.</p>}
            </div>
          </div>
        </div>

        {metadataError ? <p className="mt-3 text-[12px] text-[var(--loss-fg)]">{metadataError}</p> : null}
        {metadataSuccess ? <p className="mt-3 text-[12px] text-[var(--gain-fg)]">{metadataSuccess}</p> : null}
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
        <textarea
          className={`${fieldClass} mt-3`}
          onChange={(e) => setSetupJustification(e.target.value)}
          placeholder="One-sentence wiki-cited explanation of why this setup classification fits"
          rows={2}
          value={setupJustification}
        />
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
                      <input className={`${compactFieldClass} w-16 font-mono`} max={4} min={0} onChange={(e) => updateScore(t, "entry", Number(e.target.value))} type="number" value={s.entry} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={`${compactFieldClass} w-16 font-mono`} max={3} min={0} onChange={(e) => updateScore(t, "risk", Number(e.target.value))} type="number" value={s.risk} />
                    </td>
                    <td className="px-3 py-2">
                      <input className={`${compactFieldClass} w-16 font-mono`} max={3} min={0} onChange={(e) => updateScore(t, "setup", Number(e.target.value))} type="number" value={s.setup} />
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-[var(--fg-1)]">{Number(s.entry) + Number(s.risk) + Number(s.setup)}</td>
                    <td className="px-3 py-2">
                      <select className={`${compactFieldClass} w-24`} onChange={(e) => updateScore(t, "wouldEnter", e.target.value)} value={s.wouldEnter}>
                        <option value="Y">Y</option>
                        <option value="N">N</option>
                        <option value="Cond">Cond</option>
                      </select>
                    </td>
                    <td className="py-2 pl-3">
                      <input className={`${compactFieldClass} w-full`} onChange={(e) => updateScore(t, "why", e.target.value)} placeholder="One-line, wiki-cited" type="text" value={s.why} />
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

        {error ? <p className="mt-3 text-[12px] text-[var(--loss-fg)]">{error}</p> : null}
        {success ? <p className="mt-3 text-[12px] text-[var(--gain-fg)]">{success}</p> : null}

        <div className="mt-5 flex justify-end">
          <button className="mds-button mds-button--primary h-9 px-4 text-[12px]" disabled={saving} onClick={saveReview} type="button">
            {saving ? "Saving..." : "Save journal review"}
          </button>
        </div>
      </section>
    </div>
  );
}
