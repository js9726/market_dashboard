import { HumanMessage } from 'langchain/schema';
import OpenAI from 'openai';
import yahooFinance from 'yahoo-finance2';

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

interface TechnicalSignal {
  signal: string;
  details: string;
}

interface TechnicalAnalysis {
  signal: string;
  confidence: number;
  metrics: {
    price: number;
    volume: number;
    moving_averages: {
      sma_20: number;
      sma_50: number;
      sma_200: number;
    };
    rsi: number;
    macd: {
      macd: number;
      signal: number;
      histogram: number;
    };
  };
  reasoning: {
    trend_signal: TechnicalSignal;
    momentum_signal: TechnicalSignal;
    volume_signal: TechnicalSignal;
    support_resistance_signal: TechnicalSignal;
  };
}

const progress = {
  updateStatus: (agent: string, ticker: string, status: string) => {
    console.log(`${agent}: ${ticker} - ${status}`);
  }
};

// Initialize DeepSeek client
const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

const systemPrompt = `You are a professional technical analyst specializing in stock market analysis.
Your task is to analyze technical indicators and price patterns to provide trading signals.
Focus on four key areas:
1. Trend Analysis (Moving Averages, Price Action)
2. Momentum (RSI, MACD)
3. Volume Analysis
4. Support/Resistance Levels

Provide your analysis in a structured format with clear reasoning for each aspect.`;

async function getTechnicalMetrics(ticker: string, endDate: string) {
  try {
    // Get historical data
    const result = await yahooFinance.historical(ticker, {
      period1: new Date(new Date(endDate).setFullYear(new Date(endDate).getFullYear() - 1)),
      period2: new Date(endDate),
      interval: '1d'
    });

    if (!result || result.length === 0) {
      throw new Error('No historical data available');
    }

    // Calculate technical indicators
    const prices = result.map(d => d.close);
    const volumes = result.map(d => d.volume);
    const latestPrice = prices[prices.length - 1];
    const latestVolume = volumes[volumes.length - 1];

    // Calculate SMAs
    const sma20 = calculateSMA(prices, 20);
    const sma50 = calculateSMA(prices, 50);
    const sma200 = calculateSMA(prices, 200);

    // Calculate RSI
    const rsi = calculateRSI(prices);

    // Calculate MACD
    const macd = calculateMACD(prices);

    return {
      price: latestPrice,
      volume: latestVolume,
      moving_averages: {
        sma_20: sma20,
        sma_50: sma50,
        sma_200: sma200
      },
      rsi: rsi,
      macd: macd
    };
  } catch (error) {
    console.error(`Error calculating technical metrics for ${ticker}:`, error);
    throw error;
  }
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const sum = prices.slice(-period).reduce((a, b) => a + b, 0);
  return sum / period;
}

function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  
  const changes = prices.slice(1).map((price, i) => price - prices[i]);
  const gains = changes.map(change => change > 0 ? change : 0);
  const losses = changes.map(change => change < 0 ? -change : 0);
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([macd], 9);
  const histogram = macd - signal;

  return { macd, signal, histogram };
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period + 1) return prices[prices.length - 1];
  
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  
  return ema;
}

export async function technicalAgent(state: AgentState) {
  const { data } = state;
  const { end_date, tickers } = data;
  
  const technicalAnalysis: { [key: string]: TechnicalAnalysis } = {};

  for (const ticker of tickers) {
    progress.updateStatus("technical_agent", ticker, "Starting analysis");

    try {
      progress.updateStatus("technical_agent", ticker, "Fetching technical metrics");
      const metrics = await getTechnicalMetrics(ticker, end_date);
      progress.updateStatus("technical_agent", ticker, "Technical metrics fetched successfully");

      const metricsPrompt = `
      Analyze the following technical metrics for ${ticker}:
      
      Price and Volume:
      - Current Price: ${metrics.price}
      - Current Volume: ${metrics.volume}
      
      Moving Averages:
      - 20-day SMA: ${metrics.moving_averages.sma_20}
      - 50-day SMA: ${metrics.moving_averages.sma_50}
      - 200-day SMA: ${metrics.moving_averages.sma_200}
      
      Momentum Indicators:
      - RSI: ${metrics.rsi}
      - MACD: ${metrics.macd.macd}
      - MACD Signal: ${metrics.macd.signal}
      - MACD Histogram: ${metrics.macd.histogram}
      
      Please provide a detailed technical analysis with signals (bullish/bearish/neutral) and confidence levels for each aspect.`;

      progress.updateStatus("technical_agent", ticker, "Requesting AI analysis");
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: metricsPrompt }
        ],
        model: "deepseek-chat",
        temperature: 0.7,
        max_tokens: 1000
      });

      progress.updateStatus("technical_agent", ticker, "Processing AI response");
      const analysis = JSON.parse(completion.choices[0].message.content || '{}');
      
      technicalAnalysis[ticker] = {
        signal: analysis.overall_signal,
        confidence: analysis.confidence,
        metrics: metrics,
        reasoning: {
          trend_signal: analysis.trend,
          momentum_signal: analysis.momentum,
          volume_signal: analysis.volume,
          support_resistance_signal: analysis.support_resistance
        }
      };

      progress.updateStatus("technical_agent", ticker, "Analysis complete");
    } catch (error) {
      console.error(`Error analyzing ${ticker}:`, error);
      progress.updateStatus("technical_agent", ticker, "Analysis failed");
      technicalAnalysis[ticker] = {
        signal: "neutral",
        confidence: 50,
        metrics: {
          price: 0,
          volume: 0,
          moving_averages: {
            sma_20: 0,
            sma_50: 0,
            sma_200: 0
          },
          rsi: 50,
          macd: {
            macd: 0,
            signal: 0,
            histogram: 0
          }
        },
        reasoning: {
          trend_signal: { signal: "neutral", details: "Technical analysis unavailable" },
          momentum_signal: { signal: "neutral", details: "Technical analysis unavailable" },
          volume_signal: { signal: "neutral", details: "Technical analysis unavailable" },
          support_resistance_signal: { signal: "neutral", details: "Technical analysis unavailable" }
        }
      };
    }
  }

  progress.updateStatus("technical_agent", "all", "All analyses completed");
  const message = new HumanMessage({
    content: JSON.stringify(technicalAnalysis),
    name: "technical_agent"
  });

  if (state.metadata.show_reasoning) {
    showAgentReasoning(technicalAnalysis, "Technical Analysis Agent");
  }

  state.data.analyst_signals.technical_agent = technicalAnalysis;

  return {
    messages: [message],
    data: state.data
  };
}

function showAgentReasoning(analysis: any, agentName: string): void {
  console.log(`\n${agentName} Reasoning:`);
  console.log(JSON.stringify(analysis, null, 2));
} 