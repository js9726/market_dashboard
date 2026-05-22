"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Account = {
  id: string;
  alias: string;
  preset: { name: string };
};

type PreviewRow = {
  ticker: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  executedAt: string;
  fees: number | null;
};

export default function CsvImportClient() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [brokerAccountId, setBrokerAccountId] = useState("");
  const [csvText, setCsvText] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [preview, setPreview] = useState<{
    detected: string;
    rows: PreviewRow[];
    totalRows: number;
    errors: string[];
  } | null>(null);
  const [commitResult, setCommitResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/broker-accounts").then((r) => r.json()).then((j) => setAccounts(j.accounts ?? []));
  }, []);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setPreview(null);
    setCommitResult(null);
  }

  async function runPreview() {
    setError(null);
    setPreview(null);
    setCommitResult(null);
    if (!brokerAccountId || !csvText) {
      setError("Pick an account and paste/upload a CSV first");
      return;
    }
    setPreviewing(true);
    const res = await fetch("/api/csv/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokerAccountId, csvText, commit: false }),
    });
    const json = await res.json();
    setPreviewing(false);
    if (!res.ok || !json.detected) {
      setError(json.error ?? json.message ?? "Could not parse CSV");
      return;
    }
    setPreview(json);
  }

  async function commit() {
    if (!preview) return;
    setError(null);
    setCommitting(true);
    const res = await fetch("/api/csv/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brokerAccountId, csvText, commit: true }),
    });
    const json = await res.json();
    setCommitting(false);
    if (!res.ok) {
      setError(json.error ?? "Commit failed");
      return;
    }
    setCommitResult({ imported: json.imported, skipped: json.skipped, errors: json.errors ?? [] });
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 900 }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>CSV import</h1>
      <p style={{ color: "#666", marginBottom: "1.5rem" }}>
        Import trades from a Schwab, Fidelity, IBKR Flex, or moomoo CSV export.
        Duplicates are skipped on re-import.
      </p>

      {accounts.length === 0 ? (
        <p>
          You need a broker account first.{" "}
          <Link href="/dashboard/settings/brokers" style={{ color: "#1d4ed8" }}>
            Add one in broker settings
          </Link>.
        </p>
      ) : (
        <>
          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            Target account
            <select
              value={brokerAccountId}
              onChange={(e) => setBrokerAccountId(e.target.value)}
              style={{ width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
            >
              <option value="">-- choose --</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.alias} ({a.preset.name})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              style={{ display: "block", marginTop: "0.25rem" }}
            />
          </label>

          <label style={{ display: "block", marginBottom: "0.75rem" }}>
            …or paste CSV text
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={6}
              placeholder="Date,Action,Symbol,Quantity,Price,Fees & Comm,..."
              style={{
                width: "100%",
                padding: "0.5rem",
                marginTop: "0.25rem",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                boxSizing: "border-box",
              }}
            />
          </label>

          <button
            onClick={runPreview}
            disabled={previewing || !brokerAccountId || !csvText}
            style={{
              padding: "0.5rem 1rem",
              background: previewing ? "#9ca3af" : "#1d4ed8",
              color: "white",
              border: "none",
              borderRadius: "0.375rem",
              cursor: previewing ? "wait" : "pointer",
            }}
          >
            {previewing ? "Parsing…" : "Preview"}
          </button>

          {error && <div style={{ color: "#b91c1c", marginTop: "0.75rem" }}>{error}</div>}

          {preview && (
            <div style={{ marginTop: "1.5rem", border: "1px solid #e5e7eb", borderRadius: "0.5rem", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
                <div>
                  Detected format: <strong>{preview.detected}</strong>
                  {" · "}
                  {preview.totalRows} parseable row{preview.totalRows !== 1 ? "s" : ""}
                  {preview.errors.length > 0 && (
                    <span style={{ color: "#dc2626" }}> · {preview.errors.length} errors</span>
                  )}
                </div>
                <button
                  onClick={commit}
                  disabled={committing}
                  style={{
                    padding: "0.5rem 1rem",
                    background: committing ? "#9ca3af" : "#16a34a",
                    color: "white",
                    border: "none",
                    borderRadius: "0.375rem",
                    cursor: committing ? "wait" : "pointer",
                  }}
                >
                  {committing ? "Importing…" : `Import ${preview.totalRows} rows`}
                </button>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                <thead>
                  <tr style={{ color: "#6b7280", borderBottom: "1px solid #e5e7eb", textAlign: "right" }}>
                    <th style={{ padding: "0.25rem 0.5rem", textAlign: "left" }}>Ticker</th>
                    <th style={{ padding: "0.25rem 0.5rem", textAlign: "left" }}>Side</th>
                    <th style={{ padding: "0.25rem 0.5rem" }}>Qty</th>
                    <th style={{ padding: "0.25rem 0.5rem" }}>Price</th>
                    <th style={{ padding: "0.25rem 0.5rem" }}>Fees</th>
                    <th style={{ padding: "0.25rem 0.5rem", textAlign: "left" }}>Executed</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid #f3f4f6", textAlign: "right" }}>
                      <td style={{ padding: "0.25rem 0.5rem", textAlign: "left", fontWeight: 600 }}>{r.ticker}</td>
                      <td style={{ padding: "0.25rem 0.5rem", textAlign: "left", color: r.side === "BUY" ? "#16a34a" : "#dc2626" }}>{r.side}</td>
                      <td style={{ padding: "0.25rem 0.5rem" }}>{r.qty}</td>
                      <td style={{ padding: "0.25rem 0.5rem" }}>{r.price.toFixed(4)}</td>
                      <td style={{ padding: "0.25rem 0.5rem" }}>{r.fees != null ? r.fees.toFixed(2) : "—"}</td>
                      <td style={{ padding: "0.25rem 0.5rem", textAlign: "left", color: "#6b7280" }}>
                        {new Date(r.executedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {preview.totalRows > preview.rows.length && (
                <p style={{ color: "#6b7280", fontSize: "0.85rem", marginTop: "0.5rem" }}>
                  Showing first {preview.rows.length} of {preview.totalRows} rows — all will be imported.
                </p>
              )}

              {preview.errors.length > 0 && (
                <details style={{ marginTop: "0.75rem" }}>
                  <summary style={{ color: "#dc2626", cursor: "pointer" }}>
                    {preview.errors.length} parse error{preview.errors.length === 1 ? "" : "s"}
                  </summary>
                  <ul style={{ fontSize: "0.85rem", color: "#dc2626", marginTop: "0.25rem" }}>
                    {preview.errors.slice(0, 20).map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          {commitResult && (
            <div
              style={{
                marginTop: "1rem",
                padding: "1rem",
                background: "#f0fdf4",
                border: "1px solid #86efac",
                borderRadius: "0.5rem",
              }}
            >
              <strong>Import complete:</strong> {commitResult.imported} new fill
              {commitResult.imported === 1 ? "" : "s"}
              {commitResult.skipped > 0 && `, ${commitResult.skipped} skipped as duplicates`}.
              <div style={{ marginTop: "0.5rem" }}>
                <Link href="/dashboard/portfolio" style={{ color: "#1d4ed8" }}>
                  View portfolio →
                </Link>
              </div>
              {commitResult.errors.length > 0 && (
                <details style={{ marginTop: "0.5rem" }}>
                  <summary style={{ color: "#dc2626", cursor: "pointer" }}>
                    {commitResult.errors.length} error{commitResult.errors.length === 1 ? "" : "s"}
                  </summary>
                  <ul style={{ fontSize: "0.85rem", color: "#dc2626" }}>
                    {commitResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
