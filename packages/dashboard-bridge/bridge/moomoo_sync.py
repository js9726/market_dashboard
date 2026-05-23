"""
Pull positions + recent fills from moomoo OpenD.

Returns plain dicts ready to POST to /api/bridge/sync. Symbol prefixes are
preserved as moomoo uses them (US.HUT, HK.00700) — the dashboard's MarketQuote
worker handles conversion to Yahoo format.
"""
from __future__ import annotations

import datetime
import logging
from typing import Any

from moomoo import (
    OpenSecTradeContext,
    SecurityFirm,
    TrdEnv,
    TrdMarket,
    RET_OK,
)

from .config import Config

log = logging.getLogger(__name__)


def _firm(name: str) -> SecurityFirm:
    return getattr(SecurityFirm, name, SecurityFirm.FUTUMY)


def _market(name: str) -> TrdMarket:
    return getattr(TrdMarket, name.upper(), TrdMarket.US)


class MoomooSync:
    """One-shot wrapper around OpenSecTradeContext for clean per-poll usage."""

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def fetch(self) -> dict[str, Any]:
        """Return {positions, fills} for the configured account."""
        firm = _firm(self.cfg.opend.security_firm)
        market = _market(self.cfg.opend.market)

        ctx = OpenSecTradeContext(
            filter_trdmarket=market,
            host=self.cfg.opend.host,
            port=self.cfg.opend.port,
            security_firm=firm,
        )
        try:
            positions = self._positions(ctx)
            fills = self._fills(ctx)
            return {"positions": positions, "fills": fills}
        finally:
            ctx.close()

    # ── Positions ────────────────────────────────────────────────────────

    def _positions(self, ctx: OpenSecTradeContext) -> list[dict[str, Any]]:
        ret, data = ctx.position_list_query(
            trd_env=TrdEnv.REAL,
            acc_id=self.cfg.opend.acc_id,
            refresh_cache=True,
        )
        if ret != RET_OK:
            log.error("position_list_query failed: %s", data)
            return []

        rows: list[dict[str, Any]] = []
        for _, row in data.iterrows():
            qty = float(row.get("qty", 0))
            if qty == 0:
                continue
            rows.append({
                "ticker": str(row["code"]),
                "qty": qty,
                "avgCost": float(row.get("average_cost", 0)),
                "currency": "USD" if self.cfg.opend.market.upper() == "US" else "HKD",
            })
        return rows

    # ── Fills (last N days) ──────────────────────────────────────────────

    def _fills(self, ctx: OpenSecTradeContext) -> list[dict[str, Any]]:
        end = datetime.datetime.now(datetime.timezone.utc)
        start = end - datetime.timedelta(days=self.cfg.sync.fill_lookback_days)
        ret, data = ctx.history_deal_list_query(
            start=start.strftime("%Y-%m-%d"),
            end=end.strftime("%Y-%m-%d"),
            trd_env=TrdEnv.REAL,
            acc_id=self.cfg.opend.acc_id,
        )
        if ret != RET_OK:
            log.error("history_deal_list_query failed: %s", data)
            return []

        rows: list[dict[str, Any]] = []
        for _, row in data.iterrows():
            side_raw = str(row.get("trd_side", "")).upper()
            side = "BUY" if "BUY" in side_raw else ("SELL" if "SELL" in side_raw else None)
            if side is None:
                continue
            rows.append({
                "brokerFillId": str(row.get("deal_id", "")),
                "ticker": str(row["code"]),
                "side": side,
                "qty": float(row.get("qty", 0)),
                "price": float(row.get("price", 0)),
                "executedAt": _iso(row.get("create_time")),
                "fees": None,  # moomoo doesn't return per-fill fees in this call
                "currency": "USD" if self.cfg.opend.market.upper() == "US" else "HKD",
            })
        return rows


def _iso(v: Any) -> str:
    """Coerce whatever moomoo returns into ISO 8601 UTC."""
    if v is None:
        return datetime.datetime.now(datetime.timezone.utc).isoformat()
    if isinstance(v, datetime.datetime):
        if v.tzinfo is None:
            v = v.replace(tzinfo=datetime.timezone.utc)
        return v.isoformat()
    # moomoo often returns string "2026-05-21 10:21:15.560"
    s = str(v).replace(" ", "T")
    if "+" not in s and "Z" not in s:
        s += "Z"
    return s
