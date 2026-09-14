"""
completion_checks.py — what was actually done, and what that permits.

The problem this solves
-----------------------
`preflight.py` answers one narrow question: may a market report be published at all?
On 2026-09-14 it returned WARN, the run proceeded, and the resulting report read as
though the whole daily workflow had been completed. It had not: no authenticated chart
was captured, the IBKR book was unreachable, DecisionPoint and MCO/MCSI were never read,
and no insider research was done. A preflight PASS/WARN says nothing about any of that.

Worse, the outcome — an empty GO list — is ambiguous in a way that matters. "Nothing
qualified after a complete review" is a market fact. "Nothing could be verified because
evidence collection never finished" is a workflow defect. Both printed the same empty
table for eight consecutive sessions.

Four separate questions
-----------------------
This module keeps them apart, because a single PASS/FAIL cannot answer all four:

  PUBLISH_PARTIAL   May a partial market report be published?
                    Usually yes — a partial report that states its gaps is useful.
  WORKFLOW_COMPLETE Was the requested daily workflow actually finished?
                    Independent of whether any trade was found.
  GO_ELIGIBLE       May a given candidate be promoted to GO?
                    Per candidate, not per run.
  NEW_RISK          May new portfolio risk be taken at all?
                    Regime, traction and broker protection live here.

Status vocabulary
-----------------
  completed       done, with evidence
  failed          attempted and did not succeed — the reason is recorded
  not_attempted   never tried (this is NOT "found nothing")
  not_applicable  genuinely does not apply to this run

`not_attempted` is deliberately distinct from `completed` with an empty result. A check
that was never run must never read as a cleared check.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

# ----------------------------------------------------------------- vocabulary
COMPLETED = "completed"
FAILED = "failed"
NOT_ATTEMPTED = "not_attempted"
NOT_APPLICABLE = "not_applicable"
STATUSES = (COMPLETED, FAILED, NOT_ATTEMPTED, NOT_APPLICABLE)

PUBLISH_PARTIAL = "publish_partial_report"
WORKFLOW_COMPLETE = "workflow_complete"
GO_ELIGIBLE = "candidate_go_eligible"
NEW_RISK = "new_portfolio_risk"
GATES = (PUBLISH_PARTIAL, WORKFLOW_COMPLETE, GO_ELIGIBLE, NEW_RISK)

# Which gates each check restricts when it is not `completed`.
# A check absent from this registry restricts nothing and is informational only.
CHECK_REGISTRY: dict[str, dict] = {
    "preflight_receipt": {
        "gates": (PUBLISH_PARTIAL,),
        "label": "Preflight receipt valid and fresh",
    },
    "chart_capture": {
        "gates": (GO_ELIGIBLE, WORKFLOW_COMPLETE),
        "label": "Authenticated TradingView daily + weekly chart",
        "per_candidate": True,
    },
    "insider_institutional": {
        "gates": (GO_ELIGIBLE,),
        "label": "Insider / institutional record reviewed",
        "per_candidate": True,
    },
    "catalyst_brief": {
        "gates": (GO_ELIGIBLE,),
        "label": "Source-backed catalyst brief",
        "per_candidate": True,
    },
    "broker_protection": {
        "gates": (NEW_RISK,),
        "label": "Live protective-order reconciliation",
    },
    "ibkr_verification": {
        "gates": (NEW_RISK, WORKFLOW_COMPLETE),
        "label": "IBKR book verified",
    },
    "decisionpoint": {
        "gates": (WORKFLOW_COMPLETE,),
        "label": "DecisionPoint gallery read",
    },
    "mco_mcsi": {
        "gates": (WORKFLOW_COMPLETE,),
        "label": "McClellan Oscillator / Summation read",
    },
    "trend_radar": {
        "gates": (WORKFLOW_COMPLETE,),
        "label": "Pop-up trend radar sweep",
    },
    "fear_greed": {
        "gates": (),
        "label": "CNN Fear & Greed",
    },
}


class CheckLedger:
    """Records what was attempted, what it proved, and what that restricts."""

    def __init__(self, session_date: str, run_dir: str | None = None):
        self.session_date = session_date
        self.run_dir = run_dir
        self.entries: list[dict] = []

    # -------------------------------------------------------------- recording
    def record(self, check: str, status: str, *, evidence: str = "",
               candidate: str | None = None, reason: str = "",
               timestamp: str | None = None) -> dict:
        if status not in STATUSES:
            raise ValueError(f"unknown status {status!r}; expected one of {STATUSES}")
        if check not in CHECK_REGISTRY:
            raise ValueError(f"unknown check {check!r}; add it to CHECK_REGISTRY")
        if status == COMPLETED and not evidence:
            # A completed check with no evidence is indistinguishable from a claim.
            raise ValueError(f"check {check!r} marked completed without evidence")
        if status == FAILED and not reason:
            raise ValueError(f"check {check!r} marked failed without a reason")
        entry = {
            "check": check,
            "label": CHECK_REGISTRY[check]["label"],
            "status": status,
            "candidate": candidate,
            "evidence": evidence,
            "reason": reason,
            "restricts": list(CHECK_REGISTRY[check]["gates"]) if status != COMPLETED else [],
            "timestamp": timestamp or datetime.now().isoformat(timespec="seconds"),
        }
        self.entries.append(entry)
        return entry

    def _for(self, candidate: str | None) -> list[dict]:
        """Run-level entries, plus the entries for one candidate."""
        return [e for e in self.entries
                if e["candidate"] is None or e["candidate"] == candidate]

    # ----------------------------------------------------------------- gates
    def gate(self, name: str, candidate: str | None = None) -> dict:
        """Is `name` permitted? Returns the decision and everything blocking it."""
        if name not in GATES:
            raise ValueError(f"unknown gate {name!r}")
        blockers = [
            {"check": e["check"], "status": e["status"],
             "candidate": e["candidate"], "reason": e["reason"] or e["evidence"]}
            for e in self._for(candidate)
            if name in e["restricts"]
        ]
        # A per-candidate check that was never recorded at all is itself a blocker:
        # silence is not a pass.
        if name == GO_ELIGIBLE and candidate:
            seen = {e["check"] for e in self.entries if e["candidate"] == candidate}
            for check, meta in CHECK_REGISTRY.items():
                if meta.get("per_candidate") and GO_ELIGIBLE in meta["gates"] and check not in seen:
                    blockers.append({"check": check, "status": NOT_ATTEMPTED,
                                     "candidate": candidate,
                                     "reason": "never recorded for this candidate"})
        return {"gate": name, "candidate": candidate,
                "allowed": not blockers, "blockers": blockers}

    # ------------------------------------------------------------- reporting
    def go_absence_reason(self, candidates: list[str]) -> dict:
        """Why is the GO list empty? The two reasons are not interchangeable.

        `evidence_incomplete` means the workflow could not answer the question.
        `no_candidate_qualified` means it answered, and the answer was no.
        """
        if not candidates:
            return {"reason": "no_candidates_screened",
                    "summary": "No candidate reached the review stage."}
        blocked = {c: self.gate(GO_ELIGIBLE, c) for c in candidates}
        unevaluable = {c: g for c, g in blocked.items() if not g["allowed"]}
        if len(unevaluable) == len(candidates):
            checks = sorted({b["check"] for g in unevaluable.values() for b in g["blockers"]})
            return {
                "reason": "evidence_incomplete",
                "summary": (
                    f"No verified GO because evidence collection was incomplete for every "
                    f"one of the {len(candidates)} candidates reviewed. Blocking checks: "
                    f"{', '.join(checks)}. This is NOT a statement that the market offered "
                    f"nothing."
                ),
                "blocked_candidates": sorted(unevaluable),
            }
        if unevaluable:
            return {
                "reason": "mixed",
                "summary": (
                    f"{len(candidates) - len(unevaluable)} candidate(s) were fully reviewed "
                    f"and did not qualify; {len(unevaluable)} could not be evaluated because "
                    f"evidence collection was incomplete."
                ),
                "blocked_candidates": sorted(unevaluable),
            }
        return {
            "reason": "no_candidate_qualified",
            "summary": (
                f"All {len(candidates)} candidates were reviewed against complete evidence "
                f"and none cleared the gates. This is a market read, not a workflow gap."
            ),
            "blocked_candidates": [],
        }

    def workflow_defects(self, history: list[dict] | None = None,
                         threshold: int = 2) -> list[dict]:
        """Surface repeated collection failures as defects rather than market caution.

        `history` is a list of prior ledger summaries (oldest or newest order does not
        matter). A check that failed or was skipped in `threshold` or more runs
        including this one is a workflow defect that needs fixing, not a caveat to
        repeat.
        """
        runs = list(history or []) + [self.summary()]
        counts: dict[str, int] = {}
        for run in runs:
            bad = {e["check"] for e in run.get("entries", [])
                   if e["status"] in (FAILED, NOT_ATTEMPTED)}
            for check in bad:
                counts[check] = counts.get(check, 0) + 1
        return [
            {"check": check, "runs_affected": n,
             "message": (
                 f"{CHECK_REGISTRY[check]['label']} has failed or been skipped in {n} "
                 f"runs. Repeated collection failure is a workflow defect, not market "
                 f"caution — fix the collection path."
             )}
            for check, n in sorted(counts.items(), key=lambda kv: -kv[1])
            if n >= threshold
        ]

    def summary(self) -> dict:
        by_status: dict[str, int] = {}
        for e in self.entries:
            by_status[e["status"]] = by_status.get(e["status"], 0) + 1
        return {
            "session_date": self.session_date,
            "run_dir": self.run_dir,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "counts": by_status,
            "gates": {g: self.gate(g) for g in (PUBLISH_PARTIAL, WORKFLOW_COMPLETE, NEW_RISK)},
            "entries": self.entries,
        }

    def save(self, path: str | Path) -> Path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(self.summary(), indent=2), encoding="utf-8", newline="\n")
        return p

    @staticmethod
    def load(path: str | Path) -> dict:
        return json.loads(Path(path).read_text(encoding="utf-8"))

    # ------------------------------------------------------------ rendering
    def render(self) -> str:
        """Human-readable block for report.md. Never collapses to a single verdict."""
        mark = {COMPLETED: "done", FAILED: "FAILED",
                NOT_ATTEMPTED: "NOT ATTEMPTED", NOT_APPLICABLE: "n/a"}
        lines = ["| Check | Candidate | Status | Evidence / reason | Restricts |",
                 "|---|---|---|---|---|"]
        for e in self.entries:
            restricts = ", ".join(e["restricts"]) or "-"
            detail = e["evidence"] or e["reason"] or "-"
            lines.append(
                f"| {e['label']} | {e['candidate'] or '-'} | **{mark[e['status']]}** "
                f"| {detail} | {restricts} |"
            )
        lines.append("")
        for g in (PUBLISH_PARTIAL, WORKFLOW_COMPLETE, NEW_RISK):
            d = self.gate(g)
            state = "ALLOWED" if d["allowed"] else "BLOCKED"
            why = "" if d["allowed"] else (
                " — blocked by " + ", ".join(sorted({b["check"] for b in d["blockers"]})))
            lines.append(f"- `{g}`: **{state}**{why}")
        return "\n".join(lines)
