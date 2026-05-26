@echo off
REM Start the moomoo OpenD live-quote daemon.
REM Double-click this file, or schedule it in Windows Task Scheduler
REM (Trigger: At log on / Daily at 13:25 UTC; Action: Start a program; Program: this .bat)

REM Make sure OpenD is running first. If it isn't, this will print errors
REM but the daemon will retry indefinitely.

cd /d "%~dp0.."

echo [start_live_quote_daemon] Starting live_quote_daemon.py ...
echo [start_live_quote_daemon] Logs will scroll in this window. Ctrl+C to stop.
echo.

python scripts\live_quote_daemon.py

REM If the daemon exits (network drop, OpenD restart), pause so the window
REM stays open and you can read the error message before it closes.
echo.
echo [start_live_quote_daemon] Daemon exited with code %ERRORLEVEL%.
pause
