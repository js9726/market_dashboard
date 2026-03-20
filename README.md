# Unified monorepo (US stock chatbot + dashboard + data pipeline + research)

This repository combines several projects into one workspace.

## Layout

| Path | Description |
|------|-------------|
| `apps/usStockChatBot` | Chatbot app (see its `package.json` / local README). |
| `apps/market_dashboard` | Dashboard (Python; see `requirements.txt`). |
| `packages/usChatBot-DataPipeline` | Data pipeline for the chatbot ecosystem. |
| `research/Commodity-Forecasting` | Vendored snapshot from [hariomvyas/Commodity-Forecasting](https://github.com/hariomvyas/Commodity-Forecasting). **Keep upstream `LICENSE` / attribution.** |
| `research/Machine-Learning-Commodity-2022` | Vendored snapshot from [austinsw/Machine-Learning-on-Commodity-Price-Forecast-2022](https://github.com/austinsw/Machine-Learning-on-Commodity-Price-Forecast-2022). **Keep upstream `LICENSE` / attribution.** |

> **Note:** Third-party code under `research/` is for reference; do not delete their original GitHub repositories (you do not own them). Remove nested `.git` was intentional so this repo is a single Git tree.

## Create the GitHub repo and push

1. On GitHub: **New repository** → name it (e.g. `unified-monorepo`); **do not** add README/license (this folder already has content).
2. From this directory:

```bash
cd "path/to/unified-monorepo"
git init
git add .
git commit -m "Initial monorepo: apps, packages, research"
git branch -M main
git remote add origin git@github.com:YOUR_USERNAME/YOUR_NEW_REPO.git
git push -u origin main
```

## After you verify the new repo: delete **your** old repos only

Only delete repos under your account once you have:

- Pushed successfully and cloned the new repo elsewhere as a backup check.
- Confirmed no secrets (`.env`, API keys) are committed.
- Archived or exported anything you need (issues, releases).

Then on GitHub for each of **your** old projects: **Settings → Danger zone → Delete this repository**.

Names you likely retire (adjust if yours differ):

- `js9726/usStockChatBot`
- `js9726/usChatBot-DataPipeline`
- `js9726/market_dashboard`

(You would **not** delete `hariomvyas/...` or `austinsw/...` — those remain their authors’ repos.)

## Optional: preserve full Git history later

This import used a **fresh snapshot** (no old commit history). To merge histories with prefixes, use `git subtree` from an empty repo instead; ask if you want those commands.
