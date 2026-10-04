"""Auditable, user-scoped wiki context. Lexical mode is entirely offline.

Hybrid mode uses the existing Gemini index without repair and may embed the query.
Neither mode silently falls back. Retrieved text is evidence, never tool authority.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import importlib
import json
from pathlib import Path, PurePosixPath
import sys

SCHEMA_VERSION = "research-context/v1"
PROMPT_VERSION = "research-2026-10-04"
MANDATORY_PATHS = (
    "wiki/trading/traders/trader-styles.md",
    "wiki/trading/concepts/fundamental-analysis.md",
    "wiki/trading/concepts/ticker-catalyst-analysis.md",
    "wiki/trading/risk/risk-management.md",
    "wiki/trading/concepts/entry-methods.md",
    "wiki/trading/routines/go-chart-evidence-and-action-day.md",
    "skills/trade-analyser/references/mode-b-analysis.md",
)
ALLOWED_PREFIXES = (
    "wiki/trading/concepts/", "wiki/trading/traders/", "wiki/trading/risk/",
    "wiki/trading/routines/", "skills/trade-analyser/references/",
)


class ContextError(ValueError):
    """Context cannot be used; callers must expose this failure explicitly."""


def allowed_path(path):
    if not isinstance(path, str) or "\\" in path:
        return False
    parts = PurePosixPath(path).parts
    return (path.endswith(".md") and not any(p in {"..", ".", "_private"}
            or p.startswith(".") for p in parts)
            and any(path.startswith(prefix) for prefix in ALLOWED_PREFIXES))


def _retrieval_modules(wiki_root):
    """Load the canonical scripts lazily, refusing an unrelated same-name module."""
    directory = wiki_root / "scripts" / "retrieval"
    names = ("errors", "chunk_eval", "chunking", "providers", "embedding", "store", "query")
    for name in names:
        if not (directory / (name + ".py")).is_file():
            raise ContextError("Canonical wiki retrieval module is missing: " + name)
        loaded = sys.modules.get(name)
        if loaded is not None and Path(getattr(loaded, "__file__", "")).resolve() != (
                directory / (name + ".py")).resolve():
            raise ContextError("Conflicting retrieval module already loaded: " + name)
    sys.path.insert(0, str(directory))
    try:
        return tuple(importlib.import_module(name) for name in ("store", "query", "providers"))
    finally:
        sys.path.remove(str(directory))


def _hashes(documents):
    return {path: doc["sha256"] for path, doc in documents.items()}


def _scoped_documents(store, root):
    return {path: doc for path, doc in store.read_corpus(root).items() if allowed_path(path)}


def _passage(path, document, start, end, revision, retrieved_at):
    lines = document["text"].splitlines(keepends=True)
    text = "".join(lines[start - 1:end])
    return {"path": path, "startLine": start, "endLine": end,
            "citation": f"{path}:{start}-{end}", "text": text,
            "sourceSha256": document["sha256"],
            "contentSha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "revision": revision, "source": "worktree", "retrievedAt": retrieved_at}


def _validate_request(job, state, evidence, mode):
    if mode not in {"lexical", "hybrid"}:
        raise ContextError("Retrieval mode must be lexical or hybrid")
    if not isinstance(job, dict) or not isinstance(state, dict):
        raise ContextError("Job and thread state must be objects")
    for key in ("id", "userId", "threadId", "ticker", "question", "horizon", "provider", "asOf"):
        if not isinstance(job.get(key), str) or not job[key].strip():
            raise ContextError("Missing job field: " + key)
    if job["provider"] not in {"claude", "deepseek"}:
        raise ContextError("Unsupported research provider")
    try:
        if datetime.fromisoformat(job["asOf"].replace("Z", "+00:00")).tzinfo is None:
            raise ValueError()
    except ValueError as error:
        raise ContextError("Job asOf must be an ISO timestamp with timezone") from error
    if state.get("userId") != job["userId"] or state.get("threadId") != job["threadId"]:
        raise ContextError("Thread state does not belong to this user and thread")
    if not isinstance(state.get("summary", ""), str):
        raise ContextError("Thread summary must be text")
    if state.get("previousResultId") is not None and not isinstance(state["previousResultId"], str):
        raise ContextError("Previous result ID must be text or null")
    if not isinstance(evidence, list):
        raise ContextError("Evidence must be a caller-supplied list")
    try:
        json.dumps(evidence, allow_nan=False)
    except (TypeError, ValueError) as error:
        raise ContextError("Evidence must be finite JSON") from error


def build_context(wiki_root, job, thread_state, evidence, mode="lexical"):
    """Return a fresh context packet or raise ContextError; never repair an index.

    thread_state must explicitly carry userId and threadId even on a first run.
    No live evidence is fetched here. Supplemental ranking receives only allowlisted
    rows (and corresponding vectors), with at most six distinct source documents.
    """
    _validate_request(job, thread_state, evidence, mode)
    root = Path(wiki_root).resolve()
    try:
        store, query, providers = _retrieval_modules(root)
        revision = store.resolve_ref(root, "HEAD")
        documents = _scoped_documents(store, root)
        for path in MANDATORY_PATHS:
            if path not in documents or not documents[path]["text"].strip():
                raise ContextError("Missing or empty tracked mandatory doctrine: " + path)
        query_text = f"{job['ticker']} {job['horizon']} {job['question']}"
        query.validate_query(query_text, mode, 6)
        meta = index_metadata = None
        if mode == "lexical":
            rows = store.build_chunks(documents)
            vectors = None
        else:
            provider = providers.named("gemini")
            index = root / "scripts" / "retrieval" / provider.default_index
            all_rows, all_vectors, meta, state = store.prepare_index(
                root, index, allow_embed=False, expected=provider)
            if meta["source"] != "worktree":
                raise ContextError("Current research requires a current-worktree index")
            indices = [i for i, row in enumerate(all_rows) if allowed_path(row["path"])]
            rows = [all_rows[i] for i in indices]
            vectors = all_vectors[indices]
            index_metadata = {key: deepcopy(meta[key]) for key in (
                "embedding", "model", "dimensions", "chunker", "source", "built_at")}
            index_metadata.update({"refreshedAt": meta.get("refreshed_at"),
                                   "status": state["status"], "scopedChunks": len(rows)})
        hits = query.search_detailed(query_text, rows, vectors, meta or {}, mode, 6)
        if meta is not None:
            store.assert_fresh(root, all_rows, meta)
        # Repeat the complete scoped source snapshot, not merely returned top hits.
        if (_hashes(documents) != _hashes(_scoped_documents(store, root))
                or revision != store.resolve_ref(root, "HEAD")):
            raise ContextError("Wiki sources changed during retrieval; retry")
        retrieved_at = datetime.now(timezone.utc).isoformat()
        mandatory = [_passage(path, documents[path], 1,
                     len(documents[path]["text"].splitlines()), revision, retrieved_at)
                     for path in MANDATORY_PATHS]
        supplemental = []
        for row, detail in hits:
            path, start, end = row["path"], row["start_line"], row["end_line"]
            if (path not in documents or row["source_sha256"] != documents[path]["sha256"]
                    or not 1 <= start <= end <= len(documents[path]["text"].splitlines())):
                raise ContextError("Retrieved source provenance is invalid")
            supplemental.append({**_passage(path, documents[path], start, end, revision,
                                           retrieved_at), "ranking": detail})
        return {"schemaVersion": SCHEMA_VERSION, "promptVersion": PROMPT_VERSION,
                "jobId": job["id"], **{key: job[key] for key in (
                    "userId", "threadId", "ticker", "provider", "asOf", "question", "horizon")},
                "mandatory": mandatory, "supplemental": supplemental,
                "retrieval": {"mode": mode, "status": "current", "index": index_metadata,
                              "sourceRevision": revision, "checkedAt": retrieved_at,
                              "scope": list(ALLOWED_PREFIXES)},
                "state": {"summary": thread_state.get("summary", ""),
                          "previousResultId": thread_state.get("previousResultId")},
                "evidence": deepcopy(evidence)}
    except ContextError:
        raise
    except Exception as error:
        # Never reroute a failed hybrid request into a successful-looking keyword run.
        raise ContextError("Wiki context retrieval failed: " + type(error).__name__) from error
