"""Should this pre-open workflow run be skipped because this morning's brief already ran?

    python scripts/brief_ran_today.py --event "$GITHUB_EVENT_NAME" --meta apps/.../data/morning_brief_meta.json

GitHub's scheduled start for refresh_premarket.yml has been 4.5-7 hours late (after the
US open), so the bot PC dispatches the workflow at 09:00 ET instead. The scheduled run is
kept as a fallback for days the PC is off; it is skipped when the committed brief meta
already shows a run from this US-Eastern morning (built at or after 04:00 ET today).
Manual and dispatched runs are never skipped.

Prints the decision and writes skip=true|false to $GITHUB_OUTPUT when it is set.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
MORNING_FROM = dt.time(4, 0)


def decide(event: str, meta, now_et: dt.datetime) -> tuple[bool, str]:
    if event != "schedule":
        return False, "{} runs always proceed".format(event or "unknown event")
    built = None
    if isinstance(meta, dict) and meta.get("built_at"):
        try:
            built = dt.datetime.fromisoformat(str(meta["built_at"]).replace("Z", "+00:00")).astimezone(ET)
        except ValueError:
            built = None
    if built and built.date() == now_et.date() and built.time() >= MORNING_FROM:
        return True, "this morning's brief was already built at {:%H:%M} ET".format(built)
    return False, "no brief yet this morning (last built {})".format(
        "{:%Y-%m-%d %H:%M} ET".format(built) if built else "unknown")


def main(argv=None, now=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--event", default=os.environ.get("GITHUB_EVENT_NAME", ""))
    ap.add_argument("--meta", required=True)
    args = ap.parse_args(argv)
    try:
        with open(args.meta, encoding="utf-8") as fh:
            meta = json.load(fh)
    except (OSError, ValueError):
        meta = None
    skip, reason = decide(args.event, meta, (now or dt.datetime.now(dt.timezone.utc)).astimezone(ET))
    print("[brief_ran_today] skip={} - {}".format(str(skip).lower(), reason))
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("skip={}\n".format(str(skip).lower()))
    return 0


if __name__ == "__main__":
    sys.exit(main())
