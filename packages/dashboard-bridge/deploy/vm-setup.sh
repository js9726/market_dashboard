#!/usr/bin/env bash
# ============================================================================
#  Market Dashboard — always-on ENGINE on a Linux VM (Ubuntu 22.04 x86_64)
#  Runs headless:  moomoo OpenD  +  IB Gateway (via IBC)  +  dashboard-bridge
#  + a refresh scheduler. Pushes live data to the free cloud app (Vercel/Neon).
#
#  Recommended host: Hetzner CX22 (2 vCPU / 4 GB, ~$5/mo, x86). Oracle ARM free
#  tier works too BUT can't run OpenD (x86-only) — keep OpenD on your home PC then.
#
#  Read-only by design: IB Gateway API is enabled in READ-ONLY mode (no order
#  routing). OpenD is quote/position only here.
#
#  EDIT every <PLACEHOLDER> before running. Paste section-by-section the first
#  time so you can confirm each service comes up.
# ============================================================================
set -euo pipefail

DASH_BASE="https://market-dashboard-ivory.vercel.app"
BRIEF_INGEST_KEY="<PASTE_BRIEF_INGEST_KEY>"
REPO_SSH="git@github.com:js9726/market_dashboard.git"
APP="$HOME/market_dashboard"
BR="$APP/packages/dashboard-bridge"

# ── 1. Base packages (Python, Java for IB Gateway, Xvfb virtual display) ────
sudo apt-get update
sudo apt-get install -y python3-venv python3-pip git curl unzip xvfb \
     openjdk-17-jre-headless x11vnc fonts-dejavu

# ── 2. Repo + bridge venv (+ ib_insync for the IBKR fallback) ───────────────
[ -d "$APP" ] || git clone "$REPO_SSH" "$APP"
cd "$BR"
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt ib_insync
deactivate

# ── 3. moomoo OpenD (Linux x86, headless) ───────────────────────────────────
#  Download the Linux OpenD from moomoo (https://www.moomoo.com/download/OpenAPI),
#  unzip to ~/opend, then create OpenD.xml with your login + trade unlock pwd.
mkdir -p "$HOME/opend"
cat > "$HOME/opend/OpenD.xml" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<root>
  <login_account><PASTE_MOOMOO_ACCOUNT></login_account>
  <login_pwd_md5><PASTE_PWD_MD5></login_pwd_md5>
  <api_port>11111</api_port>
  <lang>en</lang>
</root>
XML
sudo tee /etc/systemd/system/opend.service >/dev/null <<UNIT
[Unit]
Description=moomoo OpenD
After=network-online.target
[Service]
ExecStart=$HOME/opend/moomoo_OpenD -cfg_file=$HOME/opend/OpenD.xml
Restart=always
RestartSec=10
User=$USER
[Install]
WantedBy=multi-user.target
UNIT

# ── 4. IB Gateway + IBC (headless auto-login + auto-restart) ────────────────
#  Install IB Gateway (offline installer) + IBC (https://github.com/IbcAlpha/IBC).
#  Configure config.ini: IbLoginId/IbPassword, TradingMode=live, ReadOnlyApi=yes,
#  OverrideTwsApiPort=4001. IBC handles the daily re-login + restart.
sudo tee /etc/systemd/system/ibgateway.service >/dev/null <<UNIT
[Unit]
Description=IB Gateway via IBC (headless)
After=network-online.target
[Service]
Environment=DISPLAY=:1
ExecStartPre=/usr/bin/Xvfb :1 -screen 0 1024x768x24 -nolisten tcp &
ExecStart=$HOME/ibc/gatewaystart.sh
Restart=always
RestartSec=20
User=$USER
[Install]
WantedBy=multi-user.target
UNIT

# ── 5. Bridge config (OpenD primary, IBKR fallback, read-only) ──────────────
cat > "$BR/dashboard-bridge.toml" <<TOML
[dashboard]
base_url = "$DASH_BASE"
brief_ingest_key = "$BRIEF_INGEST_KEY"
live_quote_ingest_key = "$BRIEF_INGEST_KEY"

[sync]
interval_sec = 60
live_quote_key = "moomoo"
live_quote_extras = ["SPY","QQQ","IWM","DIA","SMH","XLK","NVDA"]
breadth_post_close = true

[fallback]
ibkr_enabled = true
ibkr_host = "127.0.0.1"
ibkr_port = 4001          # 4001 live gateway / 4002 paper
ibkr_client_id = 17
ibkr_read_only = true
TOML

# ── 6. The bridge daemon (auto-restart, on-boot) ────────────────────────────
sudo tee /etc/systemd/system/market-bridge.service >/dev/null <<UNIT
[Unit]
Description=Market Dashboard bridge (live quotes + breadth + fills)
After=opend.service ibgateway.service
[Service]
WorkingDirectory=$BR
ExecStart=$BR/.venv/bin/python -m bridge
Restart=always
RestartSec=10
User=$USER
[Install]
WantedBy=multi-user.target
UNIT

# ── 7. Refresh scheduler (the LIVE cadence — replaces paid Vercel crons) ─────
cat > "$HOME/refresh-pinger.sh" <<PING
#!/usr/bin/env bash
K="$BRIEF_INGEST_KEY"; B="$DASH_BASE"
curl -s -m 60 "\$B/api/breadth/refresh?key=\$K"      >/dev/null || true
curl -s -m 60 "\$B/api/screeners/refresh?key=\$K&force=1" >/dev/null || true
curl -s -m 60 "\$B/api/cron/refresh-quotes?secret=\$K"    >/dev/null || true
PING
chmod +x "$HOME/refresh-pinger.sh"
# every 10 min, 13:00-21:00 UTC (US session), Mon-Fri:
( crontab -l 2>/dev/null; echo "*/10 13-21 * * 1-5 $HOME/refresh-pinger.sh" ) | crontab -

# ── 8. Enable + start everything ────────────────────────────────────────────
sudo systemctl daemon-reload
sudo systemctl enable --now opend.service ibgateway.service market-bridge.service
echo "Verify:  systemctl status market-bridge ;  journalctl -u market-bridge -f"
echo "Quotes should appear on the dashboard within ~60s; breadth within ~10 min."
