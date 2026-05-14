/**
 * 6-stage pipeline cards (Scratched → Settled).
 *
 * Stage counts come from the user's own pitch records. For now the data is
 * still hardcoded — wiring to Trade / TradeVerdictHistory is intentionally
 * out of scope for the unified-conviction-desk merge (different complaint
 * domain, different data source, different ownership). Slot real data in
 * later by replacing STAGES with a server-fetched array.
 */

const STAGES = [
  { id: "scratched", number: "01", label: "Scratched", count: 1, width: "45%" },
  { id: "thesis", number: "02", label: "Thesis", count: 1, width: "45%" },
  { id: "vetted", number: "03", label: "Vetted", count: 1, width: "45%" },
  { id: "armed", number: "04", label: "Armed", count: 2, width: "100%" },
  { id: "live", number: "05", label: "Live", count: 1, width: "48%", active: true },
  { id: "settled", number: "06", label: "Settled", count: 2, width: "100%" },
];

export default function PipelineStages() {
  return (
    <section className="pipeline-grid">
      {STAGES.map((stage) => (
        <div className={`pipeline-card ${stage.active ? "is-active" : ""}`} key={stage.id}>
          <p className="t-overline text-[var(--fg-3)]">Stage {stage.number}</p>
          <h3 className="mt-2 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--fg-2)]">
            {stage.label}
          </h3>
          <div className="pipeline-card__count">{stage.count}</div>
          <div className="pipeline-card__bar">
            <i style={{ width: stage.width }} />
          </div>
        </div>
      ))}
    </section>
  );
}
