"use client";

import { useEffect, useState } from "react";

type Preset = {
  id: string;
  name: string;
  region: string;
  currency: string;
  isBuiltIn: boolean;
};

type Account = {
  id: string;
  alias: string;
  brokerAccountId: string | null;
  displayCurrency: string | null;
  isLive: boolean;
  createdAt: string;
  preset: { name: string; region: string; currency: string };
};

type BridgeToken = {
  id: string;
  label: string | null;
  createdAt: string;
  lastHeartbeat: string | null;
  revokedAt: string | null;
};

export default function BrokerSettingsClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [bridgeToken, setBridgeToken] = useState<BridgeToken | null>(null);
  const [newTokenPlaintext, setNewTokenPlaintext] = useState<string | null>(null);
  const [tokenLabel, setTokenLabel] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Form state
  const [presetId, setPresetId] = useState("");
  const [alias, setAlias] = useState("");
  const [externalId, setExternalId] = useState("");
  const [isLive, setIsLive] = useState(false);

  async function refresh() {
    setLoading(true);
    const [a, p, t] = await Promise.all([
      fetch("/api/broker-accounts").then((r) => r.json()),
      fetch("/api/broker-presets").then((r) => r.json()),
      fetch("/api/bridge/token").then((r) => r.json()),
    ]);
    setAccounts(a.accounts ?? []);
    setPresets(p.presets ?? []);
    setBridgeToken(t.token ?? null);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function generateToken() {
    setNewTokenPlaintext(null);
    setTokenCopied(false);
    const res = await fetch("/api/bridge/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: tokenLabel.trim() || undefined }),
    });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error ?? "Failed");
      return;
    }
    setNewTokenPlaintext(json.token);
    setTokenLabel("");
    refresh();
  }

  async function revokeToken() {
    if (!confirm("Revoke this bridge token? The local bridge daemon will lose access until you regenerate.")) return;
    await fetch("/api/bridge/token", { method: "DELETE" });
    setNewTokenPlaintext(null);
    refresh();
  }

  async function copyToken() {
    if (!newTokenPlaintext) return;
    try {
      await navigator.clipboard.writeText(newTokenPlaintext);
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      // clipboard API can fail in some browsers; user can still select+copy
    }
  }

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!presetId || !alias.trim()) {
      setFormError("Preset and alias required");
      return;
    }
    const res = await fetch("/api/broker-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presetId,
        alias: alias.trim(),
        brokerAccountId: externalId.trim() || undefined,
        isLive,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setFormError(json.error ?? "Failed to create");
      return;
    }
    setPresetId("");
    setAlias("");
    setExternalId("");
    setIsLive(false);
    setShowForm(false);
    refresh();
  }

  async function deleteAccount(id: string) {
    if (!confirm("Deactivate this broker account? Positions and trades will be preserved.")) return;
    await fetch(`/api/broker-accounts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 900 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>Broker accounts</h1>
          <p style={{ color: "#666", margin: 0 }}>
            Link the brokers you trade through. Used for fee calculation and (optional) bridge sync.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          style={{
            padding: "0.5rem 1rem",
            background: "#1d4ed8",
            color: "white",
            border: "none",
            borderRadius: "0.375rem",
            cursor: "pointer",
          }}
        >
          {showForm ? "Cancel" : "+ Add account"}
        </button>
      </header>

      {showForm && (
        <form
          onSubmit={addAccount}
          style={{
            border: "1px solid #ddd",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1rem",
            background: "#fafafa",
          }}
        >
          <h3 style={{ marginTop: 0 }}>New broker account</h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <label>
              Broker preset
              <select
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
              >
                <option value="">-- choose --</option>
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.region}, {p.currency})
                  </option>
                ))}
              </select>
            </label>

            <label>
              Account alias
              <input
                type="text"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. Main margin"
                style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
              />
            </label>

            <label>
              External account ID (optional)
              <input
                type="text"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="e.g. moomoo 286260077786655984"
                style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem", boxSizing: "border-box" }}
              />
            </label>

            <label style={{ display: "flex", alignItems: "center", paddingTop: "1.5rem" }}>
              <input
                type="checkbox"
                checked={isLive}
                onChange={(e) => setIsLive(e.target.checked)}
                style={{ marginRight: "0.5rem" }}
              />
              Live trading account (not paper)
            </label>
          </div>

          {formError && (
            <div style={{ color: "#b91c1c", marginTop: "0.5rem" }}>{formError}</div>
          )}

          <div style={{ marginTop: "0.75rem" }}>
            <button
              type="submit"
              style={{
                padding: "0.5rem 1rem",
                background: "#16a34a",
                color: "white",
                border: "none",
                borderRadius: "0.375rem",
                cursor: "pointer",
              }}
            >
              Create
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div style={{ color: "#666" }}>Loading…</div>
      ) : accounts.length === 0 ? (
        <div style={{ color: "#666", padding: "2rem", textAlign: "center", border: "1px dashed #ddd", borderRadius: "0.5rem" }}>
          No broker accounts yet. Add one to start journaling trades.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: "0.5rem" }}>Alias</th>
              <th style={{ padding: "0.5rem" }}>Broker</th>
              <th style={{ padding: "0.5rem" }}>Region / Currency</th>
              <th style={{ padding: "0.5rem" }}>External ID</th>
              <th style={{ padding: "0.5rem" }}>Type</th>
              <th style={{ padding: "0.5rem" }}></th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "0.5rem" }}><strong>{a.alias}</strong></td>
                <td style={{ padding: "0.5rem" }}>{a.preset.name}</td>
                <td style={{ padding: "0.5rem" }}>{a.preset.region} / {a.displayCurrency ?? a.preset.currency}</td>
                <td style={{ padding: "0.5rem", color: "#666", fontFamily: "monospace", fontSize: "0.85rem" }}>
                  {a.brokerAccountId ?? "—"}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  {a.isLive ? (
                    <span style={{ color: "#16a34a" }}>● Live</span>
                  ) : (
                    <span style={{ color: "#6b7280" }}>○ Paper</span>
                  )}
                </td>
                <td style={{ padding: "0.5rem" }}>
                  <button
                    onClick={() => deleteAccount(a.id)}
                    style={{
                      padding: "0.25rem 0.5rem",
                      background: "transparent",
                      color: "#b91c1c",
                      border: "1px solid #fca5a5",
                      borderRadius: "0.25rem",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Bridge token section ─────────────────────────────────────────── */}
      <section style={{ marginTop: "2.5rem", paddingTop: "1.5rem", borderTop: "2px solid #e5e7eb" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
          <div>
            <h2 style={{ fontSize: "1.15rem", marginBottom: "0.25rem" }}>Bridge token</h2>
            <p style={{ color: "#666", margin: 0, fontSize: "0.9rem" }}>
              For the local moomoo/IBKR bridge daemon. The bridge pushes your live positions and fills here every minute.
            </p>
          </div>
        </header>

        {bridgeToken && !bridgeToken.revokedAt ? (
          <div
            style={{
              border: "1px solid #d1fae5",
              background: "#f0fdf4",
              borderRadius: "0.5rem",
              padding: "0.75rem 1rem",
              marginTop: "0.5rem",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong>Active token</strong>
              {bridgeToken.label && <span style={{ color: "#6b7280" }}> · {bridgeToken.label}</span>}
              <div style={{ fontSize: "0.85rem", color: "#6b7280", marginTop: "0.25rem" }}>
                Created {new Date(bridgeToken.createdAt).toLocaleString()}
                {bridgeToken.lastHeartbeat ? (
                  <> · Last heartbeat {new Date(bridgeToken.lastHeartbeat).toLocaleString()}</>
                ) : (
                  <> · <span style={{ color: "#f59e0b" }}>Never connected</span></>
                )}
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={generateToken}
                style={{
                  padding: "0.4rem 0.75rem",
                  background: "transparent",
                  border: "1px solid #d1d5db",
                  borderRadius: "0.375rem",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                Regenerate
              </button>
              <button
                onClick={revokeToken}
                style={{
                  padding: "0.4rem 0.75rem",
                  background: "transparent",
                  color: "#b91c1c",
                  border: "1px solid #fca5a5",
                  borderRadius: "0.375rem",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                Revoke
              </button>
            </div>
          </div>
        ) : (
          <div style={{ marginTop: "0.5rem" }}>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="text"
                value={tokenLabel}
                onChange={(e) => setTokenLabel(e.target.value)}
                placeholder="Label (optional, e.g. 'Home desktop')"
                style={{ flex: 1, padding: "0.5rem", border: "1px solid #d1d5db", borderRadius: "0.375rem" }}
              />
              <button
                onClick={generateToken}
                style={{
                  padding: "0.5rem 1rem",
                  background: "#1d4ed8",
                  color: "white",
                  border: "none",
                  borderRadius: "0.375rem",
                  cursor: "pointer",
                }}
              >
                Generate token
              </button>
            </div>
          </div>
        )}

        {newTokenPlaintext && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem 1rem",
              border: "2px solid #fbbf24",
              background: "#fef3c7",
              borderRadius: "0.5rem",
            }}
          >
            <strong>⚠ Save this token now — it won&apos;t be shown again.</strong>
            <div
              style={{
                marginTop: "0.5rem",
                fontFamily: "monospace",
                fontSize: "0.9rem",
                padding: "0.5rem 0.75rem",
                background: "#1f2937",
                color: "#f9fafb",
                borderRadius: "0.375rem",
                wordBreak: "break-all",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>{newTokenPlaintext}</span>
              <button
                onClick={copyToken}
                style={{
                  padding: "0.25rem 0.5rem",
                  background: tokenCopied ? "#10b981" : "#374151",
                  color: "white",
                  border: "none",
                  borderRadius: "0.25rem",
                  cursor: "pointer",
                  marginLeft: "0.5rem",
                  fontSize: "0.8rem",
                  whiteSpace: "nowrap",
                }}
              >
                {tokenCopied ? "✓ Copied" : "Copy"}
              </button>
            </div>
            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#78350f" }}>
              Paste this into <code>~/.config/dashboard-bridge.toml</code>{" "}
              (or the bridge installer will prompt you).
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
