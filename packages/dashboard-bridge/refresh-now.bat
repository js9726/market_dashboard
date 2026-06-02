@echo off
REM ============================================================================
REM  refresh-now.bat  —  one-off manual refresh of all dashboard data.
REM  Run this on your PC whenever you notice the dashboard is stale.
REM  It triggers the serverless refresh endpoints (no PC daemon needed),
REM  which recompute server-side and upsert Postgres.
REM
REM  SETUP (once): paste your BRIEF_INGEST_KEY below (from Vercel env or
REM  dashboard-bridge.toml). Windows 10+ ships with curl.
REM ============================================================================

set "KEY=PASTE_YOUR_BRIEF_INGEST_KEY_HERE"
set "BASE=https://market-dashboard-ivory.vercel.app"

if "%KEY%"=="PASTE_YOUR_BRIEF_INGEST_KEY_HERE" (
  echo  ERROR: edit this file and set KEY to your BRIEF_INGEST_KEY first.
  pause & exit /b 1
)

echo.
echo [1/5] Market breadth (advance/decline, highs/lows, sectors)...
curl -s -m 60 "%BASE%/api/breadth/refresh?key=%KEY%"
echo.
echo [2/5] TV screeners + REC A-list...
curl -s -m 60 "%BASE%/api/screeners/refresh?key=%KEY%&force=1"
echo.
echo [3/5] Portfolio quotes (held positions)...
curl -s -m 60 "%BASE%/api/cron/refresh-quotes?secret=%KEY%"
echo.
echo [4/5] A-list HELD seed (from live positions)...
curl -s -m 60 "%BASE%/api/cron/sync-held-alist?secret=%KEY%"
echo.
echo [5/5] A-list day-0..14 path + savings...
curl -s -m 90 "%BASE%/api/cron/track-positions?secret=%KEY%"
echo.
echo ============================================================================
echo  Done. Reload the dashboard — freshness badges should go green.
echo ============================================================================
pause
