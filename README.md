# US Market Dashboard & Morning Brief

**GitHub:** [js9726/market_dashboard](https://github.com/js9726/market_dashboard)

A full-stack market intelligence platform combining a Python data pipeline, AI-powered morning brief, and a Next.js chatbot dashboard — all automated daily via GitHub Actions and deployed on Vercel.

---

## What It Does

| Feature | Description |
|---|---|
| 📊 **Market Snapshot** | ETF/index performance across sectors, industries, and countries — 1D / 5D / 20D |
| 🏭 **Industry Scanner** | Top & bottom 5 industries scraped live from Finviz (1D / 1W / 1M performance) |
| 💪 **Relative Strength** | RS score + ABC momentum rating for every tracked ticker |
| 📈 **Breadth Metrics** | % of tickers above 200-day SMA and within top 30% of 52-week range |
| 🧠 **Morning Brief** | Claude-generated institutional brief: rotation, RS picks, breadth, catalysts |
| 💬 **Stock Chatbot** | AI chat (DeepSeek) for fundamental + technical analysis on any ticker |
| 🔄 **Daily Automation** | GitHub Actions runs Mon–Fri at 8:30 AM ET — no manual work needed |

---

## Repo Layout

```
market_dashboard/
├── .github/workflows/
│   └── refresh_data.yml          # Daily pipeline: data → brief → commit
├── apps/
│   ├── market_dashboard/
│   │   ├── scripts/
│   │   │   ├── build_data.py     # Fetches yfinance, Finviz, breadth metrics
│   │   │   └── morning_brief.py  # Calls Claude to generate morning brief
│   │   ├── data/                 # Generated output (gitignored)
│   │   └── requirements.txt
│   └── usStockChatBot/           # Next.js 15 frontend
│       ├── agents/
│       │   ├── fundamental/      # DeepSeek fundamental analysis agent
│       │   └── technical/        # Technical analysis agent
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/analysis/ # POST /api/analysis — runs AI agents
│       │   │   └── dashboard/    # Market snapshot UI
│       │   ├── components/       # Chat, Market Overview, Dashboard Shell
│       │   └── utils/
│       │       └── retry.ts      # Exponential backoff for 529 errors
│       └── public/market-dashboard/  # Synced data (gitignored)
├── packages/usChatBot-DataPipeline/
├── research/                     # Vendored ML research (attribution kept)
└── run_daily.bat                 # Local Windows Task Scheduler script
```

---

## Architecture

```
GitHub Actions (Mon–Fri 8:30 AM ET)
    │
    ├── build_data.py
    │     ├── yfinance  → ETF prices, RS, ABC ratings, breadth
    │     ├── Finviz    → Industry 1D/1W/1M performance
    │     └── investpy  → Upcoming economic events (CPI, NFP, FOMC…)
    │
    ├── morning_brief.py
    │     └── Claude (claude-opus-4-6) → morning_brief.md
    │
    └── Commits snapshot.json + brief → triggers Vercel redeploy
                                              │
                                        Vercel (Next.js)
                                        live at your-app.vercel.app
```

---

## Quick Start (Local)

### 1. Clone

```bash
git clone git@github.com:js9726/market_dashboard.git
cd market_dashboard
```

### 2. Python data pipeline

```bash
cd apps/market_dashboard
pip install -r requirements.txt
python scripts/build_data.py --out-dir data
```

### 3. Generate morning brief (requires Anthropic API key)

```bash
ANTHROPIC_API_KEY=sk-ant-... python scripts/morning_brief.py --out-dir data
# Output: data/morning_brief.md
```

### 4. Run the frontend

```bash
cd apps/usStockChatBot
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...

# Optional — enables AI analysis tab
DEEPSEEK_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-...
```

Copy data into the public folder, then start the dev server:

```bash
npm run sync:market   # copies data/ into public/market-dashboard/
npm run dev           # http://localhost:3000
```

Sign in → `/dashboard` to view the market snapshot.

---

## Local Daily Schedule (Windows)

A Windows Task Scheduler job (`MarketDashboardRefresh`) is pre-configured to run `run_daily.bat` Mon–Fri at 8:00 AM. It rebuilds the data and copies it into the Next.js public folder automatically.

To trigger manually anytime:

```bat
"C:\Users\jiesh\AI codes hub\market_dashboard\run_daily.bat"
```

To verify the scheduled task:

```powershell
schtasks /query /tn "MarketDashboardRefresh"
```

---

## Cloud Deployment

### Data Pipeline — GitHub Actions (free)

The workflow at `.github/workflows/refresh_data.yml` runs automatically. Add one secret in **GitHub → Settings → Secrets → Actions**:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic key (for morning brief generation) |

### Frontend — Vercel (free)

1. Go to **vercel.com/new** → Import `js9726/market_dashboard`
2. Set **Root Directory** → `apps/usStockChatBot`
3. Add environment variables:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | From Clerk dashboard |
| `CLERK_SECRET_KEY` | From Clerk dashboard |
| `DEEPSEEK_API_KEY` | Optional — enables AI analysis |

4. Deploy. Vercel auto-redeploys whenever GitHub Actions commits fresh data.
5. Add your Vercel URL to **Clerk → Domains** so auth works in production.

> **Why not GitHub Pages?**  
> GitHub Pages only serves static files. This app requires server-side Clerk auth and a Node.js API route (`/api/analysis`). Vercel is the natural free host for Next.js apps.

---

## Environment Variables Reference

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` / Vercel | ✅ | Clerk auth (frontend) |
| `CLERK_SECRET_KEY` | `.env.local` / Vercel | ✅ | Clerk auth (server) |
| `ANTHROPIC_API_KEY` | GitHub Secret / `.env.local` | ✅ for brief | Morning brief via Claude |
| `DEEPSEEK_API_KEY` | `.env.local` / Vercel | Optional | AI stock analysis tab |

---

## Key Scripts

| Command | What it does |
|---|---|
| `python scripts/build_data.py` | Fetch market data, generate snapshot + charts |
| `python scripts/morning_brief.py` | Generate Claude morning brief from snapshot |
| `npm run sync:market` | Copy Python output into Next.js public folder |
| `npm run dev` | Start Next.js dev server (Turbopack) |

---

## Research (Vendored)

| Path | Source |
|---|---|
| `research/Commodity-Forecasting` | [hariomvyas/Commodity-Forecasting](https://github.com/hariomvyas/Commodity-Forecasting) |
| `research/Machine-Learning-Commodity-2022` | [austinsw/Machine-Learning-on-Commodity-Price-Forecast-2022](https://github.com/austinsw/Machine-Learning-on-Commodity-Price-Forecast-2022) |

Original licenses and attribution are preserved. These are reference only — do not delete the upstream repos.
