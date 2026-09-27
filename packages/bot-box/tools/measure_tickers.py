#!/usr/bin/env python3
"""measure_tickers.py - completed-bar measurements for named tickers.

The bot-box agents run in a locked-down permission mode and may only execute
allow-listed scripts. This is the one they use to measure a ticker, so it must be
deterministic, read-only and honest about data grade and freshness.

    python measure_tickers.py --tickers VEEV,TEAM
    python measure_tickers.py --tickers VEEV --peers IGV,CRM,NOW --source yahoo

Output is one JSON document on stdout, always. The tool writes no files: there is
deliberately no output-path option, because an allow-listed program that writes where
its caller says escapes every Write/Edit permission rule.

Data grade (bars only - neither grade is chart evidence)
    broker  moomoo OpenD daily bars on this machine (127.0.0.1:11111)
    public  Yahoo Finance daily bars via yfinance (OpenD unreachable or --source yahoo)
A ticker whose chart was not captured is capped at WATCH whatever the grade.

Rules this tool enforces rather than leaving to a model:
    * The acquisition cutoff is fixed BEFORE fetching. The expected last completed
      session comes from the NYSE calendar (weekends, holidays, 13:00 early closes,
      known special closures) plus a finalization buffer after the close. A bar dated
      after the cutoff is live context only and never feeds a gate, even when the
      fetch finishes after the close (wiki/trading/traders/trader-styles.md,
      unfinished-bar veto).
    * Fresh and aligned or nothing: SPY and every ticker must end on the expected
      session and match the last ALIGN_SESSIONS exchange sessions exactly. Otherwise
      the row (or, for SPY, the whole run) is STALE / MISALIGNED with no gates.
    * Every bar used must have finite, positive, coherent OHLC and finite volume >= 0.
      One bad bar rejects the series; nothing is interpolated. JSON is strict: NaN or
      Infinity can never be emitted.
    * Extension is (close - prior bar's 21EMA) / prior bar's ATR14, the doctrine's
      definition; >= 2.5 ATR is a veto (inclusive), and base > 18% with >= 1.5 ATR is
      the combined veto. An input that cannot be computed makes its gate UNKNOWN,
      never PASS.
    * A long stop at or above the close is invalid, never "within 1.5 ATR".
    * The 52-week high needs 252 completed sessions; with fewer the proximity gate is
      UNKNOWN and the lookback is disclosed.

Exit codes: 0 measured (check each row's status), 2 no data source reachable,
3 benchmark SPY stale or invalid (no row is evaluable), 4 internal serialization error.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import sys
import time
from typing import Callable
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
VOLUME_GATE = 1.5
EXTENSION_VETO_ATR = 2.5
COMBINED_VETO_ATR = 1.5
COMBINED_VETO_BASE_PCT = 18.0
CLOSE_STRENGTH_REDLIGHT = 0.41
PROXIMITY_FLOOR_PCT = -25.0
LIQUIDITY_FLOOR_MUSD = 20.0
STOP_MAX_ATR = 1.5

MIN_BARS = 60          # EMA50, 50-day U/D and 20-day windows
HIGH_52W_BARS = 252    # sessions in a 52-week lookback
ALIGN_SESSIONS = 60    # trailing exchange sessions every series must match exactly
FINALIZE_MINUTES = 20  # a daily bar is final this long after the session close
REGULAR_CLOSE = dt.time(16, 0)
EARLY_CLOSE = dt.time(13, 0)
CALENDAR_FIRST_YEAR = 2000
# Unscheduled full-day closures. Rule-based holidays cannot predict these; add new ones
# here when the exchange announces them.
SPECIAL_CLOSURES = frozenset(dt.date.fromisoformat(d) for d in (
    "2001-09-11", "2001-09-12", "2001-09-13", "2001-09-14",  # September 11
    "2004-06-11",  # President Reagan
    "2007-01-02",  # President Ford
    "2012-10-29", "2012-10-30",  # Hurricane Sandy
    "2018-12-05",  # President G.H.W. Bush
    "2025-01-09",  # President Carter
))
CALENDAR_NOTE = ("NYSE rule-based holidays and 13:00 early closes plus known special closures; "
                 "an unscheduled closure not yet listed in SPECIAL_CLOSURES would read as a missing session")


# ---------------------------------------------------------------- exchange calendar
def _easter(year: int) -> dt.date:
    """Gregorian Easter Sunday (anonymous algorithm)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = (h + l - 7 * m + 114) % 31 + 1
    return dt.date(year, month, day)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> dt.date:
    d = dt.date(year, month, 1)
    d += dt.timedelta(days=(weekday - d.weekday()) % 7)
    return d + dt.timedelta(weeks=n - 1)


def _last_weekday(year: int, month: int, weekday: int) -> dt.date:
    d = dt.date(year + (month == 12), month % 12 + 1, 1) - dt.timedelta(days=1)
    return d - dt.timedelta(days=(d.weekday() - weekday) % 7)


def _observed(d: dt.date) -> dt.date:
    if d.weekday() == 5:
        return d - dt.timedelta(days=1)
    if d.weekday() == 6:
        return d + dt.timedelta(days=1)
    return d


def nyse_holidays(year: int) -> frozenset[dt.date]:
    days = set()
    new_year = dt.date(year, 1, 1)
    if new_year.weekday() != 5:  # NYSE does not observe a Saturday New Year on Dec 31
        days.add(_observed(new_year))
    days.add(_nth_weekday(year, 1, 0, 3))              # Martin Luther King Jr. Day
    days.add(_nth_weekday(year, 2, 0, 3))              # Washington's Birthday
    days.add(_easter(year) - dt.timedelta(days=2))     # Good Friday
    days.add(_last_weekday(year, 5, 0))                # Memorial Day
    if year >= 2022:
        days.add(_observed(dt.date(year, 6, 19)))      # Juneteenth
    days.add(_observed(dt.date(year, 7, 4)))           # Independence Day
    days.add(_nth_weekday(year, 9, 0, 1))              # Labor Day
    days.add(_nth_weekday(year, 11, 3, 4))             # Thanksgiving
    days.add(_observed(dt.date(year, 12, 25)))         # Christmas
    return frozenset(days)


def is_session(d: dt.date) -> bool:
    return d.weekday() < 5 and d not in nyse_holidays(d.year) and d not in SPECIAL_CLOSURES


def is_early_close(d: dt.date) -> bool:
    if not is_session(d):
        return False
    thanksgiving = _nth_weekday(d.year, 11, 3, 4)
    return (d == thanksgiving + dt.timedelta(days=1)
            or (d.month == 7 and d.day == 3 and d.weekday() <= 3)
            or (d.month == 12 and d.day == 24 and d.weekday() <= 3))


def session_close(d: dt.date) -> dt.datetime:
    return dt.datetime.combine(d, EARLY_CLOSE if is_early_close(d) else REGULAR_CLOSE, tzinfo=ET)


def previous_session(d: dt.date) -> dt.date:
    d -= dt.timedelta(days=1)
    while not is_session(d):
        d -= dt.timedelta(days=1)
    return d


def expected_last_completed(now_et: dt.datetime) -> dt.date:
    """Most recent session whose daily bar is final at now_et (close + buffer)."""
    now_et = now_et.astimezone(ET)
    d = now_et.date()
    if is_session(d) and now_et >= session_close(d) + dt.timedelta(minutes=FINALIZE_MINUTES):
        return d
    return previous_session(d)


def recent_sessions(last: dt.date, n: int) -> list[dt.date]:
    """The n sessions ending at `last` (inclusive), oldest first."""
    out = [last]
    while len(out) < n:
        out.append(previous_session(out[-1]))
    return out[::-1]


# ---------------------------------------------------------------- data sources
def fetch_opend(tickers: list[str], count: int = 300) -> dict[str, list[dict]]:
    from futu import AuType, KLType, OpenQuoteContext, SubType  # type: ignore

    out: dict[str, list[dict]] = {}
    ctx = OpenQuoteContext(host="127.0.0.1", port=11111)
    try:
        for t in tickers:
            code = f"US.{t}"
            for attempt in range(3):
                try:
                    ctx.subscribe([code], [SubType.K_DAY])
                    r = ctx.get_cur_kline(code, count, KLType.K_DAY, AuType.QFQ)
                except Exception as e:  # noqa: BLE001
                    r = (-1, str(e))
                if r[0] == 0:
                    df = r[1]
                    out[t] = [{"d": str(x[0])[:10], "o": float(x[1]), "h": float(x[2]), "l": float(x[3]),
                               "c": float(x[4]), "v": float(x[5])}
                              for x in df[["time_key", "open", "high", "low", "close", "volume"]].values.tolist()]
                    break
                time.sleep(2.0 * (attempt + 1))
            time.sleep(0.6)  # OpenD rate limit
    finally:
        ctx.close()
    return out


def fetch_yahoo(tickers: list[str]) -> dict[str, list[dict]]:
    import contextlib
    import logging

    import yfinance as yf  # type: ignore

    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    out: dict[str, list[dict]] = {}
    for t in tickers:
        # yfinance prints warnings to stdout; keep stdout reserved for the JSON document.
        with contextlib.redirect_stdout(sys.stderr):
            df = yf.Ticker(t).history(period="15mo", interval="1d", auto_adjust=True)
        if df is None or df.empty:
            continue
        out[t] = [{"d": idx.strftime("%Y-%m-%d"), "o": float(r.Open), "h": float(r.High), "l": float(r.Low),
                   "c": float(r.Close), "v": float(r.Volume)} for idx, r in df.iterrows()]
    return out


def opend_reachable() -> bool:
    import socket

    try:
        with socket.create_connection(("127.0.0.1", 11111), timeout=1.5):
            return True
    except OSError:
        return False


# ---------------------------------------------------------------- bar validation
class SeriesError(Exception):
    def __init__(self, status: str, message: str, **detail):
        super().__init__(message)
        self.status, self.message, self.detail = status, message, detail


def _num(v) -> float | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = float(v)
    return v if math.isfinite(v) else None


def bar_problem(b: dict) -> str | None:
    o, h, l, c, v = (_num(b.get(k)) for k in ("o", "h", "l", "c", "v"))
    if None in (o, h, l, c, v):
        return "missing or nonfinite OHLCV"
    if min(o, h, l, c) <= 0:
        return "nonpositive price"
    if v < 0:
        return "negative volume"
    if h < max(o, c, l) or l > min(o, c, h):
        return "incoherent OHLC (high below or low above the other prices)"
    return None


def split_series(bars: list[dict], cutoff: dt.date) -> tuple[list[dict], dict | None]:
    """Validate a raw series; return (completed bars <= cutoff, first live bar or None).

    Raises SeriesError for any unusable completed bar. Nothing is repaired or skipped.
    """
    completed: list[dict] = []
    live = None
    prev = None
    for b in bars:
        try:
            d = dt.date.fromisoformat(str(b.get("d")))
        except ValueError:
            raise SeriesError("INVALID_DATA", f"unparseable bar date {b.get('d')!r}") from None
        if prev is not None and d <= prev:
            raise SeriesError("INVALID_DATA", f"bar dates not strictly ascending at {d}", bar_date=d.isoformat())
        prev = d
        if d > cutoff:
            if live is None and bar_problem(b) is None:
                live = {**b, "d": d.isoformat()}
            continue
        problem = bar_problem(b)
        if problem:
            raise SeriesError("INVALID_DATA", f"{problem} on {d}", bar_date=d.isoformat())
        if d.year >= CALENDAR_FIRST_YEAR and not is_session(d):
            raise SeriesError("INVALID_DATA", f"bar dated {d}, which is not an NYSE session", bar_date=d.isoformat())
        completed.append({"d": d.isoformat(), **{k: float(b[k]) for k in ("o", "h", "l", "c", "v")}})
    return completed, live


def check_fresh_aligned(completed: list[dict], expected: dt.date) -> None:
    if not completed:
        raise SeriesError("STALE", "no completed bars", last_bar_date=None, expected_bar_date=expected.isoformat())
    last = completed[-1]["d"]
    if last != expected.isoformat():
        raise SeriesError("STALE", f"last completed bar {last}, expected session {expected}",
                          last_bar_date=last, expected_bar_date=expected.isoformat())
    if len(completed) < MIN_BARS:
        raise SeriesError("INSUFFICIENT_HISTORY", f"only {len(completed)} completed bars, need {MIN_BARS}",
                          history_bars=len(completed))
    want = [d.isoformat() for d in recent_sessions(expected, ALIGN_SESSIONS)]
    have = [b["d"] for b in completed[-ALIGN_SESSIONS:]]
    if have != want:
        missing = sorted(set(want) - set(have))
        raise SeriesError("MISALIGNED", f"trailing {ALIGN_SESSIONS} bars do not match the exchange sessions",
                          missing_sessions=missing[:10], missing_count=len(missing))


# ---------------------------------------------------------------- measurement
def ema_series(vals: list[float], n: int) -> list[float | None]:
    out: list[float | None] = []
    k, e = 2 / (n + 1), None
    for i, x in enumerate(vals):
        if i + 1 < n:
            out.append(None)
            continue
        e = sum(vals[:n]) / n if e is None else x * k + e * (1 - k)
        out.append(e)
    return out


def atr_series(s: list[dict]) -> list[float | None]:
    trs = [max(s[i]["h"] - s[i]["l"], abs(s[i]["h"] - s[i - 1]["c"]), abs(s[i]["l"] - s[i - 1]["c"]))
           for i in range(1, len(s))]
    out: list[float | None] = [None] * 15
    if len(trs) < 14:
        return [None] * len(s)
    a = sum(trs[:14]) / 14
    out[-1] = a
    for x in trs[14:]:
        a = (a * 13 + x) / 14
        out.append(a)
    return out[: len(s)]


def ret(s: list[dict], n: int) -> float | None:
    return None if len(s) < n + 1 else (s[-1]["c"] / s[-1 - n]["c"] - 1) * 100


def r2(v):
    if v is None:
        return None
    if not math.isfinite(v):
        raise ValueError(f"nonfinite measurement {v!r}")
    return round(v, 2)


def gate(fail: bool | None) -> str:
    return "UNKNOWN" if fail is None else ("FAIL" if fail else "PASS")


def stop_candidate(level: float | None, close: float, atr: float | None) -> dict | None:
    if level is None or not atr:
        return None
    risk = close - level
    if risk <= 0:
        return {"level": r2(level), "valid": False, "reason": "at or above the close: not a valid long stop",
                "risk_pct": None, "risk_atr": None, "within_1_5_atr": None}
    return {"level": r2(level), "valid": True, "risk_pct": r2(risk / close * 100),
            "risk_atr": r2(risk / atr), "within_1_5_atr": risk / atr <= STOP_MAX_ATR}


def measure(t: str, s: list[dict], spy: list[dict], live: dict | None) -> dict:
    """Measure a validated, fresh, SPY-aligned series (see check_fresh_aligned)."""
    c = [b["c"] for b in s]
    e8, e21 = ema_series(c, 8), ema_series(c, 21)
    e50 = ema_series(c, 50)
    atr = atr_series(s)
    b0, bp = s[-1], s[-2]
    rng = b0["h"] - b0["l"]
    cs = (b0["c"] - b0["l"]) / rng if rng > 0 else None
    avg20 = sum(b["v"] for b in s[-21:-1]) / 20
    rvol = b0["v"] / avg20 if avg20 > 0 else None
    prior_e21, prior_atr = e21[-2], atr[-2]
    if not prior_atr or prior_atr <= 0:
        prior_atr = None
    ext = (b0["c"] - prior_e21) / prior_atr if (prior_e21 is not None and prior_atr) else None
    w10 = s[-10:]
    low10 = min(b["l"] for b in w10)
    base10 = (max(b["h"] for b in w10) - low10) / low10 * 100
    has_52w = len(s) >= HIGH_52W_BARS
    hi_window = s[-HIGH_52W_BARS:]
    hi = max(b["h"] for b in hi_window)
    off_hi = (b0["c"] / hi - 1) * 100
    up = dn = 0.0
    for i in range(len(s) - 50, len(s)):
        if s[i]["c"] > s[i - 1]["c"]:
            up += s[i]["v"]
        elif s[i]["c"] < s[i - 1]["c"]:
            dn += s[i]["v"]
    ud = up / dn if dn else None
    slope = None if e21[-6] is None else ("RISING" if e21[-1] > e21[-6] else "FALLING")
    dv20 = sum(b["v"] * b["c"] for b in s[-20:]) / 20 / 1e6
    prior_hi20 = max(b["h"] for b in s[-21:-1])
    vol_ok = rvol is not None and rvol >= VOLUME_GATE
    breakout = b0["c"] > prior_hi20 and vol_ok
    reclaim = e21[-2] is not None and bp["c"] <= e21[-2] < b0["c"] and vol_ok

    look = spy[-45:]
    peak_d = look[max(range(len(look)), key=lambda i: look[i]["h"])]["d"] if look else None
    spy_by = {b["d"]: i for i, b in enumerate(spy)}
    ex = []
    for i in range(1, len(s)):
        d = s[i]["d"]
        j = spy_by.get(d)
        if peak_d is None or d < peak_d or j is None or j == 0 or spy[j]["c"] >= spy[j - 1]["c"]:
            continue
        ex.append((s[i]["c"] / s[i - 1]["c"] - 1) * 100 - (spy[j]["c"] / spy[j - 1]["c"] - 1) * 100)

    gates = {
        "extension_veto": gate(None if ext is None else ext >= EXTENSION_VETO_ATR),
        "combined_base_veto": gate(None if ext is None else (ext >= COMBINED_VETO_ATR and base10 > COMBINED_VETO_BASE_PCT)),
        "volume_trigger": gate(None if rvol is None else rvol < VOLUME_GATE),
        "close_strength": gate(None if cs is None else (cs < CLOSE_STRENGTH_REDLIGHT and rng / b0["c"] * 100 > 2)),
        "proximity": gate(off_hi < PROXIMITY_FLOOR_PCT if has_52w else None),
        "accumulation": gate(None if ud is None else ud < 1.0),
        "liquidity": gate(dv20 < LIQUIDITY_FLOOR_MUSD),
        "trend": gate(None if slope is None else slope != "RISING"),
    }
    stops = {}
    for name, level in (("last_bar_low", b0["l"]), ("low_10d", low10), ("prior_21ema", prior_e21)):
        cand = stop_candidate(level, b0["c"], prior_atr)
        if cand is not None:
            stops[name] = cand
    vs5 = None if ret(s, 5) is None or ret(spy, 5) is None else ret(s, 5) - ret(spy, 5)
    vs20 = None if ret(s, 20) is None or ret(spy, 20) is None else ret(s, 20) - ret(spy, 20)
    return {
        "ticker": t, "status": "OK", "bar_date": b0["d"], "bar_complete": True, "history_bars": len(s),
        "close": r2(b0["c"]), "chg_pct": r2((b0["c"] / bp["c"] - 1) * 100),
        "close_strength": r2(cs), "range_pct": r2(rng / b0["c"] * 100), "rvol_full_day": r2(rvol),
        "ext_21ema_atr": r2(ext), "base10_pct": r2(base10),
        "atr_pct": r2(prior_atr / b0["c"] * 100) if prior_atr else None,
        "off_52w_high_pct": r2(off_hi) if has_52w else None,
        "high_lookback_bars": len(hi_window),
        "high_note": None if has_52w else (f"only {len(s)} sessions: off_high_pct is from a {len(s)}-session "
                                           "high, not a 52-week high; proximity gate UNKNOWN"),
        "off_high_pct": r2(off_hi),
        "ud_ratio_50d": r2(ud), "ema21_slope": slope,
        "above_8ema": None if e8[-1] is None else b0["c"] > e8[-1],
        "above_21ema": None if e21[-1] is None else b0["c"] > e21[-1],
        "above_50ema": None if e50[-1] is None else b0["c"] > e50[-1],
        "dollar_vol_20d_musd": r2(dv20), "prior_high_20d": r2(prior_hi20),
        "vs_spy_5d": r2(vs5), "vs_spy_20d": r2(vs20),
        "downday_excess_vs_spy": r2(sum(ex) / len(ex)) if ex else None, "downdays_n": len(ex),
        "trigger": "TRIGGERED(breakout)" if breakout else "TRIGGERED(reclaim)" if reclaim else "NOT_TRIGGERED",
        "trigger_note": "proxy: close above prior 20-session high, or 21EMA reclaim, on >= 1.5x; not the dashboard engine",
        "gates": gates, "stop_candidates": stops,
        "live_partial_bar": None if not live else {"date": live["d"], "last": r2(float(live["c"])),
                                                   "chg_pct": r2((float(live["c"]) / b0["c"] - 1) * 100),
                                                   "note": "UNFINISHED bar: context only, cannot band above WATCH"},
    }


def error_row(t: str, err: SeriesError) -> dict:
    return {"ticker": t, "status": err.status, "bar_complete": False, "error": err.message, **err.detail}


# ---------------------------------------------------------------- entry point
def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter,
                                 allow_abbrev=False)
    ap.add_argument("--tickers", required=True, help="comma-separated, e.g. VEEV,TEAM")
    ap.add_argument("--peers", default="", help="comma-separated peer basket, measured the same way")
    ap.add_argument("--source", choices=("auto", "opend", "yahoo"), default="auto")
    return ap


def run(argv: list[str] | None = None, *, now: Callable[[], dt.datetime] | None = None,
        fetchers: dict[str, Callable[[list[str]], dict[str, list[dict]]]] | None = None,
        reachable: Callable[[], bool] | None = None) -> tuple[int, dict | None]:
    a = build_parser().parse_args(argv)
    now = now or (lambda: dt.datetime.now(ET))
    fetchers = fetchers or {"opend": fetch_opend, "yahoo": fetch_yahoo}
    reachable = reachable or opend_reachable

    names = [t.strip().upper() for t in a.tickers.split(",") if t.strip()]
    peers = [t.strip().upper() for t in a.peers.split(",") if t.strip()]
    wanted = list(dict.fromkeys(["SPY"] + names + peers))

    # Fix the cutoff before any network call: a request that crosses the close must not
    # promote the bar it fetched while the session was still open.
    started = now().astimezone(ET)
    expected = expected_last_completed(started)

    source = a.source
    if source == "auto":
        source = "opend" if reachable() else "yahoo"
    grade = "broker" if source == "opend" else "public"
    try:
        bars = fetchers[source](wanted)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"data source {source} failed: {e}"}), file=sys.stderr)
        return 2, None
    if "SPY" not in bars:
        print(json.dumps({"error": f"no SPY data from {source}"}), file=sys.stderr)
        return 2, None

    doc = {
        "generated_at": now().astimezone(ET).isoformat(timespec="seconds"),
        "acquisition_cutoff_at": started.isoformat(timespec="seconds"),
        "expected_last_completed_session": expected.isoformat(),
        "finalization_minutes": FINALIZE_MINUTES, "calendar": CALENDAR_NOTE,
        "data_source": source, "data_grade": grade,
        "grade_note": ("broker: moomoo OpenD daily bars on this machine" if grade == "broker" else
                       "public: Yahoo Finance daily bars; true RS Rating is absent"),
        "chart_evidence": False,
        "band_cap_without_chart": "WATCH",
        "band_note": "bars are not chart evidence: a ticker whose chart was not captured is capped at WATCH",
    }
    try:
        spy, _ = split_series(bars["SPY"], expected)
        check_fresh_aligned(spy, expected)
    except SeriesError as e:
        doc.update(status="BENCHMARK_" + e.status, spy_last_bar=e.detail.get("last_bar_date"),
                   error=f"SPY unusable, no row is evaluable: {e.message}",
                   rows=[{"ticker": t, "status": "NOT_EVALUATED", "bar_complete": False,
                          "error": "benchmark SPY unusable"} for t in names + peers])
        return 3, doc
    doc["spy_last_bar"] = spy[-1]["d"]

    rows = []
    for t in names + peers:
        role = "peer" if t in peers and t not in names else "subject"
        if t not in bars:
            rows.append({"ticker": t, "role": role, "status": "NO_DATA", "bar_complete": False,
                         "error": f"no data from {source} (delisted, renamed or unknown symbol?)"})
            continue
        try:
            comp, live = split_series(bars[t], expected)
            check_fresh_aligned(comp, expected)
            row = measure(t, comp, spy, live)
        except SeriesError as e:
            row = error_row(t, e)
        except ValueError as e:  # a nonfinite derived value; never emitted as a number
            row = error_row(t, SeriesError("INVALID_DATA", str(e)))
        row["role"] = role
        rows.append(row)
    doc["status"] = "OK"
    doc["all_rows_evaluable"] = all(r["status"] == "OK" for r in rows)
    doc["rows"] = rows
    return 0, doc


def main(argv: list[str] | None = None) -> int:
    code, doc = run(argv)
    if doc is None:
        return code
    try:
        text = json.dumps(doc, indent=1, allow_nan=False)
    except ValueError as e:
        print(json.dumps({"error": f"refusing to emit nonstandard JSON: {e}"}), file=sys.stderr)
        return 4
    print(text)
    return code


if __name__ == "__main__":
    sys.exit(main())
