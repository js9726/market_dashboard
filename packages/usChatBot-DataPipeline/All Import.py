import requests
import pandas as pd
from datetime import datetime
from supabase import create_client
from dotenv import load_dotenv
import os
import time

# Load environment variables
load_dotenv()

# Read symbols from file
with open('stock_list.txt', 'r') as f:
    SYMBOLS = [line.strip() for line in f.readlines()]

# Alpha Vantage API configuration
API_KEY = os.getenv('ALPHA_VANTAGE_API_KEY')

# Supabase configuration
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Function to get data from Alpha Vantage
def get_financial_data(function, symbol):
    url = f'https://www.alphavantage.co/query?function={function}&symbol={symbol}&apikey={API_KEY}'
    response = requests.get(url)
    return response.json()

def process_stock_data(symbol):
    print(f"\nProcessing {symbol}...")
    
    # Get all financial data
    income_statement_data = get_financial_data('INCOME_STATEMENT', symbol)
    time.sleep(1)  # Rate limit: 75 calls per minute
    balance_sheet_data = get_financial_data('BALANCE_SHEET', symbol)
    time.sleep(1)
    cash_flow_data = get_financial_data('CASH_FLOW', symbol)
    time.sleep(1)
    
    # Extract quarterly reports for each statement
    income_quarterly = pd.DataFrame(income_statement_data.get('quarterlyReports', []))
    balance_quarterly = pd.DataFrame(balance_sheet_data.get('quarterlyReports', []))
    cash_flow_quarterly = pd.DataFrame(cash_flow_data.get('quarterlyReports', []))
    
    if income_quarterly.empty or balance_quarterly.empty or cash_flow_quarterly.empty:
        print(f"No data available for {symbol}")
        return None
    
    # Add statement type prefix to column names
    income_quarterly.columns = ['date' if col == 'fiscalDateEnding' else f'IS_{col}' for col in income_quarterly.columns]
    balance_quarterly.columns = ['date' if col == 'fiscalDateEnding' else f'BS_{col}' for col in balance_quarterly.columns]
    cash_flow_quarterly.columns = ['date' if col == 'fiscalDateEnding' else f'CF_{col}' for col in cash_flow_quarterly.columns]
    
    # Merge and process data
    combined_df = pd.merge(income_quarterly, balance_quarterly, on='date', how='outer')
    combined_df = pd.merge(combined_df, cash_flow_quarterly, on='date', how='outer')
    combined_df = combined_df.sort_values('date', ascending=False)
    
    # Convert numeric columns
    numeric_columns = combined_df.columns[1:]
    for col in numeric_columns:
        combined_df[col] = pd.to_numeric(combined_df[col], errors='coerce')
        combined_df[col] = combined_df[col].fillna(0)
        combined_df[col] = combined_df[col].replace([float('inf'), float('-inf')], 0)
        combined_df[col] = combined_df[col].astype(object)
    
    return combined_df

# Main execution
if __name__ == "__main__":
    for symbol in SYMBOLS:
        try:
            print(f"Processing {symbol}...")
            combined_df = process_stock_data(symbol)
            
            if combined_df is not None:
                # Convert DataFrame to records
                records = combined_df.to_dict('records')
                records = [{k.lower(): v for k, v in record.items()} for record in records]
                
                # Add symbol to each record
                for record in records:
                    record['symbol'] = symbol
                
                # Upload to Supabase
                supabase.table('financial_statements').delete().eq('symbol', symbol).execute()
                result = supabase.table('financial_statements').insert(records).execute()
                print(f"Successfully uploaded {len(records)} records for {symbol}")
            
        except Exception as e:
            print(f"Error processing {symbol}: {str(e)}")
            continue
    
    print("\nAll stocks processed!")

