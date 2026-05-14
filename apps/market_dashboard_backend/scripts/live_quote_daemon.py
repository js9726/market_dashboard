"""
moomoo OpenD live-quote daemon.

Streams real-time quotes for indices, sector ETFs, and the watchlist from a
locally running moomoo OpenD daemon, throttles to one POST per symbol per
~15 s, and pushes batches to the Vercel-hosted ingest endpoint.

Run while you're trading, e.g.
  python scripts/live_quote_daemon.py

Or schedule via Windows Task Scheduler at 13:25 UTC daily, stopping at 21:00.

Required env (read from repo-root .env or environment):
  LIVE_QUOTE_INGEST_KEY — shared secret matching the Vercel /api/live-quotes/ingest route
  VERCEL_INGEST_URL     — base URL, e.g. https://market-dashboard.vercel.app
  MOOMOO_OPEND_HOST     — defaults to 127.0.0.1
  MOOMOO_OPEND_PORT     — defaults to 11111

Falls back to a noisy stub mode (random walk) when futu SDK or OpenD is
unavailable, so the path can be tested end-to-end without OpenD running.
Stub mode is enabled by passing --stub.
"""
from __future__ import print_function
import argparse
import datetime
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request

# --------------------------------------------------------------------------
# .env loader (mirrors the pattern used by build_data.py / morning_brief.py)
# --------------------------------------------------------------------------

def _load_env():
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.normpath(os.path.join(here, "..", "..", ".."))
    env_path = os.path.join(repo_root, ".env")
    if not os.path.exists(env_path):
        return
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_env()

# --------------------------------------------------------------------------
# Symbol universe
# --------------------------------------------------------------------------

INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"]   # ^VIX handled separately (different futu code)
SECTOR_SYMBOLS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLY", "XLP", "XLU", "XLB", "XLRE", "XLC"]
WATCHLIST = ["NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META",
             "GOOGL", "AMD", "SMCI", "PLTR", "CRWD", "MSTR"]

ALL_SYMBOLS = INDEX_SYMBOLS + SECTOR_SYMBOLS + WATCHLIST


def to_futu_code(sym):
    """Convert plain symbol to futu's US.SPY format."""
    return "US." + sym


# --------------------------------------------------------------------------
# HTTP push
# --------------------------------------------------------------------------

def push_batch(quotes):
    base = os.environ.get("VERCEL_INGEST_URL")
    key = os.environ.get("LIVE_QUOTE_INGEST_KEY")
    if not base or not key:
        print("[push_batch] missing VERCEL_INGEST_URL or LIVE_QUOTE_INGEST_KEY — skipping", flush=True)
        return False
    url = base.rstrip("/") + "/api/live-quotes/ingest"
    body = json.dumps({"quotes": quotes, "mode": "primary"}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            payload = json.loads(r.read().decode("utf-8"))
            print("[push_batch] wrote=%d skipped=%d" % (
                payload.get("written", 0), payload.get("skipped", 0)
            ), flush=True)
            return True
    except urllib.error.HTTPError as e:
        print("[push_batch] HTTP %s: %s" % (e.code, e.read().decode("utf-8", "ignore")[:200]), flush=True)
        return False
    except Exception as e:
        print("[push_batch] error: %s" % e, flush=True)
        return False


# --------------------------------------------------------------------------
# moomoo OpenD client (futu-api)
# --------------------------------------------------------------------------

def run_moomoo(throttle_s):
    try:
        from futu import OpenQuoteContext, RET_OK, SubType
    except ImportError:
        print("[moomoo] futu-api not installed — pip install futu-api", file=sys.stderr)
        return False

    host = os.environ.get("MOOMOO_OPEND_HOST", "127.0.0.1")
    port = int(os.environ.get("MOOMOO_OPEND_PORT", "11111"))

    ctx = OpenQuoteContext(host=host, port=port)
    futu_codes = [to_futu_code(s) for s in ALL_SYMBOLS]
    ret, _ = ctx.subscribe(futu_codes, [SubType.QUOTE])
    if ret != RET_OK:
        print("[moomoo] subscribe failed: %s" % _, file=sys.stderr)
        ctx.close()
        return False

    print("[moomoo] connected to OpenD at %s:%d, subscribed %d symbols" %
          (host, port, len(futu_codes)), flush=True)

    last_push = {}  # symbol -> ts

    try:
        while True:
            ret, df = ctx.get_stock_quote(futu_codes)
            if ret != RET_OK:
                print("[moomoo] get_stock_quote failed: %s" % df, flush=True)
                time.sleep(5)
                continue

            now_ts = time.time()
            now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
            batch = []
            for _, row in df.iterrows():
                code = row["code"]                         # "US.SPY"
                sym = code.split(".", 1)[1] if "." in code else code
                price = float(row["last_price"])
                prev_close = float(row.get("prev_close_price") or 0) or None
                change_pct = None
                if prev_close:
                    change_pct = (price - prev_close) / prev_close * 100.0
                volume = int(row.get("volume") or 0) or None

                last = last_push.get(sym, 0)
                if now_ts - last < throttle_s:
                    continue

                batch.append({
                    "symbol": sym,
                    "price": price,
                    "changePct": change_pct,
                    "volume": volume,
                    "source": "moomoo",
                    "observedAt": now_iso,
                })
                last_push[sym] = now_ts

            if batch:
                push_batch(batch)

            time.sleep(2)  # polling cadence; throttle_s gates push frequency per symbol
    except KeyboardInterrupt:
        print("[moomoo] interrupted", flush=True)
    finally:
        ctx.close()
    return True


# --------------------------------------------------------------------------
# Stub mode (random walk) — for local testing without OpenD
# --------------------------------------------------------------------------

def run_stub(throttle_s):
    print("[stub] random-walk mode for testing", flush=True)
    state = {s: 100.0 + random.uniform(-10, 10) for s in ALL_SYMBOLS}
    while True:
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        batch = []
        for sym in ALL_SYMBOLS:
            state[sym] *= 1 + random.uniform(-0.001, 0.001)
            batch.append({
                "symbol": sym,
                "price": round(state[sym], 4),
                "changePct": round(random.uniform(-2, 2), 3),
                "volume": random.randint(100_000, 5_000_000),
                "source": "moomoo",  # advertise as moomoo so the server treats it as primary
                "observedAt": now_iso,
            })
        push_batch(batch)
        time.sleep(throttle_s)


# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--throttle", type=float, default=15.0,
                        help="min seconds between pushes per symbol")
    parser.add_argument("--stub", action="store_true",
                        help="random-walk mode for testing without OpenD")
    args = parser.parse_args()

    if args.stub:
        run_stub(args.throttle)
        return

    ok = run_moomoo(args.throttle)
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
