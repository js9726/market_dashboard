# IBKR Bridge Setup

Step-by-step guide for connecting your Interactive Brokers account to the Market Dashboard via the `ibkr_bridge.py` adapter.

---

## Prerequisites

- Python 3.10+ already installed (same Python used for the MooMoo bridge)
- The dashboard-bridge venv already set up (`install.ps1` has been run at least once)
- Your dashboard URL and bridge token (from `/dashboard/settings/brokers`)
- IB Gateway downloaded and installed (see Step 1 below)

---

## Step 1 — Download and install IB Gateway

IB Gateway is the lightweight API-only version of TWS. Recommended over full TWS for automation.

1. Go to https://www.interactivebrokers.com/en/index.php?f=16457
2. Download **IB Gateway** (not TWS) for your platform.
   - Windows: `ibgateway-stable-standalone-windows-x64.exe`
3. Run the installer. Accept defaults.
4. Launch IB Gateway from the Start menu.

> Alternatively you can use TWS (ports 7496 live / 7497 paper). IB Gateway is lighter
> and recommended for the bridge. The bridge is read-only and never places orders.

---

## Step 2 — Enable API access in IB Gateway

1. Log in to IB Gateway with your IBKR credentials.
   - Use **Paper Trading** login for testing, **Live** login when ready.
2. In the IB Gateway menu bar go to **Configure → Settings**.
3. Select **API → Settings** in the left panel.
4. Check **Enable ActiveX and Socket Clients**.
5. Set **Socket port**:
   - Paper: `4002` (recommended default for the bridge)
   - Live:  `4001`
6. Under **Trusted IP Addresses** click **+** and add `127.0.0.1`.
7. Uncheck **Read-Only API** if it is ticked — the bridge does not trade, but IBKR's
   read-only mode can block accountSummary calls on some versions.
   (Alternatively, leave Read-Only on; the bridge only calls read endpoints.)
8. Click **OK** / **Apply**.

IB Gateway must remain open while the bridge is running.

---

## Step 3 — Create the IBKR broker account in the dashboard

1. Open your dashboard at `/dashboard/settings/brokers`.
2. Click **+ Add account**.
3. Choose broker preset **IBKR** (or "Interactive Brokers").
4. Set the **alias** to exactly `IBKR main` (or any alias you prefer — you will put
   the same value in the config file in the next step).
5. Click **Save**.

The alias must match `account_alias` in `[ibkr]` in your config file exactly
(case-sensitive).

---

## Step 4 — Install ib_async

The IBKR adapter requires an IBKR client library. Use **`ib_async`** — the
maintained fork of ib_insync that works on Python 3.12+/3.14. (The legacy
`ib_insync` crashes on *import* under modern Python: its `eventkit` dependency
calls the removed `asyncio.get_event_loop_policy()`.) Install into the existing
dashboard-bridge venv:

```powershell
cd "C:\Users\$env:USERNAME\AI codes hub\market_dashboard\packages\dashboard-bridge"
.\.venv\Scripts\python.exe -m pip install ib_async
```

> `ib_async` is also listed in `requirements.txt`, so re-running `install.ps1 -UseExistingConfig`
> picks it up automatically. The adapter still falls back to `ib_insync` if that's
> what you have on an older Python.

---

## Step 5 — Add the [ibkr] section to your config

Open `~\.config\dashboard-bridge.toml` (the same file used by the MooMoo bridge) and
append the following section, adjusting values to match your setup:

```toml
[ibkr]
host = "127.0.0.1"
port = 4002                  # 4002 = IB Gateway paper; 4001 = live; 7497 = TWS paper; 7496 = TWS live
client_id = 10               # any unused integer 1–32
account_alias = "IBKR main"  # must match Step 3 exactly
broker_type = "IBKR"
fill_lookback_days = 1
```

The `[dashboard]` and `[sync]` sections are already present from the MooMoo setup
and are reused — no changes needed there.

---

## Step 6 — Dry run (verify connection)

With IB Gateway running and logged in:

```powershell
cd "C:\Users\$env:USERNAME\AI codes hub\market_dashboard\packages\dashboard-bridge"
.\.venv\Scripts\python.exe ibkr_bridge.py
```

Expected output (no data posted):

```
2026-06-04 09:00:00 INFO bridge.ibkr_adapter: Connecting to IB Gateway at 127.0.0.1:4002 (clientId=10)
2026-06-04 09:00:01 INFO ibkr_bridge: Fetched 3 positions, 5 fills, equity=$965.42 USD from IBKR
2026-06-04 09:00:01 INFO ibkr_bridge: Dry run — not posting to dashboard.
2026-06-04 09:00:01 INFO ibkr_bridge: Broker alias: IBKR main | brokerType: IBKR
2026-06-04 09:00:01 INFO ibkr_bridge: Sample position: {'ticker': 'AAPL', 'qty': 10.0, ...}
```

If you see `ConnectionRefusedError`: IB Gateway is not running or the port is wrong.
If you see `No [ibkr] section found`: the config file is missing the `[ibkr]` block.

---

## Step 7 — One-shot sync (POST to dashboard)

```powershell
.\.venv\Scripts\python.exe ibkr_bridge.py --post
```

Then open `/dashboard/portfolio` — your IBKR positions should appear under the
"IBKR main" account.

---

## Step 8 — Backfill historical fills (optional)

To import older fills (e.g. the last 3 months) into the dashboard's fill history
for net-realised P&L calculations:

```powershell
# Dry run first — writes ibkr_backfill.json
.\.venv\Scripts\python.exe ibkr_bridge.py --backfill --months 3

# Inspect the file, then POST to the dashboard
.\.venv\Scripts\python.exe ibkr_bridge.py --backfill --months 3 --post
```

> IBKR's `reqExecutions` API returns up to 7 days per call. The backfill walks
> backwards in 7-day windows — expect it to take a few seconds per month of history.
> The dashboard deduplicates on `brokerFillId` (= IBKR `execId`) so re-running
> is safe.

---

## Step 9 — Run as a polling loop

For continuous syncing (same as the MooMoo bridge):

```powershell
.\.venv\Scripts\python.exe ibkr_bridge.py --run
```

This polls every `sync.interval_sec` seconds (default 60). To run both MooMoo
and IBKR bridges simultaneously, open two PowerShell windows (or register a
second scheduled task — see below).

---

## Registering a Windows scheduled task (optional)

To run the IBKR bridge automatically at login alongside the MooMoo bridge:

```powershell
$BridgeDir = "C:\Users\$env:USERNAME\AI codes hub\market_dashboard\packages\dashboard-bridge"
$VenvPython = "$BridgeDir\.venv\Scripts\python.exe"
$TaskName = "DashboardBridgeIBKR"

$action = New-ScheduledTaskAction `
    -Execute $VenvPython `
    -Argument "ibkr_bridge.py --run" `
    -WorkingDirectory $BridgeDir

$triggerLogin = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$triggerRecurring = New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 365)

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -MultipleInstances IgnoreNew `
    -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) `
    -Hidden

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Description "Syncs IBKR positions and fills to Market Dashboard" `
    -Action $action `
    -Trigger @($triggerLogin, $triggerRecurring) `
    -Settings $settings `
    -Principal $principal

Start-ScheduledTask -TaskName $TaskName
```

Logs go to `~\.ibkr-bridge.log` (separate from the MooMoo bridge's log).

To unregister:
```powershell
Unregister-ScheduledTask -TaskName "DashboardBridgeIBKR" -Confirm:$false
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `ConnectionRefusedError` at connect | IB Gateway / TWS is not running, or wrong port. Check port in Configure → Settings → API. |
| `clientId already in use` | Another process is using the same `client_id`. Change `client_id` in config (try 11, 12, …). |
| `No [ibkr] section found` | Add `[ibkr]` block to `~/.config/dashboard-bridge.toml` (see Step 5). |
| `No active broker account with alias 'IBKR main'` | The alias in config does not match the alias in `/dashboard/settings/brokers` (case-sensitive). |
| `Invalid or revoked token` | Regenerate the bridge token from `/dashboard/settings/brokers`. |
| Equity snapshot missing | IB Gateway may need a moment after login to populate account data. Wait 30 s and retry. |
| 0 fills returned | IBKR fills() only returns executions from the current session. Use `--backfill` for history. |
| `ib_insync` import error | Run `pip install ib_insync` in the venv (see Step 4). |

---

## Security notes

- The bridge is **read-only** (`readonly=True` in `ib.connect()`). It cannot place orders.
- The bridge token is sent over HTTPS only.
- Each request includes a timestamp; the dashboard rejects requests > 5 min off server time.
- Keep `dashboard-bridge.toml` private — it contains your bridge token.
  On Windows: `icacls "$env:USERPROFILE\.config\dashboard-bridge.toml" /inheritance:r /grant:r "$env:USERNAME:F"`
- IB Gateway should only allow `127.0.0.1` as a trusted IP (configured in Step 2).
