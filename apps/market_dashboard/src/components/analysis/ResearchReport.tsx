import { LENSES, SECTION_KEYS, type Evidence, type ResearchReport as Report } from "@/lib/research/schema";

const titles: Record<typeof SECTION_KEYS[number], string> = {
  latestCatalyst: "Latest catalyst", business: "What the company does", peers: "Peers and relative strength",
  fundamentals: "Fundamentals and durability", news90d: "Material news: 90 days", insiderInstitutional: "Insiders and institutions",
  sectorContext: "Industry and sector", upcoming30d: "Next 30 days and analyst changes", technical: "Technical analysis",
  chartEvidence: "Daily and weekly charts", conviction: "Conviction breakdown", action: "Plan and invalidation", risk: "Risk and sizing",
};
export default function ResearchReport({ report, sources }: { report: Report; sources: Omit<Evidence, "text">[] }) {
  const sourceMap = new Map(sources.map(s => [s.id, s]));
  const scores = report.scores;
  const total = Object.values(scores).every(n => n !== null) ? Object.values(scores).reduce<number>((a, n) => a + n!, 0) : null;
  return <div className="space-y-4">
    <div className="rounded-lg border border-[var(--line)] p-4">
      <p className="t-overline">{report.ticker} / {report.provider} / {new Date(report.asOf).toLocaleString()}</p>
      <h3 className="mt-2 text-xl font-semibold">{report.action.verdict === "UNAVAILABLE" ? "Research incomplete" : report.action.verdict}</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm">{report.summary}</p>
      <p className="mt-2 text-sm">Fundamental grade: {report.fundamentalGrade ?? "Unavailable"} / Conviction: {total === null ? "Unavailable" : `${total}/100`}</p>
      <p className="text-xs">Setup {scores.setup ?? "?"}/40 / Entry {scores.entry ?? "?"}/30 / Theme {scores.theme ?? "?"}/20 / Sentiment {scores.sentiment ?? "?"}/10</p>
    </div>
    {SECTION_KEYS.map(key => {
      const section = report.sections[key];
      return <section key={key} className="rounded-lg border border-[var(--line)] p-4">
        <div className="flex justify-between gap-2"><h4 className="font-semibold">{titles[key]}</h4><span className="text-xs uppercase">{section.status}</span></div>
        <p className="mt-2 whitespace-pre-wrap text-sm">{section.summary || "No verified evidence available."}</p>
        {section.observations.map((o, i) => <div key={i} className="mt-2 text-sm"><span className="text-xs uppercase text-[var(--fg-3)]">{o.kind.replace("_", " ")}: </span>{o.text}
          <span className="ml-2">{o.sourceIds.map(id => {
            const s = sourceMap.get(id);
            return s ? <a key={id} href={s.url} target="_blank" rel="noopener noreferrer" className="mr-2 underline">[{id}]</a> : <span key={id}>[unavailable source]</span>;
          })}</span></div>)}
        {section.gaps.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm text-[var(--fg-3)]">{section.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>}
        {key === "technical" && <div className="mt-3 space-y-2">{LENSES.map(name => <p key={name} className="text-sm"><strong>{name}</strong>: {report.lenses.find(l => l.name === name)?.assessment ?? "Unavailable"}</p>)}</div>}
        {key === "action" && <p className="mt-3 text-sm">Entry {report.action.entry ?? "unavailable"} / Stop {report.action.stop ?? "unavailable"} / Target {report.action.target ?? "unavailable"}<br />{report.action.invalidation}<br />{report.action.sizing}</p>}
      </section>;
    })}
    {report.action.blockers.length > 0 && <p className="text-sm">Blockers: {report.action.blockers.join("; ")}</p>}
    {report.openQuestions.length > 0 && <p className="text-sm">Open questions: {report.openQuestions.join("; ")}</p>}
    <details className="text-xs"><summary>Source timestamps and evidence</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(sources, null, 2)}</pre></details>
  </div>;
}
