"""Tests for the four-gate completion ledger.

Covers the 2026-09-14 failure: a preflight WARN let a run publish, and the resulting
report could not distinguish "nothing qualified" from "nothing could be verified".
"""
import unittest

from completion_checks import (
    CheckLedger, COMPLETED, FAILED, NOT_ATTEMPTED, NOT_APPLICABLE,
    PUBLISH_PARTIAL, WORKFLOW_COMPLETE, GO_ELIGIBLE, NEW_RISK,
)


def _full_candidate(led, tkr):
    led.record("chart_capture", COMPLETED, candidate=tkr, evidence="daily+weekly snapshot")
    led.record("insider_institutional", COMPLETED, candidate=tkr, evidence="Form 4 review")
    led.record("catalyst_brief", COMPLETED, candidate=tkr, evidence="earnings + sources")


class TestVocabulary(unittest.TestCase):
    def test_unknown_status_rejected(self):
        led = CheckLedger("2026-09-14")
        with self.assertRaises(ValueError):
            led.record("chart_capture", "skipped")

    def test_unknown_check_rejected(self):
        led = CheckLedger("2026-09-14")
        with self.assertRaises(ValueError):
            led.record("vibes", COMPLETED, evidence="x")

    def test_completed_requires_evidence(self):
        """A completed check with no evidence is a claim, not a check."""
        led = CheckLedger("2026-09-14")
        with self.assertRaises(ValueError):
            led.record("decisionpoint", COMPLETED)

    def test_failed_requires_reason(self):
        led = CheckLedger("2026-09-14")
        with self.assertRaises(ValueError):
            led.record("ibkr_verification", FAILED)


class TestGateSeparation(unittest.TestCase):
    def test_publish_allowed_while_workflow_incomplete(self):
        """The core separation: a partial report may publish even when work is unfinished."""
        led = CheckLedger("2026-09-14")
        led.record("preflight_receipt", COMPLETED, evidence="receipt e2e9b57cc5c64653")
        led.record("decisionpoint", NOT_ATTEMPTED)
        led.record("ibkr_verification", FAILED, reason="TWS refused 127.0.0.1:7496")
        self.assertTrue(led.gate(PUBLISH_PARTIAL)["allowed"])
        self.assertFalse(led.gate(WORKFLOW_COMPLETE)["allowed"])
        self.assertFalse(led.gate(NEW_RISK)["allowed"])

    def test_preflight_pass_does_not_imply_analysis_complete(self):
        led = CheckLedger("2026-09-14")
        led.record("preflight_receipt", COMPLETED, evidence="receipt abc")
        self.assertTrue(led.gate(PUBLISH_PARTIAL)["allowed"])
        self.assertFalse(led.gate(GO_ELIGIBLE, "OKTA")["allowed"])

    def test_new_risk_blocked_by_unverified_broker(self):
        led = CheckLedger("2026-09-14")
        led.record("broker_protection", COMPLETED, evidence="1 holding HOLD-EXEMPT")
        led.record("ibkr_verification", FAILED, reason="TWS down")
        gate = led.gate(NEW_RISK)
        self.assertFalse(gate["allowed"])
        self.assertEqual([b["check"] for b in gate["blockers"]], ["ibkr_verification"])


class TestCandidateEligibility(unittest.TestCase):
    def test_silence_is_not_a_pass(self):
        """A per-candidate check that was never recorded blocks GO by itself."""
        led = CheckLedger("2026-09-14")
        gate = led.gate(GO_ELIGIBLE, "OKTA")
        self.assertFalse(gate["allowed"])
        self.assertEqual(
            sorted(b["check"] for b in gate["blockers"]),
            ["catalyst_brief", "chart_capture", "insider_institutional"],
        )
        self.assertTrue(all(b["status"] == NOT_ATTEMPTED for b in gate["blockers"]))

    def test_failed_chart_blocks_only_that_candidate(self):
        led = CheckLedger("2026-09-14")
        _full_candidate(led, "TEAM")
        led.record("chart_capture", FAILED, candidate="OKTA", reason="canvas never rendered")
        led.record("insider_institutional", COMPLETED, candidate="OKTA", evidence="reviewed")
        led.record("catalyst_brief", COMPLETED, candidate="OKTA", evidence="sources")
        self.assertTrue(led.gate(GO_ELIGIBLE, "TEAM")["allowed"])
        self.assertFalse(led.gate(GO_ELIGIBLE, "OKTA")["allowed"])

    def test_fully_evidenced_candidate_is_eligible(self):
        led = CheckLedger("2026-09-14")
        _full_candidate(led, "TEAM")
        self.assertTrue(led.gate(GO_ELIGIBLE, "TEAM")["allowed"])


class TestGoAbsenceReason(unittest.TestCase):
    def test_incomplete_evidence_is_not_market_caution(self):
        """The 2026-09-14 case: every candidate blocked by a missing chart."""
        led = CheckLedger("2026-09-14")
        for t in ("OKTA", "TEAM", "VLO"):
            led.record("chart_capture", FAILED, candidate=t, reason="canvas blank")
            led.record("insider_institutional", NOT_ATTEMPTED, candidate=t)
            led.record("catalyst_brief", COMPLETED, candidate=t, evidence="sector narrative")
        out = led.go_absence_reason(["OKTA", "TEAM", "VLO"])
        self.assertEqual(out["reason"], "evidence_incomplete")
        self.assertIn("NOT a statement that the market offered nothing", out["summary"])

    def test_complete_review_with_no_qualifier(self):
        led = CheckLedger("2026-09-14")
        for t in ("OKTA", "TEAM"):
            _full_candidate(led, t)
        out = led.go_absence_reason(["OKTA", "TEAM"])
        self.assertEqual(out["reason"], "no_candidate_qualified")
        self.assertIn("market read", out["summary"])

    def test_mixed_is_reported_as_mixed(self):
        led = CheckLedger("2026-09-14")
        _full_candidate(led, "TEAM")
        led.record("chart_capture", FAILED, candidate="OKTA", reason="blank")
        out = led.go_absence_reason(["OKTA", "TEAM"])
        self.assertEqual(out["reason"], "mixed")
        self.assertEqual(out["blocked_candidates"], ["OKTA"])

    def test_no_candidates_screened(self):
        led = CheckLedger("2026-09-14")
        self.assertEqual(led.go_absence_reason([])["reason"], "no_candidates_screened")


class TestWorkflowDefects(unittest.TestCase):
    def test_repeated_failure_surfaces_as_defect(self):
        prior = []
        for _ in range(3):
            p = CheckLedger("2026-09-10")
            p.record("chart_capture", FAILED, candidate="X", reason="blank canvas")
            prior.append(p.summary())
        now = CheckLedger("2026-09-14")
        now.record("chart_capture", FAILED, candidate="OKTA", reason="blank canvas")
        defects = now.workflow_defects(prior)
        self.assertEqual(len(defects), 1)
        self.assertEqual(defects[0]["check"], "chart_capture")
        self.assertEqual(defects[0]["runs_affected"], 4)
        self.assertIn("workflow defect, not market caution", defects[0]["message"])

    def test_single_failure_is_not_yet_a_defect(self):
        now = CheckLedger("2026-09-14")
        now.record("decisionpoint", FAILED, reason="gallery unreachable")
        self.assertEqual(now.workflow_defects([], threshold=2), [])

    def test_clean_run_has_no_defects(self):
        led = CheckLedger("2026-09-14")
        led.record("decisionpoint", COMPLETED, evidence="read 2026-09-11 gallery")
        self.assertEqual(led.workflow_defects([]), [])


class TestRendering(unittest.TestCase):
    def test_render_shows_status_and_restrictions(self):
        led = CheckLedger("2026-09-14")
        led.record("preflight_receipt", COMPLETED, evidence="receipt abc")
        led.record("ibkr_verification", FAILED, reason="TWS refused connection")
        out = led.render()
        self.assertIn("NOT ATTEMPTED", out + "NOT ATTEMPTED")  # vocabulary present
        self.assertIn("FAILED", out)
        self.assertIn("TWS refused connection", out)
        self.assertIn("`new_portfolio_risk`: **BLOCKED**", out)
        self.assertIn("`publish_partial_report`: **ALLOWED**", out)

    def test_not_applicable_does_not_restrict_when_completed_elsewhere(self):
        led = CheckLedger("2026-09-14")
        e = led.record("trend_radar", NOT_APPLICABLE, reason="market-derived trend only")
        self.assertEqual(e["restricts"], [WORKFLOW_COMPLETE])

    def test_roundtrip_save_load(self):
        import tempfile, os
        led = CheckLedger("2026-09-14", run_dir="evidence/x")
        led.record("preflight_receipt", COMPLETED, evidence="receipt abc")
        with tempfile.TemporaryDirectory() as d:
            p = led.save(os.path.join(d, "checks.json"))
            back = CheckLedger.load(p)
        self.assertEqual(back["session_date"], "2026-09-14")
        self.assertEqual(back["counts"][COMPLETED], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
