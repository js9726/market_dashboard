import { HumanMessage, SystemMessage } from 'langchain/schema';
import OpenAI from 'openai';
import { FinancialMetrics, getFinalancialMetrics } from './tools/api';

interface AgentState {
  data: {
    end_date: string;
    tickers: string[];
    analyst_signals: {
      [key: string]: any;
    };
  };
  metadata: {
    show_reasoning: boolean;
  };
}

interface SignalReasoning {
  signal: string;
  details: string;
}

interface FundamentalAnalysis {
  signal: string;
  confidence: number;
  metrics: any;
  reasoning: {
    profitability_signal: SignalReasoning;
    growth_signal: SignalReasoning;
    financial_health_signal: SignalReasoning;
    price_ratios_signal: SignalReasoning;
  };
}

const progress = {
  updateStatus: (agent: string, ticker: string, status: string) => {
    console.log(`${agent}: ${ticker} - ${status}`);
  }
};

// Initialize DeepSeek client
const openai = new OpenAI({
  baseURL: "https://api.deepseek.com",
  /** Placeholder allows Next build when env is unset; real calls still need DEEPSEEK_API_KEY. */
  apiKey: process.env.DEEPSEEK_API_KEY ?? "build-without-key",
});

const systemPrompt = `You are a professional stock market analyst specializing in fundamental analysis.
Your task is to analyze financial metrics and provide detailed reasoning for your analysis.
Focus on four key areas:
1. Profitability (ROE, margins)
2. Growth (revenue, earnings, book value)
3. Financial Health (liquidity, leverage)
4. Price Ratios (P/E, P/B, P/S)

Provide your analysis in a structured format with clear reasoning for each aspect.`;

export async function fundamentalsAgent(state: AgentState) {
  const { data } = state;
  const { end_date, tickers } = data;
  
  const fundamentalAnalysis: { [key: string]: FundamentalAnalysis } = {};

  for (const ticker of tickers) {
    progress.updateStatus("fundamentals_agent", ticker, "Starting analysis");

    try {
      progress.updateStatus("fundamentals_agent", ticker, "Fetching financial metrics");
      const financialMetrics = await getFinalancialMetrics({
        ticker,
        endDate: end_date,
        period: "ttm",
        limit: 10
      });

      const metrics = financialMetrics[0];
      progress.updateStatus("fundamentals_agent", ticker, "Financial metrics fetched successfully");

      fundamentalAnalysis[ticker] = {
        signal: "neutral",
        confidence: 50,
        metrics: metrics,
        reasoning: {
          profitability_signal: {
            signal: "neutral",
            details: `ROE: ${((metrics.returnOnEquity ?? 0) * 100).toFixed(2)}%, Net Margin: ${((metrics.profitMargins ?? 0) * 100).toFixed(2)}%`
          },
          growth_signal: {
            signal: "neutral",
            details: `Revenue Growth: ${((metrics.revenueGrowth ?? 0) * 100).toFixed(2)}%, Total Revenue: $${((metrics.totalRevenue ?? 0) / 1000000).toFixed(2)}M`
          },
          financial_health_signal: {
            signal: "neutral",
            details: `Current Ratio: ${(metrics.currentRatio ?? 0).toFixed(2)}, Debt to Equity: ${(metrics.debtToEquity ?? 0).toFixed(2)}`
          },
          price_ratios_signal: {
            signal: "neutral",
            details: `Forward P/E: ${(metrics.forwardPE ?? 0).toFixed(2)}, P/S: ${(metrics.priceToSalesTrailing12Months ?? 0).toFixed(2)}`
          }
        }
      };

      if (process.env.DEEPSEEK_API_KEY) {
        try {
          const metricsPrompt = `
          Analyze the following financial metrics for ${ticker}:
          
          Profitability Metrics:
          - Return on Equity: ${((metrics.returnOnEquity ?? 0) * 100).toFixed(2)}%
          - Net Margin: ${((metrics.profitMargins ?? 0) * 100).toFixed(2)}%
          - Operating Margin: ${((metrics.operatingMargins ?? 0) * 100).toFixed(2)}%
          
          Growth Metrics:
          - Revenue Growth: ${((metrics.revenueGrowth ?? 0) * 100).toFixed(2)}%
          
          Financial Health:
          - Current Ratio: ${metrics.currentRatio ?? "N/A"}
          - Debt to Equity: ${metrics.debtToEquity ?? "N/A"}
          - Free Cash Flow: ${metrics.freeCashflow ?? "N/A"}
          
          Price Ratios:
          - Forward P/E: ${metrics.forwardPE ?? "N/A"}
          - P/B Ratio: ${metrics.priceToBook ?? "N/A"}
          - P/S Ratio: ${metrics.priceToSalesTrailing12Months ?? "N/A"}
          
          Please provide a detailed analysis with signals (bullish/bearish/neutral) and confidence levels for each aspect.`;

          progress.updateStatus("fundamentals_agent", ticker, "Requesting AI analysis");
          const completion = await openai.chat.completions.create({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: metricsPrompt }
            ],
            model: "deepseek-chat",
            temperature: 0.7,
            max_tokens: 1000
          });

          progress.updateStatus("fundamentals_agent", ticker, "Processing AI response");
          const analysis = JSON.parse(completion.choices[0].message.content || '{}');
          
          fundamentalAnalysis[ticker] = {
            signal: analysis.overall_signal,
            confidence: analysis.confidence,
            metrics: metrics,
            reasoning: {
              profitability_signal: analysis.profitability,
              growth_signal: analysis.growth,
              financial_health_signal: analysis.financial_health,
              price_ratios_signal: analysis.price_ratios
            }
          };
        } catch (error) {
          console.log("OpenAI analysis unavailable, using default analysis");
        }
      }

      progress.updateStatus("fundamentals_agent", ticker, "Analysis complete");
    } catch (error) {
      console.error(`Error analyzing ${ticker}:`, error);
      progress.updateStatus("fundamentals_agent", ticker, "Analysis failed");
      
      fundamentalAnalysis[ticker] = {
        signal: "neutral",
        confidence: 50,
        metrics: {},
        reasoning: {
          profitability_signal: { signal: "neutral", details: "Analysis unavailable" },
          growth_signal: { signal: "neutral", details: "Analysis unavailable" },
          financial_health_signal: { signal: "neutral", details: "Analysis unavailable" },
          price_ratios_signal: { signal: "neutral", details: "Analysis unavailable" }
        }
      };
    }
  }

  progress.updateStatus("fundamentals_agent", "all", "All analyses completed");
  const message = new HumanMessage({
    content: JSON.stringify(fundamentalAnalysis),
    name: "fundamentals_agent"
  });

  if (state.metadata.show_reasoning) {
    showAgentReasoning(fundamentalAnalysis, "Fundamental Analysis Agent");
  }

  state.data.analyst_signals.fundamentals_agent = fundamentalAnalysis;

  return {
    messages: [message],
    data: state.data
  };
}

function showAgentReasoning(analysis: any, agentName: string): void {
  console.log(`\n${agentName} Reasoning:`);
  console.log(JSON.stringify(analysis, null, 2));
}