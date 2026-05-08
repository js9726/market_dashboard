"""
Shared loader utilities for runtime skills (Python side).

Phase 2: only the trader-profiles bridge is needed; prompt template
interpolation lands with Phase 3 skill scaffolding.
"""
from __future__ import annotations

import json
import os
import re
from typing import Any


_HERE = os.path.dirname(os.path.abspath(__file__))
_PROFILES_PATH = os.path.join(_HERE, "trader-profiles.json")


def load_trader_profiles() -> list[dict[str, Any]]:
    """Load the canonical trader-profiles.json shared with the TS frontend."""
    with open(_PROFILES_PATH, encoding="utf-8") as f:
        return json.load(f)


_PLACEHOLDER_RE = re.compile(r"\{(\w+)\}")


def render_prompt(template: str, **vars: str) -> str:
    """Mustache-style {placeholder} interpolation. Used by Phase 3 skills."""
    def sub(match: re.Match[str]) -> str:
        key = match.group(1)
        return vars[key] if key in vars else match.group(0)
    return _PLACEHOLDER_RE.sub(sub, template)
