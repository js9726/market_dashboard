"""
TradingView screener fetcher + DeepSeek auto-scorer.

Runs each screener defined in `tv-screeners.json` against the unofficial
scanner.tradingview.com endpoint. Optionally calls DeepSeek to score the top
N hits per screener (cheap, ~40 calls/day total at top-10).

Outputs:
  data/tv_screeners.json — { fetched_at, screeners: [ { id, name, hits[] } ] }

Usage:
  python apps/market_dashboard_backend/scripts/tv_screener_fetch.py [--out-dir data] [--score] [--score-top 10]

Notes:
  - Saved-screener IDs (1R7JpXRD etc.) are NOT directly fetchable by URL.
    The query is approximated in tv-screeners.json — refine it whenever you
    notice a mismatch with what your real TV screener returns.
  - DeepSeek scoring is opt-in via --score flag. Skipped silently if
    DEEPSEEK_API_KEY missing.
  - If ALL screeners return zero hits (TradingView blocking CI IPs), the
    script exits without overwriting the output file so stale-but-valid data
    is preserved rather than replaced with empty rows.
"""
from __future__ import print_function
import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

# Shared JSON safety helpers — keep bare NaN out of browser-facing files.
from build_data import sanitize_json, safe_json_dumps  # noqa: E402


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
            key, value = key.strip(), value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value

_load_env()


SCANNER_URL = "https://scanner.tradingview.com/america/scan"

# Browser-like headers to reduce the chance of IP-based blocking in CI.
# TradingView's scanner API is public but blocks known cloud provider IPs.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Content-Type": "application/json",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}

_MAX_RETRIES = 3
_RETRY_DELAY = 5  # seconds


def fetch_screener(screener_cfg: dict, columns: list) -> list:
    """Returns list of hit dicts: {ticker, columns mapped by name}.

    Retries up to _MAX_RETRIES times on transient errors (429, 5xx).
    Returns [] on permanent rejection (403) or connection error.
    """
    body = dict(screener_cfg["query"])
    body["columns"] = columns
    payload = json.dumps(body).encode("utf-8")

    for attempt in range(1, _MAX_RETRIES + 1):
        req = urllib.request.Request(
            SCANNER_URL,
            data=payload,
            method="POST",
            headers=HEADERS,
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                data = json.loads(r.read().decode("utf-8"))
            hits = []
            for row in data.get("data", []):
                symbol = row.get("s", "")  # e.g. "NASDAQ:NVDA"
                ticker = symbol.split(":", 1)[1] if ":" in symbol else symbol
                d = row.get("d", [])
                mapped = {col: (d[i] if i < len(d) else None) for i, col in enumerate(columns)}
                hits.append({
                    "ticker": ticker,
                    "exchange": symbol.split(":", 1)[0] if ":" in symbol else None,
                    **mapped,
                })
            if not hits:
                print(f"[tv:{screener_cfg['id']}] WARNING: 0 hits returned (attempt {attempt})")
            return hits
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", "ignore")[:300]
            code = e.code
            print(f"[tv:{screener_cfg['id']}] HTTP {code} on attempt {attempt}: {msg[:120]}")
            if code == 403:
                # Permanent block — don't retry
                print(f"[tv:{screener_cfg['id']}] 403 Forbidden — TradingView is blocking this IP. "
                      "Skipping screener.")
                return []
            if attempt < _MAX_RETRIES and code in (429, 500, 502, 503, 504):
                wait = _RETRY_DELAY * attempt
                print(f"[tv:{screener_cfg['id']}] Retrying in {wait}s…")
                time.sleep(wait)
                continue
            return []
        except Exception as e:
            print(f"[tv:{screener_cfg['id']}] error on attempt {attempt}: {e}")
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY)
                continue
            return []
    return []


# --------------------------------------------------------------------------
# DeepSeek auto-scorer
# --------------------------------------------------------------------------

def _deepseek_score(ticker: str, hit: dict) -> dict | None:
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        return None
    payload = {
        "model": "deepseek-chat",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a momentum-style trader screening a setup. Output strict JSON with shape: "
                    '{"score": 0-100, "verdict": "GO"|"WAIT"|"PASS", "thesis": "1 sentence reason"}.\n'
                    "Score >= 80 → GO. 50-79 → WAIT. <50 → PASS.\n"
                    "Apply Minervini/Qullamaggie filters: prefer A-grade trend (price > rising MAs), "
                    "high RVOL, near pivot or fresh breakout, sector strength."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Score {ticker}.\n"
                    f"Price: {hit.get('close')}\n"
                    f"Change today: {hit.get('change')}%\n"
                    f"RVOL: {hit.get('relative_volume_10d_calc')}\n"
                    f"Perf 1W: {hit.get('Perf.W')}%\n"
                    f"Perf 1M: {hit.get('Perf.1M')}%\n"
                    f"Sector: {hit.get('sector')}\n"
                    f"Industry: {hit.get('industry')}\n"
                    f"Market cap: {hit.get('market_cap_basic')}\n"
                    "Return ONLY the JSON object."
                ),
            },
        ],
        "max_tokens": 300,
        "temperature": 0.1,
    }
    req = urllib.request.Request(
        "https://api.deepseek.com/v1/chat/completions",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode("utf-8"))
        text = data["choices"][0]["message"]["content"].strip()
        if text.startswith("```"):
            lines = text.splitlines()
            text = "\n".join(l for l in lines if not l.strip().startswith("```"))
        return json.loads(text)
    except Exception as e:
        print(f"[tv:score] {ticker}: {e}")
        return None


def score_top(hits: list, n: int) -> None:
    """Mutate hits[:n] to add 'score' / 'verdict' / 'thesis'."""
    for i, hit in enumerate(hits[:n]):
        result = _deepseek_score(hit["ticker"], hit)
        if result:
            hit["score"] = result.get("score")
            hit["verdict"] = result.get("verdict")
            hit["thesis"] = result.get("thesis")
        time.sleep(0.5)  # polite


# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="data")
    parser.add_argument("--config", default=None,
                        help="Path to tv-screeners.json (default: alongside this script)")
    parser.add_argument("--score", action="store_true",
                        help="Auto-score top N hits per screener with DeepSeek")
    parser.add_argument("--score-top", type=int, default=10,
                        help="Number of top hits to auto-score per screener (default: 10)")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)

    config_path = args.config or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "tv-screeners.json"
    )
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    columns = config.get("columns_to_fetch", [])
    screeners_out = []
    total_hits = 0

    for sc in config["screeners"]:
        print(f"[tv] fetching {sc['id']}…")
        hits = fetch_screener(sc, columns)
        print(f"[tv] {sc['id']}: {len(hits)} hits")
        total_hits += len(hits)
        if args.score and hits:
            print(f"[tv] scoring top {args.score_top} of {sc['id']} with DeepSeek…")
            score_top(hits, args.score_top)
        screeners_out.append({
            "id": sc["id"],
            "name": sc["name"],
            "tv_url": sc.get("tv_url"),
            "hits": hits,
        })

    # Safety guard: if ALL screeners returned 0 hits, TradingView is almost
    # certainly blocking this IP. Don't overwrite the output — preserve the
    # last good data so the dashboard shows something real.
    if total_hits == 0:
        print(
            "[tv] WARNING: ALL screeners returned 0 hits. "
            "TradingView is likely blocking this IP (common in CI). "
            "Output file NOT overwritten — stale data preserved."
        )
        sys.exit(1)  # non-zero so CI shows a visible failure (continue-on-error still masks it)

    out = {
        "fetched_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "scored": bool(args.score),
        "score_top": args.score_top if args.score else 0,
        "screeners": screeners_out,
    }
    out_path = os.path.join(args.out_dir, "tv_screeners.json")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(sanitize_json(out), indent=2, default=str))
    print(f"[tv] wrote {out_path} ({total_hits} total hits, top {args.score_top} scored per screener)")


if __name__ == "__main__":
    main()
