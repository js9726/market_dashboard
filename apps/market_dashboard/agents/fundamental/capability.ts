import { HumanMessage, SystemMessage } from 'langchain/schema';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { FinancialMetrics, getFinalancialMetrics } from './tools/api';
import { withRetry } from '../../src/utils/retry';

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
    provider?: string;
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

async function callLLM(provider: string | undefined, system: string, user: string): Promise<string> {
  if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
    });
    const block = msg.content[0];
    return block.type === "text" ? block.text : "{}";
  }

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await withRetry(() =>
      client.chat.completions.create({
        model: "gpt-4o",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        max_tokens: 1024,
      }), 3, 1000);
    return completion.choices[0].message.content ?? "{}";
  }

  // Default: Gemini
  if (!process.env.GEMINI_API_KEY) throw new Error("No LLM provider available");
  const client = new OpenAI({
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    apiKey: process.env.GEMINI_API_KEY,
  });
  const completion = await withRetry(() =>
    client.chat.completions.create({
      model: "gemini-2.5-pro",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
      max_tokens: 1024,
    }), 3, 1000);
  return completion.choices[0].message.content ?? "{}";
}

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

      const hasAnyProvider = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (hasAnyProvider) {
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
          const raw = await callLLM(state.metadata.provider, systemPrompt, metricsPrompt);

          progress.updateStatus("fundamentals_agent", ticker, "Processing AI response");
          const analysis = JSON.parse(raw || '{}');

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
          console.log("Gemini analysis unavailable, using default analysis");
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