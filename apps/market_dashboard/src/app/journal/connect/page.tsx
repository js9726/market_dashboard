"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_COL_MAP, ColMap } from "@/lib/col-map";

const TEMPLATE_URL =
  "https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/copy";

const REQUIRED_FIELDS: { key: keyof ColMap; label: string }[] = [
  { key: "ticker", label: "Ticker / Symbol" },
  { key: "date", label: "Trade Date" },
  { key: "buyPrice", label: "Entry Price" },
  { key: "quantity", label: "Quantity" },
  { key: "pnl", label: "P&L" },
];

const OPTIONAL_FIELDS: { key: keyof ColMap; label: string }[] = [
  { key: "exitPrice", label: "Exit Price" },
  { key: "side", label: "Side (Long/Short)" },
  { key: "fees", label: "Fees" },
  { key: "notes", label: "Notes" },
];

function colLabel(index: number, header: string): string {
  const letter = String.fromCharCode(65 + index);
  return `Col ${letter}${header ? ` – ${header}` : ""}`;
}

export default function ConnectPage() {
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [tabs, setTabs] = useState<{ title: string; sheetId: number }[]>([]);
  const [selectedTab, setSelectedTab] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [headerRow] = useState(14);
  const [colMap, setColMap] = useState<ColMap>(DEFAULT_COL_MAP);

  function extractId(rawUrl: string): string | null {
    const m = rawUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : null;
  }

  function extractGid(rawUrl: string): number | null {
    const m = rawUrl.match(/[#&]gid=(\d+)/);
    return m ? parseInt(m[1]) : null;
  }

  async function handleLoadSheet() {
    setError("");
    const id = extractId(url);
    if (!id) { setError("Could not find a spreadsheet ID in that URL."); return; }
    setSpreadsheetId(id);
    setLoading(true);
    try {
      const gid = extractGid(url);
      const res = await fetch("/api/journal/connection/headers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId: id, headerRow }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as {
        tabs: { title: string; sheetId: number }[];
        headers: string[];
        resolvedTab: string;
      };
      setTabs(data.tabs);
      const preselected = gid !== null
        ? (data.tabs.find((t) => t.sheetId === gid)?.title ?? data.resolvedTab)
        : data.resolvedTab;
      setSelectedTab(preselected);
      setHeaders(data.headers);
      setStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sheet");
    } finally {
      setLoading(false);
    }
  }

  async function handleTabChange(tab: string) {
    setSelectedTab(tab);
    setLoading(true);
    try {
      const res = await fetch("/api/journal/connection/headers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, sheetTab: tab, headerRow }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { tabs: { title: string; sheetId: number }[]; headers: string[] };
      setHeaders(data.headers);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch headers");
    } finally {
      setLoading(false);
    }
  }

  function setField(key: keyof ColMap, value: string) {
    setColMap((prev) => ({ ...prev, [key]: value === "" ? null : parseInt(value) }));
  }

  async function handleSaveAndSync() {
    setError("");
    setLoading(true);
    try {
      const connRes = await fetch("/api/journal/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spreadsheetId, sheetTab: selectedTab, headerRow, colMap }),
      });
      if (!connRes.ok) throw new Error(await connRes.text());

      setStep(3);
      const syncRes = await fetch("/api/journal/sync", { method: "POST" });
      if (!syncRes.ok) throw new Error(await syncRes.text());

      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setStep(2);
    } finally {
      setLoading(false);
    }
  }

  const fieldOptions = [
    <option key="" value="">Not mapped</option>,
    ...headers.map((h, i) => (
      <option key={i} value={i}>{colLabel(i, h)}</option>
    )),
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-start justify-center pt-16 px-4">
      <div className="w-full max-w-xl">
        <h1 className="text-2xl font-bold mb-1">Connect your Trade Journal</h1>
        <p className="text-slate-400 text-sm mb-6">
          Paste your Google Sheets URL and map your columns once — we&apos;ll sync your trades into the dashboard.
        </p>

        {/* Step 1 — URL */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4 text-sm text-slate-300">
              Don&apos;t have a journal template?{" "}
              <a href={TEMPLATE_URL} target="_blank" rel="noopener noreferrer"
                className="text-blue-400 hover:underline">
                Copy the Journal Template →
              </a>
            </div>
            <input
              type="text"
              placeholder="https://docs.google.com/spreadsheets/d/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full rounded-lg bg-slate-800 border border-slate-700 px-4 py-2.5 text-sm placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={handleLoadSheet}
              disabled={loading || !url.trim()}
              className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 py-2.5 text-sm font-medium transition"
            >
              {loading ? "Loading…" : "Load Sheet →"}
            </button>
          </div>
        )}

        {/* Step 2 — Tab + column mapping */}
        {step === 2 && (
          <div className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1">Sheet Tab</label>
              <select
                value={selectedTab}
                onChange={(e) => handleTabChange(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {tabs.map((t) => (
                  <option key={t.sheetId} value={t.title}>{t.title}</option>
                ))}
              </select>
            </div>

            <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4 space-y-3">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Required columns</p>
              {REQUIRED_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-36 text-sm text-slate-300 shrink-0">{label}</span>
                  <select
                    value={colMap[key] ?? ""}
                    onChange={(e) => setField(key, e.target.value)}
                    className="flex-1 rounded bg-slate-700 border border-slate-600 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {fieldOptions}
                  </select>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-slate-800/60 border border-slate-700 p-4 space-y-3">
              <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">Optional columns</p>
              {OPTIONAL_FIELDS.map(({ key, label }) => (
                <div key={key} className="flex items-center gap-3">
                  <span className="w-36 text-sm text-slate-300 shrink-0">{label}</span>
                  <select
                    value={colMap[key] ?? ""}
                    onChange={(e) => setField(key, e.target.value)}
                    className="flex-1 rounded bg-slate-700 border border-slate-600 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {fieldOptions}
                  </select>
                </div>
              ))}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 rounded-lg bg-slate-700 hover:bg-slate-600 py-2.5 text-sm font-medium transition">
                Back
              </button>
              <button
                onClick={handleSaveAndSync}
                disabled={loading}
                className="flex-2 flex-1 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 py-2.5 text-sm font-medium transition"
              >
                {loading ? "Saving & Syncing…" : "Save & Sync →"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Syncing */}
        {step === 3 && (
          <div className="text-center py-12 space-y-3">
            <div className="text-4xl">⏳</div>
            <p className="text-slate-300">Syncing your trades…</p>
          </div>
        )}
      </div>
    </div>
  );
}
