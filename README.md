# market_dashboard

GitHub: [js9726/market_dashboard](https://github.com/js9726/market_dashboard). This repository holds the US stock chatbot, market dashboard, data pipeline, and research snapshots in one workspace.

## Layout

| Path | Description |
|------|-------------|
| `apps/usStockChatBot` | Next.js chatbot + **in-app market dashboard** (see below). |
| `apps/market_dashboard` | Dashboard (Python; see `requirements.txt`). |
| `packages/usChatBot-DataPipeline` | Data pipeline for the chatbot ecosystem. |
| `research/Commodity-Forecasting` | Vendored snapshot from [hariomvyas/Commodity-Forecasting](https://github.com/hariomvyas/Commodity-Forecasting). **Keep upstream `LICENSE` / attribution.** |
| `research/Machine-Learning-Commodity-2022` | Vendored snapshot from [austinsw/Machine-Learning-on-Commodity-Price-Forecast-2022](https://github.com/austinsw/Machine-Learning-on-Commodity-Price-Forecast-2022). **Keep upstream `LICENSE` / attribution.** |

> **Note:** Third-party code under `research/` is for reference; do not delete their original GitHub repositories (you do not own them). Remove nested `.git` was intentional so this repo is a single Git tree.

## Chatbot + Python dashboard in one UI

The Python app in `apps/market_dashboard` builds `data/snapshot.json`, `events.json`, `meta.json`, and `data/charts/*.png`. The Next app (`apps/usStockChatBot`) can **show the same snapshot** on `/dashboard` (tab *Dashboard*) with Recharts and tables; the *Chat* tab runs `$TICKER` analysis.

1. Refresh data (optional): from `apps/market_dashboard`, run `python scripts/build_data.py --out-dir data`.
2. Copy data into the web app: from `apps/usStockChatBot`, run **`npm run sync:market`** (copies into `public/market-dashboard/`).
3. Run the chatbot: `npm run dev` and open `/dashboard` after signing in.

Synced assets under `public/market-dashboard/` are gitignored to avoid committing large JSON/PNGs; run `sync:market` after clone or when the pipeline updates.

The Next app expects **Clerk** (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`) and optional **DeepSeek** (`DEEPSEEK_API_KEY`) in `.env.local` for auth and AI analysis.

## Clone and push

```bash
git clone git@github.com:js9726/market_dashboard.git
cd market_dashboard
# after changes:
git push -u origin main
```

If this folder was created locally first:

```bash
git remote add origin git@github.com:js9726/market_dashboard.git
git branch -M main
git push -u origin main
```

## After you verify the new repo: delete **your** old repos only

Only delete repos under your account once you have:

- Pushed successfully and cloned the new repo elsewhere as a backup check.
- Confirmed no secrets (`.env`, API keys) are committed.
- Archived or exported anything you need (issues, releases).

Then on GitHub for each of **your** old projects: **Settings → Danger zone → Delete this repository**.

Old standalone repos you may retire after this repo is canonical (adjust if yours differ):

- `js9726/usStockChatBot`
- `js9726/usChatBot-DataPipeline`

**This** repo (`js9726/market_dashboard`) is the combined home; do not delete it while it is your primary remote. You would **not** delete `hariomvyas/...` or `austinsw/...` — those remain their authors’ repos.

## Optional: preserve full Git history later

This import used a **fresh snapshot** (no old commit history). To merge histories with prefixes, use `git subtree` from an empty repo instead; ask if you want those commands.
