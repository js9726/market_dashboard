# GitHub Actions Self-Hosted Runner Setup (Optional — Phase 6)

Per Round 8 answer, you chose hybrid runners — cloud-primary for the pre-open
brief, local self-hosted for any OpenD-dependent jobs. The dashboard-bridge
daemon already handles the live moomoo sync, so a self-hosted runner is
mostly future-proofing for jobs that need OpenD AND a managed workflow
environment (e.g. nightly Python regression tests against your live OpenD
quotes).

If you DON'T need a self-hosted runner today, skip this — the system works
fully without it. The bridge daemon + Task Scheduler + cloud GH Actions cover
all current Phase 1-5 functionality.

## When you'd want one

- A future workflow needs OpenD access (e.g. portfolio backtest using your
  exact account fees)
- You want to run heavyweight intraday jobs without paying for Vercel/GH
  compute
- You want a managed cron without writing Task Scheduler XML by hand

## One-time install (Windows, your PC)

1. **Create the runner config in GitHub**
   - Go to `https://github.com/js9726/market_dashboard/settings/actions/runners/new`
   - Pick: Windows / x64
   - Note the **token** GitHub shows you (it's single-use, ~1h expiry)

2. **Install the runner**

   Open PowerShell as your user (NOT admin):

   ```powershell
   # Choose an install location (NOT under the repo to avoid recursion)
   $RunnerDir = "C:\actions-runner"
   New-Item -ItemType Directory -Force -Path $RunnerDir | Out-Null
   cd $RunnerDir

   # Download the latest runner
   $url = "https://github.com/actions/runner/releases/latest/download/actions-runner-win-x64.zip"
   Invoke-WebRequest -Uri $url -OutFile actions-runner.zip
   Expand-Archive -Path actions-runner.zip -DestinationPath . -Force

   # Configure — paste the token from GitHub when prompted
   .\config.cmd `
     --url https://github.com/js9726/market_dashboard `
     --token <PASTE_TOKEN_HERE> `
     --labels self-hosted,windows,opend,moomoo `
     --runasservice
   ```

3. **Start the service**

   The `--runasservice` flag registers it as a Windows service. Verify:

   ```powershell
   Get-Service actions.runner.*
   # Should show: Running
   ```

   The runner survives reboots and starts automatically when your PC powers on.

## Using the runner in workflows

Add `runs-on: [self-hosted, windows, opend]` to any workflow that needs OpenD:

```yaml
jobs:
  portfolio-test:
    runs-on: [self-hosted, windows, opend]
    steps:
      - uses: actions/checkout@v4
      - run: python scripts/some_test_using_openD.py
```

Jobs queue when your PC is off and run as soon as it's back online.

## Removing the runner

```powershell
cd C:\actions-runner
.\config.cmd remove --token <FRESH_TOKEN_FROM_GITHUB>
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| Job stuck "Waiting for a runner to pick up this job" | Runner service stopped — `Restart-Service actions.runner.*` |
| Runner shows offline in GitHub UI | Network/firewall issue — verify outbound HTTPS to `*.actions.githubusercontent.com` |
| OpenD port 11111 fails inside workflow | Run `opend_watchdog.ps1` manually or wait for next 5-min watchdog cycle |
| Path conflicts (e.g. Python not found) | Runner inherits Service-account PATH; add `python` to system PATH (not user PATH) |
