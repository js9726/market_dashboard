"""Regression tests for DeepSeek scoring provenance and response handling.

These cover the two defects found on 2026-09-14:

1. ``_deepseek_score`` returned an unlabelled algorithmic fallback on failure and
   ``score_top`` stamped every returned dict ``score_source="deepseek"``. The saved
   2026-09-14 screener file carried 35 rows falsely attributed to DeepSeek.
2. The bespoke Chat Completions call used ``max_tokens=250`` against a reasoning
   model, which spent the entire budget on reasoning tokens and returned
   ``content: ""`` with ``finish_reason: "length"`` — so every ticker failed JSON
   parsing and silently fell back.

Run: python scripts/test_tv_screener_ai_provenance.py  (from apps/market_dashboard_backend)
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tv_screener_fetch as tv


def _check(name, cond):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        raise AssertionError(name)


HIT = {
    "ticker": "TEST", "change": 6.0, "Perf.1M": 12.0, "Perf.W": 3.0,
    "relative_volume_10d_calc": 2.0, "market_cap_basic": 5e9,
    "high": 11.0, "low": 10.0, "close": 10.8, "open": 10.2,
    "sector": "Technology Services", "industry": "Packaged Software",
}


class _FakeAI:
    """Stands in for call_deepseek_json."""

    def __init__(self, payload=None, exc=None):
        self.payload, self.exc, self.calls = payload, exc, 0

    def __call__(self, prompt, **kwargs):
        self.calls += 1
        self.max_output_tokens = kwargs.get("max_output_tokens")
        if self.exc:
            raise self.exc
        return self.payload


def _run(payload=None, exc=None, with_key=True):
    fake = _FakeAI(payload, exc)
    orig_call, orig_key = tv.call_deepseek_json, os.environ.get("DEEPSEEK_API_KEY")
    tv.call_deepseek_json = fake
    if with_key:
        os.environ["DEEPSEEK_API_KEY"] = "test-key-not-real"
    else:
        os.environ.pop("DEEPSEEK_API_KEY", None)
    try:
        return tv._deepseek_score("TEST", dict(HIT)), fake
    finally:
        tv.call_deepseek_json = orig_call
        if orig_key is None:
            os.environ.pop("DEEPSEEK_API_KEY", None)
        else:
            os.environ["DEEPSEEK_API_KEY"] = orig_key


def _good_payload(raw):
    return json.dumps({
        "score": raw, "verdict": "GO" if raw >= 75 else "WAIT" if raw >= 50 else "PASS",
        "thesis": "Tight base, volume expanding; risk is a failed pivot.",
        "stages": {"setup": 25, "entry": 18, "theme": 12, "sentiment": 5},
    })


def test_success_is_labelled_deepseek():
    baseline = tv._compute_stages(dict(HIT))["raw"]
    res, fake = _run(_good_payload(baseline))
    _check("AI was called", fake.calls == 1)
    _check("score_source == deepseek", res["score_source"] == "deepseek")
    _check("ai_status == ok", res["ai_status"] == "ok")
    _check("thesis preserved", "failed pivot" in res["thesis"])
    _check("uses shared boundary token budget", fake.max_output_tokens == tv._AI_MAX_OUTPUT_TOKENS)


def test_empty_content_is_algorithmic():
    """The exact 2026-09-14 production failure: reasoning ate the budget, content == ''."""
    res, _ = _run("")
    _check("empty content -> algorithmic", res["score_source"] == "algorithmic")
    _check("status names empty content", res["ai_status"] == "invalid_response:empty_content")
    _check("still returns a usable score", isinstance(res["score"], int))
    _check("thesis says algorithmic", "algorithmic" in res["thesis"])


def test_truncated_json_is_algorithmic():
    res, _ = _run('{"score": 62, "verdict": "WAIT", "thesis": "cut off her')
    _check("truncated -> algorithmic", res["score_source"] == "algorithmic")
    _check("status names non-json", res["ai_status"] == "invalid_response:not_json")


def test_malformed_shapes_are_rejected():
    cases = [
        ("not an object", "[1, 2, 3]", "invalid_response:not_an_object:list"),
        ("score not numeric", '{"score":"high","verdict":"WAIT","thesis":"x","stages":{}}',
         "invalid_response:score_not_numeric"),
        ("bad verdict", '{"score":60,"verdict":"BUY","thesis":"x","stages":{}}',
         "invalid_response:bad_verdict:'BUY'"),
        ("empty thesis", '{"score":60,"verdict":"WAIT","thesis":"   ","stages":{}}',
         "invalid_response:empty_thesis"),
    ]
    for name, payload, expected in cases:
        res, _ = _run(payload)
        _check(f"{name} -> algorithmic", res["score_source"] == "algorithmic")
        _check(f"{name} -> {expected}", res["ai_status"] == expected)


def test_stage_out_of_bounds_is_rejected():
    res, _ = _run(json.dumps({
        "score": 60, "verdict": "WAIT", "thesis": "ok",
        "stages": {"setup": 99, "entry": 18, "theme": 12, "sentiment": 5},
    }))
    _check("setup 99/40 rejected", res["score_source"] == "algorithmic")
    _check("status names the stage", res["ai_status"].startswith("invalid_response:stage_out_of_bounds:setup"))


def test_composite_adjustment_is_clamped():
    baseline = tv._compute_stages(dict(HIT))["raw"]
    runaway = min(100, baseline + 40)
    res, _ = _run(json.dumps({
        "score": runaway, "verdict": "GO", "thesis": "model ignored its budget",
        "stages": {"setup": 25, "entry": 18, "theme": 12, "sentiment": 5},
    }))
    _check("still AI-sourced", res["score_source"] == "deepseek")
    _check("clamped to +/-5 of baseline", abs(res["score"] - baseline) <= tv._MAX_COMPOSITE_ADJUST)
    _check("verdict matches clamped score",
           res["verdict"] == ("GO" if res["score"] >= 75 else "WAIT" if res["score"] >= 50 else "PASS"))


def test_transport_error_is_algorithmic():
    res, _ = _run(exc=RuntimeError("DeepSeek response status=incomplete"))
    _check("transport error -> algorithmic", res["score_source"] == "algorithmic")
    _check("status names api_error", res["ai_status"] == "api_error:RuntimeError")


def test_missing_key_never_calls_and_never_claims_ai():
    res, fake = _run(_good_payload(60), with_key=False)
    _check("no API call without a key", fake.calls == 0)
    _check("no_key -> algorithmic", res["score_source"] == "algorithmic")
    _check("status == no_key", res["ai_status"] == "no_key")


def test_score_top_never_relabels_failures():
    """The headline defect: score_top must not stamp 'deepseek' on a failed upgrade."""
    hits = [dict(HIT, ticker=f"T{i}") for i in range(3)]
    tv.algo_score_all(hits)
    orig_call, orig_key, orig_sleep = tv.call_deepseek_json, os.environ.get("DEEPSEEK_API_KEY"), tv.time.sleep
    tv.call_deepseek_json = _FakeAI("")  # every call returns empty content
    os.environ["DEEPSEEK_API_KEY"] = "test-key-not-real"
    tv.time.sleep = lambda *_: None
    try:
        tally = tv.score_top(hits, 3)
    finally:
        tv.call_deepseek_json, tv.time.sleep = orig_call, orig_sleep
        if orig_key is None:
            os.environ.pop("DEEPSEEK_API_KEY", None)
        else:
            os.environ["DEEPSEEK_API_KEY"] = orig_key

    _check("no hit claims deepseek", all(h["score_source"] == "algorithmic" for h in hits))
    _check("every hit carries ai_status", all(h.get("ai_status") for h in hits))
    _check("tally reports 0 successes", tally.get("ok", 0) == 0)
    _check("tally counts the real failure", tally.get("invalid_response:empty_content") == 3)


def test_score_top_labels_real_successes():
    hits = [dict(HIT, ticker=f"T{i}") for i in range(2)]
    tv.algo_score_all(hits)
    baseline = hits[0]["score"]
    orig_call, orig_key, orig_sleep = tv.call_deepseek_json, os.environ.get("DEEPSEEK_API_KEY"), tv.time.sleep
    tv.call_deepseek_json = _FakeAI(_good_payload(baseline))
    os.environ["DEEPSEEK_API_KEY"] = "test-key-not-real"
    tv.time.sleep = lambda *_: None
    try:
        tally = tv.score_top(hits, 2)
    finally:
        tv.call_deepseek_json, tv.time.sleep = orig_call, orig_sleep
        if orig_key is None:
            os.environ.pop("DEEPSEEK_API_KEY", None)
        else:
            os.environ["DEEPSEEK_API_KEY"] = orig_key

    _check("both labelled deepseek", all(h["score_source"] == "deepseek" for h in hits))
    _check("tally reports 2 successes", tally.get("ok") == 2)


def test_no_paid_provider_switch():
    """A failed DeepSeek call must never reach for a different vendor."""
    source = open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                               "tv_screener_fetch.py"), encoding="utf-8").read()
    for vendor in ("openai", "anthropic", "gemini", "googleapis", "OPENAI_API_KEY",
                   "ANTHROPIC_API_KEY", "GEMINI_API_KEY"):
        _check(f"no {vendor} fallback path", vendor.lower() not in source.lower())


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    print(f"Running {len(tests)} AI-provenance tests\n")
    for t in tests:
        print(t.__name__)
        t()
    print(f"\nAll {len(tests)} tests passed.")
