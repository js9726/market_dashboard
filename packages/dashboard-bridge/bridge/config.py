"""
Config loader for dashboard-bridge.

Reads ~/.config/dashboard-bridge.toml (or the path in DASHBOARD_BRIDGE_CONFIG
env var). Validates required keys. Falls back to env vars for the token so
secrets can stay out of the TOML if preferred.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import tomllib  # Python 3.11+
except ImportError:
    try:
        import tomli as tomllib  # type: ignore  # Python <3.11
    except ImportError:
        sys.exit("tomli not installed — `pip install tomli` (or upgrade to Python 3.11+).")


@dataclass(frozen=True)
class DashboardConfig:
    url: str
    token: str
    # NEW Phase: live-quotes ingest key. Optional — if absent, the bridge
    # only pushes positions/fills/equity; live quotes (replacing the
    # broken Yahoo Fallback workflow) are skipped.
    live_quote_key: str | None = None


@dataclass(frozen=True)
class BrokerConfig:
    account_alias: str
    type: str


@dataclass(frozen=True)
class OpenDConfig:
    host: str
    port: int
    acc_id: int
    security_firm: str
    market: str


@dataclass(frozen=True)
class SyncConfig:
    interval_sec: int
    fill_lookback_days: int
    # Comma-separated extra tickers to push live quotes for, beyond the
    # tickers in the user's current positions. e.g. "SPY,QQQ,NVDA,CRDO".
    # Defaults to a small index/sector set so the dashboard always has
    # fresh SPY/QQQ even when no positions are open.
    live_quote_extras: tuple[str, ...] = ()


@dataclass(frozen=True)
class Config:
    dashboard: DashboardConfig
    broker: BrokerConfig
    opend: OpenDConfig
    sync: SyncConfig


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "dashboard-bridge.toml"


def _require(d: dict[str, Any], key: str, section: str) -> Any:
    if key not in d:
        sys.exit(f"Config error: [{section}].{key} is required")
    return d[key]


def load_config(path: Path | None = None) -> Config:
    config_path = (
        Path(os.environ["DASHBOARD_BRIDGE_CONFIG"])
        if "DASHBOARD_BRIDGE_CONFIG" in os.environ
        else (path or DEFAULT_CONFIG_PATH)
    )
    if not config_path.exists():
        sys.exit(
            f"Config file not found: {config_path}\n"
            "Run install.ps1 or copy dashboard-bridge.example.toml to ~/.config/dashboard-bridge.toml."
        )

    with config_path.open("rb") as f:
        data = tomllib.load(f)

    dash = data.get("dashboard", {})
    broker = data.get("broker", {})
    opend = data.get("opend", {})
    sync = data.get("sync", {})

    # Allow env var override for the token (so it can stay out of the TOML)
    token = os.environ.get("DASHBOARD_BRIDGE_TOKEN") or _require(dash, "token", "dashboard")
    # Live-quote key (optional) — separate secret to keep blast radius small.
    live_quote_key = (
        os.environ.get("DASHBOARD_BRIDGE_LIVE_QUOTE_KEY")
        or dash.get("live_quote_key")
    )

    extras_raw = sync.get("live_quote_extras", "SPY,QQQ,IWM,DIA")
    if isinstance(extras_raw, str):
        extras = tuple(s.strip().upper() for s in extras_raw.split(",") if s.strip())
    elif isinstance(extras_raw, list):
        extras = tuple(str(s).strip().upper() for s in extras_raw if s)
    else:
        extras = ()

    return Config(
        dashboard=DashboardConfig(
            url=str(_require(dash, "url", "dashboard")).rstrip("/"),
            token=str(token),
            live_quote_key=str(live_quote_key) if live_quote_key else None,
        ),
        broker=BrokerConfig(
            account_alias=str(_require(broker, "account_alias", "broker")),
            type=str(broker.get("type", "MOOMOO")),
        ),
        opend=OpenDConfig(
            host=str(opend.get("host", "127.0.0.1")),
            port=int(opend.get("port", 11111)),
            acc_id=int(_require(opend, "acc_id", "opend")),
            security_firm=str(opend.get("security_firm", "FUTUMY")),
            market=str(opend.get("market", "US")),
        ),
        sync=SyncConfig(
            interval_sec=int(sync.get("interval_sec", 60)),
            fill_lookback_days=int(sync.get("fill_lookback_days", 1)),
            live_quote_extras=extras,
        ),
    )
