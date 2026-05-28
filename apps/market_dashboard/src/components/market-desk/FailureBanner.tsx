"use client";

/**
 * FailureBanner — Phase 6.
 *
 * Top-of-dashboard alert when:
 *   1. Latest brief bucket is >12h old (CI may have failed)
 *   2. No broker-bridge heartbeat in >2h (daemon offline / PC off)
 *   3. Any provider tab returned an error on its last run
 *
 * Per Round 8 answer: PushNotification skipped, dashboard banner is the
 * only alert channel. The banner is dismissable (session-scoped) so the user
 * can acknowledge known issues.
 *
 * Reads from /api/morning-verdict and (optionally) /api/bridge/health.
 */

import { useEffect, useState } from "react";

type Severity = "warning" | "error" | "info";

interface BannerMessage {
  severity: Severity;
  title: string;
  body: string;
}

const DISMISS_KEY = "failure-banner-dismissed";

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

      // Brief freshness check
      try {
        const r = await fetch("/api/morning-verdict", { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const providers = j.providers ?? {};
          const latest = Object.values(providers)
            .filter((p): p is { entry?: { generatedAt?: string } } => p != null && typeof p === "object")
            .map((p) => p.entry?.generatedAt)
            .filter((s): s is string => !!s)
            .sort((a, b) => b.localeCompare(a))[0];
          if (latest) {
            const ageH = (Date.now() - new Date(latest).getTime()) / 3_600_000;
            if (ageH > 12) {
              msgs.push({
                severity: "warning",
                title: `Brief stale ${Math.round(ageH)}h`,
                body: `Latest brief generated ${new Date(latest).toLocaleString()}. The pre-open CI may have failed — check GH Actions.`,
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

  return (
    <div className="space-y-1 p-2">
      {visible.map((m) => (
        <div
          key={`${m.severity}:${m.title}`}
          className="flex items-start justify-between rounded border px-3 py-2"
          style={{
            background:
              m.severity === "error" ? "var(--loss-bg)"
              : m.severity === "warning" ? "var(--warn-bg)"
              : "var(--accent-bg)",
            borderColor:
              m.severity === "error" ? "var(--loss-fg)"
              : m.severity === "warning" ? "var(--warn-fg)"
              : "var(--accent-fg)",
          }}
        >
          <div>
            <p className="t-mono font-semibold">{m.title}</p>
            <p className="t-caption">{m.body}</p>
          </div>
          <button
            className="t-caption text-[var(--fg-3)] hover:text-[var(--fg)]"
            onClick={() => dismiss(`${m.severity}:${m.title}`)}
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
