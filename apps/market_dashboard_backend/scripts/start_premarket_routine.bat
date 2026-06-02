@echo off
REM ============================================================================
REM Pre-market daily routine (run via Windows Task Scheduler at 09:00 ET / 13:00 UTC).
REM
REM Steps (in order):
REM   1. Build market snapshot (indices, VIX, RVOL/theme source data)
REM   2. Refresh TV screener cache (with DeepSeek scoring for top 8 per screener)
REM   3. Push screener picks to /dashboard/screener-history (operators: JS, XX)
REM   4. Breadth scan via TradingView bulk scanner
REM   5. Sync data into Next.js public folder
REM   6. Generate DeepSeek-tab morning brief
REM
REM Pre-requisites:
REM   - .env / .env.local has DEEPSEEK_API_KEY, BRIEF_INGEST_KEY, VERCEL_INGEST_URL
REM   - TV_SESSION_ID is optional but helps avoid TradingView IP/session blocks
REM
REM Schedule:
REM   Trigger: Daily at 13:00 UTC (= 09:00 ET = 21:00 MYT)
REM   Action:  Start this .bat file
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

REM Step 1: market data snapshot. This must run before sync:market or VIX,
REM indices, RVOL, Theme Radar, and Rotation can remain stale locally.
echo. >> "%LOG%"
echo [step 1/6] build_data snapshot >> "%LOG%"
cd /d "%BACKEND%"
python scripts\build_data.py --out-dir data >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [step 1/6] FAILED >> "%LOG%"
  goto :error
)

REM Step 2: TV screener fetch + DeepSeek score.
echo. >> "%LOG%"
echo [step 2/6] tv_screener_fetch >> "%LOG%"
cd /d "%BACKEND%"
python scripts\tv_screener_fetch.py --out-dir data --score --score-top 8 >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [step 2/6] FAILED >> "%LOG%"
  goto :error
)

REM Step 3: Push scored screener picks to the dashboard history.
echo. >> "%LOG%"
echo [step 3/6] push_screener_picks >> "%LOG%"
cd /d "%WIKI%"
python scripts\push_screener_picks.py --post --journal-user JS --min-score 60 >> "%LOG%" 2>&1
python scripts\push_screener_picks.py --post --journal-user XX --min-score 60 >> "%LOG%" 2>&1

REM Step 4: breadth scan via TradingView screener API.
echo. >> "%LOG%"
echo [step 4/6] breadth_scan_tv >> "%LOG%"
cd /d "%BACKEND%"
python scripts\breadth_scan_tv.py --out-dir data >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [step 4/6] FAILED - continuing anyway >> "%LOG%"
)

REM Step 5: sync generated data into the Next.js public folder.
echo. >> "%LOG%"
echo [step 5/6] sync to public folder >> "%LOG%"
cd /d "%FRONTEND%"
call npm run sync:market >> "%LOG%" 2>&1
if errorlevel 1 (
  echo [step 5/6] FAILED >> "%LOG%"
  goto :error
)

REM Step 6: Morning brief (DeepSeek tab, fastest automated path).
echo. >> "%LOG%"
echo [step 6/6] morning brief (DeepSeek tab) >> "%LOG%"
cd /d "%REPO_ROOT%\packages\core-skills\morning-brief"
python cli_run.py --provider deepseek --post >> "%LOG%" 2>&1

echo. >> "%LOG%"
echo [premarket-routine] completed %date% %time% >> "%LOG%"
exit /b 0

:error
echo [premarket-routine] aborted on error %date% %time% >> "%LOG%"
exit /b 1
