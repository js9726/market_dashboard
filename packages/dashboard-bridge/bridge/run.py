"""
Bridge main loop.

  python -m bridge run           — start the polling loop
  python -m bridge once          — one-shot sync (useful for cron / scheduled task)
  python -m bridge dry-run       — fetch from moomoo but don't POST to the dashboard
  python -m bridge once --since 2026-07-30
                                 — catch up fills from that host-local date (≤ ~88 days)
"""
from __future__ import annotations

import argparse
import datetime
import logging
import logging.handlers
import signal
import sys
import time
from pathlib import Path

from .client import DashboardClient
from .config import load_config
from .fill_window import FillSyncState
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


def _sync_once(dry: bool = False, since: datetime.date | None = None) -> bool:
    """Perform one sync. Returns True on success.

    Fills are fetched from the last day whose fills were fetched and posted (or
    `since`, if earlier), so a sleeping PC or an OpenD outage cannot outlast the
    lookback window and silently drop a deal.
    """
    cfg = load_config()
    sync = MoomooSync(cfg)
    state = FillSyncState()
    account = cfg.broker.account_alias
    last = state.last_synced(account)
    if last is not None:
        synced_day = last.astimezone().date()
        since = min(since, synced_day) if since else synced_day
    started = datetime.datetime.now(datetime.timezone.utc)
    try:
        snapshot = sync.fetch(fills_since=since)
    except Exception as e:  # broad — log and report
        log.exception("moomoo fetch failed: %s", e)
        if not dry:
            _run_scheduled_refreshes(cfg)
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
    if result.get("ok") and snapshot["fillsOk"]:
        state.mark_synced(account, started)

    # Live quotes push: local bridge is now the primary live-price path.
    # Non-fatal: failure here does NOT block positions/fills/equity sync above.
    try:
        from .live_quotes import fetch_live_quotes, push_live_quotes
        held = [p.get("ticker", "") for p in positions if p.get("ticker")]
        quotes = fetch_live_quotes(cfg, held)
        if quotes:
            lq_result = push_live_quotes(cfg, quotes)
            log.info("Live-quote push: %d quotes, result=%s", len(quotes), lq_result)
    except Exception as e:
        log.warning("Live-quote push failed (non-fatal): %s", e)

    _run_scheduled_refreshes(cfg)
    return bool(result.get("ok"))


def _run_scheduled_refreshes(cfg) -> None:
    """Run calendar-gated refresh tasks that should survive broker errors."""
    try:
        from .portfolio_quotes import maybe_refresh_portfolio_quotes

        result = maybe_refresh_portfolio_quotes(cfg)
        if result.get("skipped"):
            log.debug("Portfolio quote refresh skipped: %s", result.get("skipped"))
        elif result.get("ok"):
            log.info("Portfolio quote refresh result: %s", result)
        else:
            log.warning("Portfolio quote refresh failed: %s", result)
    except Exception as e:
        log.warning("Portfolio quote refresh check failed (non-fatal): %s", e)

    try:
        from .breadth import maybe_refresh_breadth

        result = maybe_refresh_breadth(cfg)
        if result.skipped:
            log.debug("Breadth refresh skipped: %s", result.skipped)
        elif result.ok:
            log.info("Breadth refresh result: %s", result.response)
        else:
            log.warning("Breadth refresh failed: %s", result.error or result.response)
    except Exception as e:
        log.warning("Breadth refresh check failed (non-fatal): %s", e)


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
    once = sub.add_parser("once", help="Perform one sync and exit")
    dry_run = sub.add_parser("dry-run", help="Fetch from moomoo but skip the HTTP POST")
    for p in (once, dry_run):
        p.add_argument(
            "--since", type=datetime.date.fromisoformat, default=None,
            help="also fetch fills from this host-local date (YYYY-MM-DD) to catch up a gap",
        )
    sub.add_parser("breadth", help="Force one market-breadth refresh and exit")
    args = parser.parse_args()

    if args.cmd == "run":
        _loop()
    elif args.cmd == "once":
        ok = _sync_once(since=args.since)
        sys.exit(0 if ok else 1)
    elif args.cmd == "dry-run":
        ok = _sync_once(dry=True, since=args.since)
        sys.exit(0 if ok else 1)
    elif args.cmd == "breadth":
        from .breadth import maybe_refresh_breadth

        cfg = load_config()
        result = maybe_refresh_breadth(cfg, force=True)
        log.info("Breadth refresh: %s", result.response or result.skipped or result.error)
        sys.exit(0 if result.ok else 1)


if __name__ == "__main__":
    main()
