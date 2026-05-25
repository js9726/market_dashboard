"""
fetch_opend_live.py
===================
Query moomoo OpenD for real-time US market snapshot data and format it into a
`live_data_block` string ready for injection into the morning-brief prompt.

Advantages over yfinance:
  • Pre-market price, change%, and volume — available before 9:30 AM ET
  • After-hours price + change — available after 4:00 PM ET
  • Volume ratio (RVOL) — relative volume vs 10-day avg
  • Sub-second live quotes during regular session
  • No bot-detection / rate-limiting issues

Usage
-----
  # Print live_data_block to stdout (PATH A morning brief)
  python fetch_opend_live.py

  # Custom ticker list
  python fetch_opend_live.py --tickers NVDA,TSLA,AAPL,SPY,QQQ

  # Save raw JSON snapshot for downstream scripts
  python fetch_opend_live.py --out opend_live.json

  # Tickers from a file (one per line or comma-sep)
  python fetch_opend_live.py --tickers-file watchlist.txt

Environment variables (optional, override defaults)
------------------------------------------------------
  OPEND_HOST        OpenD host  (default: 127.0.0.1)
  OPEND_PORT        OpenD port  (default: 11111)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Load .env / .env.local if present
try:
    from _env_loader import load_env as _load_env
    _load_env()
except ImportError:
    pass  # standalone usage without env loader is fine

# ── Default watchlist (indices + key names) ───────────────────────────────────
# Merged from: screener top tickers + core indices + sector ETFs.
# PATH A will override this via --tickers if watchlist is resolved from TV.
_DEFAULT_TICKERS = [
    # Core indices
    "SPY", "QQQ", "IWM", "DIA",
    # Sector ETFs
    "XLK", "SMH", "XLF", "XLC", "XLY", "XLRE", "XLI", "XLE", "XLV", "XLP", "XLU",
    # Thematic
    "CIBR", "IGV", "IBB",
    # Rates / commodities proxy
    "TLT", "GLD",
    # Mega-cap / key momentum names
    "NVDA", "MSFT", "AAPL", "AMZN", "META", "GOOGL",
    # Screener recurrents
    "ALAB", "CRDO", "MRVL", "ARM", "DDOG", "SNOW",
]

_INDICES = {"SPY", "QQQ", "IWM", "DIA", "TLT"}
_SECTOR_ETFS = {
    "XLK", "SMH", "XLF", "XLC", "XLY", "XLRE", "XLI",
    "XLE", "XLV", "XLP", "XLU", "CIBR", "IGV", "IBB", "GLD",
}


def _mktcode(ticker: str) -> str:
    return f"US.{ticker.upper()}"


def _pct(val) -> str | None:
    try:
        f = float(val)
        return f"{'+' if f > 0 else ''}{f:.2f}%"
    except (TypeError, ValueError):
        return None


def _port_alive(host: str, port: int, timeout_s: float = 2.0) -> bool:
    """TCP-connect probe — fast preflight to avoid the moomoo SDK's infinite retry loop."""
    import socket
    try:
        with socket.create_connection((host, port), timeout=timeout_s):
            return True
    except (OSError, socket.timeout):
        return False


def _opend_exe_path() -> Path | None:
    """Best-effort lookup for the moomoo_OpenD.exe GUI launcher (Windows only)."""
    if os.name != "nt":
        return None
    candidates = [
        Path(os.environ.get("LOCALAPPDATA", "")) / "Packages" / "Claude_pzs8sxrjxfjjc" / "LocalCache" / "Roaming" / "moomoo_OpenD" / "moomoo_OpenD.exe",
        Path(r"C:\Program Files\moomoo OpenD\moomoo_OpenD.exe"),
        Path(r"C:\Program Files (x86)\moomoo OpenD\moomoo_OpenD.exe"),
        Path(os.environ.get("USERPROFILE", "")) / "Desktop" / "moomoo OpenD" / "moomoo_OpenD.exe",
    ]
    for p in candidates:
        if p.exists():
            return p
    return None


def _preflight_opend(host: str, port: int, max_wait_s: int = 30) -> bool:
    """
    Ensure OpenD is reachable on `host:port` before any moomoo SDK call.
    Self-heal sequence:
      1. If port already alive → return True immediately.
      2. Else, on Windows: try to kill zombie moomoo_OpenD process + relaunch GUI.
      3. Poll port for up to max_wait_s seconds.
      4. Return True if alive, False otherwise (caller handles graceful fallback).
    """
    import subprocess
    import time

    if _port_alive(host, port):
        return True

    print(f"[fetch_opend_live] OpenD port {host}:{port} unreachable — attempting self-heal…", file=sys.stderr)

    if os.name == "nt":
        # Kill any zombie moomoo_OpenD process (API service inside is dead but window may persist).
        try:
            subprocess.run(
                ["taskkill", "/F", "/IM", "moomoo_OpenD.exe"],
                capture_output=True, timeout=10, check=False,
            )
        except Exception as e:
            print(f"[fetch_opend_live] taskkill skipped: {e}", file=sys.stderr)

        exe = _opend_exe_path()
        if exe:
            try:
                subprocess.Popen(
                    [str(exe)],
                    creationflags=subprocess.DETACHED_PROCESS if hasattr(subprocess, "DETACHED_PROCESS") else 0,
                )
                print(f"[fetch_opend_live] Relaunched {exe.name}", file=sys.stderr)
            except Exception as e:
                print(f"[fetch_opend_live] Relaunch failed: {e}", file=sys.stderr)
        else:
            print("[fetch_opend_live] moomoo_OpenD.exe not found at known paths — launch manually", file=sys.stderr)

    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        if _port_alive(host, port):
            print(f"[fetch_opend_live] OpenD back online after self-heal", file=sys.stderr)
            return True
        time.sleep(2)

    print(
        f"[fetch_opend_live] OpenD still down after {max_wait_s}s — skipping OpenD enrichment, "
        f"caller will fall back to yfinance/cached data.",
        file=sys.stderr,
    )
    return False


def fetch_snapshots(tickers: list[str], host: str, port: int) -> list[dict]:
    """
    Call OpenD get_market_snapshot for up to 200 US tickers.
    Returns a list of dicts, one per ticker, with normalised fields.
    Returns empty list (with stderr message) if OpenD unreachable — never hangs.
    """
    try:
        from moomoo import OpenQuoteContext, RET_OK
    except ImportError:
        print("[fetch_opend_live] moomoo SDK not installed — pip install moomoo-api", file=sys.stderr)
        return []

    # Preflight — bail fast if OpenD is down instead of letting the SDK retry forever.
    if not _preflight_opend(host, port):
        return []

    codes = [_mktcode(t) for t in tickers]
    ctx = OpenQuoteContext(host=host, port=port)
    try:
        ret, df = ctx.get_market_snapshot(codes)
    finally:
        ctx.close()

    if ret != RET_OK:
        print(f"[fetch_opend_live] get_market_snapshot error: {df}", file=sys.stderr)
        return []

    rows: list[dict] = []
    for _, row in df.iterrows():
        code = str(row.get("code", ""))
        ticker = code.replace("US.", "") if code.startswith("US.") else code

        last  = _safe_float(row, "last_price")
        prev  = _safe_float(row, "prev_close_price")
        high  = _safe_float(row, "high_price")
        low   = _safe_float(row, "low_price")
        vol   = _safe_int(row, "volume")
        rvol  = _safe_float(row, "volume_ratio")  # OpenD's relative volume

        # Compute daily change % from last vs prev_close
        change_pct: float | None = None
        if last is not None and prev is not None and prev != 0:
            change_pct = round((last - prev) / prev * 100, 2)

        # Pre-market
        pre_price  = _safe_float(row, "pre_price")
        pre_chg    = _safe_float(row, "pre_change_rate")  # already in %
        pre_vol    = _safe_int(row, "pre_volume")

        # After-hours
        aft_price  = _safe_float(row, "after_price")
        aft_chg    = _safe_float(row, "after_change_rate")  # already in %

        rows.append({
            "ticker":     ticker,
            "last":       last,
            "prev_close": prev,
            "change_pct": change_pct,
            "high":       high,
            "low":        low,
            "volume":     vol,
            "rvol":       rvol,
            "pre_price":  pre_price,
            "pre_chg":    pre_chg,
            "pre_volume": pre_vol,
            "after_price": aft_price,
            "after_chg":  aft_chg,
            "update_time": str(row.get("update_time", "")),
        })
    return rows


def _safe_float(row, col: str) -> float | None:
    try:
        v = row[col]
        if v is None or (isinstance(v, float) and (v != v)):  # NaN check
            return None
        f = float(v)
        return None if f == 0.0 and col not in ("last_price", "prev_close_price") else f
    except (KeyError, TypeError, ValueError):
        return None


def _safe_int(row, col: str) -> int | None:
    try:
        v = row[col]
        if v is None:
            return None
        return int(v)
    except (KeyError, TypeError, ValueError):
        return None


def build_live_block(rows: list[dict]) -> str:
    """Format snapshot rows into a live_data_block string for prompt injection."""
    if not rows:
        return "  (OpenD snapshot unavailable — rely on web search)"

    lines: list[str] = ["  Live market data via moomoo OpenD (real-time — AUTHORITATIVE):"]

    # Split into groups for cleaner prompt structure
    indices   = [r for r in rows if r["ticker"] in _INDICES]
    sectors   = [r for r in rows if r["ticker"] in _SECTOR_ETFS]
    watchlist = [r for r in rows if r["ticker"] not in _INDICES and r["ticker"] not in _SECTOR_ETFS]

    def _row(r: dict, label: str = "") -> str:
        t  = r["ticker"]
        lp = f"${r['last']:.2f}" if r["last"] is not None else "N/A"
        cp = _pct(r["change_pct"]) or "N/A"
        rv = f"RVOL={r['rvol']:.1f}x" if r["rvol"] is not None else ""
        vol_m = f"{r['volume']/1e6:.1f}M" if r["volume"] else ""

        extras: list[str] = []
        if r["pre_price"] and r["pre_chg"] is not None:
            extras.append(f"pre={r['pre_price']:.2f}({_pct(r['pre_chg'])})")
        if r["after_price"] and r["after_chg"] is not None:
            extras.append(f"aft={r['after_price']:.2f}({_pct(r['after_chg'])})")

        parts = [f"    {t:<6} {lp} ({cp})", vol_m, rv] + extras
        return "  ".join(p for p in parts if p)

    if indices:
        lines.append("  Indices:")
        for r in indices:
            lines.append(_row(r))

    if sectors:
        lines.append("  Sector ETFs:")
        for r in sectors:
            lines.append(_row(r))

    if watchlist:
        lines.append("  Watchlist live prices (use for watchlist[].level and changePct):")
        for r in watchlist:
            lines.append(_row(r))

    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Fetch live OpenD snapshot for morning brief")
    parser.add_argument("--tickers", default="", help="Comma-separated US tickers")
    parser.add_argument("--tickers-file", default="", help="File with one ticker per line")
    parser.add_argument("--out", default="", help="Write raw JSON to this path")
    parser.add_argument("--host", default=os.environ.get("OPEND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("OPEND_PORT", "11111")))
    parser.add_argument("--json", action="store_true", help="Output raw JSON instead of live_block text")
    args = parser.parse_args(argv)

    tickers: list[str] = []

    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]

    if args.tickers_file:
        fp = Path(args.tickers_file)
        if fp.exists():
            raw = fp.read_text(encoding="utf-8")
            for line in raw.replace(",", "\n").splitlines():
                t = line.strip().upper()
                if t:
                    tickers.append(t)

    if not tickers:
        tickers = _DEFAULT_TICKERS

    # Deduplicate, preserve order
    seen: set[str] = set()
    deduped: list[str] = []
    for t in tickers:
        if t not in seen:
            seen.add(t)
            deduped.append(t)
    tickers = deduped

    rows = fetch_snapshots(tickers, host=args.host, port=args.port)

    if args.out:
        Path(args.out).write_text(json.dumps(rows, indent=2), encoding="utf-8")
        print(f"[fetch_opend_live] Saved {len(rows)} rows to {args.out}", file=sys.stderr)

    if args.json:
        print(json.dumps(rows, indent=2))
    else:
        print(build_live_block(rows))


if __name__ == "__main__":
    main()
