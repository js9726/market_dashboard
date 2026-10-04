"use client";
import { useEffect, useRef, useState } from "react";
import ResearchReport from "./ResearchReport";
import type { Evidence, ResearchReport as Report } from "@/lib/research/schema";
type Job = { id: string; threadId: string; ticker: string; provider: string; status: string; errorCode: string | null; verdictId: string | null; resultJson: { report: Report; sources: Omit<Evidence, "text">[] } | null };
const active = (job: Job | null) => Boolean(job && ["queued", "running"].includes(job.status));
function StatefulResearchRunner({ initialTicker = "" }: { initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker);
  const [provider, setProvider] = useState("claude");
  const [question, setQuestion] = useState("Review the latest catalyst, fundamentals, technical setup and evidence gaps.");
  const [job, setJob] = useState<Job | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [followUp, setFollowUp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const submission = useRef<{ body: string; key: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/research/jobs", { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load research");
      setJobs(body.jobs); setJob(body.jobs[0] ?? null);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoadingJobs(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!active(job)) return;
    const id = job!.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/research/jobs/${id}`, { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Could not read job");
        if (!controller.signal.aborted) { setJob(body); setError(null); if (active(body)) timer = setTimeout(poll, 5000); }
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "Status unavailable"); timer = setTimeout(poll, 10000); } }
    }
    timer = setTimeout(poll, 2000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job?.id, job?.status]);
  async function run() {
    setSubmitting(true); setError(null);
    const payload = { ticker: ticker.trim().toUpperCase(), provider, question, horizon: "swing", ...(followUp && job ? { threadId: job.threadId } : {}) };
    const body = JSON.stringify(payload);
    if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
    try {
      const response = await fetch("/api/research/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, requestKey: submission.current.key }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Submission failed");
      // A retried POST may return an already completed job. Always load its saved
      // report instead of constructing an empty terminal state that never polls.
      const saved = await fetch(`/api/research/jobs/${result.id}`, { cache: "no-store" });
      if (!saved.ok) throw new Error("Request saved; retry to recover its current status.");
      const queued = await saved.json() as Job;
      setJob(queued); setJobs(old => [queued, ...old.filter(j => j.id !== queued.id)]); submission.current = null;
    } catch (e) { setError(e instanceof Error ? e.message : "Submission failed"); }
    finally { setSubmitting(false); }
  }
  async function cancel() {
    if (!job) return;
    try {
      const response = await fetch(`/api/research/jobs/${job.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Could not cancel; refresh the job status.");
      setJob({ ...job, status: "cancelled" });
    } catch (e) { setError(e instanceof Error ? e.message : "Cancel failed"); }
  }
  return <section className="market-panel space-y-4 p-5">
    <div><p className="t-overline">Stateful research</p><p className="t-caption">Sourced research from your PC worker, with saved reports and follow-up context.</p></div>
    <div className="flex flex-wrap gap-2">
      <input aria-label="Ticker" className="w-24 rounded border p-2 text-black" value={ticker} maxLength={10} onChange={e => { setTicker(e.target.value.toUpperCase()); setFollowUp(false); }} placeholder="NTAP" />
      <select aria-label="Research provider" className="rounded border p-2 text-black" value={provider} onChange={e => setProvider(e.target.value)}><option value="claude">Claude subscription</option><option value="deepseek">DeepSeek API</option></select>
      <button className="mds-button mds-button--primary px-4" disabled={loadingJobs || submitting || active(job) || !ticker.trim() || !question.trim()} onClick={run}>{submitting ? "Submitting..." : "Request research"}</button>
      {active(job) && <button className="underline" onClick={cancel}>Cancel</button>}
    </div>
    <textarea aria-label="Research question" className="w-full rounded border p-2 text-sm text-black" maxLength={2000} value={question} onChange={e => setQuestion(e.target.value)} />
    {job && !active(job) && job.ticker === ticker.trim().toUpperCase() && <label className="block text-sm"><input type="checkbox" checked={followUp} onChange={e => setFollowUp(e.target.checked)} /> Continue this research thread</label>}
    {jobs.length > 0 && <select aria-label="Saved research jobs" className="rounded border p-2 text-black" value={job?.id ?? ""} onChange={async e => {
      try { const response = await fetch(`/api/research/jobs/${e.target.value}`); if (!response.ok) throw new Error("Could not load job"); const saved = await response.json(); setJob(saved); setTicker(saved.ticker); setFollowUp(false); }
      catch (e) { setError(e instanceof Error ? e.message : "Could not load job"); }
    }}>{jobs.map(j => <option key={j.id} value={j.id}>{j.ticker} / {j.provider} / {j.id.slice(-6)}</option>)}</select>}
    {error && <p role="alert" className="text-sm text-[var(--loss-fg)]">{error}</p>}
    {job && <p role="status" className="text-sm">{job.ticker}: {job.status}{job.status === "queued" ? " - waiting for the PC worker; this is not a completed report." : ""}{job.errorCode ? ` / ${job.errorCode}` : ""}{job.verdictId ? ` / Saved analysis ${job.verdictId}` : ""}</p>}
    {job?.resultJson && <ResearchReport report={job.resultJson.report} sources={job.resultJson.sources} />}
  </section>;
}




import MultiAgentAnalysisCard from "./MultiAgentAnalysisCard";
import type { MultiAgentResult } from "@/lib/analysis/agents";

const PIPELINE_ORDER: MultiAgentResult["reports"][number]["agent"][] = [
  "data",
  "fundamental",
  "technical",
  "news",
  "chart",
  "historical",
  "risk",
];

function verdictTone(verdict: MultiAgentResult["moderator"]["verdict"]): { bg: string; fg: string } {
  switch (verdict) {
    case "UNAVAILABLE": return { bg: "var(--bg-raised)", fg: "var(--fg-2)" };
    case "BUY":  return { bg: "var(--gain-bg)", fg: "var(--gain-fg)" };
    case "PASS": return { bg: "var(--loss-bg)", fg: "var(--loss-fg)" };
    default:     return { bg: "var(--accent-soft-bg)", fg: "var(--accent)" };
  }
}

function LegacyMultiAgentRunner() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MultiAgentResult | null>(null);

  async function run() {
    const t = ticker.trim().toUpperCase();
    if (!t) {
      setError("Enter a ticker first");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch("/api/analysis/multi-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const payload = await r.json();
      if (!r.ok) throw new Error(payload.error ?? `HTTP ${r.status}`);
      setResult(payload as MultiAgentResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  // Build a quick ordered map of reports for the pipeline visualization.
  const reportsByAgent = new Map(result?.reports.map((r) => [r.agent, r]) ?? []);
  const tone = result ? verdictTone(result.moderator.verdict) : null;

  return (
    <section className="market-panel p-5">
      <div className="market-section-head">
        <div>
          <p className="t-overline">Multi-Agent Analysis</p>
          <p className="t-caption">
            Preliminary research across available sources. A final verdict requires verified
            market data, fundamentals, technicals, news, charts and risk evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={ticker}
            disabled={loading}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter") run(); }}
            placeholder="AAPL"
            maxLength={10}
            className="w-24 rounded border border-[var(--line)] bg-[var(--bg-surface)] px-3 py-2 text-center text-[13px] font-mono uppercase outline-none"
          />
          <button
            type="button"
            onClick={run}
            disabled={loading || !ticker.trim()}
            className="mds-button mds-button--primary h-9 px-4 text-[12px]"
          >
            {loading ? "Analysing..." : "Run analysis"}
          </button>
        </div>
      </div>

      {error ? <p className="mb-3 t-caption text-[var(--loss-fg)]">{error}</p> : null}

      {/* Pipeline progress strip */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md bg-[var(--bg-raised)] p-3">
        {PIPELINE_ORDER.map((agent, i) => {
          const r = reportsByAgent.get(agent);
          const active = r?.status === "ok";
          const stub = r?.status === "stub";
          return (
            <div key={agent} className="flex items-center gap-2">
              <span
                className="flex h-7 min-w-7 items-center justify-center rounded px-2 font-mono text-[11px] font-bold uppercase"
                style={{
                  background: active ? (stub ? "var(--bg-surface)" : "var(--accent-soft-bg)") : "transparent",
                  color: active ? (stub ? "var(--fg-3)" : "var(--accent)") : "var(--fg-3)",
                  border: "1px solid var(--line)",
                }}
              >
                {agent}
              </span>
              {i < PIPELINE_ORDER.length - 1 ? (
                <span className="text-[var(--fg-3)]">→</span>
              ) : null}
            </div>
          );
        })}
        <span className="text-[var(--fg-3)]">→</span>
        <span
          className="rounded px-2 py-1 font-mono text-[11px] font-bold uppercase"
          style={tone ? { background: tone.bg, color: tone.fg, border: "1px solid var(--line)" } : { color: "var(--fg-3)", border: "1px solid var(--line)" }}
        >
          {result ? result.moderator.verdict : "moderator"}
        </span>
      </div>

      {/* Moderator consensus card */}
      {result ? (
        <div
          className="mb-4 rounded-lg border p-4"
          style={{
            background: tone?.bg ?? "var(--bg-raised)",
            borderColor: "var(--line)",
          }}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p
              className="font-mono text-3xl font-bold"
              style={{ color: tone?.fg }}
            >
              {result.moderator.verdict === "UNAVAILABLE" ? "Research incomplete" : result.moderator.verdict}
            </p>
            <p className="font-mono text-[13px]" style={{ color: tone?.fg }}>
              {result.moderator.verdict === "UNAVAILABLE" ? "Incomplete evidence" : `confidence ${result.moderator.confidence} / 100`}
            </p>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--fg-1)]">
            {result.moderator.rationale}
          </p>
        </div>
      ) : null}

      {/* Per-agent cards */}
      <div className="space-y-2">
        {result?.reports.map((r) => (
          <MultiAgentAnalysisCard key={r.agent} report={r} />
        ))}
        {!result && !loading ? (
          <p className="t-body-small text-[var(--fg-3)]">
            Enter a ticker and click <strong>Run analysis</strong> to inspect available findings and missing evidence.
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default function MultiAgentRunner(props: { initialTicker?: string }) {
  return process.env.NEXT_PUBLIC_FEATURE_RESEARCH_WORKER === "true" ? <StatefulResearchRunner {...props} /> : <LegacyMultiAgentRunner />;
}
