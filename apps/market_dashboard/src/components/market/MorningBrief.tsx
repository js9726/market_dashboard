"use client";

import { useEffect, useState } from "react";

const BASE = "/market-dashboard";

type Provider = "gemini" | "openai" | "claude";

interface ProviderInfo {
  available: boolean;
  generated: boolean;
  label: string;
}

interface BriefMeta {
  built_at: string;
  providers: Record<Provider, ProviderInfo>;
}

const PROVIDER_DISPLAY: Record<Provider, { name: string; icon: string }> = {
  gemini: { name: "Gemini 2.5 Pro", icon: "✦" },
  openai: { name: "GPT-4o", icon: "⬡" },
  claude: { name: "Claude", icon: "◆" },
};

const PROVIDERS: Provider[] = ["gemini", "openai", "claude"];

// CSS variables the brief HTML uses — mapped to the dashboard dark theme
const BRIEF_CSS_VARS: React.CSSProperties = {
  ["--brief-text-primary" as string]: "#e2e8f0",
  ["--brief-text-secondary" as string]: "#94a3b8",
  ["--brief-text-tertiary" as string]: "#64748b",
  ["--brief-border-primary" as string]: "#334155",
  ["--brief-border-tertiary" as string]: "#1e293b",
  ["--brief-bg-secondary" as string]: "#0f172a",
  ["--brief-font-mono" as string]: "ui-monospace, 'Cascadia Code', monospace",
};

export default function MorningBrief() {
  const [meta, setMeta] = useState<BriefMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Provider | null>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [htmlLoading, setHtmlLoading] = useState(false);
  const [htmlError, setHtmlError] = useState<string | null>(null);

  // Load meta on mount
  useEffect(() => {
    fetch(`${BASE}/morning_brief_meta.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BriefMeta>;
      })
      .then((m) => {
        setMeta(m);
        // Auto-select the first generated provider
        const first = PROVIDERS.find((p) => m.providers[p]?.generated);
        if (first) setSelected(first);
      })
      .catch((e) => setMetaError(e.message));
  }, []);

  // Load HTML whenever selection changes
  useEffect(() => {
    if (!selected) return;
    setHtml(null);
    setHtmlError(null);
    setHtmlLoading(true);
    fetch(`${BASE}/morning_brief_${selected}.html`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        setHtml(text);
        setHtmlLoading(false);
      })
      .catch((e) => {
        setHtmlError(e.message);
        setHtmlLoading(false);
      });
  }, [selected]);

  // Not yet synced — no meta file
  if (metaError) {
    return (
      <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-6 text-amber-100">
        <p className="font-medium">Morning brief not available</p>
        <p className="mt-2 text-sm text-amber-200/80">
          Run the backend pipeline first, then sync:
        </p>
        <ol className="mt-3 space-y-1 text-sm text-amber-200/70">
          <li>
            <code className="rounded bg-black/30 px-1">cd apps/market_dashboard_backend</code>
          </li>
          <li>
            <code className="rounded bg-black/30 px-1">python scripts/morning_brief.py --out-dir data</code>
          </li>
          <li>
            <code className="rounded bg-black/30 px-1">cd ../market_dashboard && npm run sync:market</code>
          </li>
        </ol>
        <p className="mt-3 text-xs text-amber-300/50">
          Requires at least one of: <code>GEMINI_API_KEY</code>, <code>OPENAI_API_KEY</code>,{" "}
          <code>ANTHROPIC_API_KEY</code>
        </p>
      </div>
    );
  }

  if (!meta) {
    return <div className="text-slate-400 text-sm">Loading brief…</div>;
  }

  const builtAt = new Date(meta.built_at).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Last generated:{" "}
          <span className="text-slate-300">{builtAt} MYT</span>
        </p>

        {/* AI selector */}
        <div className="flex gap-1 rounded-lg bg-slate-800/80 p-1">
          {PROVIDERS.map((p) => {
            const info = meta.providers[p];
            const display = PROVIDER_DISPLAY[p];
            const isAvailable = info?.generated;
            const isActive = selected === p;

            return (
              <button
                key={p}
                type="button"
                disabled={!isAvailable}
                onClick={() => setSelected(p)}
                title={
                  !info?.available
                    ? `${display.name}: API key not configured`
                    : !info?.generated
                      ? `${display.name}: Brief not generated this run`
                      : display.name
                }
                className={[
                  "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition",
                  isActive
                    ? "bg-slate-700 text-white shadow"
                    : isAvailable
                      ? "text-slate-400 hover:text-white cursor-pointer"
                      : "text-slate-600 cursor-not-allowed opacity-40",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="text-base leading-none">{display.icon}</span>
                <span>{display.name}</span>
                {!info?.available && (
                  <span className="ml-0.5 text-[10px] text-slate-600">(no key)</span>
                )}
                {info?.available && !info?.generated && (
                  <span className="ml-0.5 text-[10px] text-amber-700">(failed)</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Brief content */}
      <div
        className="rounded-xl border border-slate-800 bg-slate-950/80 p-4 overflow-x-auto"
        style={BRIEF_CSS_VARS}
      >
        {htmlLoading && (
          <div className="py-12 text-center text-sm text-slate-500">
            Loading {PROVIDER_DISPLAY[selected!]?.name} brief…
          </div>
        )}

        {htmlError && (
          <div className="rounded border border-red-900/40 bg-red-950/30 p-4 text-sm text-red-300">
            Failed to load brief: {htmlError}
          </div>
        )}

        {!htmlLoading && !htmlError && html && (
          // The HTML is generated by our own backend — dangerouslySetInnerHTML is intentional
          // eslint-disable-next-line react/no-danger
          <div dangerouslySetInnerHTML={{ __html: html }} />
        )}

        {!htmlLoading && !htmlError && !html && !selected && (
          <div className="py-12 text-center text-sm text-slate-500">
            No provider selected
          </div>
        )}
      </div>
    </div>
  );
}
