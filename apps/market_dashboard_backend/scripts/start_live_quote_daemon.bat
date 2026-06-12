@echo off
REM Backward-compatible launcher.
REM This used to run the legacy quote-only daemon. It now starts the proper
REM dashboard bridge, which syncs MooMoo positions, fills, equity, and live
REM quotes to the Vercel dashboard when the config has live_quote_key.

call "%~dp0start_moomoo_bridge.bat"
