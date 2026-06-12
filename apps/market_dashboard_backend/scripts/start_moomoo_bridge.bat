@echo off
setlocal

REM Operator-facing launcher for the real broker bridge.
REM Run this while MooMoo OpenD is logged in and listening on 127.0.0.1:11111.

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..\..") do set "REPO_ROOT=%%~fI"
set "BRIDGE_DIR=%REPO_ROOT%\packages\dashboard-bridge"
set "PYTHON_EXE=%BRIDGE_DIR%\.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
  echo [start_moomoo_bridge] Bridge virtualenv not found:
  echo   %PYTHON_EXE%
  echo.
  echo Run this once first:
  echo   cd /d "%BRIDGE_DIR%"
  echo   install.ps1
  pause
  exit /b 1
)

echo [start_moomoo_bridge] Starting Dashboard Bridge for MooMoo.
echo [start_moomoo_bridge] This syncs positions, fills, equity, and live quotes.
echo [start_moomoo_bridge] Logs also go to %%USERPROFILE%%\.dashboard-bridge.log
echo.

cd /d "%BRIDGE_DIR%"
"%PYTHON_EXE%" -m bridge run

echo.
echo [start_moomoo_bridge] Bridge exited with code %ERRORLEVEL%.
pause
