"""
compute_index_technicals.py
============================
Compute daily-bar technicals for the major US index ETFs (SPY/QQQ/DIA) and
optionally IWM and any other tickers. Writes index_technicals.json that the
morning-brief skill consumes.

Indicators:
  - ATR(14): average true range
  - 21EMA, 50EMA, 200SMA
  - RSI(14)
  - MACD(12,26,9): line, signal, histogram, direction, curving-down flag
  - Distance from 21EMA / 50EMA / 200SMA in ATR units (the "extension" measure)
  - Entry-risk classification per wiki rubric:
      EXTREME-EXTENDED  dist >= +3 ATR above 21EMA  → do not chase, expect mean reversion
      EXTENDED          dist +2 to +3 ATR           → wait for first pullback
      FAIR              dist +0.5 to +2 ATR         → mid-range, normal entry zone
      AT-MA             dist -0.5 to +0.5 ATR       → favourable entry zone
      OVERSOLD-PB       dist <= -0.5 ATR            → potential reversal play

Data source: moomoo OpenD `get_kline` (requires OpenD running on 127.0.0.1:11111).
Fallback: yfinance if OpenD unreachable.

Usage:
  python compute_index_technicals.py                       # default SPY,QQQ,DIA
  python compute_index_technicals.py --tickers SPY,QQQ,DIA,IWM
  python compute_index_technicals.py --out custom.json
"""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path

try:
    from _env_loader import load_env as _load_env
    _load_env()
except ImportError:
    pass


# ── Pure-python technicals (no pandas/numpy required) ────────────────────────
def ema(values, period):
    if len(values) < period:
        return [None] * len(values)
    k = 2 / (period + 1)
    out = [None] * (period - 1)
    sma_v = sum(values[:period]) / period
    out.append(sma_v)
    for v in values[period:]:
        out.append(v * k + out[-1] * (1 - k))
    return out


def sma(values, period):
    if len(values) < period:
        return [None] * len(values)
    out = [None] * (period - 1)
    for i in range(period - 1, len(values)):
        out.append(sum(values[i - period + 1:i + 1]) / period)
    return out


def atr(highs, lows, closes, period=14):
    tr = [highs[0] - lows[0]]
    for i in range(1, len(highs)):
        tr.append(max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        ))
    return ema(tr, period)


def rsi(closes, period=14):
    if len(closes) <= period:
        return [None] * len(closes)
    gains, losses = [0.0], [0.0]
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(d if d > 0 else 0)
        losses.append(-d if d < 0 else 0)
    avg_g = sum(gains[1:period + 1]) / period
    avg_l = sum(losses[1:period + 1]) / period
    out = [None] * period
    for i in range(period, len(closes)):
        if i > period:
            avg_g = (avg_g * (period - 1) + gains[i]) / period
            avg_l = (avg_l * (period - 1) + losses[i]) / period
        rs_v = (avg_g / avg_l) if avg_l else 99
        out.append(100 - 100 / (1 + rs_v))
    return out


def macd_calc(closes, fast=12, slow=26, signal=9):
    ef = ema(closes, fast)
    es = ema(closes, slow)
    line = [(a - b) if (a is not None and b is not None) else None for a, b in zip(ef, es)]
    line_clean = [x for x in line if x is not None]
    sig_clean = ema(line_clean, signal)
    sig = [None] * (len(line) - len(sig_clean)) + sig_clean
    hist = [(l - s) if (l is not None and s is not None) else None for l, s in zip(line, sig)]
    return line, sig, hist


def classify_risk(dist_21_atr):
    if dist_21_atr is None:
        return "UNKNOWN"
    if dist_21_atr >= 3:
        return "EXTREME-EXTENDED"
    if dist_21_atr >= 2:
        return "EXTENDED"
    if dist_21_atr >= 0.5:
        return "FAIR"
    if dist_21_atr >= -0.5:
        return "AT-MA"
    return "OVERSOLD-PB"


# ── Data fetch via moomoo OpenD ──────────────────────────────────────────────
def fetch_klines(ticker: str, n: int = 100) -> list[dict] | None:
    """
    Returns list of {time,open,high,low,close,volume} or None on failure.
    Uses get_cur_kline (subscription-cached, no rolling quota) instead of
    request_history_kline which has a 30-day rolling quota that fills up fast.
    """
    try:
        from moomoo import OpenQuoteContext, RET_OK, KLType, SubType
    except ImportError:
        print("[technicals] moomoo SDK not installed", file=sys.stderr)
        return None

    code = ticker if ticker.startswith(("US.", "HK.", "SH.", "SZ.")) else f"US.{ticker}"
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    try:
        # Subscribe first (required for get_cur_kline)
        ret_sub, _ = ctx.subscribe([code], [SubType.K_DAY])
        if ret_sub != RET_OK:
            print(f"[technicals] subscribe error for {ticker}", file=sys.stderr)
            return None
        ret, df = ctx.get_cur_kline(code, n, KLType.K_DAY)
    finally:
        ctx.close()
    if ret != RET_OK:
        print(f"[technicals] kline error for {ticker}: {df}", file=sys.stderr)
        return None
    return df.to_dict("records")


def analyze(ticker: str, n: int = 100) -> dict | None:
    bars = fetch_klines(ticker, n)
    if not bars:
        return None
    closes = [b["close"] for b in bars]
    highs = [b["high"] for b in bars]
    lows = [b["low"] for b in bars]
    last_close = closes[-1]
    last_date = str(bars[-1].get("time_key", bars[-1].get("time", "")))

    a14 = atr(highs, lows, closes, 14)
    e21 = ema(closes, 21)
    e50 = ema(closes, 50)
    s200 = sma(closes, 200) if len(closes) >= 200 else [None] * len(closes)
    r14 = rsi(closes, 14)
    ml, ms, mh = macd_calc(closes)

    atr_now, e21_now, e50_now = a14[-1], e21[-1], e50[-1]
    ma200_now = s200[-1] if s200[-1] else None
    rsi_now = r14[-1]
    macd_now, sig_now, hist_now = ml[-1], ms[-1], mh[-1]
    hist_prev = mh[-2] if len(mh) > 1 else 0

    dist_21_atr = (last_close - e21_now) / atr_now if (atr_now and e21_now) else None
    dist_50_atr = (last_close - e50_now) / atr_now if (atr_now and e50_now) else None
    dist_200_atr = (last_close - ma200_now) / atr_now if (atr_now and ma200_now) else None

    macd_dir = "RISING" if hist_now > hist_prev else ("FALLING" if hist_now < hist_prev else "FLAT")
    curving_down = bool((hist_now < hist_prev) and (macd_now > sig_now))
    bear_cross_imminent = bool((macd_now > sig_now) and ((macd_now - sig_now) < atr_now * 0.05))

    return {
        "symbol": ticker, "close": round(last_close, 2), "date": last_date,
        "atr14": round(atr_now, 2), "atr_pct": round(atr_now / last_close * 100, 2),
        "ema21": round(e21_now, 2), "ema50": round(e50_now, 2),
        "ma200": round(ma200_now, 2) if ma200_now else None,
        "dist_21_atr": round(dist_21_atr, 2), "dist_50_atr": round(dist_50_atr, 2),
        "dist_200_atr": round(dist_200_atr, 2) if dist_200_atr else None,
        "rsi14": round(rsi_now, 1),
        "macd": round(macd_now, 3), "macd_signal": round(sig_now, 3),
        "macd_hist": round(hist_now, 4), "macd_dir": macd_dir,
        "curving_down": curving_down, "bear_cross_imminent": bear_cross_imminent,
        "overbought": bool(rsi_now and rsi_now > 70),
        "oversold": bool(rsi_now and rsi_now < 30),
        "entry_risk": classify_risk(dist_21_atr),
    }


def format_block(results: dict) -> str:
    """Format technicals as a human-readable block for the brief prompt."""
    lines = ["INDEX TECHNICALS (daily bars, computed locally):"]
    for sym, r in results.items():
        if not r:
            continue
        flags = []
        if r["overbought"]: flags.append("OVERBOUGHT")
        if r["curving_down"]: flags.append("MACD-CURVING-DOWN")
        if r["bear_cross_imminent"]: flags.append("BEAR-CROSS-NEAR")
        flag_str = f" [{','.join(flags)}]" if flags else ""
        lines.append(
            f"  {sym}: ${r['close']:.2f}  "
            f"21EMA dist={r['dist_21_atr']:+.2f}ATR  "
            f"50EMA dist={r['dist_50_atr']:+.2f}ATR  "
            f"RSI={r['rsi14']:.1f}  MACD={r['macd_dir']}  "
            f"ENTRY_RISK={r['entry_risk']}{flag_str}"
        )
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tickers", default="SPY,QQQ,DIA", help="Comma-separated index ETFs")
    ap.add_argument("--out", default="index_technicals.json")
    ap.add_argument("--block", action="store_true", help="Print human-readable block")
    args = ap.parse_args()

    tickers = [t.strip().upper() for t in args.tickers.split(",") if t.strip()]
    results = {}
    for t in tickers:
        r = analyze(t)
        if r:
            results[t] = r
            print(f"[technicals] {t}: dist={r['dist_21_atr']:+.2f}ATR RSI={r['rsi14']:.1f} risk={r['entry_risk']}", file=sys.stderr)

    out_path = Path(__file__).parent / args.out if not Path(args.out).is_absolute() else Path(args.out)
    out_path.write_text(json.dumps(results, indent=2, ensure_ascii=False))
    print(f"[technicals] wrote {out_path}", file=sys.stderr)

    if args.block:
        print(format_block(results))


if __name__ == "__main__":
    main()
