"use client";

/**
 * FailureBanner — Phase 6.
 *
 * Top-of-dashboard alert when:
 *   1. EVERY provider brief is stale (>12h) — the pre-open CI likely failed.
 *   2. A SPECIFIC provider tab is stale (>24h) while others updated — that
 *      provider's generation step is failing silently (e.g. the Claude tab
 *      dying on the Claude subscription session limit in CI).
 *   3. A provider tab returned an explicit error on its last run.
 *
 * Reads from /api/morning-verdict. IMPORTANT: that endpoint returns each
 * provider as `providers[name] = { generatedAt, error, stale, ... }` with the
 * fields at the TOP LEVEL (there is no `.entry` wrapper). A previous version
 * read `p.entry.generatedAt`, so it silently never fired.
 *
 * The dashboard banner is the only alert channel; it is dismissable
 * (session-scoped) so the user can acknowledge a known issue.
 */

import { useEffect, useState } from "react";
import Icon from "@/components/market-desk/Icon";

type Severity = "warning" | "error" | "info";

interface BannerMessage {
  severity: Severity;
  title: string;
  body: string;
}

interface ProviderEntry {
  generatedAt?: string | null;
  error?: string | null;
  stale?: boolean;
}

interface ProviderRow {
  name: string;
  label: string;
  generatedAt: string | null;
  error: string | null;
  ageH: number | null;
}

function severityClass(severity: Severity): string {
  if (severity === "error") return "border-[var(--loss-fg)] bg-[var(--loss-bg)]";
  if (severity === "warning") return "border-[var(--warn-500)] bg-[var(--warn-bg)]";
  return "border-[var(--accent)] bg-[var(--accent-soft-bg)]";
}

const DISMISS_KEY = "failure-banner-dismissed";

const PROVIDER_LABEL: Record<string, string> = {
  deepseek: "DeepSeek",
  gemini: "Gemini",
  openai: "Codex",
  claude: "Claude",
};

const ALL_STALE_H = 12; // every tab older than this → CI likely failed
const TAB_STALE_H = 24; // one tab this old while others fresh → that step is failing

function ageHours(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

export default function FailureBanner() {
  const [messages, setMessages] = useState<BannerMessage[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Initial load + 60s poll
  useEffect(() => {
    let cancelled = false;
    const stored = sessionStorage.getItem(DISMISS_KEY);
    if (stored) {
      try { setDismissed(new Set(JSON.parse(stored))); } catch {}
    }

    async function check() {
      const msgs: BannerMessage[] = [];

      try {
        const r = await fetch("/api/morning-verdict", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const providers: Record<string, ProviderEntry | null> = j.providers ?? {};

          const rows: ProviderRow[] = Object.entries(providers)
            .filter((pair): pair is [string, ProviderEntry] => pair[1] != null && typeof pair[1] === "object")
            .map(([name, v]) => ({
              name,
              label: PROVIDER_LABEL[name] ?? name,
              generatedAt: v.generatedAt ?? null,
              error: v.error ?? null,
              ageH: v.generatedAt ? ageHours(v.generatedAt) : null,
            }));

          const timed = rows.filter(
            (row): row is ProviderRow & { generatedAt: string; ageH: number } =>
              row.generatedAt != null && row.ageH != null,
          );
          const freshestAge = timed.length ? Math.min(...timed.map((row) => row.ageH)) : null;

          if (freshestAge != null && freshestAge > ALL_STALE_H) {
            // 1. Everything is stale — the whole pre-open CI run likely failed.
            const newest = timed.reduce((a, b) => (a.ageH <= b.ageH ? a : b));
            msgs.push({
              severity: "warning",
              title: `Brief stale ${Math.round(freshestAge)}h`,
              body: `Newest tab (${newest.label}) generated ${new Date(newest.generatedAt).toLocaleString()}. The pre-open CI may have failed — check GitHub Actions.`,
            });
          } else if (freshestAge != null) {
            // 2. Some tabs are fresh, but a specific tab lags far behind — that
            //    provider's generation step is failing silently.
            for (const row of timed) {
              if (row.ageH > TAB_STALE_H) {
                msgs.push({
                  severity: "warning",
                  title: `${row.label} tab stale ${Math.round(row.ageH)}h`,
                  body: `Other tabs updated but ${row.label} hasn't refreshed since ${new Date(row.generatedAt).toLocaleString()} — its generation step is likely failing. Use "Refresh ${row.label}" or check GitHub Actions.`,
                });
              }
            }
          }

          // 3. A provider stored an explicit error on its last run.
          for (const row of rows) {
            if (row.error) {
              msgs.push({
                severity: "error",
                title: `${row.label} tab failed`,
                body: row.error.slice(0, 200),
              });
            }
          }
        }
      } catch {
        // Silent — network error shouldn't trigger its own banner
      }

      if (!cancelled) setMessages(msgs);
    }

    check();
    const interval = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const dismiss = (key: string) => {
    const next = new Set(dismissed);
    next.add(key);
    setDismissed(next);
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(next)));
  };

  const visible = messages.filter((m) => !dismissed.has(`${m.severity}:${m.title}`));
  if (visible.length === 0) return null;

  const errorCount = visible.filter((message) => message.severity === "error").length;

  return (
    <div className="px-2 pt-2">
      <details className="group rounded border border-[var(--line)] bg-[var(--bg-raised)]" id="system-alerts">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2">
          <span className="flex min-w-0 items-center gap-2 text-[12px] font-bold text-[var(--fg-2)]">
            <span className={`h-2 w-2 shrink-0 rounded-full ${errorCount ? "bg-[var(--loss-fg)]" : "bg-[var(--warn-500)]"}`} />
            {visible.length} system {visible.length === 1 ? "alert" : "alerts"}
          </span>
          <Icon className="h-4 w-4 shrink-0 text-[var(--fg-3)] transition group-open:rotate-180" name="chevron-down" />
        </summary>
        <div className="space-y-1 border-t border-[var(--line)] p-2">
          {visible.map((message) => {
            const key = `${message.severity}:${message.title}`;
            return (
              <div className={`flex items-start justify-between gap-3 rounded border px-3 py-2 ${severityClass(message.severity)}`} key={key}>
                <div className="min-w-0">
                  <p className="t-mono font-semibold">{message.title}</p>
                  <p className="t-caption break-words">{message.body}</p>
                </div>
                <button
                  aria-label={`Dismiss ${message.title}`}
                  className="mds-button mds-button--icon h-7 w-7 shrink-0"
                  onClick={() => dismiss(key)}
                  title="Dismiss alert"
                  type="button"
                >
                  <Icon className="h-3.5 w-3.5" name="x" />
                </button>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}
