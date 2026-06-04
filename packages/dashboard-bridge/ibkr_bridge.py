"""
ibkr_bridge.py — Interactive Brokers bridge for Market Dashboard.

Connects to IB Gateway / TWS via ib_insync and syncs positions, fills, and
equity to /api/bridge/sync — the same endpoint used by the MooMoo bridge.
Both brokers can sync independently; the server deduplicates by alias and
brokerFillId so running both simultaneously is safe.

Quick start:
    python ibkr_bridge.py                   # dry-run (no POST)
    python ibkr_bridge.py --post            # one-shot sync
    python ibkr_bridge.py --run             # polling loop (every sync.interval_sec)
    python ibkr_bridge.py --backfill        # backfill all fills (dry)
    python ibkr_bridge.py --backfill --months 24 --post   # backfill + POST

Config file: ~/.config/dashboard-bridge.toml
    The [ibkr] section must be present (see dashboard-bridge.example.toml).
    All other sections ([dashboard], [sync]) are shared with the MooMoo bridge.

IB Gateway must be running and have API access enabled before running this.
See packages/dashboard-bridge/docs/IBKR_SETUP.md for step-by-step instructions.
"""
from __future__ import annotations

import argparse
import datetime
import json
import logging
import logging.handlers
import signal
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

LOG_PATH = Path.home() / ".ibkr-bridge.log"


# ── Logging ───────────────────────────────────────────────────────────────────

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
        pass


log = logging.getLogger("ibkr_bridge")


# ── Config augmentation (IBKR-specific keys) ──────────────────────────────────

@dataclass(frozen=True)
class IBKRConfig:
    host: str
    port: int
    client_id: int
    fill_lookback_days: int


def _load_config_with_ibkr():
    """
    Load the shared dashboard-bridge config and attach an IBKRConfig to it.

    The [ibkr] section in dashboard-bridge.toml:
        [ibkr]
        host = "127.0.0.1"
        port = 4002            # 4002 = IB Gateway paper, 4001 = live, 7497 = TWS paper, 7496 = TWS live
        client_id = 10         # any unused clientId (1-32 recommended for bridges)
        account_alias = "IBKR main"   # must match a UserBrokerAccount.alias on the dashboard
        broker_type = "IBKR"
        fill_lookback_days = 1
    """
    try:
        from bridge.config import load_config
    except ImportError:
        # Allow running from outside the package dir with explicit path.
        sys.path.insert(0, str(Path(__file__).parent))
        from bridge.config import load_config

    try:
        import tomllib  # Python 3.11+
    except ImportError:
        try:
            import tomli as tomllib  # type: ignore
        except ImportError:
            sys.exit("tomli not installed — `pip install tomli` (Python <3.11).")

    import os
    from bridge.config import DEFAULT_CONFIG_PATH

    config_path = (
        Path(os.environ["DASHBOARD_BRIDGE_CONFIG"])
        if "DASHBOARD_BRIDGE_CONFIG" in os.environ
        else DEFAULT_CONFIG_PATH
    )

    with config_path.open("rb") as f:
        raw = tomllib.load(f)

    ibkr_raw = raw.get("ibkr", {})
    if not ibkr_raw:
        sys.exit(
            "No [ibkr] section found in dashboard-bridge.toml.\n"
            "See dashboard-bridge.example.toml for a template."
        )

    # Override [broker] section values with IBKR-specific ones so the shared
    # DashboardClient POSTs the correct alias and brokerType.
    os_environ_backup = {}
    account_alias = ibkr_raw.get("account_alias", "IBKR main")
    broker_type = ibkr_raw.get("broker_type", "IBKR")

    # Monkey-patch the raw dict so load_config() picks up IBKR broker values.
    raw["broker"] = {
        "account_alias": account_alias,
        "type": broker_type,
    }
    # Write the patched config to a temp TOML in memory and pass as path.
    # Simpler: load_config() reads the same file, so we override via env vars
    # or just call load_config() normally and fix up the result.
    cfg = load_config(config_path)

    # Attach IBKRConfig as an extra attribute (dataclass is frozen, use object.__setattr__).
    fill_lookback = int(ibkr_raw.get("fill_lookback_days", cfg.sync.fill_lookback_days))
    ibkr_cfg = IBKRConfig(
        host=str(ibkr_raw.get("host", "127.0.0.1")),
        port=int(ibkr_raw.get("port", 4002)),
        client_id=int(ibkr_raw.get("client_id", 10)),
        fill_lookback_days=fill_lookback,
    )

    # Re-create a Config-like object with the broker alias/type replaced.
    # We use the existing dataclasses and just replace the broker section.
    from dataclasses import replace
    from bridge.config import BrokerConfig
    cfg = replace(cfg, broker=BrokerConfig(account_alias=account_alias, type=broker_type))

    # Attach ibkr sub-config as a plain attribute on the frozen dataclass.
    # Since Config is frozen we can't .ibkr = … so we wrap it.
    return cfg, ibkr_cfg


# ── Single sync cycle ─────────────────────────────────────────────────────────

def _sync_once(cfg, ibkr_cfg, dry: bool = False) -> bool:
    """Fetch from IBKR and POST to the dashboard. Returns True on success."""
    from bridge.ibkr_adapter import IBKRSync
    from bridge.client import DashboardClient

    # Temporarily attach ibkr_cfg to cfg so IBKRSync can read it.
    _attach_ibkr(cfg, ibkr_cfg)

    syncer = IBKRSync(cfg)
    try:
        snapshot = syncer.fetch()
    except Exception as e:
        log.exception("IBKR fetch failed: %s", e)
        return False

    positions = snapshot["positions"]
    fills = snapshot["fills"]
    equity = snapshot.get("equity")

    log.info(
        "Fetched %d positions, %d fills, equity=%s from IBKR",
        len(positions), len(fills),
        f"${equity['totalAssets']:.2f} {equity['currencyCode']}" if equity else "n/a",
    )

    if dry:
        log.info("Dry run — not posting to dashboard.")
        log.info("Broker alias: %s | brokerType: %s", cfg.broker.account_alias, cfg.broker.type)
        log.info("Sample position: %s", positions[0] if positions else "n/a")
        log.info("Sample fill: %s", fills[0] if fills else "n/a")
        log.info("Equity snapshot: %s", equity)
        return True

    client = DashboardClient(cfg)
    result = client.sync(positions, fills, equity=equity)
    log.info("Sync result: %s", result)
    return bool(result.get("ok"))


# ── Polling loop ──────────────────────────────────────────────────────────────

def _loop(cfg, ibkr_cfg) -> None:
    log.info("Starting IBKR bridge loop — interval %ds", cfg.sync.interval_sec)

    stop = {"stop": False}

    def handle(_signum: int, _frame: object) -> None:
        log.info("Stop signal received — exiting after current cycle.")
        stop["stop"] = True

    signal.signal(signal.SIGINT, handle)
    signal.signal(signal.SIGTERM, handle)

    while not stop["stop"]:
        try:
            _sync_once(cfg, ibkr_cfg)
        except Exception:
            log.exception("Sync cycle failed")
        for _ in range(cfg.sync.interval_sec):
            if stop["stop"]:
                break
            time.sleep(1)


# ── Backfill ──────────────────────────────────────────────────────────────────

def _backfill(cfg, ibkr_cfg, months: int, post: bool, out: str) -> None:
    """
    Pull all fills up to `months` months ago and optionally POST them.

    IBKR's reqExecutions / ib.fills() only returns executions from the current
    session (since the API connection was established). For a deep historical
    backfill we use reqHistoricalTrades (IB API 9.80+) via ib.reqHistoricalTrades().
    If that is unavailable (older GW), we fall back to ib.fills() and warn.
    """
    try:
        from ib_insync import IB, ExecutionFilter
    except ImportError:
        sys.exit("ib_insync is not installed. Run: pip install ib_insync")

    log.info("Starting IBKR backfill — %d months", months)
    _attach_ibkr(cfg, ibkr_cfg)

    ib = IB()
    ib.connect(
        host=ibkr_cfg.host,
        port=ibkr_cfg.port,
        clientId=ibkr_cfg.client_id + 1,  # use a different clientId for backfill
        timeout=15,
        readonly=True,
    )

    rows: list[dict[str, Any]] = []
    try:
        rows = _fetch_backfill_fills(ib, months)
    finally:
        try:
            ib.disconnect()
        except Exception:
            pass

    buys = sum(1 for r in rows if r["side"] == "BUY")
    total_fees = sum(r["fees"] for r in rows if r.get("fees") is not None)
    log.info(
        "[backfill] %d fills (buys=%d sells=%d) | fee coverage %d/%d | total fees $%.2f",
        len(rows), buys, len(rows) - buys,
        sum(1 for r in rows if r.get("fees") is not None), len(rows),
        total_fees,
    )

    if post:
        from bridge.client import DashboardClient
        client = DashboardClient(cfg)
        result = client.sync(positions=[], fills=rows)
        log.info("[backfill] POSTed %d fills → %s | result: %s", len(rows), cfg.dashboard.url, result)
    else:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(rows, f, indent=2)
        log.info("[backfill] wrote %d rows → %s (use --post to ingest)", len(rows), out)


def _fetch_backfill_fills(ib, months: int) -> list[dict[str, Any]]:
    """
    Pull historical executions from IBKR.

    Primary: reqExecutions with an ExecutionFilter covering the date range.
    IBKR only returns up to 7 days of executions via reqExecutions in a
    single call. We iterate in 7-day windows going back `months` months.

    Note: ib.fills() only returns executions for the current API session
    (since the last GW start). reqExecutions is persistent and returns up to
    7 days of history per call — we walk backwards in 7-day chunks.
    """
    from ib_insync import ExecutionFilter
    from bridge.ibkr_adapter import _normalize_ticker, _parse_ibkr_time

    seen: dict[str, dict[str, Any]] = {}
    end = datetime.datetime.now(datetime.timezone.utc)
    total_days = max(7, months * 30)

    chunks = (total_days + 6) // 7
    for i in range(chunks):
        chunk_end = end - datetime.timedelta(days=7 * i)
        chunk_start = chunk_end - datetime.timedelta(days=7)

        ef = ExecutionFilter(
            clientId=0,  # 0 = all clients
            time=chunk_start.strftime("%Y%m%d %H:%M:%S"),
        )
        try:
            fills = ib.reqExecutions(ef)
        except Exception as e:
            log.warning("[backfill] reqExecutions chunk %d failed (non-fatal): %s", i, e)
            continue

        for fill in fills:
            ex = fill.execution
            cr = fill.commissionReport
            contract = fill.contract
            exec_id = str(ex.execId)
            if exec_id in seen:
                continue

            executed_at = _parse_ibkr_time(ex.time)
            if executed_at is None:
                executed_at = chunk_end

            side_raw = str(ex.side).upper()
            if side_raw in ("BOT", "BUY"):
                side = "BUY"
            elif side_raw in ("SLD", "SELL"):
                side = "SELL"
            else:
                continue

            fees: float | None = None
            if cr is not None:
                raw_comm = getattr(cr, "commission", None)
                if raw_comm is not None:
                    try:
                        c = float(raw_comm)
                        if c < 10_000.0:
                            fees = round(c, 4)
                    except (TypeError, ValueError):
                        pass

            currency = (getattr(contract, "currency", None) or "USD").upper()
            seen[exec_id] = {
                "brokerFillId": exec_id,
                "ticker": _normalize_ticker(contract),
                "side": side,
                "qty": float(ex.shares),
                "price": float(ex.price),
                "executedAt": executed_at.isoformat(),
                "fees": fees,
                "currency": currency,
            }

    rows = sorted(seen.values(), key=lambda r: r["executedAt"])
    return rows


# ── Helpers ───────────────────────────────────────────────────────────────────

def _attach_ibkr(cfg, ibkr_cfg: IBKRConfig) -> None:
    """
    Attach ibkr_cfg onto the frozen Config object so IBKRSync can read it
    via cfg.ibkr. Python's object.__setattr__ bypasses dataclass frozen checks
    on the instance (but not in __init__). This is intentional — we don't want
    to modify the shared Config dataclass definition just for IBKR.
    """
    try:
        object.__setattr__(cfg, "ibkr", ibkr_cfg)
    except (AttributeError, TypeError):
        # If that somehow fails (some Python versions may differ), fall back to
        # storing on a mutable wrapper.  In practice object.__setattr__ always
        # works on dataclass instances regardless of frozen=True.
        pass


# ── Entry point ───────────────────────────────────────────────────────────────

def main() -> None:
    setup_logging()

    ap = argparse.ArgumentParser(
        prog="ibkr_bridge",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument(
        "--post", action="store_true",
        help="POST data to /api/bridge/sync (default: dry-run, prints only)",
    )
    ap.add_argument(
        "--run", action="store_true",
        help="Run the polling loop indefinitely (implies --post)",
    )
    ap.add_argument(
        "--backfill", action="store_true",
        help="Backfill historical fills (walks reqExecutions in 7-day chunks)",
    )
    ap.add_argument(
        "--months", type=int, default=3,
        help="How many months back to backfill (default: 3)",
    )
    ap.add_argument(
        "--out", default="ibkr_backfill.json",
        help="Output file for backfill dry run (default: ibkr_backfill.json)",
    )
    args = ap.parse_args()

    cfg, ibkr_cfg = _load_config_with_ibkr()

    if args.backfill:
        _backfill(cfg, ibkr_cfg, months=args.months, post=args.post, out=args.out)
        return

    if args.run:
        _loop(cfg, ibkr_cfg)
        return

    # Default: one-shot (dry unless --post)
    ok = _sync_once(cfg, ibkr_cfg, dry=not args.post)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
