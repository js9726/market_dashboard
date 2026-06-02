"""Unit tests for validate_brief.sanitize_news.

Run either way:
    python -m pytest test_validate_brief.py
    python test_validate_brief.py
"""
from validate_brief import sanitize_news


def test_strips_news_when_no_citations():
    brief = {
        "earnings": {"yesterdayReactions": [{"ticker": "NVDA", "result": "beat"}]},
        "ratings": {"upgrades": [{"ticker": "ARM", "firm": "BofA"}]},
        "calendar": [{"time": "08:30 ET", "name": "Jobless Claims"}],
        "citations": [],
    }
    out, withheld = sanitize_news(brief, provider="gemini", has_events=False)
    assert out["earnings"] is None
    assert out["ratings"] is None
    assert out["calendar"] is None
    assert {w["field"] for w in withheld} == {"earnings", "ratings", "calendar"}
    assert out["_validation"]["provider"] == "gemini"
    assert out["_validation"]["unavailable"]


def test_keeps_news_when_real_citation_present():
    brief = {
        "earnings": {"amc": [{"ticker": "CRM", "consensus": "1.20"}]},
        "ratings": {"downgrades": [{"ticker": "INTU", "firm": "JPM"}]},
        "calendar": [{"time": "10:00 ET", "name": "ISM"}],
        "citations": [
            "Reuters 2026-06-02 - earnings calendar",
            "Benzinga 2026-06-02 - ratings",
        ],
    }
    out, withheld = sanitize_news(brief, provider="deepseek-search", has_events=True)
    assert out["earnings"] is not None
    assert out["ratings"] is not None
    assert out["calendar"] is not None
    assert withheld == []
    assert "_validation" not in out


def test_calendar_kept_when_events_feed_present_even_without_citations():
    brief = {
        "earnings": {"bmo": [{"ticker": "FDX", "consensus": "4.0"}]},
        "calendar": [{"time": "08:30 ET", "name": "CPI"}],
        "citations": [],
    }
    out, withheld = sanitize_news(brief, provider="gemini", has_events=True)
    assert out["earnings"] is None
    assert out["calendar"] is not None
    assert {w["field"] for w in withheld} == {"earnings"}


def test_unavailable_placeholder_citations_do_not_count_as_grounding():
    brief = {
        "ratings": {"upgrades": [{"ticker": "X", "firm": "Y"}]},
        "calendar": [{"time": "10:00 ET", "name": "Consumer Confidence"}],
        "citations": ["data unavailable at generation time", "no source found"],
    }
    out, withheld = sanitize_news(brief, provider="deepseek-search", has_events=False)
    assert out["ratings"] is None
    assert out["calendar"] is None
    assert {w["field"] for w in withheld} == {"ratings", "calendar"}


def test_no_op_when_news_fields_absent():
    brief = {"mood": {"posture": "WAIT"}, "citations": []}
    out, withheld = sanitize_news(brief, provider="deepseek", has_events=False)
    assert withheld == []
    assert "_validation" not in out


if __name__ == "__main__":
    import sys

    tests = [
        value
        for key, value in sorted(globals().items())
        if key.startswith("test_") and callable(value)
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
