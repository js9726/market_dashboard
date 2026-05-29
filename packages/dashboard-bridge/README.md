# Dashboard Bridge

Local Python daemon that syncs your moomoo OpenD positions and trade fills to the Market Dashboard cloud.

## What it does

```
┌────────────────────┐         ┌──────────────────────┐         ┌───────────────────┐
│  moomoo OpenD      │ ◄─SDK── │  dashboard-bridge    │ ──HTTPS► │  /api/bridge/sync │
│  127.0.0.1:11111   │         │  (this package)      │         │  (Vercel)         │
└────────────────────┘         └──────────────────────┘         └───────────────────┘
```

Every 60 seconds (default), the bridge:
1. Pulls your current positions from moomoo OpenD
2. Pulls trade fills since last sync
3. Posts both to your dashboard via authenticated HTTPS
4. Pushes live quotes for held tickers + configured watch tickers when `live_quote_key` is set
5. Triggers market breadth once per US trading day after the close when `brief_ingest_key` is set

The dashboard then surfaces live P&L in `/dashboard/portfolio`.

## Prerequisites

- **Python 3.10+**
- **moomoo OpenD** running on the same machine (`127.0.0.1:11111`)
- **Bridge token** from your dashboard
  - Go to `/dashboard/settings/brokers`
  - Click "Generate token" — save the plaintext, it's shown once
- **Broker account** registered in your dashboard
  - Use `/dashboard/settings/brokers` → "+ Add account"
  - Pick the matching broker preset (e.g. "moomoo (Malaysia)")
  - Note the **alias** you give it — the bridge config references it by name

## Install (Windows)

```powershell
cd "C:\Users\$env:USERNAME\AI codes hub\market_dashboard\packages\dashboard-bridge"
.\install.ps1
```

The installer:
1. Creates a virtualenv in `.venv/`
2. Installs `moomoo-api` and `requests`
3. Prompts you for: dashboard URL, bridge token, broker account alias
4. Writes `~/.config/dashboard-bridge.toml`
5. Registers a Windows scheduled task that runs the bridge at login + every 5 minutes

To uninstall:

```powershell
.\uninstall.ps1
```

## Manual run (for testing)

```powershell
.\.venv\Scripts\python.exe -m bridge run
```

Logs go to `~/.dashboard-bridge.log`.

## Configuration

`~/.config/dashboard-bridge.toml`:

```toml
[dashboard]
url = "https://market-dashboard-ivory.vercel.app"
token = "mdb_<your-token-here>"
# Optional. Store secrets here or use env vars instead:
# live_quote_key = "<LIVE_QUOTE_INGEST_KEY>"
# brief_ingest_key = "<BRIEF_INGEST_KEY>"

[broker]
# Must match a UserBrokerAccount.alias on your dashboard
account_alias = "moomoo Malaysia"
# Broker type for diagnostics
type = "MOOMOO_FUTUMY"

[opend]
host = "127.0.0.1"
port = 11111
# Real moomoo account ID (not paper)
acc_id = 286260077786655984
security_firm = "FUTUMY"
market = "US"

[sync]
# Polling interval in seconds
interval_sec = 60
# Fetch fills since N days ago on each sync (broker dedup will skip duplicates)
fill_lookback_days = 1
live_quote_extras = "SPY,QQQ,IWM,DIA,SMH,XLK,NVDA,CRDO,ARM,MRVL"
breadth_post_close = true
breadth_post_close_time = "16:33"
breadth_timezone = "America/New_York"
```

`brief_ingest_key` can also be supplied as `DASHBOARD_BRIDGE_BRIEF_INGEST_KEY` or `BRIEF_INGEST_KEY`.
`live_quote_key` can also be supplied as `DASHBOARD_BRIDGE_LIVE_QUOTE_KEY`.

Force a one-off breadth refresh:

```powershell
.\.venv\Scripts\python.exe -m bridge breadth
```

## Security notes

- **Token is sensitive** — chmod 600 the TOML file on Unix; ACL-restrict on Windows.
- Token is sent over HTTPS only.
- Each request includes a timestamp; the dashboard rejects requests >5min off server time (replay protection).
- Tokens are revokable from the dashboard — revoked tokens stop syncing immediately on next call.
- The bridge NEVER places trades. It only reads positions/fills.

## Troubleshooting

**`Could not connect to OpenD`**:
Make sure moomoo OpenD is running and that it's on the configured `host:port`. Default is `127.0.0.1:11111`.

**`Invalid or revoked token`**:
Regenerate from `/dashboard/settings/brokers` and update the TOML file.

**`No active broker account with alias 'X'`**:
The `account_alias` in your TOML must match an existing alias in the dashboard. Check `/dashboard/settings/brokers`.

**`Timestamp drift Ns exceeds tolerance`**:
Your system clock is off. Sync via `w32tm /resync` (Windows) or NTP.
