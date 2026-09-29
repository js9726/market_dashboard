"""Status line for the private bot session: records subscription usage for the control panel.

Claude Code runs this after the bot's replies and on its own timers, passing session JSON on
stdin (https://code.claude.com/docs/en/statusline). The only way Claude Code exposes the
claude.ai subscription limits is `rate_limits` in that JSON: `five_hour` and `seven_day`, each
with `used_percentage` (0-100) and `resets_at` (Unix seconds). They are account-wide (every
session on the subscription counts), appear only after the session's first reply, and a window
is dropped once its reset time passes.

This script keeps the last reading in %USERPROFILE%\\.claude\\bot-box\\usage.json, together with
the bot's transcript path (whose modification time tells the refresher when the bot last
worked), and prints a one-line status. It never fails the status line: any error prints a
short notice and leaves the previous file alone.
"""
from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import time
from pathlib import Path


def state_dir() -> Path:
    override = os.environ.get("BOTBOX_STATE_DIR")
    if override:
        return Path(override)
    home = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return Path(home) / ".claude" / "bot-box"


def clean_window(w) -> dict | None:
    if not isinstance(w, dict):
        return None
    used, resets = w.get("used_percentage"), w.get("resets_at")
    if isinstance(used, bool) or not isinstance(used, (int, float)) or not math.isfinite(used):
        return None
    out = {"used_percentage": round(float(used), 1)}
    if isinstance(resets, (int, float)) and not isinstance(resets, bool) and math.isfinite(resets):
        out["resets_at"] = int(resets)
    return out


def update(data: dict, previous: dict, now: float) -> dict:
    doc = {
        "updated_at": int(now),
        "session_id": data.get("session_id") if isinstance(data.get("session_id"), str) else None,
        "transcript_path": data.get("transcript_path") if isinstance(data.get("transcript_path"), str) else None,
        "rate_limits": previous.get("rate_limits") or {},
        "rate_limits_observed_at": previous.get("rate_limits_observed_at"),
    }
    rl = data.get("rate_limits")
    if isinstance(rl, dict):
        windows = {k: clean_window(rl.get(k)) for k in ("five_hour", "seven_day")}
        windows = {k: v for k, v in windows.items() if v}
        if windows:
            doc["rate_limits"] = windows
            doc["rate_limits_observed_at"] = int(now)
    return doc


def line(doc: dict) -> str:
    rl = doc.get("rate_limits") or {}
    parts = [f"{label} {rl[k]['used_percentage']:.0f}% used" for k, label in (("five_hour", "5h"), ("seven_day", "7d"))
             if k in rl]
    return "Claude plan: " + (" | ".join(parts) if parts else "usage appears after the first reply")


def write_atomic(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".usage-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(doc, fh, indent=1, allow_nan=False)
            fh.write("\n")
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def main() -> int:
    try:
        data = json.loads(sys.stdin.read() or "{}")
        if not isinstance(data, dict):
            data = {}
        path = state_dir() / "usage.json"
        try:
            previous = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(previous, dict):
                previous = {}
        except (OSError, ValueError):
            previous = {}
        doc = update(data, previous, time.time())
        write_atomic(path, doc)
        print(line(doc))
    except Exception as e:  # noqa: BLE001 - a status line must never break the session
        print(f"Claude plan: usage not recorded ({type(e).__name__})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
