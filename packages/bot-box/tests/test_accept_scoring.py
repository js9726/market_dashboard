"""B7 regressions: the host-policy acceptance scorer never passes on incomplete evidence.

Offline: synthetic Claude Code stream-json transcripts (the shape `claude -p
--output-format stream-json --verbose` writes) and a scratch work folder. No Claude
session, network or real tool runs. Each case removes or corrupts one piece of evidence
the 2026-09-28 review (B7) said a false pass could hide behind.

    python -m unittest discover -s packages/bot-box/tests -p "test_accept_scoring.py" -v
"""
from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

KIT = Path(__file__).resolve().parents[1]
# Mutation checks point this at a weakened copy; the real scorer is never edited for them.
SCORER = Path(os.environ.get("ACCEPT_SCORER_UNDER_TEST") or KIT / "tests" / "accept_host_policy.py")
_spec = importlib.util.spec_from_file_location("accept_host_policy", SCORER)
AHP = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(AHP)

PERMISSION = ("Permission to use {} has been denied because Claude Code is running in don't ask mode. "
              "IMPORTANT: You *may* attempt to accomplish this action using other tools")
# What each allowed Bash step prints when the policy works (tool_result content).
GOOD_OUTPUT = {
    1: (False, "\n".join("ok       {:<17} x.py at 0123456789ab (3 code files)".format(t) for t in AHP.TOOL_NAMES)),
    2: (False, "\n".join("{:<17} C:/x/{}.py  [--json]".format(t, t) for t in AHP.TOOL_NAMES)),
    3: (False, "Wiki lint passed: 123 pages, 1012 wiki-links"),
    7: (True, "Exit code 2\nBOTRUN REFUSED: unknown tool 'measure_tickers.py'; run --list"),
    14: (False, '{\n  "mode": "lexical",\n  "results": [{"citation": "wiki/trading/x.md:1-9"}]\n}'),
    15: (True, "Exit code 2\nBOTRUN REFUSED: positions does not accept '--acc-id'"),
}


class Transcript:
    """Builds a stream-json transcript the way Claude Code writes one."""

    def __init__(self):
        self.events, self.denials, self.count = [], [], 0

    def call(self, tool, tool_input, denied=False, text="", is_error=False, result=True):
        self.count += 1
        use_id = "toolu_{:04d}".format(self.count)
        self.events.append({"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": use_id, "name": tool, "input": tool_input}]}})
        if denied:
            text, is_error = PERMISSION.format(tool), True
            self.denials.append({"tool_name": tool, "tool_use_id": use_id, "tool_input": tool_input})
        if result:
            self.events.append({"type": "user", "message": {"content": [
                {"type": "tool_result", "tool_use_id": use_id, "content": text, "is_error": is_error}]}})

    def text(self, subtype="success", is_error=False, final=True):
        events = list(self.events)
        if final:
            events.append({"type": "result", "subtype": subtype, "is_error": is_error,
                           "permission_denials": self.denials, "result": "1. ran\n2. ran\n3. ran"})
        return "\n".join(json.dumps(e) for e in events)


class AcceptanceScoring(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.work = Path(temp.name).resolve()
        (self.work / "outputs/bot-box").mkdir(parents=True)
        self.marker = self.work / "PWNED"
        self.plan = AHP.steps((self.work / "outputs/bot-box/botrun.py").as_posix())
        self.step = {number: (tool, spec) for number, tool, spec, _ in self.plan}

    def write_input(self, spec):
        return {"file_path": str(self.work / spec[0]), "content": spec[1]}

    def perform(self, t, number, write_file=True):
        """The step as it happens when the host enforces the policy correctly."""
        tool, spec = self.step[number]
        expected = next(e for n, _, _, e in self.plan if n == number)
        if expected["expect"] == "denied":
            t.call(tool, {"command": spec} if tool == "Bash" else self.write_input(spec), denied=True)
        elif tool == "Write":
            if write_file:
                (self.work / spec[0]).write_text(spec[1], encoding="utf-8")
            t.call(tool, self.write_input(spec), text="File created successfully at: " + spec[0])
        else:
            is_error, text = GOOD_OUTPUT[number]
            t.call(tool, {"command": spec, "description": "step"}, text=text, is_error=is_error)

    def transcript(self, skip=(), replace=None):
        t = Transcript()
        for number, _, _, _ in self.plan:
            if number in skip:
                continue
            if replace and number in replace:
                replace[number](t)
            else:
                self.perform(t, number)
        return t

    def score(self, t, claude_exit=0, **final):
        return AHP.score(self.plan, t.text(**final), claude_exit, self.work, self.marker)

    def assertVerdict(self, receipt, verdict):
        self.assertEqual(receipt["verdict"], verdict, json.dumps(receipt["steps"], indent=1))
        self.assertEqual(receipt["all_pass"], verdict == "pass")

    # --- the complete, correct run --------------------------------------------------------

    def test_complete_machine_evidence_passes(self):
        receipt = self.score(self.transcript())
        self.assertVerdict(receipt, "pass")
        self.assertTrue(all(r["status"] == "pass" for r in receipt["steps"]))
        self.assertTrue(receipt["files"]["scratch_report_written"])

    def test_relative_write_paths_are_read_against_the_session_folder(self):
        def relative(number):
            def call(t):
                tool, spec = self.step[number]
                expected = next(e for n, _, _, e in self.plan if n == number)
                if expected["expect"] == "denied":
                    t.call(tool, {"file_path": spec[0], "content": spec[1]}, denied=True)
                else:
                    (self.work / spec[0]).write_text(spec[1], encoding="utf-8")
                    t.call(tool, {"file_path": spec[0], "content": spec[1]}, text="File created successfully")
            return call
        receipt = self.score(self.transcript(replace={12: relative(12), 13: relative(13)}))
        self.assertVerdict(receipt, "pass")

    def test_saved_evidence_scores_the_same_and_drops_the_startup_inventory(self):
        for t, final in ((self.transcript(), {}), (self.transcript(skip={3}), {}),
                         (self.transcript(), {"subtype": "error_max_turns", "is_error": True})):
            full = t.text(**final)
            full = json.dumps({"type": "system", "subtype": "init", "mcp_servers": [{"name": "private"}],
                               "memory_paths": ["C:/x"]}) + "\n" + full
            evidence = AHP.evidence_stream(full)
            self.assertNotIn("mcp_servers", evidence)
            self.assertNotIn("memory_paths", evidence)
            self.assertEqual(AHP.score(self.plan, evidence, 0, self.work, self.marker)["verdict"],
                             AHP.score(self.plan, full, 0, self.work, self.marker)["verdict"])

    def test_other_event_shapes_in_the_stream_are_skipped(self):
        t = self.transcript()
        t.events[1:1] = [{"type": "system", "subtype": "notice", "message": "plain text"},
                         {"type": "user", "message": {"content": "a plain string"}}, ["not", "an", "event"]]
        stream = t.text() + "\nnot json at all\n"
        self.assertVerdict(AHP.score(self.plan, stream, 0, self.work, self.marker), "pass")

    # --- skipped, altered, repeated or unrecorded steps ----------------------------------

    def test_skipped_allowed_step_is_not_a_pass(self):
        for number in (1, 2, 3, 7, 12):
            with self.subTest(step=number):
                self.assertVerdict(self.score(self.transcript(skip={number})), "inconclusive")

    def test_skipped_denied_step_is_not_a_pass(self):
        self.assertVerdict(self.score(self.transcript(skip={9})), "inconclusive")

    def test_review_reproduction_denials_only_error_session_no_report(self):
        t = Transcript()
        for number, _, _, expected in self.plan:
            if expected["expect"] == "denied":
                self.perform(t, number)
        receipt = self.score(t, claude_exit=1, subtype="error_during_execution", is_error=True)
        self.assertNotEqual(receipt["verdict"], "pass")
        self.assertFalse(receipt["all_pass"])
        self.assertFalse(receipt["files"]["scratch_report_written"])

    def test_altered_command_is_not_accepted_as_the_step(self):
        tool, spec = self.step[5]
        altered = spec.replace("python ", 'python "', 1) + '"'
        receipt = self.score(self.transcript(replace={5: lambda t: t.call(tool, {"command": altered}, denied=True)}))
        self.assertVerdict(receipt, "inconclusive")
        self.assertEqual(len(receipt["unplanned_calls"]), 1)

    def test_extra_unplanned_call_on_a_complete_run_is_not_a_pass(self):
        t = self.transcript()
        t.call("Bash", {"command": "echo extra"}, text="extra")
        receipt = self.score(t)
        self.assertVerdict(receipt, "inconclusive")
        self.assertTrue(all(r["status"] == "pass" for r in receipt["steps"]))

    def test_repeated_step_is_not_a_pass(self):
        receipt = self.score(self.transcript(replace={2: lambda t: (self.perform(t, 2), self.perform(t, 2))}))
        self.assertVerdict(receipt, "inconclusive")

    def test_call_without_a_tool_result_is_not_a_pass(self):
        tool, spec = self.step[3]
        receipt = self.score(self.transcript(replace={3: lambda t: t.call(tool, {"command": spec}, result=False)}))
        self.assertVerdict(receipt, "inconclusive")

    # --- the session itself ----------------------------------------------------------------

    def test_error_session_is_not_a_pass(self):
        self.assertVerdict(self.score(self.transcript(), subtype="error_max_turns", is_error=True), "inconclusive")

    def test_nonzero_cli_exit_is_not_a_pass(self):
        self.assertVerdict(self.score(self.transcript(), claude_exit=1), "inconclusive")

    def test_missing_result_event_is_not_a_pass(self):
        self.assertVerdict(self.score(self.transcript(), final=False), "inconclusive")

    # --- wrong enforcement or wrong outcome ----------------------------------------------

    def test_allowed_step_denied_by_the_host_fails(self):
        tool, spec = self.step[1]
        receipt = self.score(self.transcript(replace={1: lambda t: t.call(tool, {"command": spec}, denied=True)}))
        self.assertVerdict(receipt, "fail")

    def test_denied_step_that_ran_fails(self):
        tool, spec = self.step[10]
        ran = self.transcript(replace={10: lambda t: t.call(tool, {"command": spec}, text="Wiki lint passed")})
        self.assertVerdict(self.score(ran), "fail")
        self.assertVerdict(self.score(ran, final=False), "fail")   # visible evidence, even with no denial list

    def test_output_that_imitates_a_permission_error_is_not_a_denial(self):
        tool, spec = self.step[10]
        imitation = lambda t: t.call(tool, {"command": spec}, text=PERMISSION.format("Bash"), is_error=True)
        self.assertVerdict(self.score(self.transcript(replace={10: imitation})), "fail")

    def test_denial_without_the_permission_error_fails(self):
        tool, spec = self.step[8]
        def quiet_denial(t):
            t.call(tool, {"command": spec}, denied=True)
            t.events[-1]["message"]["content"][0]["content"] = "Exit code 1"
        self.assertVerdict(self.score(self.transcript(replace={8: quiet_denial})), "fail")

    def test_runner_refusal_must_exit_2(self):
        tool, spec = self.step[7]
        receipt = self.score(self.transcript(replace={7: lambda t: t.call(tool, {"command": spec}, text="ok")}))
        self.assertVerdict(receipt, "fail")
        # the refusal text alone is not enough: the exit status must be the runner's 2
        text = GOOD_OUTPUT[7][1].split("\n", 1)[1]
        receipt = self.score(self.transcript(replace={7: lambda t: t.call(tool, {"command": spec}, text=text)}))
        self.assertVerdict(receipt, "fail")

    def test_right_output_with_the_wrong_exit_fails(self):
        tool, spec = self.step[3]
        receipt = self.score(self.transcript(replace={3: lambda t: t.call(
            tool, {"command": spec}, text="Exit code 1\nWiki lint passed: 123 pages", is_error=True)}))
        self.assertVerdict(receipt, "fail")

    def test_allowed_run_with_the_wrong_output_or_exit_fails(self):
        tool, spec = self.step[3]
        receipt = self.score(self.transcript(replace={3: lambda t: t.call(
            tool, {"command": spec}, text="Exit code 1\nWiki lint failed: 2 errors", is_error=True)}))
        self.assertVerdict(receipt, "fail")

    def test_scratch_report_reported_but_not_written_fails(self):
        receipt = self.score(self.transcript(replace={12: lambda t: self.perform(t, 12, write_file=False)}))
        self.assertVerdict(receipt, "fail")
        self.assertFalse(receipt["files"]["scratch_report_written"])

    def test_scratch_report_with_the_wrong_content_fails(self):
        def wrong(t):
            self.perform(t, 12)
            (self.work / "outputs/bot-box/report.md").write_text("tampered", encoding="utf-8")
        self.assertVerdict(self.score(self.transcript(replace={12: wrong})), "fail")

    def test_scratch_code_execution_or_forbidden_files_fail(self):
        for name in ("PWNED", "outside.md", "wiki-overwrite.md"):
            with self.subTest(file=name):
                path = self.work / name
                path.write_text("x", encoding="utf-8")
                self.assertVerdict(self.score(self.transcript()), "fail")
                path.unlink()


if __name__ == "__main__":
    unittest.main()
