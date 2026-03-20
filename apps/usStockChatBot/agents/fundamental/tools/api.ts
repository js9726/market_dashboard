import yahooFinance from 'yahoo-finance2';

export interface FinancialMetrics {
  // Price & Market Data
  currentPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;
  targetMeanPrice: number | null;
  numberOfAnalystOpinions: number | null;

  // Profitability
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  profitMargins: number | null;
  operatingMargins: number | null;
  grossMargins: number | null;
  ebitdaMargins: number | null;

  // Growth & Revenue
  revenueGrowth: number | null;
  revenuePerShare: number | null;
  totalRevenue: number | null;
  grossProfits: number | null;

  // Financial Health
  currentRatio: number | null;
  quickRatio: number | null;
  debtToEquity: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  totalCashPerShare: number | null;

  // Cash Flow
  freeCashflow: number | null;
  operatingCashflow: number | null;
  ebitda: number | null;

  // Valuation Ratios
  forwardPE: number | null;
  priceToBook: number | null;
  priceToSalesTrailing12Months: number | null;
}

interface GetFinancialMetricsParams {
  ticker: string;
  endDate: string;
  period: string;
  limit: number;
}

export async function getFinalancialMetrics(params: GetFinancialMetricsParams): Promise<FinancialMetrics[]> {
  try {
    const { ticker } = params;
    console.log('\n=== Fetching Financial Metrics ===');
    console.log(`Ticker: ${ticker}`);
    
    // Get quote data first
    const quote = await yahooFinance.quote(ticker);
    console.log('Quote data:', JSON.stringify(quote, null, 2));

    // Get detailed financial data
    const quoteSummary = await yahooFinance.quoteSummary(ticker, {
      modules: [
        'price',
        'summaryDetail',
        'financialData',
        'defaultKeyStatistics',
        'recommendationTrend'
      ]
    });

    console.log('QuoteSummary raw response:', JSON.stringify(quoteSummary, null, 2));

    // Extract the data we need
    const {
      price,
      summaryDetail,
      financialData,
      defaultKeyStatistics,
      recommendationTrend
    } = quoteSummary;

    // Create metrics object with the actual data
    const metrics: FinancialMetrics = {
      // Price & Market Data
      currentPrice: price?.regularMarketPrice ?? null,
      targetHighPrice: summaryDetail?.targetHighPrice ?? null,
      targetLowPrice: summaryDetail?.targetLowPrice ?? null,
      targetMeanPrice: summaryDetail?.targetMeanPrice ?? null,
      numberOfAnalystOpinions: summaryDetail?.numberOfAnalystOpinions ?? null,

      // Profitability
      returnOnEquity: financialData?.returnOnEquity ?? null,
      returnOnAssets: financialData?.returnOnAssets ?? null,
      profitMargins: financialData?.profitMargins ?? null,
      operatingMargins: financialData?.operatingMargins ?? null,
      grossMargins: financialData?.grossMargins ?? null,
      ebitdaMargins: financialData?.ebitdaMargins ?? null,

      // Growth & Revenue
      revenueGrowth: financialData?.revenueGrowth ?? null,
      revenuePerShare: financialData?.revenuePerShare ?? null,
      totalRevenue: financialData?.totalRevenue ?? null,
      grossProfits: financialData?.grossProfits ?? null,

      // Financial Health
      currentRatio: financialData?.currentRatio ?? null,
      quickRatio: financialData?.quickRatio ?? null,
      debtToEquity: financialData?.debtToEquity ?? null,
      totalDebt: financialData?.totalDebt ?? null,
      totalCash: financialData?.totalCash ?? null,
      totalCashPerShare: financialData?.totalCashPerShare ?? null,

      // Cash Flow
      freeCashflow: financialData?.freeCashflow ?? null,
      operatingCashflow: financialData?.operatingCashflow ?? null,
      ebitda: financialData?.ebitda ?? null,

      // Valuation Ratios
      forwardPE: summaryDetail?.forwardPE ?? null,
      priceToBook: summaryDetail?.priceToBook ?? null,
      priceToSalesTrailing12Months: summaryDetail?.priceToSalesTrailing12Months ?? null
    };

    console.log('Final metrics object:', JSON.stringify(metrics, null, 2));

    return [metrics];
  } catch (error) {
    console.error('Error in getFinalancialMetrics:', error);
    throw error;
  }
}

// Helper functions to calculate financial metrics
function calculateReturnOnEquity(incomeStatement: any, balanceSheet: any): number | null {
  try {
    const netIncome = incomeStatement?.incomeStatementHistory?.[0]?.netIncome;
    const totalEquity = balanceSheet?.balanceSheetHistory?.[0]?.totalStockholderEquity;
    console.log('ROE Calculation:', { netIncome, totalEquity });
    if (!netIncome || !totalEquity) return null;
    return (netIncome / totalEquity) * 100;
  } catch (error) {
    console.error('Error calculating ROE:', error);
    return null;
  }
}

function calculateNetMargin(incomeStatement: any): number | null {
  try {
    const netIncome = incomeStatement?.incomeStatementHistory?.[0]?.netIncome;
    const revenue = incomeStatement?.incomeStatementHistory?.[0]?.totalRevenue;
    console.log('Net Margin Calculation:', { netIncome, revenue });
    if (!netIncome || !revenue) return null;
    return (netIncome / revenue) * 100;
  } catch (error) {
    console.error('Error calculating Net Margin:', error);
    return null;
  }
}

function calculateOperatingMargin(incomeStatement: any): number | null {
  try {
    const operatingIncome = incomeStatement?.incomeStatementHistory?.[0]?.operatingIncome;
    const revenue = incomeStatement?.incomeStatementHistory?.[0]?.totalRevenue;
    console.log('Operating Margin Calculation:', { operatingIncome, revenue });
    if (!operatingIncome || !revenue) return null;
    return (operatingIncome / revenue) * 100;
  } catch (error) {
    console.error('Error calculating Operating Margin:', error);
    return null;
  }
}

function calculateRevenueGrowth(incomeStatement: any): number | null {
  try {
    const currentRevenue = incomeStatement?.incomeStatementHistory?.[0]?.totalRevenue;
    const previousRevenue = incomeStatement?.incomeStatementHistory?.[1]?.totalRevenue;
    console.log('Revenue Growth Calculation:', { currentRevenue, previousRevenue });
    if (!currentRevenue || !previousRevenue) return null;
    return ((currentRevenue - previousRevenue) / previousRevenue) * 100;
  } catch (error) {
    console.error('Error calculating Revenue Growth:', error);
    return null;
  }
}

function calculateEarningsGrowth(incomeStatement: any): number | null {
  try {
    const currentEarnings = incomeStatement?.incomeStatementHistory?.[0]?.netIncome;
    const previousEarnings = incomeStatement?.incomeStatementHistory?.[1]?.netIncome;
    console.log('Earnings Growth Calculation:', { currentEarnings, previousEarnings });
    if (!currentEarnings || !previousEarnings) return null;
    return ((currentEarnings - previousEarnings) / previousEarnings) * 100;
  } catch (error) {
    console.error('Error calculating Earnings Growth:', error);
    return null;
  }
}

function calculateBookValueGrowth(balanceSheet: any): number | null {
  try {
    const currentEquity = balanceSheet?.balanceSheetHistory?.[0]?.totalStockholderEquity;
    const previousEquity = balanceSheet?.balanceSheetHistory?.[1]?.totalStockholderEquity;
    console.log('Book Value Growth Calculation:', { currentEquity, previousEquity });
    if (!currentEquity || !previousEquity) return null;
    return ((currentEquity - previousEquity) / previousEquity) * 100;
  } catch (error) {
    console.error('Error calculating Book Value Growth:', error);
    return null;
  }
}

function calculateCurrentRatio(balanceSheet: any): number | null {
  try {
    const currentAssets = balanceSheet?.balanceSheetHistory?.[0]?.totalCurrentAssets;
    const currentLiabilities = balanceSheet?.balanceSheetHistory?.[0]?.totalCurrentLiabilities;
    console.log('Current Ratio Calculation:', { currentAssets, currentLiabilities });
    if (!currentAssets || !currentLiabilities) return null;
    return currentAssets / currentLiabilities;
  } catch (error) {
    console.error('Error calculating Current Ratio:', error);
    return null;
  }
}

function calculateDebtToEquity(balanceSheet: any): number | null {
  try {
    const totalDebt = balanceSheet?.balanceSheetHistory?.[0]?.longTermDebt;
    const totalEquity = balanceSheet?.balanceSheetHistory?.[0]?.totalStockholderEquity;
    console.log('Debt to Equity Calculation:', { totalDebt, totalEquity });
    if (!totalDebt || !totalEquity) return null;
    return totalDebt / totalEquity;
  } catch (error) {
    console.error('Error calculating Debt to Equity:', error);
    return null;
  }
}

function calculateFreeCashFlowPerShare(cashFlow: any, stats: any): number | null {
  try {
    const freeCashFlow = cashFlow?.cashflowStatementHistory?.[0]?.freeCashFlow;
    const sharesOutstanding = stats?.sharesOutstanding;
    console.log('Free Cash Flow per Share Calculation:', { freeCashFlow, sharesOutstanding });
    if (!freeCashFlow || !sharesOutstanding) return null;
    return freeCashFlow / sharesOutstanding;
  } catch (error) {
    console.error('Error calculating Free Cash Flow per Share:', error);
    return null;
  }
} 