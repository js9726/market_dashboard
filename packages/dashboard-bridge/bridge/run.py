"""
Bridge main loop.

  python -m bridge run           — start the polling loop
  python -m bridge once          — one-shot sync (useful for cron / scheduled task)
  python -m bridge dry-run       — fetch from moomoo but don't POST to the dashboard
"""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import signal
import sys
import time
from pathlib import Path

from .client import DashboardClient
from .config import load_config
from .moomoo_sync import MoomooSync

LOG_PATH = Path.home() / ".dashboard-bridge.log"


def setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")

    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    root.addHandler(sh)

    try:
        fh = logging.handlers.RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=3)
        fh.setFormatter(fmt)
        root.addHandler(fh)
    except OSError:
        pass  # file logging best-effort


log = logging.getLogger("bridge")


def _sync_once(dry: bool = False) -> bool:
    """Perform one sync. Returns True on success."""
    cfg = load_config()
    sync = MoomooSync(cfg)
    try:
        snapshot = sync.fetch()
    except Exception as e:  # broad — log and report
        log.exception("moomoo fetch failed: %s", e)
        return False

    positions = snapshot["positions"]
    fills = snapshot["fills"]
    equity = snapshot.get("equity")  # Phase 4 — optional, best-effort
    log.info(
        "Fetched %d positions, %d fills, equity=%s from moomoo",
        len(positions), len(fills),
        f"${equity['totalAssets']:.2f} {equity['currencyCode']}" if equity else "n/a",
    )

    if dry:
        log.info("Dry run — not posting to dashboard.")
        log.info("Sample position: %s", positions[0] if positions else "n/a")
        log.info("Sample fill: %s", fills[0] if fills else "n/a")
        log.info("Equity snapshot: %s", equity)
        return True

    client = DashboardClient(cfg)
    result = client.sync(positions, fills, equity=equity)
    log.info("Sync result: %s", result)
    return bool(result.get("ok"))


def _loop() -> None:
    cfg = load_config()
    log.info("Starting bridge loop — interval %ds", cfg.sync.interval_sec)

    stop = {"stop": False}

    def handle(_signum: int, _frame: object) -> None:
        log.info("Stop signal received — exiting after current cycle.")
        stop["stop"] = True

    signal.signal(signal.SIGINT, handle)
    signal.signal(signal.SIGTERM, handle)

    while not stop["stop"]:
        try:
            _sync_once()
        except Exception:  # broad — keep the loop alive
            log.exception("Sync cycle failed")
        # Sleep in 1-s chunks so SIGTERM is responsive
        for _ in range(cfg.sync.interval_sec):
            if stop["stop"]:
                break
            time.sleep(1)


def main() -> None:
    setup_logging()
    parser = argparse.ArgumentParser(prog="bridge")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("run", help="Run the polling loop indefinitely")
    sub.add_parser("once", help="Perform one sync and exit")
    sub.add_parser("dry-run", help="Fetch from moomoo but skip the HTTP POST")
    args = parser.parse_args()

    if args.cmd == "run":
        _loop()
    elif args.cmd == "once":
        ok = _sync_once()
        sys.exit(0 if ok else 1)
    elif args.cmd == "dry-run":
        ok = _sync_once(dry=True)
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
