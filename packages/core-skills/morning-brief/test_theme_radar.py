"""Regression tests for theme_radar's ATR-extension column.

Run either way:
    python -m pytest test_theme_radar.py
    python test_theme_radar.py

Background
----------
On 2026-09-10 theme_radar reported MDB/RBRK/ZS/TOST in the full-size green zone
(+1.35 to +2.09 ATR) while all four were trading BELOW their 21EMA, where
compute_index_technicals put them at -0.17 to -1.28. The extension gate is a hard
sizing rule, so the column promoted four names on the wrong side of the average
to full size.

The cause was not a lost sign. `_metrics` asked OpenD for a 150-calendar-day window
(105 bars) with `max_count=90`. `max_count` caps ONE forward-paginated PAGE, so page 1
returned the OLDEST 90 bars, the `page_req_key` saying more remained was never read,
and `.iloc[-1]` was then treated as "today" - freezing every metric at the 2026-08-19
close, three weeks stale.

`tests/mdb_2026-09-10.json` is a frozen capture of MDB's real bars from that session.
Do not regenerate it to make a failing test pass - the point is that it pins a day
when price sat under the 21EMA.
"""
import json
from datetime import date, timedelta
from pathlib import Path

from compute_index_technicals import analyze, extension_atr
from theme_radar import MAX_STALE_DAYS, SESSIONS_3M, StaleBars, _metrics, zone

FIXTURE = json.loads((Path(__file__).parent / "tests" / "mdb_2026-09-10.json")
                     .read_text(encoding="utf-8"))
BARS = FIXTURE["bars"]
SESSION = date(2026, 9, 10)          # the session the fixture was captured on

HIGHS = [b["high"] for b in BARS]
LOWS = [b["low"] for b in BARS]
CLOSES = [b["close"] for b in BARS]


# --- the sign pin -----------------------------------------------------------
def test_below_21ema_ticker_has_a_negative_extension():
    """MDB closed under its 21EMA on 2026-09-10. The measure must say so."""
    ext = extension_atr(HIGHS, LOWS, CLOSES)
    assert ext is not None
    assert ext < 0, f"expected a negative extension, got {ext:+.4f}"
    assert -1.5 < ext < -0.5, f"expected roughly -1 ATR, got {ext:+.4f}"


def test_a_negative_extension_is_never_the_green_zone():
    """The sizing gate must not promote a name trading under its 21EMA."""
    assert zone(extension_atr(HIGHS, LOWS, CLOSES)) == "HALF-SIZE"
    for ext in (-0.01, -0.6, -1.02, -3.0):
        assert zone(ext) == "HALF-SIZE", f"{ext} must not be tradeable-green"
    assert zone(0.5) == "GREEN" and zone(2.5) == "GREEN"
    assert zone(2.51) == "BLOCKED"
    assert zone(None) == "n/a"


def test_truncating_the_window_is_what_produced_the_false_green():
    """
    The exact 2026-09-10 defect: keep only the first 90 of 105 bars - what
    `max_count=90` actually returned - and the same ticker flips to full-size GREEN.

    This also guards the fixture. If it ever stops flipping, the fixture no longer
    reproduces the bug and the sign pin above has quietly stopped proving anything.
    """
    stale = extension_atr(HIGHS[:90], LOWS[:90], CLOSES[:90])
    assert stale > 0.5 and zone(stale) == "GREEN"
    assert zone(extension_atr(HIGHS, LOWS, CLOSES)) == "HALF-SIZE"


# --- the two tools must agree ----------------------------------------------
def test_theme_radar_and_index_technicals_share_one_implementation():
    """
    theme_radar must not carry a second copy of the measure. Both go through
    compute_index_technicals.extension_atr, so on identical bars they agree
    exactly rather than merely closely.
    """
    import theme_radar

    assert theme_radar.extension_atr is extension_atr
    assert analyze.__module__ == extension_atr.__module__


# --- end to end through _metrics, including OpenD's forward pagination ------
class _FakePage(list):
    """Just enough DataFrame for _history: len() and .to_dict("records")."""

    def to_dict(self, orient):
        assert orient == "records"
        return list(self)


class _FakeCtx:
    """Serves the fixture the way OpenD does: oldest page first, then the rest."""

    def __init__(self, bars, page_size=None):
        self.bars = bars
        self.page_size = page_size or len(bars)
        self.calls = 0

    def request_history_kline(self, code, **kw):
        self.calls += 1
        offset = kw.get("page_req_key") or 0
        page = self.bars[offset:offset + self.page_size]
        nxt = offset + self.page_size
        return (0, _FakePage(page), nxt if nxt < len(self.bars) else None)


def _fetch(bars, page_size=None, today=SESSION):
    ctx = _FakeCtx(bars, page_size)
    return _metrics(ctx, "MDB", "2026-04-13", "2026-09-10", today), ctx


def test_metrics_reports_a_negative_extension_for_a_below_ema_name():
    m, _ = _fetch(BARS)
    assert m is not None
    assert m["ext_atr"] < 0, f"ext_atr must stay signed, got {m['ext_atr']}"
    assert zone(m["ext_atr"]) == "HALF-SIZE"
    assert m["as_of"] == "2026-09-10", "must report the session it actually priced"
    assert m["ext_atr"] == round(extension_atr(HIGHS, LOWS, CLOSES), 2)


def test_metrics_follows_pagination_instead_of_stopping_at_page_one():
    """
    The regression itself. Served 90 bars per page, _metrics must page through to
    all 105 and price the newest session rather than stop at page 1.
    """
    paged, ctx = _fetch(BARS, page_size=90)
    assert ctx.calls > 1, "must follow page_req_key"
    assert paged["as_of"] == "2026-09-10"
    assert paged["ext_atr"] < 0
    whole, _ = _fetch(BARS)
    assert paged == whole, "paged and single-shot reads must be identical"


def test_stopping_at_page_one_would_have_failed_this_suite():
    """A page-1-only feed is stale, so the freshness gate must fail it closed."""
    truncated = BARS[:90]
    assert truncated[-1]["time_key"] == "2026-08-19"
    try:
        _fetch(truncated)
    except StaleBars as exc:
        assert exc.bar_date == "2026-08-19"
        assert exc.age_days > MAX_STALE_DAYS
    else:
        raise AssertionError("stale bars must fail closed, not be reported as today")


def test_fresh_bars_do_not_trip_the_staleness_gate():
    m, _ = _fetch(BARS, today=SESSION)
    assert m is not None
    # a weekend gap is still fresh
    m2, _ = _fetch(BARS, today=SESSION + timedelta(days=3))
    assert m2 is not None


# --- the 3M anchor (Codex audit, 2026-08-12) --------------------------------
def test_m3_uses_an_explicit_63_session_anchor_not_the_window_start():
    """
    `c.iloc[0]` meant "however long the window happens to be" - ~105 sessions, or
    five months, not three. rel_3m gates LEADING/LAGGING, so this is not cosmetic:
    on this fixture the two anchors read 7.27% and 58.21%.
    """
    m, _ = _fetch(BARS)
    expected = round((CLOSES[-1] / CLOSES[-1 - SESSIONS_3M] - 1) * 100, 2)
    window_start = round((CLOSES[-1] / CLOSES[0] - 1) * 100, 2)
    assert m["m3"] == expected
    assert m["m3"] != window_start


def test_returns_are_none_rather_than_wrong_when_history_is_short():
    short = BARS[-30:]          # enough to price, too few for a 63-session anchor
    m, _ = _fetch(short)
    assert m is not None
    assert m["m1"] is not None
    assert m["m3"] is None, "a 3M return must be withheld, never silently rescaled"


if __name__ == "__main__":
    import sys

    tests = [
        value
        for key, value in sorted(globals().items())
        if key.startswith("test_") and callable(value)
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"PASS {test.__name__}")
        except AssertionError as exc:
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)
