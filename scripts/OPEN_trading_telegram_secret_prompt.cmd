@echo off
title JsTradingDeskBot secure local provisioning
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch_trading_telegram_provisioner.ps1"
echo.
pause
