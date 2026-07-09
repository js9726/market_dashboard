"use client";

/**
 * DisclaimerBanner — one-time acceptance of the beta disclaimer
 * (client-beta Phase 0.3).
 *
 * Shows a slim banner at the top of the dashboard until the signed-in user
 * accepts. Acceptance is stored on the User row (disclaimerAcceptedAt) via
 * /api/user/disclaimer, so it follows the account across devices; the Ideas
 * tab (Phase 1) hard-gates on the same field. Fail-quiet: any fetch error
 * just hides the banner rather than blocking the desk.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

export default function DisclaimerBanner() {
  const [accepted, setAccepted] = useState<boolean | null>(null); // null = loading
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/disclaimer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { acceptedAt?: string | null } | null) => {
        if (!cancelled) setAccepted(j ? j.acceptedAt != null : true);
      })
      .catch(() => {
        if (!cancelled) setAccepted(true); // fail-quiet
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function accept() {
    setSaving(true);
    try {
      const r = await fetch("/api/user/disclaimer", { method: "POST" });
      if (r.ok) setAccepted(true);
    } finally {
      setSaving(false);
    }
  }

  if (accepted !== false) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--warn-fg)] bg-[var(--warn-bg)] px-4 py-2">
      <p className="t-caption">
        <strong>Private beta.</strong> Everything here — ideas, entries, stops, scores — is educational, not
        financial advice. Trading involves risk of loss.{" "}
        <Link href="/legal" className="underline" target="_blank">
          Read the full disclaimer &amp; privacy note
        </Link>
        .
      </p>
      <button
        type="button"
        onClick={accept}
        disabled={saving}
        className="mds-button h-7 shrink-0 px-3 text-[11px] font-bold"
      >
        {saving ? "..." : "I understand & accept"}
      </button>
    </div>
  );
}
