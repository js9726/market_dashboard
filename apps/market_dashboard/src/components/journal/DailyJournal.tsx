"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import MoodEmojiPicker from "./MoodEmojiPicker";
import {
  MARKET_CONDITIONS,
  SLEEP_HOURS_MAX,
  SLEEP_HOURS_MIN,
  moodLabel,
} from "@/lib/journal/mood";
import {
  ALLOWED_MIME_TYPES,
  MAX_ATTACHMENTS_PER_ENTRY,
  MAX_FILE_SIZE_BYTES,
  isAllowedMime,
  isWithinSizeLimit,
} from "@/lib/journal/attachments";

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

interface WidgetPrefs {
  morningBrief: boolean;
  marketBrief: boolean;
  highImpactNews: boolean;
  tradeEntries: boolean;
  reflection: boolean;
}

interface JournalPrefsDto {
  dailyDocUrl: string | null;
  widgetPrefs: WidgetPrefs;
  defaultTemplate: string | null;
  autoWrite: boolean;
}

interface ComposedSection {
  key: string;
  title: string;
  markdown: string;
}

interface DailyComposeDto {
  date: string;
  markdown: string;
  sections: ComposedSection[];
  prefs: WidgetPrefs;
  tradeCount: number;
  hasBrief: boolean;
}

const DEFAULT_PREFS: JournalPrefsDto = {
  dailyDocUrl: null,
  widgetPrefs: {
    morningBrief: true,
    marketBrief: true,
    highImpactNews: true,
    tradeEntries: true,
    reflection: true,
  },
  defaultTemplate: null,
  autoWrite: false,
};

const WIDGET_TOGGLES: { key: keyof WidgetPrefs; label: string }[] = [
  { key: "morningBrief", label: "Morning brief" },
  { key: "marketBrief", label: "Market brief" },
  { key: "highImpactNews", label: "High-impact news" },
  { key: "tradeEntries", label: "Trade entries" },
  { key: "reflection", label: "Reflection" },
];

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
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── WS4: config panel + composed preview + generate ──────────────────────
  const [prefs, setPrefs] = useState<JournalPrefsDto>(DEFAULT_PREFS);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsMsg, setPrefsMsg] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);

  const [preview, setPreview] = useState<DailyComposeDto | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateMsg, setGenerateMsg] = useState<string | null>(null);

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
        setAttachments(Array.isArray(entry.attachmentUrls) ? entry.attachmentUrls : []);
      } else {
        setMood(null);
        setSleep("");
        setConditions(null);
        setNotes("");
        setTvLinks([]);
        setAttachments([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load entry");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPrefs = useCallback(async () => {
    try {
      const r = await fetch("/api/journal/prefs", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const p = (await r.json()) as JournalPrefsDto;
      setPrefs({
        dailyDocUrl: p.dailyDocUrl ?? null,
        widgetPrefs: { ...DEFAULT_PREFS.widgetPrefs, ...(p.widgetPrefs ?? {}) },
        defaultTemplate: p.defaultTemplate ?? null,
        autoWrite: !!p.autoWrite,
      });
    } catch {
      // Non-fatal: keep defaults so the panel still renders.
    }
  }, []);

  const loadPreview = useCallback(async (d: string) => {
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const r = await fetch(`/api/journal/daily?date=${encodeURIComponent(d)}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as DailyComposeDto;
      setPreview(data);
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : "Failed to compose preview");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  useEffect(() => {
    loadEntry(date);
    loadPreview(date);
  }, [date, loadEntry, loadPreview]);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  async function savePrefs() {
    setPrefsSaving(true);
    setPrefsMsg(null);
    try {
      const r = await fetch("/api/journal/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyDocUrl: prefs.dailyDocUrl ?? "",
          widgetPrefs: prefs.widgetPrefs,
          defaultTemplate: prefs.defaultTemplate ?? "",
          autoWrite: prefs.autoWrite,
        }),
      });
      const payload = (await r.json()) as JournalPrefsDto & { error?: string };
      if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
      setPrefs({
        dailyDocUrl: payload.dailyDocUrl ?? null,
        widgetPrefs: { ...DEFAULT_PREFS.widgetPrefs, ...(payload.widgetPrefs ?? {}) },
        defaultTemplate: payload.defaultTemplate ?? null,
        autoWrite: !!payload.autoWrite,
      });
      setPrefsMsg("Saved");
      // Re-compose preview since toggles affect the output.
      loadPreview(date);
    } catch (e) {
      setPrefsMsg(e instanceof Error ? e.message : "Failed to save preferences");
    } finally {
      setPrefsSaving(false);
    }
  }

  async function generateToday() {
    setGenerating(true);
    setGenerateMsg(null);
    try {
      const r = await fetch("/api/journal/daily", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const payload = (await r.json()) as {
        error?: string;
        doc?: { ok: boolean; skipped?: boolean; reason?: string } | null;
        tradeCount?: number;
      };
      if (!r.ok) throw new Error(payload.error || `HTTP ${r.status}`);
      let msg = "Composed";
      if (payload.doc) {
        if (payload.doc.ok && payload.doc.skipped) msg = "Composed — doc already has today's section";
        else if (payload.doc.ok) msg = "Composed and written to Google Doc";
        else if (payload.doc.reason === "no_doc_url_configured") msg = "Composed (no Google Doc configured)";
        else msg = `Composed — doc write failed: ${payload.doc.reason ?? "unknown"}`;
      }
      setGenerateMsg(msg);
      loadPreview(date);
      loadEntry(date);
    } catch (e) {
      setGenerateMsg(e instanceof Error ? e.message : "Generate failed");
    } finally {
      setGenerating(false);
    }
  }

  function toggleWidget(key: keyof WidgetPrefs) {
    setPrefs((p) => ({ ...p, widgetPrefs: { ...p.widgetPrefs, [key]: !p.widgetPrefs[key] } }));
  }

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

  function removeAttachment(idx: number) {
    setAttachments((cur) => cur.filter((_, i) => i !== idx));
  }

  async function uploadAttachment(file: File) {
    if (!isAllowedMime(file.type)) {
      setError(`Unsupported file type: ${file.type || "(unknown)"}. Use PNG / JPEG / WebP / GIF.`);
      return;
    }
    if (!isWithinSizeLimit(file.size)) {
      setError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    if (attachments.length >= MAX_ATTACHMENTS_PER_ENTRY) {
      setError(`Maximum ${MAX_ATTACHMENTS_PER_ENTRY} attachments per entry.`);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const pathname = `journal/${date}/${Date.now()}-${file.name}`;
      const blob = await upload(pathname, file, {
        access: "public",
        handleUploadUrl: "/api/journal/entry/attachments",
        contentType: file.type,
      });
      setAttachments((cur) => [...cur, blob.url]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Upload failed";
      setError(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
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
          attachmentUrls: attachments,
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
            Auto-composed from the morning brief, your trades&apos; AI briefings, and your reflection —
            preview below, then push to your Google Doc. The manual reflection form is the last section.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfigOpen((v) => !v)}
            className="mds-button h-9 px-3 text-[12px]"
            aria-expanded={configOpen}
          >
            {configOpen ? "Hide config" : "Configure"}
          </button>
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

      {/* ── WS4 Config panel ─────────────────────────────────────────────── */}
      {configOpen ? (
        <div className="mb-5 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-4">
          <div className="flex items-center justify-between">
            <p className="t-overline">Daily Journal Settings</p>
            {prefsMsg ? (
              <span className="t-caption text-[var(--accent)]">{prefsMsg}</span>
            ) : null}
          </div>

          <div className="mt-3">
            <p className="t-caption">Include sections</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {WIDGET_TOGGLES.map(({ key, label }) => {
                const on = prefs.widgetPrefs[key];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleWidget(key)}
                    className={`rounded-full border px-3 py-1 text-[12px] transition ${
                      on
                        ? "border-[var(--accent-soft-border)] bg-[var(--accent-soft-bg)] text-[var(--accent)]"
                        : "border-[var(--line)] bg-[var(--bg-surface)] text-[var(--fg-3)]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-4">
            <label className="t-caption" htmlFor="daily-doc-url">Google Doc URL</label>
            <input
              id="daily-doc-url"
              type="url"
              value={prefs.dailyDocUrl ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, dailyDocUrl: e.target.value || null }))}
              placeholder="https://docs.google.com/document/d/…/edit"
              className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] font-mono"
            />
            <p className="mt-1 t-caption">
              Generated sections are appended here. Requires Google Docs access — if writes fail,
              sign out and back in to grant the Docs permission.
            </p>
          </div>

          <div className="mt-4">
            <label className="t-caption" htmlFor="default-template">Default template</label>
            <textarea
              id="default-template"
              rows={3}
              value={prefs.defaultTemplate ?? ""}
              onChange={(e) => setPrefs((p) => ({ ...p, defaultTemplate: e.target.value || null }))}
              placeholder="Optional notes/structure prepended to your reflection (e.g. What worked? What to fix?)"
              className="mt-1 w-full rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-[13px] leading-relaxed"
            />
          </div>

          <div className="mt-4 flex items-center justify-between">
            <label className="flex items-center gap-2 t-caption" htmlFor="auto-write">
              <input
                id="auto-write"
                type="checkbox"
                checked={prefs.autoWrite}
                onChange={(e) => setPrefs((p) => ({ ...p, autoWrite: e.target.checked }))}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Auto-write to Google Doc daily (via scheduled cron)
            </label>
            <button
              type="button"
              onClick={savePrefs}
              disabled={prefsSaving}
              className="mds-button mds-button--primary h-9 px-4 text-[12px]"
            >
              {prefsSaving ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      ) : null}

      {/* ── WS4 Composed preview ─────────────────────────────────────────── */}
      <div className="mb-5 rounded-md border border-[var(--line)] bg-[var(--bg-raised)] p-4">
        <div className="market-section-head">
          <div>
            <p className="t-overline">Composed Journal — Preview</p>
            <p className="t-caption">
              {previewLoading
                ? "Composing…"
                : preview
                ? `${preview.sections.length} section(s) · ${preview.tradeCount} trade(s)${preview.hasBrief ? " · brief found" : " · no brief"}`
                : "Nothing composed yet."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {generateMsg ? <span className="t-caption text-[var(--accent)]">{generateMsg}</span> : null}
            <button
              type="button"
              onClick={() => loadPreview(date)}
              disabled={previewLoading || generating}
              className="mds-button h-9 px-3 text-[12px]"
            >
              Refresh preview
            </button>
            <button
              type="button"
              onClick={generateToday}
              disabled={generating || previewLoading}
              className="mds-button mds-button--primary h-9 px-4 text-[12px]"
            >
              {generating ? "Generating…" : "Generate today"}
            </button>
          </div>
        </div>

        {previewError ? (
          <p className="mt-2 t-caption text-[var(--loss-fg)]">{previewError}</p>
        ) : null}

        {preview && preview.sections.length > 0 ? (
          <div className="mt-3 space-y-3">
            {preview.sections.map((s) => (
              <div key={s.key} className="rounded bg-[var(--bg-surface)] p-3">
                <p className="t-overline">{s.title}</p>
                <pre className="mt-1 whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-[var(--fg-2)]">
                  {s.markdown}
                </pre>
              </div>
            ))}
          </div>
        ) : !previewLoading && !previewError ? (
          <p className="mt-2 t-caption">No sections — enable widgets in Configure, or add a brief / trades for this date.</p>
        ) : null}
      </div>

      {/* ── Manual reflection form (existing) ────────────────────────────── */}
      <p className="t-overline">Manual Reflection</p>
      <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-3">
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

      <div className="mt-4">
        <p className="t-overline">Attachments ({attachments.length}/{MAX_ATTACHMENTS_PER_ENTRY})</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_MIME_TYPES.join(",")}
            disabled={loading || uploading || attachments.length >= MAX_ATTACHMENTS_PER_ENTRY}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAttachment(f);
            }}
            className="text-[12px] file:mr-3 file:rounded file:border file:border-[var(--line)] file:bg-[var(--bg-raised)] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:cursor-pointer disabled:opacity-40"
          />
          {uploading ? <span className="t-caption text-[var(--accent)]">Uploading...</span> : null}
        </div>
        <p className="mt-1 t-caption">
          PNG / JPEG / WebP / GIF, max {MAX_FILE_SIZE_BYTES / 1024 / 1024} MB per file.
        </p>
        {attachments.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
            {attachments.map((url, i) => (
              <div key={`${i}:${url}`} className="relative rounded border border-[var(--line)] bg-[var(--bg-raised)] p-1">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt={`Attachment ${i + 1}`}
                  className="aspect-square w-full rounded object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  title="Remove"
                  className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-[var(--loss-fg)]"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
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
