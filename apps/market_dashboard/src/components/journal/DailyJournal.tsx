"use client";

import { useCallback, useEffect, useState } from "react";
import MoodEmojiPicker from "./MoodEmojiPicker";
import {
  MARKET_CONDITIONS,
  SLEEP_HOURS_MAX,
  SLEEP_HOURS_MIN,
  moodLabel,
} from "@/lib/journal/mood";

interface JournalEntryDto {
  id: string;
  entryDate: string;
  moodEmoji: string | null;
  sleepHours: string | number | null;
  marketConditions: string | null;
  notes: string | null;
  tvLinks: string[];
  attachmentUrls: string[];
  createdAt: string;
  updatedAt: string;
}

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseSleep(raw: string | number | null): string {
  if (raw == null) return "";
  return String(raw);
}

export default function DailyJournal() {
  const [date, setDate] = useState<string>(todayIsoDate);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [mood, setMood] = useState<string | null>(null);
  const [sleep, setSleep] = useState<string>("");
  const [conditions, setConditions] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");
  const [tvLinks, setTvLinks] = useState<string[]>([]);
  const [newLink, setNewLink] = useState<string>("");

  const loadEntry = useCallback(async (d: string) => {
    setLoading(true);
    setError(null);
    setSavedAt(null);
    try {
      const r = await fetch(`/api/journal/entry?date=${encodeURIComponent(d)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const entry: JournalEntryDto | null = await r.json();
      if (entry) {
        setMood(entry.moodEmoji);
        setSleep(parseSleep(entry.sleepHours));
        setConditions(entry.marketConditions);
        setNotes(entry.notes ?? "");
        setTvLinks(Array.isArray(entry.tvLinks) ? entry.tvLinks : []);
      } else {
        setMood(null);
        setSleep("");
        setConditions(null);
        setNotes("");
        setTvLinks([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entry");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntry(date);
  }, [date, loadEntry]);

  function addLink() {
    const trimmed = newLink.trim();
    if (!trimmed) return;
    if (tvLinks.length >= 10) {
      setError("Maximum 10 links per entry");
      return;
    }
    setTvLinks((cur) => [...cur, trimmed]);
    setNewLink("");
  }

  function removeLink(idx: number) {
    setTvLinks((cur) => cur.filter((_, i) => i !== idx));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSavedAt(null);
    const sleepNum = sleep.trim() === "" ? null : Number(sleep);
    try {
      const r = await fetch("/api/journal/entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          moodEmoji: mood,
          sleepHours: sleepNum,
          marketConditions: conditions,
          notes: notes || null,
          tvLinks,
        }),
      });
      const payload = (await r.json()) as { error?: string };
      if (!r.ok) {
        throw new Error(payload.error || `HTTP ${r.status}`);
      }
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Daily Journal</p>
          <p className="t-caption">
            Mood, sleep, market conditions, reflection notes, and chart links — one entry per day.
            Image upload coming soon (Feature 7.2).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="t-caption" htmlFor="journal-date">Date</label>
          <input
            id="journal-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded border border-[var(--line)] bg-[var(--bg-raised)] px-2 py-1 text-[13px] font-mono"
          />
        </div>
      </div>

      {error ? (
        <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p>
      ) : null}
      {savedAt ? (
        <p className="mb-3 t-caption text-[var(--gain-fg)]">Saved at {savedAt}</p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-md bg-[var(--bg-raised)] p-4">
          <p className="t-overline">Mood</p>
          <div className="mt-3">
            <MoodEmojiPicker value={mood} onChange={setMood} disabled={loading} />
          </div>
          <p className="mt-2 t-caption">{moodLabel(mood) ?? "Not set"}</p>
        </div>

        <div className="rounded-md bg-[var(--bg-raised)] p-4">
          <p className="t-overline">Sleep (hrs)</p>
          <input
            type="number"
            min={SLEEP_HOURS_MIN}
            max={SLEEP_HOURS_MAX}
            step="0.5"
            value={sleep}
            disabled={loading}
            onChange={(e) => setSleep(e.target.value)}
            placeholder="e.g. 6.5"
            className="mt-3 w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[14px] font-mono"
          />
          <p className="mt-2 t-caption">Range {SLEEP_HOURS_MIN}-{SLEEP_HOURS_MAX} hours</p>
        </div>

        <div className="rounded-md bg-[var(--bg-raised)] p-4">
          <p className="t-overline">Market Conditions</p>
          <select
            value={conditions ?? ""}
            disabled={loading}
            onChange={(e) => setConditions(e.target.value || null)}
            className="mt-3 w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px]"
          >
            <option value="">None</option>
            {MARKET_CONDITIONS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4">
        <p className="t-overline">Notes / Reflection</p>
        <textarea
          rows={5}
          value={notes}
          disabled={loading}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What did you learn today? Any mistakes, wins, patterns to watch?"
          className="mt-2 w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] leading-relaxed"
        />
        <p className="mt-1 t-caption">{notes.length} / 4096 chars</p>
      </div>

      <div className="mt-4">
        <p className="t-overline">Chart Links ({tvLinks.length}/10)</p>
        <div className="mt-2 flex gap-2">
          <input
            type="url"
            value={newLink}
            disabled={loading || tvLinks.length >= 10}
            onChange={(e) => setNewLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder="Paste TradingView chart link or any URL..."
            className="flex-1 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] font-mono"
          />
          <button
            type="button"
            onClick={addLink}
            disabled={loading || !newLink.trim() || tvLinks.length >= 10}
            className="mds-button h-9 px-3 text-[12px]"
          >
            Add link
          </button>
        </div>
        {tvLinks.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {tvLinks.map((link, i) => (
              <li key={`${i}:${link}`} className="flex items-center gap-2 rounded bg-[var(--bg-raised)] px-3 py-1.5">
                <a
                  href={link}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 truncate text-[12px] font-mono text-[var(--accent)] hover:underline"
                  title={link}
                >
                  {link}
                </a>
                <button
                  type="button"
                  onClick={() => removeLink(i)}
                  className="t-caption text-[var(--fg-3)] hover:text-[var(--loss-fg)]"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => loadEntry(date)}
          disabled={loading || saving}
          className="mds-button h-9 px-4 text-[12px]"
        >
          Discard changes
        </button>
        <button
          type="button"
          onClick={save}
          disabled={loading || saving}
          className="mds-button mds-button--primary h-9 px-4 text-[12px]"
        >
          {saving ? "Saving..." : "Save entry"}
        </button>
      </div>
    </section>
  );
}
