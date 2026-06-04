"""
IBKR adapter for dashboard-bridge.

Connects to IB Gateway / TWS via ib_insync, pulls:
  - portfolio positions  (ib.portfolio())
  - executed fills       (ib.fills())
  - account summary      (ib.accountSummary())

Maps to the same /api/bridge/sync payload shape used by the MooMoo adapter
so both brokers POST to the same server endpoint with no TS changes needed.

Ticker normalisation:
    IBKR returns bare tickers (AAPL, NVDA) for US equities and for options
    the localSymbol is used. We send them as-is (no "US." prefix) since the
    server's plainTicker() strips "XX." prefixes — a bare ticker already
    passes through cleanly.

Currency:
    We read currency from the IBKR Contract object (usually "USD" for US
    stocks). The equity snapshot currency comes from accountSummary
    BaseCurrency.
"""
from __future__ import annotations

import datetime
import logging
from typing import Any

from .config import Config

log = logging.getLogger(__name__)


def _normalize_ticker(contract) -> str:
    """
    Return a dashboard-safe ticker string from an ib_insync Contract.

    - Stocks: use `localSymbol` when it looks like a plain symbol (no spaces),
      otherwise fall back to `symbol`.
    - Options / futures: use `localSymbol` as-is so the fill record stays
      human-readable (the dashboard treats unrecognised tickers as non-equity).
    """
    sec_type = getattr(contract, "secType", "").upper()
    local = (getattr(contract, "localSymbol", "") or "").strip()
    symbol = (getattr(contract, "symbol", "") or "").strip().upper()

    if sec_type == "STK":
        # Prefer localSymbol for stocks — it matches what IBKR displays in TWS.
        # Fall back to symbol if localSymbol is absent or oddly formatted.
        if local and " " not in local:
            return local.upper()
        return symbol or local.upper()

    # For options, futures, etc., use localSymbol (e.g. "AAPL  260117C00200000")
    # The server dedup is on brokerFillId so the shape doesn't need to change.
    return local or symbol


class IBKRSync:
    """
    One-shot connector: connects, fetches data, disconnects.

    Usage:
        sync = IBKRSync(cfg)
        snapshot = sync.fetch()   # -> {"positions": [...], "fills": [...], "equity": {...}}
    """

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def fetch(self) -> dict[str, Any]:
        """
        Connect to IB Gateway/TWS, pull all data, disconnect.
        Returns a dict with positions, fills, equity (mirroring MoomooSync.fetch).
        """
        # Import here so the rest of the bridge still works even if ib_insync
        # is not installed (MooMoo users don't need it).
        try:
            from ib_insync import IB
        except ImportError:
            raise ImportError(
                "ib_insync is not installed. Run: pip install ib_insync"
            ) from None

        ibkr_cfg = self.cfg.ibkr  # type: ignore[attr-defined]  # added by load_config
        ib = IB()

        log.info(
            "Connecting to IB Gateway at %s:%d (clientId=%d)",
            ibkr_cfg.host, ibkr_cfg.port, ibkr_cfg.client_id,
        )
        ib.connect(
            host=ibkr_cfg.host,
            port=ibkr_cfg.port,
            clientId=ibkr_cfg.client_id,
            timeout=15,         # seconds — raise fast if GW is down
            readonly=True,      # the bridge NEVER places orders
        )

        try:
            positions = self._positions(ib)
            fills = self._fills(ib)
            equity = self._equity(ib)
            return {"positions": positions, "fills": fills, "equity": equity}
        finally:
            try:
                ib.disconnect()
            except Exception:  # noqa: BLE001
                pass

    # ── Positions ─────────────────────────────────────────────────────────────

    def _positions(self, ib) -> list[dict[str, Any]]:  # type: ignore[no-untyped-def]
        """
        ib.portfolio() returns PortfolioItem objects for all positions.
        We emit rows only where qty != 0.
        """
        rows: list[dict[str, Any]] = []
        for item in ib.portfolio():
            qty = float(item.position)
            if qty == 0:
                continue
            contract = item.contract
            currency = (getattr(contract, "currency", None) or "USD").upper()
            rows.append({
                "ticker": _normalize_ticker(contract),
                "qty": qty,
                "avgCost": float(item.averageCost),
                "currency": currency,
            })
        log.debug("IBKR positions: %d rows", len(rows))
        return rows

    # ── Fills ─────────────────────────────────────────────────────────────────

    def _fills(self, ib) -> list[dict[str, Any]]:
        """
        ib.fills() returns Fill namedtuples with (contract, execution, commissionReport, time).
        We filter to the last N days (fill_lookback_days) and map to the bridge shape.

        brokerFillId = execution.execId  — globally unique per IBKR execution.
        fees         = commissionReport.commission (USD, may be UNSET=1.7976931348623157e+308).
        """
        lookback = datetime.timedelta(days=self.cfg.ibkr.fill_lookback_days)  # type: ignore[attr-defined]
        cutoff = datetime.datetime.now(datetime.timezone.utc) - lookback

        rows: list[dict[str, Any]] = []
        for fill in ib.fills():
            ex = fill.execution
            cr = fill.commissionReport
            contract = fill.contract

            # Parse execution time — IBKR format: "20260531  15:30:00 US/Eastern"
            executed_at = _parse_ibkr_time(ex.time)
            if executed_at is None:
                log.warning("Could not parse fill time '%s' — using now", ex.time)
                executed_at = datetime.datetime.now(datetime.timezone.utc)

            if executed_at < cutoff:
                continue

            side_raw = str(ex.side).upper()
            if side_raw in ("BOT", "BUY"):
                side = "BUY"
            elif side_raw in ("SLD", "SELL"):
                side = "SELL"
            else:
                log.warning("Unrecognised fill side '%s' for execId %s — skipping", ex.side, ex.execId)
                continue

            # Commission: IBKR sometimes returns the max-float sentinel when the
            # commission report hasn't arrived yet. Treat anything > $10,000 as absent.
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

            rows.append({
                "brokerFillId": str(ex.execId),
                "ticker": _normalize_ticker(contract),
                "side": side,
                "qty": float(ex.shares),
                "price": float(ex.price),
                "executedAt": executed_at.isoformat(),
                "fees": fees,
                "currency": currency,
            })

        log.debug("IBKR fills (last %d days): %d rows", self.cfg.ibkr.fill_lookback_days, len(rows))  # type: ignore[attr-defined]
        return rows

    # ── Equity snapshot ───────────────────────────────────────────────────────

    def _equity(self, ib) -> dict[str, Any] | None:
        """
        Pull account summary tags and build the equity snapshot dict.
        We request the standard tags that map to the dashboard's equity shape.
        """
        # accountSummary() returns a list of AccountValue namedtuples.
        # Tags we need: NetLiquidation, TotalCashValue, GrossPositionValue,
        #               UnrealizedPnL, BaseCurrency, AccountType.
        tags = (
            "NetLiquidation,TotalCashValue,GrossPositionValue,"
            "UnrealizedPnL,BaseCurrency"
        )
        try:
            summary = ib.accountSummary()
        except Exception as e:
            log.warning("accountSummary() failed (non-fatal): %s", e)
            return None

        if not summary:
            log.warning("accountSummary() returned empty list")
            return None

        vals: dict[str, str] = {}
        currency = "USD"
        for item in summary:
            tag = item.tag
            # Filter to USD currency values (or the BaseCurrency tag itself).
            # IBKR may return values in multiple currencies; we want the USD ones.
            if tag == "BaseCurrency":
                currency = str(item.value).upper()
                continue
            if item.currency not in ("USD", "BASE", ""):
                continue
            vals[tag] = item.value

        def _f(key: str) -> float | None:
            v = vals.get(key)
            if v is None:
                return None
            try:
                return float(v)
            except (TypeError, ValueError):
                return None

        net_liq = _f("NetLiquidation")
        cash = _f("TotalCashValue")
        market_val = _f("GrossPositionValue")
        unrealized_pl = _f("UnrealizedPnL")

        if net_liq is None:
            log.warning("NetLiquidation missing from accountSummary — skipping equity snapshot")
            return None

        # Reconciliation guard (mirrors the MooMoo adapter).
        if cash is not None and market_val is not None:
            expected = cash + market_val
            if expected > 0 and abs(net_liq - expected) / expected > 0.5:
                log.warning(
                    "IBKR equity reconciliation WARNING: NetLiquidation=%.2f vs "
                    "TotalCashValue+GrossPositionValue=%.2f (%.1fx). "
                    "Check the account in IB Gateway.",
                    net_liq, expected,
                    (net_liq / expected) if expected else 0.0,
                )

        return {
            "snapshotDate": datetime.datetime.now(datetime.timezone.utc).date().isoformat(),
            "totalAssets": net_liq,
            "cash": cash if cash is not None else 0.0,
            "marketVal": market_val if market_val is not None else 0.0,
            "unrealizedPl": unrealized_pl,
            "currencyCode": currency,
        }


# ── Time parsing ──────────────────────────────────────────────────────────────

def _parse_ibkr_time(raw: str | None) -> datetime.datetime | None:
    """
    Parse the IBKR execution time string.

    IBKR returns times in various formats depending on the TWS/GW version:
      "20260531  15:30:00 US/Eastern"   (most common from TWS API)
      "20260531 15:30:00"               (GW / older versions)
      "20260531-15:30:00"               (some historical data endpoints)

    We normalise to UTC. IBKR does NOT include the UTC offset in the string —
    the timezone name is a label only and not reliably parseable by stdlib.
    We treat the timestamp as US/Eastern and convert to UTC using a fixed
    offset table (ET = UTC-5 in winter, UTC-4 in summer). For an equity swing
    trader this is accurate enough; sub-minute fill timing is not required.
    """
    if not raw:
        return None

    # Strip the timezone label (everything after a second space or a trailing tz).
    s = str(raw).strip()
    # e.g. "20260531  15:30:00 US/Eastern" → ["20260531", "15:30:00", "US/Eastern"]
    # or   "20260531 15:30:00"
    parts = s.split()
    if len(parts) >= 2:
        date_part = parts[0].strip()
        time_part = parts[1].strip()
        # Handle "20260531-15:30:00" format
        if "-" in date_part and len(date_part) > 8:
            idx = date_part.index("-")
            date_part, time_part = date_part[:idx], date_part[idx + 1:]
    elif "-" in s:
        idx = s.index("-")
        date_part, time_part = s[:idx], s[idx + 1:]
    else:
        return None

    try:
        naive = datetime.datetime.strptime(f"{date_part} {time_part}", "%Y%m%d %H:%M:%S")
    except ValueError:
        try:
            naive = datetime.datetime.strptime(f"{date_part} {time_part}", "%Y%m%d %H:%M:%S.%f")
        except ValueError:
            return None

    # Determine US/Eastern UTC offset via DST rules (second Sunday March → first Sunday Nov).
    et_offset = _et_utc_offset(naive)
    return (naive - datetime.timedelta(hours=et_offset)).replace(tzinfo=datetime.timezone.utc)


def _et_utc_offset(dt: datetime.datetime) -> int:
    """Return the US Eastern UTC offset in hours (4 = EDT, 5 = EST)."""
    year = dt.year
    # DST starts: second Sunday in March at 02:00
    # DST ends:   first Sunday in November at 02:00
    march_first = datetime.date(year, 3, 1)
    first_sunday_march = march_first + datetime.timedelta(
        days=(6 - march_first.weekday()) % 7
    )
    dst_start = datetime.datetime(year, 3, first_sunday_march.day + 7, 2, 0, 0)

    nov_first = datetime.date(year, 11, 1)
    first_sunday_nov = nov_first + datetime.timedelta(
        days=(6 - nov_first.weekday()) % 7
    )
    dst_end = datetime.datetime(year, 11, first_sunday_nov.day, 2, 0, 0)

    if dst_start <= dt < dst_end:
        return 4  # EDT = UTC-4
    return 5  # EST = UTC-5
