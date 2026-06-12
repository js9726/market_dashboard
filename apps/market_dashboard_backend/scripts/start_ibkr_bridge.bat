@echo off
setlocal

REM Operator-facing launcher for the IBKR bridge.
REM Run this while IB Gateway/TWS is logged in and API access is enabled.

set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..\..\..") do set "REPO_ROOT=%%~fI"
set "BRIDGE_DIR=%REPO_ROOT%\packages\dashboard-bridge"
set "PYTHON_EXE=%BRIDGE_DIR%\.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
  echo [start_ibkr_bridge] Bridge virtualenv not found:
  echo   %PYTHON_EXE%
  echo.
  echo Run this once first:
  echo   cd /d "%BRIDGE_DIR%"
  echo   install.ps1 -UseExistingConfig
  pause
  exit /b 1
)

echo [start_ibkr_bridge] Starting Dashboard Bridge for IBKR.
echo [start_ibkr_bridge] This syncs IBKR positions, fills, and equity.
echo [start_ibkr_bridge] Logs also go to %%USERPROFILE%%\.ibkr-bridge.log
echo.

cd /d "%BRIDGE_DIR%"
"%PYTHON_EXE%" ibkr_bridge.py --run

echo.
echo [start_ibkr_bridge] Bridge exited with code %ERRORLEVEL%.
pause
