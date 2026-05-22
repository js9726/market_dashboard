"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Trade = {
  id: string;
  ticker: string;
  side: string | null;
  buyPrice: number | null;
  quantity: number | null;
  tradeDate: string | null;
  executedAt: string | null;
  industry: string | null;
  state: string | null;
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

type TraderScore = {
  entry: number;
  risk: number;
  setup: number;
  wouldEnter: "Y" | "N" | "Cond";
  why: string;
};

export default function JournalEditorClient({ trade }: { trade: Trade }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [setupType, setSetupType] = useState("");
  const [primingPattern, setPrimingPattern] = useState("");
  const [setupJustification, setSetupJustification] = useState("");
  const [scores, setScores] = useState<Record<string, TraderScore>>(
    () => Object.fromEntries(TRADERS.map((t) => [t, { entry: 0, risk: 0, setup: 0, wouldEnter: "N", why: "" }])),
  );
  const [fundamentalGrade, setFundamentalGrade] = useState<"" | "A" | "B" | "C">("");
  const [entryVerdict, setEntryVerdict] = useState<"" | "GOOD" | "ACCEPTABLE" | "POOR">("");
  const [evolutionNote, setEvolutionNote] = useState("");
  const [patternNote, setPatternNote] = useState("");
  const [wikiRefs, setWikiRefs] = useState<string>("");  // newline-separated input

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
        setLoading(false);
      });
  }, [trade.id]);

  const compositeScore =
    TRADERS.reduce((sum, t) => {
      const s = scores[t];
      return sum + (s.entry + s.risk + s.setup);
    }, 0) / TRADERS.length;

  function updateScore(trader: string, field: keyof TraderScore, value: string | number) {
    setScores((prev) => ({
      ...prev,
      [trader]: { ...prev[trader], [field]: value },
    }));
  }

  async function save() {
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
      setSuccess("Saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div style={{ padding: "2rem" }}>Loading…</div>;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 1000 }}>
      <header style={{ marginBottom: "1rem" }}>
        <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>
          Journal: {trade.ticker}{" "}
          <span style={{ fontWeight: "normal", color: "#6b7280", fontSize: "1rem" }}>
            · {trade.side} · {trade.quantity ?? "?"} @ {trade.buyPrice ?? "?"} ·{" "}
            {trade.tradeDate ? new Date(trade.tradeDate).toLocaleDateString() : "—"}
          </span>
        </h1>
        <Link href="/dashboard/portfolio" style={{ color: "#1d4ed8", fontSize: "0.9rem" }}>
          ← Back to portfolio
        </Link>
      </header>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Setup classification</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.5rem" }}>
          <label>
            Setup type
            <select
              value={setupType}
              onChange={(e) => setSetupType(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
              required
            >
              <option value="">-- choose --</option>
              {SETUP_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>
            Priming pattern
            <select
              value={primingPattern}
              onChange={(e) => setPrimingPattern(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
            >
              <option value="">-- none --</option>
              {PRIMING_PATTERNS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        <textarea
          value={setupJustification}
          onChange={(e) => setSetupJustification(e.target.value)}
          rows={2}
          placeholder="One-sentence wiki-cited explanation of why this setup classification fits"
          style={{ width: "100%", padding: "0.5rem", boxSizing: "border-box" }}
        />
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>
          7-trader rubric{" "}
          <span style={{ fontWeight: "normal", color: "#6b7280", fontSize: "0.9rem" }}>
            (composite: <strong>{compositeScore.toFixed(1)}</strong> / 10)
          </span>
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
          <thead>
            <tr style={{ color: "#6b7280", borderBottom: "1px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "0.25rem 0.5rem" }}>Trader</th>
              <th style={{ padding: "0.25rem 0.5rem" }}>Entry (0-4)</th>
              <th style={{ padding: "0.25rem 0.5rem" }}>Risk (0-3)</th>
              <th style={{ padding: "0.25rem 0.5rem" }}>Setup (0-3)</th>
              <th style={{ padding: "0.25rem 0.5rem" }}>Total</th>
              <th style={{ padding: "0.25rem 0.5rem" }}>Would enter?</th>
              <th style={{ padding: "0.25rem 0.5rem" }}>Why</th>
            </tr>
          </thead>
          <tbody>
            {TRADERS.map((t) => {
              const s = scores[t];
              return (
                <tr key={t} style={{ borderBottom: "1px solid #f3f4f6" }}>
                  <td style={{ padding: "0.25rem 0.5rem", fontWeight: 600 }}>{t}</td>
                  <td style={{ padding: "0.25rem 0.5rem" }}>
                    <input type="number" min={0} max={4} value={s.entry}
                      onChange={(e) => updateScore(t, "entry", Number(e.target.value))}
                      style={{ width: "3.5rem", padding: "0.25rem" }} />
                  </td>
                  <td style={{ padding: "0.25rem 0.5rem" }}>
                    <input type="number" min={0} max={3} value={s.risk}
                      onChange={(e) => updateScore(t, "risk", Number(e.target.value))}
                      style={{ width: "3.5rem", padding: "0.25rem" }} />
                  </td>
                  <td style={{ padding: "0.25rem 0.5rem" }}>
                    <input type="number" min={0} max={3} value={s.setup}
                      onChange={(e) => updateScore(t, "setup", Number(e.target.value))}
                      style={{ width: "3.5rem", padding: "0.25rem" }} />
                  </td>
                  <td style={{ padding: "0.25rem 0.5rem", fontWeight: 600 }}>{s.entry + s.risk + s.setup}</td>
                  <td style={{ padding: "0.25rem 0.5rem" }}>
                    <select value={s.wouldEnter}
                      onChange={(e) => updateScore(t, "wouldEnter", e.target.value)}
                      style={{ padding: "0.25rem" }}>
                      <option value="Y">Y</option>
                      <option value="N">N</option>
                      <option value="Cond">Cond</option>
                    </select>
                  </td>
                  <td style={{ padding: "0.25rem 0.5rem" }}>
                    <input type="text" value={s.why}
                      onChange={(e) => updateScore(t, "why", e.target.value)}
                      placeholder="One-line, wiki-cited"
                      style={{ width: "100%", padding: "0.25rem", boxSizing: "border-box" }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.05rem", marginBottom: "0.5rem" }}>Verdict</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <label>
            Entry verdict
            <select
              value={entryVerdict}
              onChange={(e) => setEntryVerdict(e.target.value as "" | "GOOD" | "ACCEPTABLE" | "POOR")}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
              required
            >
              <option value="">-- choose --</option>
              <option value="GOOD">GOOD</option>
              <option value="ACCEPTABLE">ACCEPTABLE</option>
              <option value="POOR">POOR</option>
            </select>
          </label>
          <label>
            Fundamental grade
            <select
              value={fundamentalGrade}
              onChange={(e) => setFundamentalGrade(e.target.value as "" | "A" | "B" | "C")}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
            >
              <option value="">-- none --</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </select>
          </label>
        </div>
      </section>

      <section style={{ marginBottom: "1.5rem" }}>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>
          Evolution note (one specific improvement for next trade)
          <textarea
            value={evolutionNote}
            onChange={(e) => setEvolutionNote(e.target.value)}
            rows={2}
            style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
          />
        </label>
        <label style={{ display: "block", marginBottom: "0.5rem" }}>
          Pattern note (vs last 5 trades — recurring weakness/improvement trend)
          <textarea
            value={patternNote}
            onChange={(e) => setPatternNote(e.target.value)}
            rows={2}
            style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
          />
        </label>
        <label style={{ display: "block" }}>
          Wiki refs consulted (one per line)
          <textarea
            value={wikiRefs}
            onChange={(e) => setWikiRefs(e.target.value)}
            rows={3}
            placeholder="wiki/trader-styles.md&#10;wiki/qullamaggie-breakouts-episodic-pivots.md"
            style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", fontFamily: "monospace", fontSize: "0.85rem", boxSizing: "border-box" }}
          />
        </label>
      </section>

      {error && <div style={{ color: "#b91c1c", marginBottom: "0.5rem" }}>{error}</div>}
      {success && <div style={{ color: "#16a34a", marginBottom: "0.5rem" }}>{success}</div>}

      <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "0.5rem 1.25rem",
            background: saving ? "#9ca3af" : "#1d4ed8",
            color: "white",
            border: "none",
            borderRadius: "0.375rem",
            cursor: saving ? "wait" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save journal entry"}
        </button>
      </div>
    </div>
  );
}
