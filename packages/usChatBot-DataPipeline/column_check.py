import requests
import pandas as pd
from dotenv import load_dotenv
import os
from supabase import create_client
import time

# Load environment variables
load_dotenv()

# Read symbols from file
with open('stock_list.txt', 'r') as f:
    SYMBOLS = [line.strip() for line in f.readlines()]

# Configuration
API_KEY = os.getenv('ALPHA_VANTAGE_API_KEY')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def get_financial_data(function, symbol):
    url = f'https://www.alphavantage.co/query?function={function}&symbol={symbol}&apikey={API_KEY}'
    response = requests.get(url)
    return response.json()

def process_stock_data(symbol):
    print(f"\nProcessing {symbol}...")
    
    # Get financial data
    income_data = get_financial_data('INCOME_STATEMENT', symbol)
    time.sleep(1)  # Adjusted for 75 calls per minute limit
    balance_data = get_financial_data('BALANCE_SHEET', symbol)
    time.sleep(1)
    cash_flow_data = get_financial_data('CASH_FLOW', symbol)
    time.sleep(1)
    
    # Create DataFrames
    income_df = pd.DataFrame(income_data.get('quarterlyReports', []))
    balance_df = pd.DataFrame(balance_data.get('quarterlyReports', []))
    cash_flow_df = pd.DataFrame(cash_flow_data.get('quarterlyReports', []))
    
    if income_df.empty or balance_df.empty or cash_flow_df.empty:
        print(f"No data available for {symbol}")
        return None
    
    # Add prefixes to column names
    income_df.columns = ['date' if col == 'fiscalDateEnding' else f'is_{col.lower()}' for col in income_df.columns]
    balance_df.columns = ['date' if col == 'fiscalDateEnding' else f'bs_{col.lower()}' for col in balance_df.columns]
    cash_flow_df.columns = ['date' if col == 'fiscalDateEnding' else f'cf_{col.lower()}' for col in cash_flow_df.columns]
    
    # Merge all statements
    combined_df = pd.merge(income_df, balance_df, on='date', how='outer')
    combined_df = pd.merge(combined_df, cash_flow_df, on='date', how='outer')
    
    # Convert numeric columns
    numeric_columns = combined_df.columns[1:]  # Skip the date column
    for col in numeric_columns:
        combined_df[col] = pd.to_numeric(combined_df[col], errors='coerce')
        combined_df[col] = combined_df[col].fillna(0)
        combined_df[col] = combined_df[col].replace([float('inf'), float('-inf')], 0)
        combined_df[col] = combined_df[col].astype(float)
    
    # Add symbol column
    combined_df['symbol'] = symbol
    
    return combined_df

# Process all stocks and upload to Supabase
for symbol in SYMBOLS:
    try:
        df = process_stock_data(symbol)
        if df is not None:
            # Convert DataFrame to records
            records = df.to_dict('records')
            
            # Delete existing data for this symbol
            supabase.table('financial_statements').delete().eq('symbol', symbol).execute()
            
            # Insert new data
            result = supabase.table('financial_statements').insert(records).execute()
            print(f"Successfully uploaded {len(records)} records for {symbol}")
        
    except Exception as e:
        print(f"Error processing {symbol}: {str(e)}")

print("\nAll stocks processed!")