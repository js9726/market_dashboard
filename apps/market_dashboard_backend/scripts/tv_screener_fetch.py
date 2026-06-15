"""
TradingView screener fetcher + 4-stage DeepSeek scorer.

Runs each screener defined in `tv-screeners.json` against the unofficial
scanner.tradingview.com endpoint. Optionally calls DeepSeek to score the top
N hits per screener using the Conviction model (Setup/40 + Entry/30 + Theme/20 + Sentiment/10) from the LLM Traders Wiki:

  Stage 1 — Trend Leadership (RS)   : Is this a true market leader?
  Stage 2 — Pattern Quality          : VCP / EP / pullback — how clean?
  Stage 3 — Entry Timing             : Can we enter safely TODAY?
  Stage 4 — Risk Quality             : Institutional grade, volume, stop distance

Scores are pre-computed deterministically in Python (from Minervini/Qullamaggie/
Alex/Jeff/SRx rules embedded from the wiki) and passed to DeepSeek for sector
context + thesis. The LLM cannot hallucinate past the Python-computed caps.

Outputs:
  data/tv_screeners.json — { fetched_at, screeners: [ { id, name, hits[] } ] }

Usage:
  python scripts/tv_screener_fetch.py [--out-dir data] [--score] [--score-top 10]

CI TradingView IP-block workaround:
  Set TV_SESSION_ID env var (or GitHub Secret) to your TradingView sessionid
  cookie value. Authenticated requests bypass the IP block.
  Get it from: Chrome → DevTools → Application → Cookies → tradingview.com → sessionid
  Add as GitHub Secret → referenced in workflow as TV_SESSION_ID.

Notes:
  - Saved-screener IDs (1R7JpXRD etc.) are NOT directly fetchable by URL.
    The query is approximated in tv-screeners.json — refine whenever needed.
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

def _build_headers() -> dict:
    """
    Build request headers for the TradingView scanner.

    TV_SESSION_ID workaround for CI IP blocks
    -----------------------------------------
    TradingView blocks known cloud-provider IPs (GitHub Actions uses Azure
    ranges). Authenticated requests bypass this. To enable:

    1. Log into TradingView in Chrome.
    2. Open DevTools → Application → Cookies → tradingview.com → sessionid
    3. Copy the value.
    4. Add it as GitHub Secret TV_SESSION_ID in your repo Settings.
    5. Reference it in both workflow files:
         env:
           TV_SESSION_ID: ${{ secrets.TV_SESSION_ID }}

    The session expires every 30-90 days — you will need to refresh it.
    When it expires, the script falls back to the anonymous (likely blocked)
    path and the zero-hit guard preserves the last good data.
    """
    headers = {
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
    session_id = os.environ.get("TV_SESSION_ID", "").strip()
    if session_id:
        headers["Cookie"] = f"sessionid={session_id}"
        print("[tv] Using TV_SESSION_ID cookie for authenticated request")
    else:
        print("[tv] No TV_SESSION_ID set — using anonymous request (may be blocked in CI)")
    return headers

HEADERS = _build_headers()

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
# 4-Stage scoring engine (wiki-derived, Python-deterministic)
# --------------------------------------------------------------------------
#
# Rules are extracted from the LLM Traders Wiki and embedded here so they
# work both in CI (no wiki access) and locally. The 4 stages mirror the
# trader frameworks used in the trade-analyser skill:
#
#  Stage 1 — Trend Leadership / RS
#    Source: Minervini SEPA trend template, Steve Jacobs "97 Club", Alex's RS
#    composite, Qullamaggie breakout scan (top 1-2% RS over 1/3/6 months).
#    Rule: Only stocks in top RS quartile qualify for GO. Negative-1M stocks
#    are Stage 4 downtrends — avoid unless there's a fresh EP catalyst.
#
#  Stage 2 — Pattern Quality
#    Source: Minervini VCP (tight base after strong move), Qullamaggie EP
#    (10%+ gap, neglected before, huge vol), SRxTrades breakout/MA-pullback,
#    Alex 21dma pullback (0-1x ATR from 21ema, earnings 7+ days away).
#    Rule: Best patterns are VCP (1M 10-40%, 1W tight, RVOL > 2) or EP
#    (today > 10%, 1M < 30%, RVOL > 3). Parabolic or very-extended = low.
#
#  Stage 3 — Entry Timing
#    Source: Jeff Sun LoD < 60% ATR rule; Qullamaggie ORH trigger with
#    LOD stop; SRxTrades "first green 30M candle" entry; Alex first-hour
#    or last-30-min entry.
#    Rule: Today's move > 20% = gap-day, entry risk high; > 30% = PASS.
#    Best entry window = 3-15% move with clear pullback structure forming.
#
#  Stage 4 — Risk Quality
#    Source: Jeff Sun RVOL > 100% required; Alex $10B+ liquid leaders,
#    $250M+ daily liquidity; Qullamaggie avoids >30% overnight; all traders
#    require stop < 1-1.5x ATR.
#    Rule: RVOL < 1 = no institutional confirmation = avoid. Mcap < $300M
#    = thin, fade-prone. Mcap > $1B + RVOL > 2 = institutional grade.

def _compute_stages(hit: dict, market_sentiment: float = 6.0) -> dict:
    """
    Deterministic Conviction sub-scores from screener data (2026-06-15 model;
    see wiki/trader-styles.md "Conviction Scoring Model").

        Conviction = Setup/40 + Entry/30 + Theme/20 + Sentiment/10  (0-100)
        GO >= 75, WAIT 50-74, PASS < 50.

    The screener row lacks ADR / true RS Rating / EMA structure, so Setup, Entry
    and Theme are approximated from pattern + RVOL + perf + market cap. Sentiment
    is a market-regime input (neutral default 6) the caller / LLM layer overlays.
    The 7 personas inform the Setup score; they are not averaged.
    """
    perf_1m       = float(hit.get("Perf.1M") or 0)
    perf_1w       = float(hit.get("Perf.W")  or 0)
    chg_day       = float(hit.get("change")  or 0)
    rvol          = float(hit.get("relative_volume_10d_calc") or 0)
    mcap          = float(hit.get("market_cap_basic")         or 0)
    high_d        = float(hit.get("high")             or 0)
    low_d         = float(hit.get("low")              or 0)
    close_d       = float(hit.get("close")            or 0)
    premarket_chg = float(hit.get("premarket_change") or 0)

    # Pattern classification (feeds the Setup score)
    is_ep        = chg_day > 8 and perf_1m < 15 and rvol > 2.5
    is_breakout  = 3 < chg_day < 20 and 8 < perf_1m < 50 and rvol > 1.5
    is_pullback  = abs(chg_day) < 5 and perf_1m > 5 and rvol >= 0.8
    is_parabolic = perf_1m > 70 or (chg_day > 25 and perf_1m > 30)
    is_stage4    = perf_1m < -15

    # -- Setup /40: proven setup that works + cleanliness + volume confirmation --
    if   is_parabolic: setup = 6     # no clean base / chase
    elif is_stage4:    setup = 8     # downtrend, EP-bounce only
    elif is_ep:        setup = 32
    elif is_breakout:  setup = 30
    elif is_pullback:  setup = 26
    else:              setup = 14    # unclear
    if   rvol >= 3: setup += 6
    elif rvol >= 2: setup += 3
    elif rvol < 1:  setup -= 6       # no volume confirmation
    if   perf_1m > 80: setup -= 8    # extended / late base
    elif perf_1m > 60: setup -= 4
    setup = max(0, min(40, setup))

    # -- Entry /30: trigger / timing readiness + premarket fade + close strength --
    if   abs(chg_day) > 30: entry = 3
    elif abs(chg_day) > 20: entry = 7
    elif abs(chg_day) > 15: entry = 12
    elif abs(chg_day) > 10: entry = 18
    elif abs(chg_day) > 5:  entry = 27   # ideal clean-entry range
    elif abs(chg_day) > 1:  entry = 22
    else:                   entry = 13
    if is_ep and rvol >= 3 and 10 <= abs(chg_day) <= 25:
        entry = max(entry, 24)           # for a true EP the gap IS the trigger
    if premarket_chg > 5 and chg_day >= 0:
        fade = premarket_chg - chg_day
        if   fade > 25: entry -= 8
        elif fade > 15: entry -= 6
    if high_d > low_d > 0 and close_d > 0 and abs(chg_day) > 5:
        if (high_d - low_d) / close_d > 0.02:
            cs = (close_d - low_d) / (high_d - low_d)
            if   cs < 0.35: entry -= 6   # bottom-third close = distribution
            elif cs < 0.50: entry -= 3
    entry = max(0, min(30, entry))

    # -- Theme /20: leadership (perf_1m RS proxy) + institutional tradeability --
    if   perf_1m > 80: rs_part = 5       # parabolic, topping risk
    elif perf_1m > 50: rs_part = 9
    elif perf_1m > 25: rs_part = 14
    elif perf_1m > 10: rs_part = 12
    elif perf_1m > 2:  rs_part = 8
    elif perf_1m > -5: rs_part = 5
    elif perf_1m > -20: rs_part = 3
    else:              rs_part = 1
    if   mcap >= 10e9:  mcap_part = 6
    elif mcap >= 2e9:   mcap_part = 5
    elif mcap >= 500e6: mcap_part = 3
    elif mcap >= 300e6: mcap_part = 2
    else:               mcap_part = 0
    theme = min(20, rs_part + mcap_part)

    # -- Sentiment /10: market regime / event gate (caller-supplied; neutral=6) --
    sentiment = max(0, min(10, market_sentiment))

    total = round(setup + entry + theme + sentiment)
    return {
        "setup":     round(setup),
        "entry":     round(entry),
        "theme":     round(theme),
        "sentiment": round(sentiment),
        "raw":       total,
        "pattern": (
            "PARABOLIC"     if is_parabolic else
            "EP"            if is_ep        else
            "BREAKOUT"      if is_breakout  else
            "PULLBACK"      if is_pullback  else
            "STAGE4-BOUNCE" if is_stage4    else
            "UNCLEAR"
        ),
    }


def _deepseek_score(ticker: str, hit: dict) -> dict | None:
    """
    Call DeepSeek to add sector/industry context and write the thesis.
    The 4-stage sub-scores are pre-computed in Python — DeepSeek cannot
    override them, only adjust the composite score by ±5 per stage based
    on sector context it knows and we do not.
    """
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        return None

    stages = _compute_stages(hit)
    raw    = stages["raw"]   # deterministic baseline 0-100

    # Build a compact stage block for the LLM
    stage_block = (
        f"Conviction sub-scores (Python-deterministic, do NOT change more than ±5 each):\n"
        f"  Setup     : {stages['setup']}/40  [{stages['pattern']}]\n"
        f"  Entry     : {stages['entry']}/30\n"
        f"  Theme     : {stages['theme']}/20\n"
        f"  Sentiment : {stages['sentiment']}/10\n"
        f"  Conviction total : {raw}/100\n"
    )

    perf_1m       = float(hit.get("Perf.1M") or 0)
    perf_1w       = float(hit.get("Perf.W")  or 0)
    chg_day       = float(hit.get("change")  or 0)
    rvol          = float(hit.get("relative_volume_10d_calc") or 0)
    high_d        = float(hit.get("high")             or 0)
    low_d         = float(hit.get("low")              or 0)
    close_d       = float(hit.get("close")            or 0)
    premarket_chg = float(hit.get("premarket_change") or 0)

    # Build candle quality line for the LLM
    if high_d > low_d > 0 and close_d > 0:
        close_strength = (close_d - low_d) / (high_d - low_d)
        candle_line = (
            f"Candle: O={hit.get('open','?'):.2f} H={high_d:.2f} L={low_d:.2f} C={close_d:.2f} "
            f"| Close strength: {close_strength:.2f} (0=LoD, 1=HoD)"
        ) if isinstance(hit.get('open'), (int, float)) else (
            f"Candle: H={high_d:.2f} L={low_d:.2f} C={close_d:.2f} "
            f"| Close strength: {close_strength:.2f} (0=LoD, 1=HoD)"
        )
    else:
        candle_line = "Candle: intraday range unavailable"
        close_strength = None

    premarket_line = (
        f"Premarket: {premarket_chg:+.1f}% | Fade from premarket: {premarket_chg - chg_day:.1f}pp"
        if premarket_chg != 0 else "Premarket: no data"
    )

    payload = {
        "model": "deepseek-chat",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a disciplined momentum trader scoring setups using a 4-stage framework "
                    "(Minervini SEPA + Qullamaggie EP/Breakout + Alex 21dma pullback + SRxTrades/Jeff volume rules).\n\n"
                    "The Conviction sub-scores (Setup/40, Entry/30, Theme/20, Sentiment/10) were computed in Python using wiki rules. Your job:\n"
                    "1. Review the stage scores and adjust the composite ±5 TOTAL based on sector "
                    "context, industry tailwind/headwind, or contradictions you know about.\n"
                    "2. Translate the composite into GO (>=75) / WAIT (50-74) / PASS (<50).\n"
                    "3. Write a 1-sentence thesis (max 25 words) naming the setup type and the key risk.\n\n"
                    'Output ONLY this JSON (no markdown): '
                    '{"score":<int 0-100>,"verdict":"GO"|"WAIT"|"PASS","thesis":"<text>","stages":{'
                    '"setup":<int>,"entry":<int>,"theme":<int>,"sentiment":<int>}}'
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Ticker: {ticker}\n"
                    f"Sector: {hit.get('sector', 'N/A')} | Industry: {hit.get('industry', 'N/A')}\n"
                    f"Price: ${close_d:.2f} | Today: {chg_day:+.1f}% | "
                    f"1W: {perf_1w:+.1f}% | 1M: {perf_1m:+.1f}%\n"
                    f"RVOL: {rvol:.2f} | MCap: ${(hit.get('market_cap_basic') or 0)/1e9:.1f}B\n"
                    f"{candle_line}\n"
                    f"{premarket_line}\n\n"
                    f"{stage_block}\n"
                    "Does the sector/industry context change any stage score? "
                    "Adjust composite (±5 max total) and write thesis."
                ),
            },
        ],
        "max_tokens": 250,
        "temperature": 0.0,
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
            text = "\n".join(ln for ln in lines if not ln.strip().startswith("```"))
        result = json.loads(text)
        # Merge stages from Python computation (authoritative) with LLM output
        result["stages"] = {
            "setup":     result.get("stages", {}).get("setup",     stages["setup"]),
            "entry":     result.get("stages", {}).get("entry",     stages["entry"]),
            "theme":     result.get("stages", {}).get("theme",     stages["theme"]),
            "sentiment": result.get("stages", {}).get("sentiment", stages["sentiment"]),
        }
        result["pattern"] = stages["pattern"]
        return result
    except Exception as e:
        print(f"[tv:score] {ticker}: {e}")
        # Fall back to Python-only score without thesis
        verdict = "GO" if raw >= 75 else "WAIT" if raw >= 50 else "PASS"
        return {
            "score":   raw,
            "verdict": verdict,
            "thesis":  f"{stages['pattern']} setup; scored without LLM context.",
            "stages":  {k: stages[k] for k in ("setup","entry","theme","sentiment")},
            "pattern": stages["pattern"],
        }


def algo_score_all(hits: list) -> None:
    """
    Mutate ALL hits with deterministic 4-stage scores (free, no API call).
    Sets score_source="algorithmic" so the dashboard can show a confidence badge.
    Always runs — even without --score — so intraday refreshes never lose scores.
    """
    for hit in hits:
        stages = _compute_stages(hit)
        hit["score"]        = stages["raw"]
        hit["verdict"]      = (
            "GO"   if stages["raw"] >= 75 else
            "WAIT" if stages["raw"] >= 50 else
            "PASS"
        )
        hit["thesis"]       = f"{stages['pattern']} setup; algorithmic score only."
        hit["stages"]       = {
            "setup":     stages["setup"],
            "entry":     stages["entry"],
            "theme":     stages["theme"],
            "sentiment": stages["sentiment"],
        }
        hit["pattern"]      = stages["pattern"]
        hit["score_source"] = "algorithmic"


def score_top(hits: list, n: int) -> None:
    """
    Mutate hits[:n] — upgrades algorithmic scores to DeepSeek AI scores.
    algo_score_all() must have already run so every hit has a baseline score.
    DeepSeek can adjust the composite ±5 per stage and add a real thesis.
    Sets score_source="deepseek" on hits it successfully upgrades.
    """
    for hit in hits[:n]:
        result = _deepseek_score(hit["ticker"], hit)
        if result:
            hit["score"]        = result.get("score")
            hit["verdict"]      = result.get("verdict")
            hit["thesis"]       = result.get("thesis")
            hit["stages"]       = result.get("stages")   # {setup, entry, theme, sentiment}
            hit["pattern"]      = result.get("pattern")  # EP / BREAKOUT / PULLBACK / PARABOLIC / …
            hit["score_source"] = "deepseek"
        time.sleep(0.6)  # polite — DeepSeek rate limit


# --------------------------------------------------------------------------

def push_alist_candidates(screeners_out: list) -> None:
    """POST screener hits that clear the A-list bar (score>=80, verdict GO,
    rvol>=1.5x) to the dashboard so the REC lane populates. This is THE feed for
    the recommended A-list — the morning brief does not carry per-ticker
    score+RVOL. No-op unless DASHBOARD_URL + BRIEF_INGEST_KEY are set. Idempotent
    on the ingest side (upsert by pickDate+ticker)."""
    base = os.environ.get("DASHBOARD_URL") or os.environ.get("DASHBOARD_BASE_URL")
    key = os.environ.get("BRIEF_INGEST_KEY")
    if not base or not key:
        print("[tv:alist] DASHBOARD_URL / BRIEF_INGEST_KEY not set — skipping REC A-list push")
        return

    pattern_to_setup = {
        "EP": "EP-FRESH", "BREAKOUT": "BO-CB", "PULLBACK": "PB-21EMA", "PARABOLIC": "PARABOLIC",
    }
    best: dict = {}
    for sc in screeners_out:
        for hit in sc.get("hits", []):
            ticker = (hit.get("ticker") or "").upper()
            verdict = (hit.get("verdict") or "").upper()
            try:
                score = int(round(float(hit.get("score"))))
            except (TypeError, ValueError):
                continue
            rvol_raw = hit.get("relative_volume_10d_calc")
            rvol = float(rvol_raw) if rvol_raw is not None else None
            if not ticker or score < 75 or verdict != "GO" or rvol is None or rvol < 1.5:
                continue
            cand = {
                "ticker": ticker,
                "day0Score": score,
                "day0Verdict": verdict,
                "day0Rvol": rvol,
                "day0Thesis": hit.get("thesis"),
                "setupClassification": pattern_to_setup.get((hit.get("pattern") or "").upper(), hit.get("pattern")),
                "screenSource": sc.get("id"),
                "day0Price": hit.get("close"),
            }
            if ticker not in best or score > best[ticker]["day0Score"]:
                best[ticker] = cand

    candidates = list(best.values())
    if not candidates:
        print("[tv:alist] no screener hits cleared the A-list bar (>=80 / GO / >=1.5x)")
        return

    pick_date = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    payload = json.dumps({"pickDate": pick_date, "candidates": candidates}).encode("utf-8")
    url = base.rstrip("/") + "/api/a-list/ingest"
    req = urllib.request.Request(
        url, data=payload, method="POST",
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            resp = json.loads(r.read().decode("utf-8"))
        print(f"[tv:alist] pushed {len(candidates)} REC candidate(s): "
              f"inserted={resp.get('inserted')} updated={resp.get('updated')}")
    except Exception as e:
        print(f"[tv:alist] REC push failed (non-fatal): {e}")


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

    # Determine if the US equity market was open when this fetch ran.
    # NYSE regular session: Mon-Fri 09:30-16:00 ET.
    try:
        import zoneinfo
        _et = zoneinfo.ZoneInfo("America/New_York")
    except Exception:
        import pytz  # fallback for older Python/CI images
        _et = pytz.timezone("America/New_York")
    _now_et = datetime.datetime.now(_et)
    _market_was_open = (
        _now_et.weekday() < 5
        and datetime.time(9, 30) <= _now_et.time() <= datetime.time(16, 0)
    )

    deepseek_scored_at = None  # set below only when DeepSeek runs

    for sc in config["screeners"]:
        print(f"[tv] fetching {sc['id']}…")
        hits = fetch_screener(sc, columns)
        print(f"[tv] {sc['id']}: {len(hits)} hits")
        total_hits += len(hits)

        if hits:
            # Always apply free algorithmic scoring — never skip this step.
            # This ensures intraday refreshes always have scores even without --score.
            algo_score_all(hits)

            if args.score:
                print(f"[tv] upgrading top {args.score_top} of {sc['id']} to DeepSeek AI scores…")
                score_top(hits, args.score_top)

        screeners_out.append({
            "id": sc["id"],
            "name": sc["name"],
            "tv_url": sc.get("tv_url"),
            "hits": hits,
        })

    if args.score:
        deepseek_scored_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

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
        # True only when DeepSeek AI upgraded the algorithmic scores.
        "scored": bool(args.score),
        "score_top": args.score_top if args.score else 0,
        # Timestamp of the last DeepSeek pass (null when algorithmic-only).
        "deepseek_scored_at": deepseek_scored_at,
        # Whether the US equity market was open when this data was fetched.
        # Drives the confidence level shown on the dashboard:
        #   True  → intraday prices; scores age quickly (recheck every 30 min)
        #   False → EOD/pre-market prices; scores remain valid until next session
        "market_was_open": _market_was_open,
        "screeners": screeners_out,
    }
    out_path = os.path.join(args.out_dir, "tv_screeners.json")
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(sanitize_json(out), indent=2, default=str))
    score_label = (
        f"DeepSeek top {args.score_top} + algo all"
        if args.score else
        "algo all (no DeepSeek)"
    )
    print(f"[tv] wrote {out_path} ({total_hits} total hits, {score_label}, market_open={_market_was_open})")

    # Populate the dashboard's REC A-list lane from screener hits that clear the bar.
    push_alist_candidates(screeners_out)


if __name__ == "__main__":
    main()
