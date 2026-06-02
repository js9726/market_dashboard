"""Post-generation integrity gate for the morning brief.

The prompt tells providers not to fabricate news, ratings, or economic-calendar
items, but instructions are not enforcement. This module withholds any
news-type section that is not grounded by a real source so the dashboard renders
it as "Unavailable" rather than presenting invented context as current news.

Grounding rule, fail-closed and provider-agnostic:
  - `earnings` and `ratings` are web-sourced, so they are kept only when the
    brief carries at least one real citation.
  - `calendar` is kept when it is backed by the authoritative events.json feed
    (`has_events=True`) or by a real citation.
  - Placeholder citations such as "data unavailable" do not count as grounding.
  - Withheld fields are set to null and recorded under `_validation`.

Pure data-in / data-out: no network and no env dependency.
"""
from __future__ import annotations

from typing import Any

# News-type fields with no authoritative pre-fetch feed. The model can only get
# them from web/search context, so they must be citation-backed to be trusted.
WEB_SOURCED_NEWS_FIELDS = ("earnings", "ratings")

UNGROUNDED_CITATION_MARKERS = (
    "unavailable",
    "not available",
    "no data",
    "no source",
    "not found",
    "missing",
)


def _is_empty(value: Any) -> bool:
    return value in (None, [], {}, "")


def _has_grounding_citation(citations: Any) -> bool:
    if not isinstance(citations, list):
        return False
    for citation in citations:
        if not isinstance(citation, str):
            continue
        text = citation.strip()
        if not text:
            continue
        lowered = text.lower()
        if any(marker in lowered for marker in UNGROUNDED_CITATION_MARKERS):
            continue
        return True
    return False


def sanitize_news(
    structured: dict,
    *,
    provider: str = "unknown",
    has_events: bool = False,
) -> tuple[dict, list[dict]]:
    """Withhold ungrounded news/ratings/calendar from a parsed brief.

    Args:
        structured: The parsed brief JSON, mutated in place.
        provider: The generating provider, recorded in `_validation`.
        has_events: True when an authoritative events.json feed backed the
            calendar. Calendar is allowed without citations in that case.

    Returns:
        (structured, withheld), where `withheld` contains
        {"field", "reason"} dicts and is empty when nothing was withheld.
    """
    if not isinstance(structured, dict):
        return structured, []

    has_citations = _has_grounding_citation(structured.get("citations"))
    withheld: list[dict] = []

    def withhold(field: str, reason: str) -> None:
        if not _is_empty(structured.get(field)):
            structured[field] = None
            withheld.append({"field": field, "reason": reason})

    if not has_citations:
        for field in WEB_SOURCED_NEWS_FIELDS:
            withhold(field, "no live citation; news not grounded by a source")
        if not has_events:
            withhold(
                "calendar",
                "no live citation and no events.json; calendar not grounded",
            )

    if withheld:
        validation = structured.get("_validation")
        if not isinstance(validation, dict):
            validation = {}
        validation["unavailable"] = withheld
        validation["provider"] = provider
        validation["note"] = (
            "Ungrounded news/ratings/calendar sections were withheld. They render "
            "as Unavailable rather than invented context."
        )
        structured["_validation"] = validation

    return structured, withheld
