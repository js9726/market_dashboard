import pandas as pd
import requests
import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm

def get_all_us_stocks():
    try:
        # Download NASDAQ stocks with proper column names
        nasdaq = pd.read_csv('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt', 
                           sep='|', 
                           names=['Nasdaq Traded', 'Symbol', 'Security Name', 'Listing Exchange', 
                                 'Market Category', 'ETF', 'Round Lot Size', 'Test Issue', 
                                 'Financial Status', 'CQS Symbol', 'NASDAQ Symbol', 'NextShares'],
                           skiprows=1)
        
        # Filter for NASDAQ and NYSE only
        nasdaq = nasdaq[nasdaq['Listing Exchange'].isin(['N', 'Q'])]  # N for NYSE, Q for NASDAQ
        nasdaq = nasdaq[nasdaq['Test Issue'] == 'N']  # Remove test stocks
        nasdaq = nasdaq[nasdaq['ETF'] == 'N']  # Remove ETFs
        
        # Clean up the data
        stocks_list = nasdaq[['Symbol', 'Security Name', 'Listing Exchange']].copy()
        stocks_list = stocks_list[stocks_list['Symbol'].str.len() <= 4]  # Standard US stock symbols
        
        # Remove preferred stocks, warrants, and other special securities
        stocks_list = stocks_list[~stocks_list['Symbol'].str.contains(r'\$|\^|\.|\+')]
        
        # Remove rows with empty symbols or names
        stocks_list = stocks_list.dropna(subset=['Symbol', 'Security Name'])
        
        # Map exchange codes to full names
        stocks_list['Exchange'] = stocks_list['Listing Exchange'].map({'N': 'NYSE', 'Q': 'NASDAQ'})
        stocks_list = stocks_list.drop('Listing Exchange', axis=1)
        
        # Print formatted output
        print("\nUS Stocks List (NASDAQ & NYSE):")
        print("-" * 80)
        print(f"{'Symbol':<10} {'Company Name':<50} {'Exchange':<10}")
        print("-" * 80)
        
        for _, row in stocks_list.iterrows():
            print(f"{row['Symbol']:<10} {row['Security Name'][:48]:<50} {row['Exchange']:<10}")
        
        print(f"\nTotal number of stocks: {len(stocks_list)}")
        
        # Return list of symbols
        return stocks_list['Symbol'].tolist()
        
    except Exception as e:
        print(f"Error fetching stock list: {str(e)}")
        print("Full error details:", e)
        return []

def verify_single_stock(symbol):
    """Verify if a single stock is tradeable"""
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info
        return symbol if info and info.get('regularMarketPrice') else None
    except:
        return None

def verify_tradeable(symbols, max_workers=10):
    """Verify if stocks are currently tradeable using parallel processing"""
    valid_symbols = []
    
    print(f"\nVerifying {len(symbols)} stocks...")
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Create future tasks
        future_to_symbol = {executor.submit(verify_single_stock, symbol): symbol for symbol in symbols}
        
        # Process results with progress bar
        with tqdm(total=len(symbols), desc="Verifying stocks") as pbar:
            for future in as_completed(future_to_symbol):
                result = future.result()
                if result:
                    valid_symbols.append(result)
                pbar.update(1)
    
    return valid_symbols

if __name__ == "__main__":
    print("Fetching all US stocks...")
    all_stocks = get_all_us_stocks()
    
    # Get the full DataFrame from get_all_us_stocks
    nasdaq = pd.read_csv('https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqtraded.txt', 
                        sep='|', 
                        names=['Nasdaq Traded', 'Symbol', 'Security Name', 'Listing Exchange', 
                              'Market Category', 'ETF', 'Round Lot Size', 'Test Issue', 
                              'Financial Status', 'CQS Symbol', 'NASDAQ Symbol', 'NextShares'],
                        skiprows=1)
    
    # Filter and clean data
    stocks_list = nasdaq[nasdaq['Listing Exchange'].isin(['N', 'Q'])]
    stocks_list = stocks_list[stocks_list['Test Issue'] == 'N']
    stocks_list = stocks_list[stocks_list['ETF'] == 'N']
    stocks_list = stocks_list[['Symbol', 'Security Name', 'Listing Exchange']]
    stocks_list['Listing Exchange'] = stocks_list['Listing Exchange'].map({'N': 'NYSE', 'Q': 'NASDAQ'})
    
    # Save to file with formatted columns
    with open('us_stock_list.txt', 'w', encoding='utf-8') as f:
        # Write header with padding
        f.write(f"{'Symbol':<10} | {'Company Name':<200} | {'Exchange':<10}\n")
        f.write("-" * 224 + "\n")  # Separator line adjusted for new width
        
        # Write data with padding
        for _, row in stocks_list.iterrows():
            f.write(f"{row['Symbol']:<10} | {row['Security Name']:<200} | {row['Listing Exchange']:<10}\n")
    
    print(f"\nFinal list of stocks saved to us_stock_list.txt")
    print(f"Total stocks: {len(stocks_list)}")