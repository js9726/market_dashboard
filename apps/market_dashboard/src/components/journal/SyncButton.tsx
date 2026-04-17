"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  lastSyncedAt: string | null;
  onSynced?: (result: { synced: number; open: number; closed: number }) => void;
};

export default function SyncButton({ lastSyncedAt, onSynced }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ synced: number; open: number; closed: number } | null>(null);
  const [error, setError] = useState("");

  async function handleSync() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/journal/sync", { method: "POST" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as { synced: number; open: number; closed: number };
      setResult(data);
      onSynced?.(data);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  const syncedTime = lastSyncedAt
    ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
        Math.round((new Date(lastSyncedAt).getTime() - Date.now()) / 60000),
        "minutes"
      )
    : null;

  return (
    <div className="flex items-center gap-3">
      {result ? (
        <span className="text-xs text-green-400">
          Synced {result.synced} trades ({result.open} open, {result.closed} closed)
        </span>
      ) : syncedTime ? (
        <span className="text-xs text-slate-400">Last synced {syncedTime}</span>
      ) : (
        <span className="text-xs text-slate-500">Never synced</span>
      )}
      {error && <span className="text-xs text-red-400">{error}</span>}
      <button
        onClick={handleSync}
        disabled={loading}
        className="rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-50 px-3 py-1.5 text-xs font-medium transition"
      >
        {loading ? "Syncing…" : "Sync Now"}
      </button>
    </div>
  );
}
