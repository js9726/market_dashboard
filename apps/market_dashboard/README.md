# Market Dashboard

Static stock dashboard with daily auto-refresh via GitHub Actions (Yahoo Finance), hosted on GitHub Pages.

## Build data locally

```bash
cd market-dashboard
pip install -r requirements.txt
python scripts/build_data.py --out-dir data
```

This generates: `data/snapshot.json`, `data/events.json`, `data/meta.json`, and `data/charts/*.png`.

To preview locally: open `index.html` in a browser, or serve the project root with a static server (e.g. `python -m http.server 8000`) and visit `http://localhost:8000`.

## Deploy to GitHub Pages

1. Create a new GitHub repository and push this directory’s contents to it (or push as the repo root).
2. **Before first deploy** you need initial data. Either:
   - **Recommended:** In the repo go to **Actions** → “Refresh dashboard data” → **Run workflow**. When it finishes, it will commit `data/` to the repo.
   - Or run locally: `python scripts/build_data.py --out-dir data`, then `git add data/`, commit and push.
3. In the repo **Settings → Pages**:
   - Set Source to **GitHub Actions** (or “Deploy from a branch”).
   - If using a branch: choose branch `main` and folder `/ (root)`.
4. The workflow runs daily at 16:30 US Eastern to refresh data; you can also run it manually from **Actions**.

Site URL: `https://<your-username>.github.io/<repo-name>/`

## Project structure

```
market-dashboard/
├── .github/workflows/refresh_data.yml   # Daily data refresh
├── scripts/build_data.py                # Fetches data, outputs JSON + charts
├── data/                                # Generated (commit for Pages)
│   ├── snapshot.json
│   ├── events.json
│   ├── meta.json
│   └── charts/*.png
├── index.html                            # Static frontend
├── requirements.txt
└── README.md
```

Data: Yahoo Finance (yfinance), economic calendar (investpy). Charts: TradingView embed.
