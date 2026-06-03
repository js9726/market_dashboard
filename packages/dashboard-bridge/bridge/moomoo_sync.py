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
            equity = self._equity(ctx)
            return {"positions": positions, "fills": fills, "equity": equity}
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

        currency = "USD" if self.cfg.opend.market.upper() == "US" else "HKD"
        rows: list[dict[str, Any]] = []
        order_qty: dict[str, float] = {}
        for _, row in data.iterrows():
            side_raw = str(row.get("trd_side", "")).upper()
            side = "BUY" if "BUY" in side_raw else ("SELL" if "SELL" in side_raw else None)
            if side is None:
                continue
            qty = float(row.get("qty", 0))
            oid = str(row.get("order_id", ""))
            order_qty[oid] = order_qty.get(oid, 0.0) + qty
            rows.append({
                "brokerFillId": str(row.get("deal_id", "")),
                "_orderId": oid,
                "ticker": str(row["code"]),
                "side": side,
                "qty": qty,
                "price": float(row.get("price", 0)),
                "executedAt": _iso(row.get("create_time")),
                "fees": None,
                "currency": currency,
            })

        # The deal API returns no fees; order_fee_query does. Attach per-deal fees
        # (order fee split across the order's deals by qty) so realized P&L is net
        # of fees without needing a separate backfill. Best-effort (non-fatal).
        order_fee = self._order_fees(ctx, [o for o in order_qty if o])
        for r in rows:
            oid = r.pop("_orderId", "")
            oq = order_qty.get(oid, 0.0)
            fee = order_fee.get(oid)
            if fee is not None and oq > 0:
                r["fees"] = round(fee * (r["qty"] / oq), 4)
        return rows

    def _order_fees(self, ctx: OpenSecTradeContext, order_ids: list[str]) -> dict[str, float]:
        """Per-order fees via order_fee_query, chunked. Non-fatal on error."""
        fees: dict[str, float] = {}
        for j in range(0, len(order_ids), 50):
            try:
                ret, data = ctx.order_fee_query(
                    order_id_list=order_ids[j:j + 50],
                    acc_id=self.cfg.opend.acc_id,
                    trd_env=TrdEnv.REAL,
                )
            except Exception as e:  # noqa: BLE001
                log.warning("order_fee_query exception (non-fatal): %s", e)
                continue
            if ret != RET_OK:
                log.warning("order_fee_query failed (non-fatal): %s", data)
                continue
            for _, row in data.iterrows():
                oid = str(row.get("order_id", ""))
                fa = row.get("fee_amount")
                if oid and fa is not None:
                    try:
                        fees[oid] = float(fa)
                    except (TypeError, ValueError):
                        pass
        return fees


    # ── Equity snapshot (Phase 4 — feeds /equity timeline page) ─────────
    def _equity(self, ctx: OpenSecTradeContext) -> dict[str, Any] | None:
        """
        Pull current account totals via accinfo_query and return a single
        equity snapshot dict. Returns None on error (sync still succeeds for
        positions+fills; equity is best-effort).

        Reported in the account's local currency (USD for FUTUMY/US, HKD for
        HK accounts). The dashboard normalises display via currencyCode.
        """
        try:
            ret, data = ctx.accinfo_query(
                trd_env=TrdEnv.REAL,
                acc_id=self.cfg.opend.acc_id,
                refresh_cache=True,
            )
        except Exception as e:
            log.warning("accinfo_query exception (non-fatal): %s", e)
            return None
        if ret != RET_OK:
            log.warning("accinfo_query failed (non-fatal): %s", data)
            return None
        if data is None or len(data) == 0:
            return None

        row = data.iloc[0]
        currency = (
            "USD" if self.cfg.opend.market.upper() == "US"
            else ("HKD" if self.cfg.opend.market.upper() == "HK" else "USD")
        )

        def _f(key: str) -> float | None:
            v = row.get(key)
            try:
                return float(v) if v is not None else None
            except (TypeError, ValueError):
                return None

        # moomoo accinfo_query returns: total_assets, cash, market_val,
        # frozen_cash, avl_withdrawal_cash, power, available_funds, etc.
        # Field names vary by market; us_cash/hk_cash also available.
        total_assets = _f("total_assets")
        cash = _f("us_cash") if currency == "USD" else _f("cash")
        if cash is None:
            cash = _f("cash") or 0.0
        market_val = _f("market_val")
        unrealized_pl = _f("unrealized_pl")  # may not exist; falls back to None

        if total_assets is None or market_val is None:
            log.warning("equity snapshot missing required fields; skipping")
            return None

        # Reconciliation guard: for a cash account total_assets ≈ cash + market_val.
        # A large divergence means accinfo is returning the WRONG account or a
        # margin buying-power figure (observed: total_assets ~9x the real account).
        # Log loudly so the snapshot is not silently trusted — the dashboard also
        # re-checks this server-side and hides the account-value line until it
        # reconciles. See docs/EQUITY-ACCID-FIX.md to verify acc_id.
        expected = (cash or 0.0) + market_val
        if expected > 0 and abs(total_assets - expected) / expected > 0.5:
            log.warning(
                "equity reconciliation FAILED: total_assets=%.2f vs cash+market_val=%.2f "
                "(%.1fx). acc_id=%s may be the wrong account or a margin/aggregate view. "
                "See docs/EQUITY-ACCID-FIX.md.",
                total_assets, expected,
                (total_assets / expected) if expected else 0.0,
                self.cfg.opend.acc_id,
            )

        return {
            "snapshotDate": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
            "totalAssets": total_assets,
            "cash": cash or 0.0,
            "marketVal": market_val,
            "unrealizedPl": unrealized_pl,
            "currencyCode": currency,
        }


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
