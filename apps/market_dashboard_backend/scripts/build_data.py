"""
Build dashboard data for static GitHub Pages deployment.
Run from repo root: python scripts/build_data.py [--out-dir data]
Outputs: data/snapshot.json, data/events.json, data/meta.json, data/charts/*.png
"""
from __future__ import print_function
import argparse
import json
import math
import os
import re
import time

import yfinance as yf
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from datetime import datetime, timedelta
from io import BytesIO
from scipy.stats import rankdata

try:
    import investpy
except ImportError:
    investpy = None

try:
    import requests
    from bs4 import BeautifulSoup
    _BS4_AVAILABLE = True
except ImportError:
    _BS4_AVAILABLE = False


# --- Config: no Liquid Stocks ---
KEY_EVENTS = [
    "Fed", "Federal Reserve", "Interest Rate", "FOMC",
    "ISM Manufacturing", "ISM Non-Manufacturing", "ISM Services", "ISM",
    "CPI", "Consumer Price Index", "Nonfarm Payrolls", "NFP", "Employment",
    "PPI", "Producer Price Index", "PCE", "Core PCE", "Personal Consumption",
    "Retail Sales", "GDP", "Gross Domestic Product", "Unemployment", "Jobless Claims", "Initial Claims",
    "Housing Starts", "Building Permits", "Durable Goods", "Factory Orders",
    "Consumer Confidence", "Michigan Consumer", "Trade Balance", "Trade Deficit",
    "Beige Book", "Fed Minutes", "JOLTS", "Job Openings"
]

STOCK_GROUPS = {
    "Indices": ["QQQE", "MGK", "QQQ", "IBIT", "RSP", "MDY", "IWM", "TLT", "SPY", "ETHA", "DIA"],
    "S&P Style ETFs": ["IJS", "IJR", "IJT", "IJJ", "IJH", "IJK", "IVE", "IVV", "IVW"],
    "Sel Sectors": ["XLK", "XLI", "XLC", "XLF", "XLU", "XLY", "XLRE", "XLP", "XLB", "XLE", "XLV"],
    "EW Sectors": ["RSPT", "RSPC", "RSPN", "RSPF", "RSP", "RSPD", "RSPU", "RSPR", "RSPH", "RSPM", "RSPS", "RSPG"],
    "Industries": [
        "TAN", "KCE", "IBUY", "QQQE", "JETS", "IBB", "SMH", "CIBR", "UTES", "ROBO", "IGV", "WCLD", "ITA", "PAVE", "BLOK", "AIQ", "IYZ", "PEJ", "FDN", "KBE",
        "UNG", "BOAT", "KWEB", "KRE", "IBIT", "XRT", "IHI", "DRIV", "MSOS", "SOCL", "XLU", "ARKF", "SLX", "ARKK", "XTN", "XME", "KIE", "GLD", "GXC", "SCHH",
        "GDX", "IPAY", "IWM", "XOP", "VNQ", "EATZ", "FXI", "DBA", "ICLN", "SILJ", "REZ", "LIT", "SLV", "XHB", "XHE", "PBJ", "USO", "DBC", "FCG", "XBI",
        "ARKG", "CPER", "XES", "OIH", "PPH", "FNGS", "URA", "WGMI", "REMX"
    ],
    "Countries": [
        "EZA", "ARGT", "EWA", "THD", "EIDO", "EWC", "GREK", "EWP", "EWG", "EWL", "EUFN", "EWY", "IEUR", "EFA", "ACWI",
        "IEV", "EWQ", "EWI", "EWJ", "EWW", "ECH", "EWD", "ASHR", "EWS", "KSA", "INDA", "EEM", "EWZ", "TUR", "EWH", "EWT", "MCHI"
    ]
}

LEVERAGED_ETFS = {
    "QQQ": {"long": ["TQQQ"], "short": ["SQQQ"]},
    "MDY": {"long": ["MIDU"], "short": []},
    "IWM": {"long": ["TNA"], "short": ["TZA"]},
    "TLT": {"long": ["TMF"], "short": ["TMV"]},
    "SPY": {"long": ["SPXL", "UPRO"], "short": ["SPXS", "SH"]},
    "ETHA": {"long": ["ETHU"], "short": []},
    "XLK": {"long": ["TECL"], "short": ["TECS"]},
    "XLI": {"long": ["DUSL"], "short": []},
    "XLC": {"long": ["LTL"], "short": []},
    "XLF": {"long": ["FAS"], "short": ["FAZ"]},
    "XLU": {"long": ["UTSL"], "short": []},
    "XLY": {"long": ["WANT"], "short": ["SCC"]},
    "XLRE": {"long": ["DRN"], "short": ["DRV"]},
    "XLP": {"long": ["UGE"], "short": ["SZK"]},
    "XLB": {"long": ["UYM"], "short": ["SMN"]},
    "XLE": {"long": ["ERX"], "short": ["ERY"]},
    "XLV": {"long": ["CURE"], "short": []},
    "SMH": {"long": ["SOXL"], "short": ["SOXS"]},
    "ARKK": {"long": ["TARK"], "short": ["SARK"]},
    "XTN": {"long": ["TPOR"], "short": []},
    "KWEB": {"long": ["CWEB"], "short": []},
    "XRT": {"long": ["RETL"], "short": []},
    "KRE": {"long": ["DPST"], "short": []},
    "DRIV": {"long": ["EVAV"], "short": []},
    "XBI": {"long": ["LABU"], "short": ["LABD"]},
    "ROBO": {"long": ["UBOT"], "short": []},
    "XHB": {"long": ["NAIL"], "short": []},
    "FNGS": {"long": ["FNGB"], "short": ["FNGD"]},
    "WCLD": {"long": ["CLDL"], "short": []},
    "XOP": {"long": ["GUSH"], "short": ["DRIP"]},
    "FDN": {"long": ["WEBL"], "short": ["WEBS"]},
    "FXI": {"long": ["YINN"], "short": ["YANG"]},
    "PEJ": {"long": ["OOTO"], "short": []},
    "USO": {"long": ["UCO"], "short": ["SCO"]},
    "PPH": {"long": ["PILL"], "short": []},
    "ITA": {"long": ["DFEN"], "short": []},
    "SLV": {"long": ["AGQ"], "short": ["ZSL"]},
    "GLD": {"long": ["UGL"], "short": ["GLL"]},
    "UNG": {"long": ["BOIL"], "short": ["KOLD"]},
    "GDX": {"long": ["NUGT", "GDXU"], "short": ["JDST", "GDXD"]},
    "IBIT": {"long": ["BITX", "BITU"], "short": ["SBIT", "BITI"]},
    "MSOS": {"long": ["MSOX"], "short": []},
    "REMX": {"long": [], "short": []},
    "EWY": {"long": ["KORU"], "short": []},
    "IEV": {"long": ["EURL"], "short": []},
    "EWJ": {"long": ["EZJ"], "short": []},
    "EWW": {"long": ["MEXX"], "short": []},
    "ASHR": {"long": ["CHAU"], "short": []},
    "INDA": {"long": ["INDL"], "short": []},
    "EEM": {"long": ["EDC"], "short": ["EDZ"]},
    "EWZ": {"long": ["BRZU"], "short": []}
}

# Google Finance URL: https://www.google.com/finance/quote/{TICKER}:{EXCHANGE}
# Used by fetch_google_finance_quote() as a last-resort fallback for current-day price.
GOOGLE_FINANCE_EXCHANGE = {
    # Indices
    "QQQE": "NASDAQ",  "MGK": "NYSEARCA",  "QQQ": "NASDAQ",
    "IBIT": "NASDAQ",  "RSP": "NYSEARCA",   "MDY": "NYSEARCA",
    "IWM": "NYSEARCA", "TLT": "NASDAQ",     "SPY": "NYSEARCA",
    "ETHA": "NASDAQ",  "DIA": "NYSEARCA",
    # S&P Style ETFs
    "IJS": "NYSEARCA", "IJR": "NYSEARCA",   "IJT": "NYSEARCA",
    "IJJ": "NYSEARCA", "IJH": "NYSEARCA",   "IJK": "NYSEARCA",
    "IVE": "NYSEARCA", "IVV": "NYSEARCA",   "IVW": "NYSEARCA",
    # Sel Sectors
    "XLK": "NYSEARCA", "XLI": "NYSEARCA",   "XLC": "NYSEARCA",
    "XLF": "NYSEARCA", "XLU": "NYSEARCA",   "XLY": "NYSEARCA",
    "XLRE": "NYSEARCA","XLP": "NYSEARCA",   "XLB": "NYSEARCA",
    "XLE": "NYSEARCA", "XLV": "NYSEARCA",
    # EW Sectors
    "RSPT": "NYSEARCA","RSPC": "NYSEARCA",  "RSPN": "NYSEARCA",
    "RSPF": "NYSEARCA","RSPD": "NYSEARCA",  "RSPU": "NYSEARCA",
    "RSPR": "NYSEARCA","RSPH": "NYSEARCA",  "RSPM": "NYSEARCA",
    "RSPS": "NYSEARCA","RSPG": "NYSEARCA",
    # Industries
    "TAN": "NASDAQ",   "KCE": "NYSEARCA",   "IBUY": "NASDAQ",
    "JETS": "NYSEARCA","IBB": "NASDAQ",     "SMH": "NASDAQ",
    "CIBR": "NASDAQ",  "UTES": "NYSEARCA",  "ROBO": "NASDAQ",
    "IGV": "NYSEARCA", "WCLD": "NASDAQ",    "ITA": "NYSEARCA",
    "PAVE": "NYSE",    "BLOK": "NYSE",      "AIQ": "NYSE",
    "IYZ": "NYSEARCA", "PEJ": "NASDAQ",     "FDN": "NYSEARCA",
    "KBE": "NYSEARCA", "UNG": "NYSEARCA",   "BOAT": "NYSE",
    "KWEB": "NYSEARCA","KRE": "NYSEARCA",   "XRT": "NYSEARCA",
    "IHI": "NYSEARCA", "DRIV": "NASDAQ",    "MSOS": "OTC",
    "SOCL": "NASDAQ",  "ARKF": "NYSEARCA",  "SLX": "NYSEARCA",
    "ARKK": "NYSEARCA","XTN": "NYSEARCA",   "XME": "NYSEARCA",
    "KIE": "NYSEARCA", "GLD": "NYSEARCA",   "GXC": "NYSEARCA",
    "SCHH": "NYSEARCA","GDX": "NYSEARCA",   "IPAY": "NASDAQ",
    "XOP": "NYSEARCA", "VNQ": "NYSEARCA",   "EATZ": "NYSE",
    "FXI": "NYSEARCA", "DBA": "NYSEARCA",   "ICLN": "NASDAQ",
    "SILJ": "NYSEARCA","REZ": "NYSEARCA",   "LIT": "NYSEARCA",
    "SLV": "NYSEARCA", "XHB": "NYSEARCA",   "XHE": "NYSEARCA",
    "PBJ": "NASDAQ",   "USO": "NYSEARCA",   "DBC": "NYSEARCA",
    "FCG": "NYSEARCA", "XBI": "NYSEARCA",   "ARKG": "NYSEARCA",
    "CPER": "NYSE",    "XES": "NYSEARCA",   "OIH": "NYSEARCA",
    "PPH": "NASDAQ",   "FNGS": "NYSE",      "URA": "NYSEARCA",
    "WGMI": "NASDAQ",  "REMX": "NYSEARCA",
    # Countries
    "EZA": "NYSEARCA", "ARGT": "NYSEARCA",  "EWA": "NYSEARCA",
    "THD": "NYSEARCA", "EIDO": "NYSEARCA",  "EWC": "NYSEARCA",
    "GREK": "NYSEARCA","EWP": "NYSEARCA",   "EWG": "NYSEARCA",
    "EWL": "NYSEARCA", "EUFN": "NASDAQ",    "EWY": "NYSEARCA",
    "IEUR": "NASDAQ",  "EFA": "NYSEARCA",   "ACWI": "NASDAQ",
    "IEV": "NYSEARCA", "EWQ": "NYSEARCA",   "EWI": "NYSEARCA",
    "EWJ": "NYSEARCA", "EWW": "NYSEARCA",   "ECH": "NYSEARCA",
    "EWD": "NYSEARCA", "ASHR": "NYSEARCA",  "EWS": "NYSEARCA",
    "KSA": "NYSEARCA", "INDA": "NYSEARCA",  "EEM": "NYSEARCA",
    "EWZ": "NYSEARCA", "TUR": "NYSEARCA",   "EWH": "NYSEARCA",
    "EWT": "NYSEARCA", "MCHI": "NASDAQ",
}

SECTOR_COLORS = {
    "Information Technology": "#3f51b5", "Industrials": "#333", "Emerging Markets": "#00bcd4",
    "Consumer Discretionary": "#4caf50", "Health Care": "#e91e63", "Financials": "#ff5722",
    "Energy": "#795548", "Communication Services": "#9c27b0", "Real Estate": "#673ab7",
    "Commodities": "#8b6914", "Materials": "#ff9800", "Utilities": "#009688",
    "Consumer Staples": "#8bc34a", "Broad Market": "#9e9e9e",
}

Industries_COLORS = {
    "SMH": "#3f51b5", "ARKK": "#3f51b5", "XTN": "#333", "KWEB": "#00bcd4", "XRT": "#4caf50", "KRE": "#ff5722",
    "ARKF": "#3f51b5", "ARKG": "#e91e63", "BOAT": "#333", "DRIV": "#4caf50", "KBE": "#ff5722", "XES": "#795548",
    "XBI": "#e91e63", "OIH": "#795548", "SOCL": "#9c27b0", "ROBO": "#333", "AIQ": "#3f51b5", "XHB": "#4caf50",
    "FNGS": "#9e9e9e", "BLOK": "#3f51b5", "LIT": "#ff9800", "WCLD": "#3f51b5", "XOP": "#795548", "FDN": "#4caf50",
    "TAN": "#795548", "IBB": "#e91e63", "PAVE": "#333", "PEJ": "#4caf50", "KCE": "#ff5722", "XHE": "#e91e63",
    "IBUY": "#4caf50", "MSOS": "#4caf50", "FCG": "#795548", "JETS": "#4caf50", "IPAY": "#ff5722", "SLX": "#ff9800",
    "IGV": "#3f51b5", "CIBR": "#3f51b5", "EATZ": "#4caf50", "PPH": "#e91e63", "IHI": "#e91e63", "UTES": "#009688",
    "ICLN": "#795548", "XME": "#ff9800", "IYZ": "#9c27b0", "URA": "#795548", "ITA": "#333", "VNQ": "#673ab7",
    "SCHH": "#673ab7", "KIE": "#ff5722", "REZ": "#673ab7", "CPER": "#8b6914", "PBJ": "#8bc34a", "SLV": "#8b6914",
    "GLD": "#8b6914", "SILJ": "#ff9800", "GDX": "#ff9800", "FXI": "#00bcd4", "GXC": "#00bcd4", "USO": "#8b6914",
    "DBA": "#8b6914", "UNG": "#8b6914", "DBC": "#8b6914", "WGMI": "#3f51b5", "REMX": "#ff9800",
}


def sanitize_json(obj):
    """Recursively replace NaN/Inf with None and convert numpy scalars to
    native Python types so output is valid JSON."""
    if isinstance(obj, dict):
        return {k: sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_json(v) for v in obj]
    # numpy scalar types — use .item() to convert to native Python
    if hasattr(obj, 'item'):
        try:
            native = obj.item()
            if isinstance(native, float):
                return None if (math.isnan(native) or math.isinf(native)) else native
            return native
        except Exception:
            pass
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    return obj


def safe_json_dumps(data, **kwargs):
    """Dump to JSON string and replace any remaining bare NaN/Infinity tokens."""
    raw = json.dumps(data, ensure_ascii=False, **kwargs)
    raw = re.sub(r'\bNaN\b', 'null', raw)
    raw = re.sub(r'\b-?Infinity\b', 'null', raw)
    return raw


def get_ticker_to_sector_mapping():
    color_to_sector = {c: s for s, c in SECTOR_COLORS.items()}
    return {t: color_to_sector.get(c, "Broad Market") for t, c in Industries_COLORS.items()}


TICKER_TO_SECTOR = get_ticker_to_sector_mapping()


def get_leveraged_etfs(ticker):
    if ticker in LEVERAGED_ETFS:
        return LEVERAGED_ETFS[ticker].get("long", []), LEVERAGED_ETFS[ticker].get("short", [])
    return [], []


def get_upcoming_key_events(days_ahead=7):
    if investpy is None:
        return []
    today = datetime.today()
    end_date = today + timedelta(days=days_ahead)
    from_date = today.strftime('%d/%m/%Y')
    to_date = end_date.strftime('%d/%m/%Y')
    try:
        calendar = investpy.news.economic_calendar(
            time_zone=None, time_filter='time_only', countries=['united states'],
            importances=['high'], categories=None, from_date=from_date, to_date=to_date
        )
        if calendar.empty:
            return []
        pattern = '|'.join(KEY_EVENTS)
        filtered = calendar[
            (calendar['event'].str.contains(pattern, case=False, na=False)) &
            (calendar['importance'].str.lower() == 'high')
        ]
        if filtered.empty:
            return []
        filtered = filtered.sort_values(['date', 'time'])
        return filtered[['date', 'time', 'event']].to_dict('records')
    except Exception as e:
        print("Economic calendar error:", e)
        return []


def calculate_atr(hist_data, period=14):
    try:
        hl = hist_data['High'] - hist_data['Low']
        hc = (hist_data['High'] - hist_data['Close'].shift()).abs()
        lc = (hist_data['Low'] - hist_data['Close'].shift()).abs()
        tr = pd.concat([hl, hc, lc], axis=1).max(axis=1)
        return tr.ewm(alpha=1/period, adjust=False).mean().iloc[-1]
    except Exception:
        return None


def calculate_rrs(stock_data, spy_data, atr_length=14, length_rolling=50, length_sma=20, atr_multiplier=1.0):
    try:
        merged = pd.merge(
            stock_data[['High', 'Low', 'Close']], spy_data[['High', 'Low', 'Close']],
            left_index=True, right_index=True, suffixes=('_stock', '_spy'), how='inner'
        )
        if len(merged) < atr_length + 1:
            return None
        for prefix in ['stock', 'spy']:
            h, l, c = merged[f'High_{prefix}'], merged[f'Low_{prefix}'], merged[f'Close_{prefix}']
            tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
            merged[f'atr_{prefix}'] = tr.ewm(alpha=1/atr_length, adjust=False).mean()
        sc = merged['Close_stock'] - merged['Close_stock'].shift(1)
        spy_c = merged['Close_spy'] - merged['Close_spy'].shift(1)
        spy_pi = spy_c / merged['atr_spy']
        expected = spy_pi * merged['atr_stock'] * atr_multiplier
        rrs = (sc - expected) / merged['atr_stock']
        rolling_rrs = rrs.rolling(window=length_rolling, min_periods=1).mean()
        rrs_sma = rolling_rrs.rolling(window=length_sma, min_periods=1).mean()
        return pd.DataFrame({'RRS': rrs, 'rollingRRS': rolling_rrs, 'RRS_SMA': rrs_sma}, index=merged.index)
    except Exception:
        return None


def calculate_sma(hist_data, period=50):
    try:
        return hist_data['Close'].rolling(window=period).mean().iloc[-1]
    except Exception:
        return None


def calculate_ema(hist_data, period=10):
    try:
        return hist_data['Close'].ewm(span=period, adjust=False).mean().iloc[-1]
    except Exception:
        return None


def calculate_abc_rating(hist_data):
    try:
        ema10 = calculate_ema(hist_data, 10)
        ema20 = calculate_ema(hist_data, 20)
        sma50 = calculate_sma(hist_data, 50)
        if ema10 is None or ema20 is None or sma50 is None:
            return None
        if ema10 > ema20 and ema20 > sma50:
            return "A"
        if (ema10 > ema20 and ema20 < sma50) or (ema10 < ema20 and ema20 > sma50):
            return "B"
        if ema10 < ema20 and ema20 < sma50:
            return "C"
    except Exception:
        pass
    return None


def create_rs_chart_png(rrs_data, ticker, charts_dir):
    try:
        recent = rrs_data.tail(20)
        if len(recent) == 0:
            return None
        plt.style.use('dark_background')
        fig, ax = plt.subplots(figsize=(8, 2))
        fig.patch.set_facecolor('#1a1a1a')
        ax.set_facecolor('#1a1a1a')
        rolling_rrs = recent['rollingRRS'].values
        rrs_sma = recent['RRS_SMA'].values
        max_idx = rolling_rrs.argmax()
        bar_colors = ['#4ade80' if i == max_idx else '#b0b0b0' for i in range(len(rolling_rrs))]
        ax.bar(range(len(rolling_rrs)), rolling_rrs, color=bar_colors, width=0.8, edgecolor='none')
        ax.plot(range(len(rrs_sma)), rrs_sma, color='yellow', lw=2)
        ax.axhline(y=0, color='#808080', linestyle='--', linewidth=1)
        mn = min(rolling_rrs.min(), rrs_sma.min() if len(rrs_sma) else 0)
        mx = max(rolling_rrs.max(), rrs_sma.max() if len(rrs_sma) else 0)
        pad = 0.1 if mn == mx else (mx - mn) * 0.2
        ax.set_ylim(mn - pad, mx + pad)
        ax.set_xticks([])
        ax.set_yticks([])
        for s in ax.spines.values():
            s.set_visible(False)
        fig.tight_layout(pad=0)
        safe = re.sub(r'[^a-zA-Z0-9]', '_', ticker)
        path = os.path.join(charts_dir, f"{safe}.png")
        fig.savefig(path, format='png', dpi=80, bbox_inches='tight', facecolor='#1a1a1a')
        plt.close(fig)
        return f"data/charts/{safe}.png"
    except Exception as e:
        print("Chart error", ticker, e)
        return None


def fetch_stooq_history(ticker, period_days):
    """Fetch OHLCV history from stooq via direct HTTP CSV download."""
    if not _BS4_AVAILABLE:  # requests is imported alongside bs4
        return None
    try:
        end = datetime.now()
        start = end - timedelta(days=period_days)
        url = (
            f"https://stooq.com/q/d/l/?s={ticker.lower()}"
            f"&d1={start.strftime('%Y%m%d')}"
            f"&d2={end.strftime('%Y%m%d')}"
            f"&i=d"
        )
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        from io import StringIO
        df = pd.read_csv(StringIO(resp.text), parse_dates=["Date"], index_col="Date")
        if df is None or df.empty:
            return None
        df = df.sort_index(ascending=True)
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        df = df.dropna(subset=["Close", "Open", "High", "Low"])
        return df if not df.empty else None
    except Exception as e:
        print(f"stooq fetch failed for {ticker}: {e}")
        return None


def fetch_google_finance_quote(ticker):
    """Scrape current-day price from Google Finance.

    Returns {"price": float, "prev_close": float, "open": float|None} or None.
    Provides CURRENT-DAY data only — no historical OHLCV.
    Used as last-resort rescue for daily/intra when all history sources fail.
    """
    if not _BS4_AVAILABLE:
        return None
    exchange = GOOGLE_FINANCE_EXCHANGE.get(ticker)
    if not exchange:
        return None
    url = f"https://www.google.com/finance/quote/{ticker}:{exchange}"
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")

        # Current price — try multiple selectors in order of stability
        price = None
        for selector in [
            'div.YMlKec.fxKbKc',
            '[data-last-price]',
            'div[class*="YMlKec"]',
        ]:
            tag = soup.select_one(selector)
            if tag:
                raw = tag.get('data-last-price') or tag.get_text(strip=True)
                try:
                    price = float(str(raw).replace(',', '').replace('$', ''))
                    break
                except (ValueError, AttributeError):
                    continue
        if price is None:
            return None

        # Previous close — find label then navigate to sibling value
        prev_close = None
        for label in soup.find_all(string=lambda t: t and 'Previous close' in t):
            parent = label.find_parent()
            if parent:
                sib = parent.find_next_sibling()
                if sib:
                    try:
                        prev_close = float(sib.get_text(strip=True).replace(',', '').replace('$', ''))
                        break
                    except ValueError:
                        continue

        # Today's open
        open_price = None
        for label in soup.find_all(string=lambda t: t and t.strip() == 'Open'):
            parent = label.find_parent()
            if parent:
                sib = parent.find_next_sibling()
                if sib:
                    try:
                        open_price = float(sib.get_text(strip=True).replace(',', '').replace('$', ''))
                        break
                    except ValueError:
                        continue

        return {"price": price, "prev_close": prev_close, "open": open_price}
    except Exception as e:
        print(f"Google Finance fetch failed for {ticker}: {e}")
        return None


def fetch_history_with_fallback(ticker, period_days):
    """Fetch OHLCV history trying yfinance first, then stooq.

    Returns a DataFrame (ascending date, dropna applied) or None.
    """
    # Layer 1: yfinance
    try:
        stock = yf.Ticker(ticker)
        if period_days <= 30:
            df = stock.history(period="21d")
        elif period_days <= 90:
            df = stock.history(period="60d")
        elif period_days <= 400:
            end = datetime.now()
            start = end - timedelta(days=period_days)
            df = stock.history(start=start, end=end)
        else:
            df = stock.history(period="1y")
        if df.index.tz is not None:
            df.index = df.index.tz_localize(None)
        df = df.dropna(subset=['Close', 'Open', 'High', 'Low'])
        if not df.empty:
            return df
    except Exception as e:
        print(f"yfinance failed for {ticker} ({period_days}d): {e}")

    # Layer 2: stooq
    print(f"Falling back to stooq for {ticker} ({period_days}d)")
    return fetch_stooq_history(ticker, period_days)


def get_stock_data(ticker_symbol, charts_dir):
    try:
        # Fetch short and long history with yfinance → stooq fallback
        hist  = fetch_history_with_fallback(ticker_symbol, 30)
        daily = fetch_history_with_fallback(ticker_symbol, 90)

        if hist is not None:
            hist = hist.dropna(subset=['Close', 'Open', 'High', 'Low'])
        if daily is not None:
            daily = daily.dropna(subset=['Close', 'Open', 'High', 'Low'])

        # Google Finance rescue: history unavailable — return minimal row with daily/intra only
        if hist is None or len(hist) < 2:
            gf = fetch_google_finance_quote(ticker_symbol)
            if gf and gf.get("price") and gf.get("prev_close"):
                daily_chg = (gf["price"] / gf["prev_close"] - 1) * 100
                intra_chg = (gf["price"] / gf["open"] - 1) * 100 if gf.get("open") else None
                long_etfs, short_etfs = get_leveraged_etfs(ticker_symbol)
                return {
                    "ticker": ticker_symbol,
                    "daily": round(daily_chg, 2),
                    "intra": round(intra_chg, 2) if intra_chg is not None else None,
                    "5d": None, "20d": None, "atr_pct": None,
                    "dist_sma50_atr": None, "rs": None, "rs_chart": None,
                    "long": long_etfs, "short": short_etfs, "abc": None,
                }
            return None  # all sources exhausted

        if daily is None or len(daily) < 50:
            return None

        daily_change = (hist['Close'].iloc[-1] / hist['Close'].iloc[-2] - 1) * 100
        intraday_change = (hist['Close'].iloc[-1] / hist['Open'].iloc[-1] - 1) * 100
        five_day_change = (hist['Close'].iloc[-1] / hist['Close'].iloc[-6] - 1) * 100 if len(hist) >= 6 else None
        twenty_day_change = (hist['Close'].iloc[-1] / hist['Close'].iloc[-21] - 1) * 100 if len(hist) >= 21 else None

        sma50 = calculate_sma(daily)
        atr = calculate_atr(daily)
        current_close = daily['Close'].iloc[-1]
        atr_pct = (atr / current_close) * 100 if atr and current_close else None
        dist_sma50_atr = (100 * (current_close / sma50 - 1) / atr_pct) if (sma50 and atr_pct and atr_pct != 0) else None
        abc_rating = calculate_abc_rating(daily)

        rs_sts = None
        rrs_data = None
        start_date = datetime.now() - timedelta(days=120)
        try:
            stock_history = fetch_history_with_fallback(ticker_symbol, 180)
            spy_history   = fetch_history_with_fallback("SPY", 180)
            # Trim to 120-day window (stooq returns buffered days)
            ts = pd.Timestamp(start_date).tz_localize(None)
            if stock_history is not None:
                stock_history = stock_history[stock_history.index >= ts].dropna(subset=['Close', 'Open', 'High', 'Low'])
            if spy_history is not None:
                spy_history = spy_history[spy_history.index >= ts].dropna(subset=['Close', 'Open', 'High', 'Low'])
            if stock_history is not None and spy_history is not None and len(stock_history) > 0 and len(spy_history) > 0:
                rrs_data = calculate_rrs(stock_history, spy_history, atr_length=14, length_rolling=50, length_sma=20, atr_multiplier=1.0)
                if rrs_data is not None and len(rrs_data) >= 21:
                    recent_21 = rrs_data['rollingRRS'].iloc[-21:]
                    ranks = rankdata(recent_21, method='average')
                    rs_sts = ((ranks[-1] - 1) / (len(recent_21) - 1)) * 100
        except Exception as e:
            print("RRS error", ticker_symbol, e)

        rs_chart_path = create_rs_chart_png(rrs_data, ticker_symbol, charts_dir) if rrs_data is not None and len(rrs_data) > 0 else None
        long_etfs, short_etfs = get_leveraged_etfs(ticker_symbol)

        return {
            "ticker": ticker_symbol,
            "daily": round(daily_change, 2) if daily_change is not None else None,
            "intra": round(intraday_change, 2) if intraday_change is not None else None,
            "5d": round(five_day_change, 2) if five_day_change is not None else None,
            "20d": round(twenty_day_change, 2) if twenty_day_change is not None else None,
            "atr_pct": round(atr_pct, 1) if atr_pct is not None else None,
            "dist_sma50_atr": round(dist_sma50_atr, 2) if dist_sma50_atr is not None else None,
            "rs": round(rs_sts, 0) if rs_sts is not None else None,
            "rs_chart": rs_chart_path,
            "long": long_etfs,
            "short": short_etfs,
            "abc": abc_rating
        }
    except Exception as e:
        print("Error", ticker_symbol, e)
        return None


def fetch_finviz_industry_performance():
    """Scrape 1D/1W/1M performance by industry from Finviz groups page."""
    if not _BS4_AVAILABLE:
        print("Warning: requests/beautifulsoup4 not installed, skipping Finviz scan.")
        return {"top5": [], "bottom5": [], "all": []}
    url = "https://finviz.com/groups.ashx?g=industry&v=210&o=name&st=d1"
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")
        rows = []
        for row in soup.select("tr.table-light-row-cp, tr.table-dark-row-cp"):
            cols = [td.get_text(strip=True) for td in row.find_all("td")]
            if len(cols) >= 6:
                def parse_pct(s):
                    try:
                        return float(s.replace("%", "").replace("+", "").strip())
                    except ValueError:
                        return 0.0
                rows.append({
                    "industry": cols[1],
                    "perf_1d": cols[3],
                    "perf_1w": cols[4],
                    "perf_1m": cols[5],
                    "perf_1d_val": parse_pct(cols[3]),
                })
        rows.sort(key=lambda x: x["perf_1d_val"], reverse=True)
        clean = [{k: v for k, v in r.items() if k != "perf_1d_val"} for r in rows]
        return {"top5": clean[:5], "bottom5": clean[-5:], "all": clean}
    except Exception as e:
        print("Finviz industry fetch error:", e)
        return {"top5": [], "bottom5": [], "all": []}


def compute_breadth(tickers):
    """
    Compute market breadth metrics across a list of tickers:
    - % of stocks trading above their 200-day SMA
    - % of stocks in the top 30% of their 52-week range
    Returns dict with counts and percentages.
    """
    above_200 = 0
    near_52w_high = 0
    valid = 0
    for ticker in tickers:
        try:
            hist = fetch_history_with_fallback(ticker, 400)
            if hist is None or len(hist) < 200:
                continue
            close = hist["Close"].iloc[-1]
            sma200 = hist["Close"].rolling(200).mean().iloc[-1]
            high_52w = hist["Close"].max()
            low_52w = hist["Close"].min()
            valid += 1
            if close > sma200:
                above_200 += 1
            rng = high_52w - low_52w
            if rng > 0 and (close - low_52w) / rng >= 0.70:
                near_52w_high += 1
        except Exception:
            continue
    if valid == 0:
        return {"above_200sma_pct": None, "near_52w_high_pct": None, "tickers_sampled": 0}
    return {
        "above_200sma_pct": round(above_200 / valid * 100, 1),
        "near_52w_high_pct": round(near_52w_high / valid * 100, 1),
        "tickers_sampled": valid,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default="data", help="Output directory (default: data)")
    args = parser.parse_args()
    out_dir = args.out_dir
    charts_dir = os.path.join(out_dir, "charts")
    os.makedirs(charts_dir, exist_ok=True)

    print("Fetching economic events...")
    events = get_upcoming_key_events()

    print("Fetching Finviz industry performance...")
    industry_perf = fetch_finviz_industry_performance()

    print("Computing market breadth...")
    # Use the Industries group as the breadth universe
    breadth_tickers = STOCK_GROUPS.get("Sel Sectors", []) + STOCK_GROUPS.get("Industries", [])
    breadth = compute_breadth(breadth_tickers)

    print("Fetching stock data (no Liquid Stocks)...")
    groups_data = {}
    all_ticker_data = {}
    for group_name, tickers in STOCK_GROUPS.items():
        rows = []
        for i, ticker in enumerate(tickers):
            print(f"  [{group_name}] {i+1}/{len(tickers)} {ticker}")
            row = get_stock_data(ticker, charts_dir)
            if row:
                rows.append(row)
                all_ticker_data[ticker] = row
            time.sleep(0.15)
        groups_data[group_name] = rows

    print("Computing column ranges...")
    column_ranges = {}
    for group_name, rows in groups_data.items():
        daily_v = [r["daily"] for r in rows if r.get("daily") is not None]
        intra_v = [r["intra"] for r in rows if r.get("intra") is not None]
        five_v = [r["5d"] for r in rows if r.get("5d") is not None]
        twenty_v = [r["20d"] for r in rows if r.get("20d") is not None]
        column_ranges[group_name] = {
            "daily": (min(daily_v) if daily_v else -10, max(daily_v) if daily_v else 10),
            "intra": (min(intra_v) if intra_v else -10, max(intra_v) if intra_v else 10),
            "5d": (min(five_v) if five_v else -20, max(five_v) if five_v else 20),
            "20d": (min(twenty_v) if twenty_v else -30, max(twenty_v) if twenty_v else 30),
        }

    snapshot = {
        "built_at": datetime.utcnow().isoformat() + "Z",
        "groups": groups_data,
        "column_ranges": column_ranges,
        "industry_performance": industry_perf,
        "breadth": breadth,
    }
    meta = {
        "SECTOR_COLORS": SECTOR_COLORS,
        "TICKER_TO_SECTOR": TICKER_TO_SECTOR,
        "Industries_COLORS": Industries_COLORS,
        "SECTOR_ORDER": list(SECTOR_COLORS.keys()),
        "default_symbol": STOCK_GROUPS["Indices"][0] if STOCK_GROUPS["Indices"] else "SPY",
    }

    snapshot_path = os.path.join(out_dir, "snapshot.json")
    events_path = os.path.join(out_dir, "events.json")
    meta_path = os.path.join(out_dir, "meta.json")

    with open(snapshot_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(sanitize_json(snapshot), indent=2))
    with open(events_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(sanitize_json(events), indent=2))
    with open(meta_path, "w", encoding="utf-8") as f:
        f.write(safe_json_dumps(sanitize_json(meta), indent=2))

    print("Wrote", snapshot_path, events_path, meta_path, "and charts in", charts_dir)


if __name__ == "__main__":
    main()
