"use client";

import { useMorningVerdict } from "@/hooks/useMorningVerdict";
import type { StructuredBrief } from "@/types/structured-brief";

const FILTERS = ["All", "Longs", "Shorts", "High conviction"];

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asStructuredBrief(value: unknown): StructuredBrief | null {
  const obj = asObject(value);
  if (!obj || !("standout" in obj)) return null;
  return obj as unknown as StructuredBrief;
}

function formatPrice(value: number | null | undefined): string {
  return value == null ? "-" : value.toFixed(2);
}

export default function SpotlightAndIdeas() {
  const verdict = useMorningVerdict();

  const entry = verdict.data
    ? verdict.data.providers.deepseek ??
      Object.values(verdict.data.providers).find((providerEntry) => providerEntry?.structured)
    : null;
  const brief = asStructuredBrief(entry?.structured ?? entry?.verdict);
  const standout = brief?.standout ?? null;

  const ticker = standout?.ticker ?? "-";
  const side = (standout?.side ?? "LONG").toUpperCase();
  const score = standout?.score ?? null;
  const isLong = side === "LONG";
  const sideStyle = {
    background: isLong ? "var(--gain-bg)" : "var(--loss-bg)",
    color: isLong ? "var(--gain-fg)" : "var(--loss-fg)",
  };

  return (
    <section className="conviction-grid">
      <div className="space-y-3">
        <div className="market-section-head">
          <p className="t-overline">Live Idea</p>
          {entry ? (
            <p className="t-caption t-mono">
              Updated {new Date(entry.generatedAt).toLocaleTimeString()}
              {entry.stale ? " stale" : ""}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter, index) => (
            <span
              className={`rounded-full border px-3 py-1 text-xs font-bold ${
                index === 0
                  ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "border-[var(--line)] bg-[var(--bg-surface)] text-[var(--fg-2)]"
              }`}
              key={filter}
            >
              {filter}
            </span>
          ))}
        </div>

        <article className="idea-row is-selected">
          <div className="idea-row__side" style={sideStyle}>
            {side}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="idea-row__ticker">{ticker}</span>
              {standout?.sector || standout?.grade ? (
                <span className="t-caption">
                  {standout.sector ?? "-"}
                  {standout.grade ? ` - ABC ${standout.grade}` : ""}
                </span>
              ) : null}
              <span className="rounded bg-[var(--bg-raised)] px-2 py-1 text-[10px] font-bold text-[var(--fg-2)]">
                STRUCTURED
              </span>
            </div>
            <p className="t-body-small mt-1">{standout?.thesis ?? "Awaiting structured standout..."}</p>
            <p className="t-caption t-mono mt-2">
              Entry <b>{formatPrice(standout?.entry)}</b> &nbsp; Stop{" "}
              <b>{formatPrice(standout?.stop)}</b> &nbsp; Target{" "}
              <b>{formatPrice(standout?.target)}</b> &nbsp; R/R{" "}
              <b>{formatPrice(standout?.rrr)}</b>
            </p>
          </div>
          <div>
            {score != null ? (
              <span className="rounded px-2 py-1 font-mono text-[11px] font-bold" style={sideStyle}>
                GO {score}
              </span>
            ) : null}
            <div className="idea-row__score">
              {score ?? "-"}
              <span className="text-sm text-[var(--fg-3)]">/100</span>
            </div>
            <p className="t-caption t-mono text-right">brief</p>
          </div>
        </article>
      </div>

      <aside className="spotlight-card">
        <div className="spotlight-gauge">{score ?? "-"}</div>
        <p className="t-overline">Spotlight</p>
        <div className="mt-2 flex items-center gap-2">
          <span className="t-metric">{ticker}</span>
          <span className="rounded px-2 py-1 text-[10px] font-bold" style={sideStyle}>
            {side}
          </span>
        </div>
        <p className="t-caption t-mono mt-1">
          {standout?.sector ?? "-"}
          {standout?.rs != null ? ` - RS ${standout.rs}` : ""}
          {standout?.grade ? ` - ${standout.grade}` : ""}
        </p>
        <p className="t-body-small mt-4 border-t border-[var(--line)] pt-4">
          {standout?.thesis ?? "Awaiting structured verdict..."}
        </p>
        {standout?.tags?.length ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {standout.tags.map((tag) => (
              <span
                className="rounded bg-[var(--bg-raised)] px-2 py-1 text-[10px] font-bold text-[var(--fg-2)]"
                key={tag}
              >
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </aside>
    </section>
  );
}
