declare module 'yahoo-finance2' {
  interface HistoricalData {
    date: Date;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }

  interface QuoteResponse {
    symbol: string;
    regularMarketPrice: number;
    forwardEps?: number;
    forwardPE?: number;
    priceToBook?: number;
    sharesOutstanding?: number;
  }

  interface Price {
    regularMarketPrice: number;
    regularMarketChange: number;
    regularMarketChangePercent: number;
    regularMarketDayHigh: number;
    regularMarketDayLow: number;
    regularMarketVolume: number;
    regularMarketTime: number;
  }

  interface SummaryDetail {
    targetHighPrice: number;
    targetLowPrice: number;
    targetMeanPrice: number;
    targetMedianPrice: number;
    numberOfAnalystOpinions: number;
    recommendationKey: string;
    recommendationMean: number;
    recommendationTrend: {
      period: string;
      strongBuy: number;
      buy: number;
      hold: number;
      sell: number;
      strongSell: number;
    }[];
  }

  interface IncomeStatement {
    totalRevenue: number;
    netIncome: number;
    operatingIncome: number;
    grossProfit: number;
    totalOperatingExpenses: number;
    researchAndDevelopment: number;
    sellingGeneralAndAdministrative: number;
    nonRecurring: number;
    otherOperatingItems: number;
    totalOtherIncomeExpenseNet: number;
    ebit: number;
    interestExpense: number;
    incomeBeforeTax: number;
    incomeTaxExpense: number;
    minorityInterest: number;
    netIncomeFromContinuingOps: number;
    discontinuedOperations: number;
    extraordinaryItems: number;
    effectOfAccountingCharges: number;
    otherItems: number;
    netIncomeApplicableToCommonShares: number;
  }

  interface BalanceSheet {
    totalAssets: number;
    totalCurrentAssets: number;
    cash: number;
    cashAndEquivalents: number;
    inventory: number;
    totalCurrentLiabilities: number;
    totalLiab: number;
    totalStockholderEquity: number;
    netTangibleAssets: number;
    longTermDebt: number;
    shortLongTermDebt: number;
    otherCurrentLiab: number;
    otherLiab: number;
    accountsPayable: number;
    totalCash: number;
    shortTermInvestments: number;
    netReceivables: number;
    longTermInvestments: number;
    propertyPlantEquipment: number;
    otherAssets: number;
    deferredLongTermAssetCharges: number;
    intangibleAssets: number;
    accumulatedAmortization: number;
    otherStockholderEquity: number;
    totalPermanentEquity: number;
    additionalPaidInCapital: number;
    retainedEarnings: number;
    treasuryStock: number;
    accumulatedDepreciation: number;
    capitalSurplus: number;
    minorityInterest: number;
  }

  interface CashFlowStatement {
    freeCashFlow: number;
    totalCashFromOperatingActivities: number;
    netIncome: number;
    depreciation: number;
    totalCashflowsFromInvestingActivities: number;
    capitalExpenditures: number;
    investments: number;
    otherCashflowsFromInvestingActivities: number;
    totalCashFromFinancingActivities: number;
    dividendsPaid: number;
    netBorrowings: number;
    otherCashflowsFromFinancingActivities: number;
    effectOfExchangeRate: number;
    changeInCash: number;
    repurchaseOfStock: number;
    issuanceOfStock: number;
  }

  interface FinancialStatement {
    incomeStatementHistory: IncomeStatement[];
    balanceSheetHistory: BalanceSheet[];
    cashflowStatementHistory: CashFlowStatement[];
  }

  interface DefaultKeyStatistics {
    sharesOutstanding: number;
    floatShares: number;
    shortRatio: number;
    shortPercentOfFloat: number;
    beta: number;
    forwardPE: number;
    trailingPE: number;
    enterpriseValue: number;
    profitMargins: number;
    operatingMargins: number;
    returnOnEquity: number;
    returnOnAssets: number;
    revenue: number;
    revenuePerShare: number;
    grossProfits: number;
    freeCashflow: number;
    operatingCashflow: number;
    earningsGrowth: number;
    revenueGrowth: number;
    grossMargins: number;
    ebitdaMargins: number;
    operatingMargins: number;
    profitMargins: number;
  }

  interface FinancialData {
    forwardEps: number;
    forwardPE: number;
    priceToBook: number;
    priceToSalesTrailing12Months: number;
    enterpriseValue: number;
    profitMargins: number;
    operatingMargins: number;
    returnOnEquity: number;
    returnOnAssets: number;
    revenue: number;
    revenuePerShare: number;
    grossProfits: number;
    freeCashflow: number;
    operatingCashflow: number;
    earningsGrowth: number;
    revenueGrowth: number;
    grossMargins: number;
    ebitdaMargins: number;
    operatingMargins: number;
    profitMargins: number;
    currentRatio: number;
    quickRatio: number;
    debtToEquity: number;
    totalDebt: number;
    totalCash: number;
    totalCashPerShare: number;
    ebitda: number;
  }

  interface QuoteSummaryOptions {
    modules: string[];
  }

  interface HistoricalOptions {
    period1: Date;
    period2: Date;
    interval: '1d' | '1wk' | '1mo';
  }

  interface YahooFinance {
    quote(symbol: string): Promise<QuoteResponse>;
    quoteSummary(symbol: string, options: QuoteSummaryOptions): Promise<{
      incomeStatementHistory: IncomeStatement[];
      balanceSheetHistory: BalanceSheet[];
      cashflowStatementHistory: CashFlowStatement[];
      defaultKeyStatistics: DefaultKeyStatistics;
      financialData: FinancialData;
      price: Price;
      summaryDetail: SummaryDetail;
      recommendationTrend: {
        period: string;
        strongBuy: number;
        buy: number;
        hold: number;
        sell: number;
        strongSell: number;
      }[];
    }>;
    historical(symbol: string, options: HistoricalOptions): Promise<HistoricalData[]>;
  }

  const yahooFinance: YahooFinance;
  export default yahooFinance;
} 