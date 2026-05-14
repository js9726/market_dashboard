"""
_env_loader.py
==============
Auto-loads environment variables from .env / .env.local files.
No external libraries required — pure stdlib.

Search order (stops at first file found):
  1. {skill_dir}/.env              — keys local to this skill only
  2. {project_root}/apps/market_dashboard/.env.local   ← your main secrets file
  3. {project_root}/apps/market_dashboard/.env

Already-set shell environment variables are NEVER overwritten —
so if you have a real env var set, it always wins over the file.

Usage (at the top of any script):
    from _env_loader import load_env
    load_env()
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _parse_dotenv(path: Path) -> dict[str, str]:
    """
    Parse a .env / .env.local file into a dict.
    Handles:
      KEY=VALUE
      KEY = VALUE          (spaces around =)
      KEY="quoted value"   (strips surrounding quotes)
      # comment lines
      blank lines
    Does NOT handle multi-line values.
    """
    result: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        key = key.strip()
        value = value.strip()
        # strip surrounding single or double quotes
        if len(value) >= 2 and value[0] in ('"', "'") and value[-1] == value[0]:
            value = value[1:-1]
        if key:
            result[key] = value
    return result


def _find_project_root(start: Path) -> Path | None:
    """Walk up until we find a directory that contains 'apps/market_dashboard'."""
    current = start.resolve()
    for _ in range(10):  # max 10 levels up
        candidate = current / "apps" / "market_dashboard"
        if candidate.is_dir():
            return current
        parent = current.parent
        if parent == current:
            break
        current = parent
    return None


def load_env(verbose: bool = False) -> int:
    """
    Load .env files and inject missing keys into os.environ.
    Returns the number of keys loaded.
    """
    skill_dir = Path(__file__).parent.resolve()
    project_root = _find_project_root(skill_dir)

    candidates: list[Path] = [
        skill_dir / ".env",  # skill-local override (create this if you want)
    ]
    if project_root:
        candidates += [
            project_root / "apps" / "market_dashboard" / ".env.local",
            project_root / "apps" / "market_dashboard" / ".env",
        ]

    loaded = 0
    for path in candidates:
        if not path.exists():
            continue
        pairs = _parse_dotenv(path)
        for key, value in pairs.items():
            if key not in os.environ:
                os.environ[key] = value
                loaded += 1
        if verbose:
            print(f"[env] loaded {len(pairs)} vars from {path}", file=sys.stderr)
        break  # stop at the first file that exists

    return loaded
