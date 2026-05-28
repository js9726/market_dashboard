"use client";

export interface AListFilterState {
  from: string;
  to: string;
  ticker: string;
  sector: string;
  setup: string;
  status: string;
  outcome: string;
  minScore: string;
  sort: "date" | "score" | "outcome";
}

interface Props {
  filters: AListFilterState;
  onChange: (next: AListFilterState) => void;
}

const STATUS_OPTIONS = ["", "ACTIVE", "HIT_TARGET", "STOPPED_OUT", "CONVERTED", "EXPIRED", "MANUALLY_CLOSED"];
const OUTCOME_OPTIONS = ["", "HIT_TARGET", "STOPPED_OUT", "PARTIAL", "FADE", "DRIFT"];
const SETUP_OPTIONS = ["", "EP-FRESH", "BO-CB", "BO-VCP", "PB-21EMA", "MA-PULLBACK", "POST-GAP-VCP", "PARABOLIC"];

export default function AListFilters({ filters, onChange }: Props) {
  const update = (key: keyof AListFilterState, value: string) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-[var(--line)] px-5 py-3">
      <Field label="From">
        <input
          type="date"
          value={filters.from}
          onChange={(e) => update("from", e.target.value)}
          className="mds-input"
        />
      </Field>
      <Field label="To">
        <input
          type="date"
          value={filters.to}
          onChange={(e) => update("to", e.target.value)}
          className="mds-input"
        />
      </Field>
      <Field label="Ticker">
        <input
          type="text"
          value={filters.ticker}
          onChange={(e) => update("ticker", e.target.value.toUpperCase())}
          placeholder="e.g. NVDA"
          className="mds-input"
          style={{ width: 80 }}
        />
      </Field>
      <Field label="Setup">
        <select
          value={filters.setup}
          onChange={(e) => update("setup", e.target.value)}
          className="mds-input"
        >
          {SETUP_OPTIONS.map((s) => (
            <option key={s || "any"} value={s}>{s || "Any"}</option>
          ))}
        </select>
      </Field>
      <Field label="Sector">
        <input
          type="text"
          value={filters.sector}
          onChange={(e) => update("sector", e.target.value)}
          placeholder="e.g. Technology"
          className="mds-input"
          style={{ width: 140 }}
        />
      </Field>
      <Field label="Status">
        <select
          value={filters.status}
          onChange={(e) => update("status", e.target.value)}
          className="mds-input"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s || "any"} value={s}>{s || "Any"}</option>
          ))}
        </select>
      </Field>
      <Field label="Outcome">
        <select
          value={filters.outcome}
          onChange={(e) => update("outcome", e.target.value)}
          className="mds-input"
        >
          {OUTCOME_OPTIONS.map((s) => (
            <option key={s || "any"} value={s}>{s || "Any"}</option>
          ))}
        </select>
      </Field>
      <Field label="Min Score">
        <input
          type="number"
          value={filters.minScore}
          onChange={(e) => update("minScore", e.target.value)}
          placeholder="80"
          min={0}
          max={100}
          className="mds-input"
          style={{ width: 80 }}
        />
      </Field>
      <Field label="Sort">
        <select
          value={filters.sort}
          onChange={(e) => update("sort", e.target.value as AListFilterState["sort"])}
          className="mds-input"
        >
          <option value="date">Date</option>
          <option value="score">Day-0 Score</option>
          <option value="outcome">Day-14 Score</option>
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="t-caption text-[var(--fg-3)]">{label}</span>
      {children}
    </label>
  );
}
