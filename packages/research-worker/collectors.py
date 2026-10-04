"""Read-only evidence collectors. Run only with the worker's explicit live flags.

Search grounding does not prove exhaustive 90-day coverage. Authenticated chart
captures still come from the existing chart workflow via collector evidence files.
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
import urllib.request


def source(source_id, kind, url, text, now, as_of=None, **extra):
    return {"id": source_id, "kind": kind, "url": url, "text": text,
            "contentHash": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "asOf": (as_of or now).isoformat(), "retrievedAt": now.isoformat(),
            "expiresAt": (now + timedelta(minutes=10 if kind == "quote" else 60)).isoformat(), **extra}


def collect_market(ticker, now=None, ticker_factory=None):
    now = now or datetime.now(timezone.utc)
    try:
        if ticker_factory is None:
            import yfinance
            ticker_factory = yfinance.Ticker
        info = ticker_factory(ticker).get_info()
        rows = []
        timestamp, price = info.get("regularMarketTime"), info.get("regularMarketPrice")
        if isinstance(timestamp, (int, float)) and isinstance(price, (int, float)) and price > 0:
            as_of = datetime.fromtimestamp(timestamp, timezone.utc)
            if timedelta(minutes=-5) <= now - as_of <= timedelta(minutes=15):
                text = json.dumps({"ticker": ticker, "price": price, "currency": info.get("currency"), "marketTimestamp": as_of.isoformat()}, allow_nan=False)
                rows.append(source("market_quote", "quote", f"https://finance.yahoo.com/quote/{ticker}/", text, now, as_of, ticker=ticker))
        fields = ["longName", "longBusinessSummary", "sector", "industry", "totalRevenue", "revenueGrowth", "earningsGrowth", "grossMargins", "operatingMargins", "profitMargins", "freeCashflow", "totalCash", "totalDebt", "debtToEquity", "returnOnEquity", "trailingPE", "forwardPE"]
        values = {k: info[k] for k in fields if info.get(k) is not None}
        period = info.get("mostRecentQuarter")
        if values and isinstance(period, (int, float)):
            period_date = datetime.fromtimestamp(period, timezone.utc)
            if timedelta(0) <= now - period_date <= timedelta(days=180):
                text = json.dumps({"ticker": ticker, "fields": values, "reportingPeriod": period_date.date().isoformat(), "note": "Provider summary mixes TTM, latest-quarter and current valuation metrics; do not call every field quarterly."}, allow_nan=False)
                rows.append(source("market_fundamentals", "fundamental", f"https://finance.yahoo.com/quote/{ticker}/financials/", text, now, period_date, period=period_date.date().isoformat(), ticker=ticker))
        return rows, [] if rows else ["Market/fundamental evidence unavailable or stale"]
    except Exception:
        return [], ["Market collector unavailable; no market facts supplied"]


def collect_news(ticker, now=None, opener=urllib.request.urlopen):
    now = now or datetime.now(timezone.utc)
    key, model = os.environ.get("GEMINI_API_KEY"), os.environ.get("RESEARCH_NEWS_MODEL")
    if not key or not model:
        return [], ["Grounded news requires GEMINI_API_KEY and explicit RESEARCH_NEWS_MODEL"]
    if not all(c.isalnum() or c in "-_." for c in model):
        return [], ["Invalid news model configuration"]
    start = (now - timedelta(days=90)).date().isoformat()
    prompt = (f"Research {ticker} as of {now.isoformat()}. Search primary/reliable sources for the latest company catalyst, "
              f"peer-driven catalysts, material events since {start}, insider/institutional activity, analyst changes, "
              "next 30-day scheduled events, business/clients and peer relative-strength context. "
              "Use exact event dates, facts and source links. Distinguish estimates/inferences. "
              "Explicitly state search gaps; never imply exhaustive coverage from empty results.")
    data = json.dumps({"contents": [{"parts": [{"text": prompt}]}], "tools": [{"google_search": {}}]}).encode()
    request = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent", data=data,
                                     headers={"x-goog-api-key": key, "Content-Type": "application/json"})
    try:
        with opener(request, timeout=90) as response:
            payload = json.loads(response.read(2_000_001))
        candidate = payload["candidates"][0]
        grounding = candidate["groundingMetadata"]
        chunks = grounding.get("groundingChunks", [])
        rows = []
        for i, support in enumerate(grounding.get("groundingSupports", [])[:20]):
            text = support.get("segment", {}).get("text", "").strip()
            if not text:
                continue
            for index in support.get("groundingChunkIndices", [])[:3]:
                if not isinstance(index, int) or index < 0 or index >= len(chunks):
                    continue
                url = chunks[index].get("web", {}).get("uri", "")
                if url.startswith("https://"):
                    rows.append(source(f"news_{i}_{index}", "search_grounded", url, text, now, ticker=ticker))
        return rows, ["Search-grounded passages are not proof of exhaustive 90-day coverage; collector is bounded to 20 segments / 60 citations"] if rows else ["No supported search-grounded passages returned"]
    except Exception:
        return [], ["Grounded news collector failed; news coverage unknown"]
