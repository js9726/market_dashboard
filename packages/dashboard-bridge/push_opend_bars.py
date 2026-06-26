"""
push_opend_bars.py — P2 local bridge: pull authoritative daily OHLCV bars from
moomoo OpenD for the dashboard's tracked A-list tickers and push them to
/api/a-list/bars-ingest. The track-positions cron then computes MFE/MAE/stops
from the broker's own price basis instead of the cloud Yahoo/Stooq fallback.

Run (OpenD must be running locally):
    INGEST_KEY=<BRIEF_INGEST_KEY> python push_opend_bars.py

Env:
    INGEST_KEY   (required) — the dashboard BRIEF_INGEST_KEY
    DASH_URL     default https://market-dashboard-ivory.vercel.app
    OPEND_HOST   default 127.0.0.1
    OPEND_PORT   default 11111
    OPEND_MARKET default US  (symbol prefix, e.g. US.MU)
    BARS_DAYS    default 120
    MAX_TICKERS  default 0 (= all)
    THROTTLE_S   default 1.1 (stay under OpenD's history-kline rate limit)
"""
from __future__ import annotations
import os, sys, json, time, datetime, urllib.request

DASH = os.environ.get("DASH_URL", "https://market-dashboard-ivory.vercel.app")
KEY = os.environ.get("INGEST_KEY", "")
HOST = os.environ.get("OPEND_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPEND_PORT", "11111"))
MARKET = os.environ.get("OPEND_MARKET", "US")
DAYS = int(os.environ.get("BARS_DAYS", "120"))
MAX_TICKERS = int(os.environ.get("MAX_TICKERS", "0"))
THROTTLE_S = float(os.environ.get("THROTTLE_S", "1.1"))


def _get(url: str):
    with urllib.request.urlopen(urllib.request.Request(url), timeout=30) as r:
        return json.loads(r.read().decode())


def _post(url: str, body: dict):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def main() -> int:
    if not KEY:
        print("ERROR: set INGEST_KEY env (the dashboard BRIEF_INGEST_KEY)")
        return 2
    try:
        from moomoo import OpenQuoteContext, RET_OK, KLType, AuType
    except Exception as e:  # noqa: BLE001
        print("ERROR: moomoo SDK import failed:", e)
        return 2

    tickers = _get(f"{DASH}/api/a-list/bars-ingest?key={KEY}").get("tickers", [])
    if MAX_TICKERS > 0:
        tickers = tickers[:MAX_TICKERS]
    print(f"tracked tickers to pull: {len(tickers)}")
    if not tickers:
        return 0

    ctx = OpenQuoteContext(host=HOST, port=PORT)
    end = datetime.date.today()
    start = end - datetime.timedelta(days=DAYS)
    bars: dict[str, list] = {}
    ok, fail = 0, []
    try:
        for t in tickers:
            sym = f"{MARKET}.{t}"
            try:
                ret, data, _ = ctx.request_history_kline(
                    sym, start=start.strftime("%Y-%m-%d"), end=end.strftime("%Y-%m-%d"),
                    ktype=KLType.K_DAY, autype=AuType.QFQ, max_count=300,
                )
                if ret != RET_OK or data is None or len(data) == 0:
                    fail.append(t)
                else:
                    rows = []
                    for _, r in data.iterrows():
                        rows.append({
                            "date": str(r["time_key"])[:10],
                            "open": float(r["open"]), "high": float(r["high"]),
                            "low": float(r["low"]), "close": float(r["close"]),
                            "volume": float(r["volume"]),
                        })
                    bars[t] = rows
                    ok += 1
            except Exception as e:  # noqa: BLE001
                fail.append(t)
                print(f"  {t}: {e}")
            time.sleep(THROTTLE_S)
    finally:
        ctx.close()

    print(f"pulled: {ok} ok, {len(fail)} failed{' ' + str(fail[:10]) if fail else ''}")
    if bars:
        res = _post(f"{DASH}/api/a-list/bars-ingest?key={KEY}", {"source": "opend", "bars": bars})
        print("ingest:", res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
