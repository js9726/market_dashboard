# Market Dashboard Backend Scripts

This folder is the operator-facing script area: things you can double-click or
run from PowerShell while the dashboard is deployed on Vercel.

The live broker sync implementation lives in `packages/dashboard-bridge`.
These backend BAT files are wrappers so you do not need to remember that package
path.

## What To Run

MooMoo / OpenD continuous sync:

```powershell
apps\market_dashboard_backend\scripts\start_moomoo_bridge.bat
```

This calls:

```powershell
packages\dashboard-bridge\.venv\Scripts\python.exe -m bridge run
```

It syncs MooMoo positions, fills, account equity, and live quotes when
`~\.config\dashboard-bridge.toml` has `live_quote_key`.

IBKR continuous sync:

```powershell
apps\market_dashboard_backend\scripts\start_ibkr_bridge.bat
```

This calls:

```powershell
packages\dashboard-bridge\.venv\Scripts\python.exe ibkr_bridge.py --run
```

It syncs IBKR positions, fills, and account equity while IB Gateway or TWS is
logged in and API access is enabled.

## Legacy Scripts

The Python scripts in `scripts/` are still useful for market data builds,
screeners, breadth, and morning brief generation.

The old standalone quote-only daemon was removed. Use `start_moomoo_bridge.bat`,
because the bridge is the complete path that syncs broker positions, fills,
equity, held-position quotes, and market breadth into the dashboard database.

`scripts\start_live_quote_daemon.bat` is kept as a backward-compatible shortcut.
It forwards to `start_moomoo_bridge.bat`.

## Local Config

The bridge reads:

```text
%USERPROFILE%\.config\dashboard-bridge.toml
```

That file is local-only and contains secrets. Do not commit it.

Useful logs:

```text
%USERPROFILE%\.dashboard-bridge.log
%USERPROFILE%\.ibkr-bridge.log
%USERPROFILE%\.opend-watchdog.log
```
