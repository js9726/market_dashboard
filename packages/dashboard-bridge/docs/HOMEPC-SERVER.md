# Home PC Server — always-on backend for free, live data

**Goal:** run the data engine continuously on your Home PC so the dashboard has
**live** data without paying for cloud compute. The PC is the *engine*; Vercel
(free Hobby) + Postgres (free tier) are just the *display + storage*.

```
            HOME PC (always on)                          CLOUD (free)
  ┌─────────────────────────────────────────┐     ┌──────────────────────────┐
  │ moomoo OpenD  ─┐                         │     │  Vercel (Hobby)          │
  │ IB Gateway    ─┤ live quotes (primary +  │ ──> │  - serves dashboard      │
  │                │  IBKR fallback)         │push │  - /api/*/ingest + refresh│
  │ dashboard-bridge daemon (python -m bridge)│     │  - cron = DAILY backstop │
  │   • live quotes  → /api/live-quotes/ingest│     │  Postgres (Neon/Vercel   │
  │   • breadth+scr  → /api/{breadth,screeners}/refresh   free tier)          │
  │   • fills/pos/eq → /api/bridge/sync       │     └──────────────────────────┘
  │ + refresh-pinger task (every 10 min)      │
  │ + watchdogs: OpenD :11111, IB Gateway     │
  └─────────────────────────────────────────┘
```

Why this is the answer to "free + live": Vercel **Hobby** crons run *once per day*
and are capped (~2). They're fine as a daily safety net, but **live intraday data
must be pushed/triggered from an always-on machine** — your PC. No Vercel Pro
($20/mo) needed.

---

## Prerequisites (one-time)

- Python 3.11 + the bridge venv (already at `packages/dashboard-bridge/.venv`).
- **moomoo OpenD** running (port 11111) — primary live source.
- **IB Gateway** (or TWS) running with the API enabled — the fallback source.
- `BRIEF_INGEST_KEY` + `LIVE_QUOTE_INGEST_KEY` from Vercel env, in your
  `dashboard-bridge.toml`.
- [NSSM](https://nssm.cc) (`choco install nssm` or download) — turns the daemon
  into an auto-restarting Windows service.

---

## Step 1 — Configure the bridge (`dashboard-bridge.toml`)

Copy `dashboard-bridge.example.toml` → `dashboard-bridge.toml` and set:

```toml
[dashboard]
base_url = "https://market-dashboard-ivory.vercel.app"
brief_ingest_key = "..."        # from Vercel env
live_quote_ingest_key = "..."

[sync]
interval_sec = 60               # push live quotes every 60s
live_quote_key = "moomoo"
live_quote_extras = ["SPY","QQQ","IWM","DIA","VIX","SMH","XLK","NVDA"]  # always-fresh refs
breadth_post_close = true
breadth_post_close_time = "16:33"
breadth_timezone = "America/New_York"

[fallback]                      # NEW — IBKR when OpenD rate-limits (Step 4)
ibkr_enabled = true
ibkr_host = "127.0.0.1"
ibkr_port = 4001                # 4001 live Gateway / 4002 paper / 7496 TWS live / 7497 paper
ibkr_client_id = 17
```

## Step 2 — Run the daemon as an auto-restarting service (NSSM)

```powershell
$Root = "C:\Users\jiesh\AI codes hub\market_dashboard\packages\dashboard-bridge"
nssm install MarketBridge "$Root\.venv\Scripts\python.exe" "-m bridge"
nssm set MarketBridge AppDirectory "$Root"
nssm set MarketBridge AppStdout "$Root\logs\bridge.out.log"
nssm set MarketBridge AppStderr "$Root\logs\bridge.err.log"
nssm set MarketBridge AppExit Default Restart      # auto-restart on crash
nssm set MarketBridge AppRestartDelay 5000
nssm set MarketBridge Start SERVICE_AUTO_START     # start on boot
nssm start MarketBridge
```
Survives reboots + crashes. Logs to `logs\`. (Alternative without NSSM: Task
Scheduler trigger "At startup" + "Restart every 1 min if it stops".)

## Step 3 — Refresh-pinger (the LIVE intraday driver) + watchdogs

The bridge pushes live *quotes* every 60s and triggers *breadth* post-close. To
get **intraday breadth + screeners live** (the part Hobby cron can't do), add a
scheduled task that curls the refresh endpoints every 10 min during market hours:

```powershell
# refresh-pinger.ps1 — every 10 min, 09:00–17:00 ET (Mon–Fri)
$BASE = "https://market-dashboard-ivory.vercel.app"
$KEY  = $env:BRIEF_INGEST_KEY
"refresh-screeners","cron/refresh-breadth" | ForEach-Object {
  try { Invoke-RestMethod "$BASE/api/$_?key=$KEY&secret=$KEY" -TimeoutSec 60 } catch {}
}
```
Register it: Task Scheduler → trigger **every 10 minutes**, only on weekdays.
This makes your **PC** drive the live cadence (free), independent of Vercel crons.

**Watchdogs** (Task Scheduler, every 5 min) keep the data sources alive:
```powershell
# opend-watchdog.ps1
if (-not (Test-NetConnection 127.0.0.1 -Port 11111 -WarningAction SilentlyContinue).TcpTestSucceeded) {
  Start-Process "C:\moomoo\OpenD\moomoo_OpenD.exe"   # adjust path
}
# IB Gateway: use IBC (IBController) for auto-login + auto-restart — https://github.com/IbcAlpha/IBC
```

## Step 4 — IBKR live-quote fallback (when OpenD rate-limits)

Add `bridge/ibkr_quotes.py` (uses `ib_insync` → your local IB Gateway). The
quote loop tries OpenD first; on error/rate-limit it falls back to IBKR, then
yfinance last.

```python
# bridge/ibkr_quotes.py  —  pip install ib_insync
from ib_insync import IB, Stock

def fetch_ibkr_quotes(symbols, host="127.0.0.1", port=4001, client_id=17):
    """Return {symbol: {"price","change_pct","volume"}} from IB Gateway.
    symbols: bare US tickers e.g. ['NVDA','HUT']. Requires a US market-data sub
    on the account for real-time (else delayed). No-op if Gateway is down."""
    ib = IB()
    out = {}
    try:
        ib.connect(host, port, clientId=client_id, timeout=8)
        tickers = [ib.reqMktData(Stock(s, "SMART", "USD"), "", False, False) for s in symbols]
        ib.sleep(2)  # let snapshots populate
        for s, t in zip(symbols, tickers):
            last = t.last if t.last == t.last else t.close  # NaN-safe
            if last and last == last:
                prev = t.close
                out[s] = {
                    "price": float(last),
                    "change_pct": round((last/prev - 1) * 100, 2) if prev else None,
                    "volume": int(t.volume) if t.volume == t.volume else None,
                    "source": "ibkr",
                }
    except Exception as e:
        print(f"[ibkr] fallback unavailable: {e}")
    finally:
        ib.disconnect()
    return out
```

Wire it into the existing live-quote step (`bridge/live_quotes.py`):
```python
quotes = fetch_opend_quotes(symbols)                 # primary
missing = [s for s in symbols if s not in quotes]    # rate-limited / errored
if missing and cfg.ibkr_enabled:
    quotes.update(fetch_ibkr_quotes(missing, port=cfg.ibkr_port))   # fallback
# (optional) anything still missing → yfinance EOD
```
Then POST the merged `quotes` to `/api/live-quotes/ingest` as today. Each row
already carries a `source` field, so the dashboard shows `moomoo` vs `ibkr`.

> **IBKR market-data note:** real-time US quotes need a market-data subscription
> on the account (the US Securities Snapshot bundle is cheap/often waived for
> funded accounts; otherwise you get *delayed*). The official **IBKR↔Claude
> connector** (which we verified works) is a separate, read-only convenience for
> in-chat analysis — the *backend* fallback uses IB Gateway directly as above.

## Step 5 — Verify

- `Get-Service MarketBridge` → Running; `logs\bridge.out.log` shows pushes.
- Dashboard freshness badges (Portfolio, Market Breadth) go green and stay <15 min.
- Kill OpenD briefly → confirm quotes keep flowing tagged `source: ibkr`.

---

## Cost-free architecture (what's free, what isn't)

| Layer | Free option | Paid trap to avoid |
|---|---|---|
| Compute / scheduler | **Home PC** (NSSM service + Task Scheduler) | Vercel **Pro** crons ($20/mo) — not needed |
| Hosting / display | Vercel **Hobby** (free) | — |
| Database | **Neon** or Vercel Postgres free tier | paid DB before you need it |
| Live quotes | **OpenD** (moomoo, free) + **IBKR** fallback | paid quote APIs |
| Breadth / screeners | **TradingView scanner** (free) | paid data vendors |
| AI brief / scoring | **Claude via subscription** (`CLAUDE_CODE_OAUTH_TOKEN`, not metered API) + DeepSeek (cheap) + Gemini free tier | metered Claude/OpenAI API tokens |
| Market-data realtime | IBKR snapshot bundle (often waived) / moomoo / delayed-free | per-quote streaming fees |

**Rule of thumb:** keep *compute + scheduling + live data* on the always-on Home
PC (free, you already own it), keep *display + storage* on free cloud tiers, and
drive AI from your **subscription** not metered API tokens. The only thing the
cloud cron needs to do is be a once-daily safety net — your PC does the live work.

**Reliability (defense-in-depth):** Home-PC bridge (primary, live) → Vercel Hobby
daily cron (backstop) → optional free external uptime cron (cron-job.org hitting
`/api/breadth/refresh?key=…`) for when the PC is off. No single point of failure,
$0/mo.
