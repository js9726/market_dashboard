@echo off
REM ============================================================================
REM Pre-market daily routine (run via Windows Task Scheduler at 09:00 ET / 13:00 UTC).
REM
REM Steps (in order):
REM   1. Refresh TV screener cache (with DeepSeek scoring for top 8 per screener)
REM   2. Push screener picks to /dashboard/screener-history (operators: JS, XX)
REM   3. Breadth scan via OpenD on mcap>$2B universe (~13 min @ 1.9 req/s)
REM   4. Sync data into Next.js public folder
REM   5. Generate Claude-tab morning brief (optional — needs OpenD live data)
REM
REM Pre-requisites:
REM   - moomoo OpenD running locally (start_live_quote_daemon.bat keeps it alive)
REM   - .env / .env.local has DEEPSEEK_API_KEY, BRIEF_INGEST_KEY, VERCEL_INGEST_URL
REM
REM Schedule:
REM   Trigger: Daily at 13:00 UTC (= 09:00 ET = 21:00 MYT)
REM   Action:  Start a program → this .bat file
REM   Settings: "If task fails, restart every 5 min, attempt up to 3 times"
REM ============================================================================

set REPO_ROOT=C:\Users\jiesh\AI codes hub\market_dashboard
set BACKEND=%REPO_ROOT%\apps\market_dashboard_backend
set FRONTEND=%REPO_ROOT%\apps\market_dashboard
set WIKI=C:\Users\jiesh\AI codes hub\llm_traders_wiki
set LOG=%BACKEND%\data\_premarket_routine.log

echo. >> "%LOG%"
echo ============================================================ >> "%LOG%"
echo [premarket-routine] starting %date% %time% >> "%LOG%"
echo ============================================================ >> "%LOG%"

REM ── Step 1: TV screener fetch + DeepSeek score ──────────────────────────────
echo. >> "%LOG%"
echo [step 1/5] tv_screener_fetch >> "%LOG%"
cd /d "%BACKEND%"
python scripts\tv_screener_fetch.py --out-dir data --score --score-top 8 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [step 1/5] FAILED >> "%LOG%"
  goto :error
)

REM ── Step 2: Push picks to /dashboard/screener-history (JS + XX) ─────────────
echo. >> "%LOG%"
echo [step 2/5] push_screener_picks >> "%LOG%"
cd /d "%WIKI%"
python scripts\push_screener_picks.py --post --journal-user JS --min-score 60 >> "%LOG%" 2>&1
python scripts\push_screener_picks.py --post --journal-user XX --min-score 60 >> "%LOG%" 2>&1

REM ── Step 3: Breadth scan via TradingView screener API (free, ~2 sec) ────────
REM Replaces the OpenD path because moomoo free tier caps history-kline calls
REM at ~80/day. TradingView's bulk screener endpoint returns 2700+ tickers
REM with sector/SMA/perf pre-computed in one request, no auth, no rate limit.
echo. >> "%LOG%"
echo [step 3/5] breadth_scan_tv >> "%LOG%"
cd /d "%BACKEND%"
python scripts\breadth_scan_tv.py --out-dir data >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [step 3/5] FAILED — continuing anyway >> "%LOG%"
)

REM ── Step 4: Sync to Next.js public folder ───────────────────────────────────
echo. >> "%LOG%"
echo [step 4/5] sync to public folder >> "%LOG%"
cd /d "%FRONTEND%"
call npm run sync:market >> "%LOG%" 2>&1

REM ── Step 5: Morning brief (DeepSeek tab, fastest path) ──────────────────────
REM Path A (Claude tab) needs to be triggered from Claude CLI / Codex CLI manually.
REM Path B (DeepSeek tab) is fully automated.
echo. >> "%LOG%"
echo [step 5/5] morning brief (DeepSeek tab) >> "%LOG%"
cd /d "%REPO_ROOT%\packages\core-skills\morning-brief"
python cli_run.py --provider deepseek --post >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [premarket-routine] completed %date% %time% >> "%LOG%"
exit /b 0

:error
echo [premarket-routine] aborted on error %date% %time% >> "%LOG%"
exit /b 1
