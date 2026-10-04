import { getFinalancialMetrics } from './tools/api';
import { callLLM } from '../../src/utils/llm-router';
import { isMeteredLLMProviderConfigured } from '../../src/lib/ai/provider-policy';
import type { AgentMessage, AgentState } from '../../src/types/agent';

interface SignalReasoning {
  signal: string;
  details: string;
}

interface FundamentalAnalysis {
  analysisAvailable: boolean;
  analysisReason: string;
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

function formatMetric(value: unknown, scale = 1): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? (value * scale).toFixed(2) : 'Unavailable';
}

const progress = {
  updateStatus: (agent: string, ticker: string, status: string) => {
    console.log(`${agent}: ${ticker} - ${status}`);
  }
};

const systemPrompt = `You are a professional stock market analyst specializing in fundamental analysis.
Your task is to analyze financial metrics and provide detailed reasoning for your analysis.
Focus on four key areas:
1. Profitability (ROE, margins)
2. Growth (revenue, earnings, book value)
3. Financial Health (liquidity, leverage)
4. Price Ratios (P/E, P/B, P/S)

Respond ONLY with a JSON object in this exact shape:
{
  "overall_signal": "bullish" | "bearish" | "neutral",
  "confidence": <integer 0-100>,
  "profitability": { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>" },
  "growth": { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>" },
  "financial_health": { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>" },
  "price_ratios": { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>" }
}`;

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
        analysisAvailable: false,
        analysisReason: "Financial metrics only; AI analysis unavailable.",
        signal: "unknown",
        confidence: 0,
        metrics: metrics,
        reasoning: {
          profitability_signal: {
            signal: "neutral",
            details: `ROE: ${formatMetric(metrics.returnOnEquity, 100)}%, Net Margin: ${formatMetric(metrics.profitMargins, 100)}%`
          },
          growth_signal: {
            signal: "neutral",
            details: `Revenue Growth: ${formatMetric(metrics.revenueGrowth, 100)}%, Total Revenue: $${formatMetric(metrics.totalRevenue, 0.000001)}M`
          },
          financial_health_signal: {
            signal: "neutral",
            details: `Current Ratio: ${formatMetric(metrics.currentRatio)}, Debt to Equity: ${formatMetric(metrics.debtToEquity)}`
          },
          price_ratios_signal: {
            signal: "neutral",
            details: `Forward P/E: ${formatMetric(metrics.forwardPE)}, P/S: ${formatMetric(metrics.priceToSalesTrailing12Months)}`
          }
        }
      };

      const hasAnyProvider = isMeteredLLMProviderConfigured("deepseek");
      if (hasAnyProvider) {
        try {
          const metricsPrompt = `
          Analyze the following financial metrics for ${ticker}:

          Profitability Metrics:
          - Return on Equity: ${formatMetric(metrics.returnOnEquity, 100)}%
          - Net Margin: ${formatMetric(metrics.profitMargins, 100)}%
          - Operating Margin: ${formatMetric(metrics.operatingMargins, 100)}%

          Growth Metrics:
          - Revenue Growth: ${formatMetric(metrics.revenueGrowth, 100)}%

          Financial Health:
          - Current Ratio: ${formatMetric(metrics.currentRatio)}
          - Debt to Equity: ${formatMetric(metrics.debtToEquity)}
          - Free Cash Flow: ${formatMetric(metrics.freeCashflow)}

          Price Ratios:
          - Forward P/E: ${formatMetric(metrics.forwardPE)}
          - P/B Ratio: ${formatMetric(metrics.priceToBook)}
          - P/S Ratio: ${formatMetric(metrics.priceToSalesTrailing12Months)}

          Please provide a detailed analysis with signals (bullish/bearish/neutral) and confidence levels for each aspect.`;

          progress.updateStatus("fundamentals_agent", ticker, "Requesting AI analysis");
          const raw = await callLLM(metricsPrompt, systemPrompt, { maxTokens: 1024, tier: "fast" });

          progress.updateStatus("fundamentals_agent", ticker, "Processing AI response");
          const analysis = JSON.parse(raw || '{}');

          if (!['bullish', 'bearish', 'neutral'].includes(analysis.overall_signal)
            || !Number.isFinite(analysis.confidence) || analysis.confidence < 0 || analysis.confidence > 100
            || !['profitability', 'growth', 'financial_health', 'price_ratios'].every(
              key => typeof analysis[key]?.details === 'string' && analysis[key].details.trim()
            )) throw new Error('Incomplete fundamental analysis response');
          fundamentalAnalysis[ticker] = {
            analysisAvailable: true,
            analysisReason: "Legacy fundamental analysis; full research contract is separate.",
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
          console.log("DeepSeek analysis unavailable; retaining financial metrics only");
        }
      }

      progress.updateStatus("fundamentals_agent", ticker, "Analysis complete");
    } catch (error) {
      console.error(`Error analyzing ${ticker}:`, error);
      progress.updateStatus("fundamentals_agent", ticker, "Analysis failed");
      
      fundamentalAnalysis[ticker] = {
        analysisAvailable: false,
        analysisReason: "Financial metrics only; AI analysis unavailable.",
        signal: "unknown",
        confidence: 0,
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
  const message: AgentMessage = {
    content: JSON.stringify(fundamentalAnalysis),
    name: "fundamentals_agent",
  };

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
