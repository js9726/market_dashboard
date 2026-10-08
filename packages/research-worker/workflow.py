"""Explicit LangGraph research stages; ResearchJob/Thread own durable state.

No LangGraph checkpointer or node-resume claim: a new lease runs a fresh graph.
Only synthesis calls the selected analysis provider; enabled news collection has
its own existing, explicitly opted-in Gemini search call.
"""
from __future__ import annotations

from pathlib import Path
from typing import TypedDict


class WorkerError(RuntimeError):
    pass


class ConcurrentUpdate(WorkerError):
    """The server rolled back a conflicting transaction; safe to resubmit."""


class ResearchState(TypedDict, total=False):
    evidence: list
    evidence_status: str
    collector_gaps: list
    context: dict
    report: dict
    session_id: str | None
    receipt: dict


def build_workflow(*, client, job, wiki_root, mode, evidence_dir, generator,
                   builder, evidence_loader, market_collector, news_collector,
                   cancelled, live_market=False, grounded_news=False,
                   wiki_store="local"):
    try:
        from langgraph.graph import END, START, StateGraph
    except ImportError as error:
        raise WorkerError("LANGGRAPH_DEPENDENCY_REQUIRED: install research-worker/requirements.txt") from error
    if wiki_store not in {"local", "pg"} or (wiki_store == "pg" and mode != "hybrid"):
        raise WorkerError("PG_WIKI_STORE_REQUIRES_HYBRID_RETRIEVAL")
    identity = {"id": job["id"], "leaseToken": job["leaseToken"]}

    def check_lease():
        if cancelled.is_set():
            raise WorkerError("LEASE_LOST")

    def evidence_file(state):
        check_lease()
        evidence, status = evidence_loader(job["ticker"], evidence_dir)
        return {"evidence": evidence, "evidence_status": status, "collector_gaps": []}

    def collect(state, collector):
        check_lease()
        collected, gaps = collector(job["ticker"])
        collected_ids = {source["id"] for source in collected}
        return {"evidence": [s for s in state["evidence"] if s.get("id") not in collected_ids] + collected,
                "collector_gaps": state["collector_gaps"] + gaps}

    def wiki_context(state):
        check_lease()
        evidence, gaps = state["evidence"], list(state["collector_gaps"])
        if len(evidence) > 100:
            priority = {"chart_daily": 0, "chart_weekly": 0, "quote": 1, "fundamental": 2, "search_grounded": 3}
            evidence = sorted(evidence, key=lambda s: priority.get(s.get("kind"), 4))[:100]
            gaps.append("Evidence truncated to 100 sources; charts and market evidence retained first")
        options = {"mode": mode}
        if wiki_store != "local":
            options["store_type"] = wiki_store
        context = builder(wiki_root, job, job["thread"], evidence, **options)
        context["evidenceStatus"] = state["evidence_status"]
        context["collectorGaps"] = gaps
        return {"evidence": evidence, "collector_gaps": gaps, "context": context}

    def checkpoint(state):
        check_lease()
        client.post("checkpoint", **identity, context=state["context"])
        return {}

    def synthesis(state):
        check_lease()
        context = state["context"]
        report, session_id = generator(job["provider"], context, job["template"], cancelled,
                                       session_id=job["thread"].get("sessionId"),
                                       cwd=str(Path(__file__).resolve().parent))
        # The provider adapter records observed usage/model in this context.
        return {"report": report, "session_id": session_id, "context": context}

    def complete(state):
        fields = {**identity, "report": state["report"]}
        if state.get("session_id"):
            fields["sessionId"] = state["session_id"]
        for attempt in range(3):
            check_lease()
            try:
                client.post("complete", **fields)
                break
            except WorkerError as error:
                # A lost response may follow a committed result; read before retry.
                try:
                    receipt = client.post("receipt", **identity)
                except WorkerError:
                    receipt = {}
                if receipt.get("persisted"):
                    break
                if not isinstance(error, ConcurrentUpdate) or attempt == 2:
                    raise error
                if cancelled.wait(.25 * (attempt + 1)):
                    raise WorkerError("LEASE_LOST")
        return {}

    def readback(state):
        receipt = client.post("receipt", **identity)
        if (receipt.get("id") != job["id"] or not receipt.get("persisted")
                or not receipt.get("verdictId") or receipt.get("status") not in {"partial", "succeeded"}):
            raise WorkerError("INGEST_READBACK_FAILED")
        return {"receipt": receipt}

    stages = [("evidence_file", evidence_file)]
    if live_market:
        stages.append(("market_collection", lambda state: collect(state, market_collector)))
    if grounded_news:
        stages.append(("news_collection", lambda state: collect(state, news_collector)))
    stages.extend([("wiki_context", wiki_context), ("checkpoint_context", checkpoint),
                   ("provider_synthesis", synthesis), ("checkpoint_usage", checkpoint),
                   ("complete", complete), ("readback", readback)])
    graph = StateGraph(ResearchState)
    previous = START
    for name, node in stages:
        graph.add_node(name, node)
        graph.add_edge(previous, name)
        previous = name
    graph.add_edge(previous, END)
    return graph.compile(checkpointer=None)


def run_workflow(**options):
    try:
        from langsmith import tracing_context
    except ImportError as error:
        raise WorkerError("LANGGRAPH_DEPENDENCY_REQUIRED: install research-worker/requirements.txt") from error
    # Private context must never inherit environment-enabled external tracing.
    with tracing_context(enabled=False, parent=False):
        graph = build_workflow(**options)
        return graph.invoke({}, config={"callbacks": []})["receipt"]
