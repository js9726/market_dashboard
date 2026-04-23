import { HumanMessage } from 'langchain/schema';
import yahooFinance from 'yahoo-finance2';
import { withRetry } from '../../src/utils/retry';
import { callLLM } from '../../src/utils/llm-router';

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

interface TraderSignal {
  signal: string;
  details: string;
  confidence: number;
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
  trader_signals: {
    markminervini: TraderSignal;
    clement_ang: TraderSignal;
    jfsrev: TraderSignal;
    ted_zhang: TraderSignal;
    srx_trades: TraderSignal;
    prime_trading: TraderSignal;
  };
}

const progress = {
  updateStatus: (agent: string, ticker: string, status: string) => {
    console.log(`${agent}: ${ticker} - ${status}`);
  }
};

const systemPrompt = `You are a professional technical analyst. Evaluate the given technical metrics through the lens of 6 distinct trader personas. For each trader, output a signal (bullish/bearish/neutral), confidence (0-100), and brief details explaining their specific criteria.

Trader profiles:
- markminervini: SEPA/Superperformance. Requires Stage 2 uptrend (price > 50-day > 150-day > 200-day SMA, 200-day rising). VCP base forming (volatility contracting). Bullish only if: price above all MAs in proper stack, base ≥5 weeks, volume drying up. Bearish if below 50-day MA.
- clement_ang: Swing/Superperformance. 21/50 EMA confluence. Looks for pullback to rising 21-EMA on low volume. Bullish if: price pulling back to 21-EMA (SMA-20 proxy), liquid leader. Bearish if extended far above 21-EMA or no EMA support.
- jfsrev: Mechanical/Systematic. Requires RVOL confirmation (volume > average). Stop width < 60% of ATR. Not extended > 4× ATR from 50-MA. Bullish if: volume confirming, tight range, not extended. Bearish if: low volume, wide stop, or pre-earnings.
- ted_zhang: Institutional/Portfolio Manager. Three pillars: price > 20 > 50 > 200 SMA stack, strong fundamentals, sector leadership. Bullish if SMA stack intact, bearish if any key MA broken. Longer-term bias.
- srx_trades: Technical Swing. Two setups: (A) Breakout — tight coil above MAs, volume confirming. (B) MA Pullback — 8/21/50 EMA pullback on LOW volume. Bullish if coiled above MAs with volume drying up. Uses 4-tranche exit plan.
- prime_trading: Momentum/21-dma Pullback ONLY. Entry must be within 0-1× ATR of rising 21-dma (use SMA-20 as proxy). Bullish if price within 1 ATR of SMA-20 and SMA-20 is rising. Bearish if extended above or below.

Respond ONLY with a JSON object:
{
  "overall_signal": "bullish" | "bearish" | "neutral",
  "overall_confidence": <integer 0-100>,
  "markminervini": { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>", "confidence": <integer 0-100> },
  "clement_ang":   { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>", "confidence": <integer 0-100> },
  "jfsrev":        { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>", "confidence": <integer 0-100> },
  "ted_zhang":     { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>", "confidence": <integer 0-100> },
  "srx_trades":    { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>", "confidence": <integer 0-100> },
  "prime_trading": { "signal": "bullish" | "bearish" | "neutral", "details": "<reasoning>", "confidence": <integer 0-100> }
}`;

async function getTechnicalMetrics(ticker: string, endDate: string) {
  const result = await withRetry(async () => {
    // @ts-expect-error: yahoo-finance2 types omit the queryOptions 3rd argument
    return yahooFinance.historical(ticker, { period1: new Date(new Date(endDate).setFullYear(new Date(endDate).getFullYear() - 1)), period2: new Date(endDate), interval: '1d' }, { skipValidation: true });
  }, 3, 2000);

  if (!result || result.length === 0) {
    throw new Error('No historical data available');
  }

  const prices = result.map((d: any) => d.close);
  const volumes = result.map((d: any) => d.volume);
  const latestPrice = prices[prices.length - 1];
  const latestVolume = volumes[volumes.length - 1];

  return {
    price: latestPrice,
    volume: latestVolume,
    moving_averages: {
      sma_20: calculateSMA(prices, 20),
      sma_50: calculateSMA(prices, 50),
      sma_200: calculateSMA(prices, 200),
    },
    rsi: calculateRSI(prices),
    macd: calculateMACD(prices),
  };
}

function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const sum = prices.slice(-period).reduce((a: number, b: number) => a + b, 0);
  return sum / period;
}

function calculateRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  const changes = prices.slice(1).map((price: number, i: number) => price - prices[i]);
  const gains = changes.map((c: number) => c > 0 ? c : 0);
  const losses = changes.map((c: number) => c < 0 ? -c : 0);
  const avgGain = gains.slice(-period).reduce((a: number, b: number) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a: number, b: number) => a + b, 0) / period;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = calculateEMA([macd], 9);
  return { macd, signal, histogram: macd - signal };
}

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period + 1) return prices[prices.length - 1];
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a: number, b: number) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

const defaultTraderSignal: TraderSignal = { signal: "neutral", details: "Technical analysis unavailable", confidence: 50 };

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

      const avgVolume = metrics.volume;
      const atr = Math.abs(metrics.price - metrics.moving_averages.sma_20);

      const metricsPrompt = `Analyze the following technical metrics for ${ticker}:

Price and Volume:
- Current Price: ${metrics.price.toFixed(2)}
- Current Volume: ${metrics.volume.toLocaleString()}
- Avg Volume (proxy): ${avgVolume.toLocaleString()}

Moving Averages:
- 20-day SMA (21-EMA proxy): ${metrics.moving_averages.sma_20.toFixed(2)}
- 50-day SMA: ${metrics.moving_averages.sma_50.toFixed(2)}
- 200-day SMA: ${metrics.moving_averages.sma_200.toFixed(2)}

Momentum Indicators:
- RSI (14): ${metrics.rsi.toFixed(2)}
- MACD: ${metrics.macd.macd.toFixed(4)}
- MACD Signal: ${metrics.macd.signal.toFixed(4)}
- MACD Histogram: ${metrics.macd.histogram.toFixed(4)}

Derived:
- Price distance from SMA-20: ${(metrics.price - metrics.moving_averages.sma_20).toFixed(2)} (${((metrics.price / metrics.moving_averages.sma_20 - 1) * 100).toFixed(1)}%)
- Price distance from SMA-50: ${(metrics.price - metrics.moving_averages.sma_50).toFixed(2)} (${((metrics.price / metrics.moving_averages.sma_50 - 1) * 100).toFixed(1)}%)
- Price distance from SMA-200: ${(metrics.price - metrics.moving_averages.sma_200).toFixed(2)} (${((metrics.price / metrics.moving_averages.sma_200 - 1) * 100).toFixed(1)}%)
- Approx ATR (|price - SMA20|): ${atr.toFixed(2)}
- SMA stack (20>50>200): ${metrics.moving_averages.sma_20 > metrics.moving_averages.sma_50 && metrics.moving_averages.sma_50 > metrics.moving_averages.sma_200 ? "YES" : "NO"}`;

      progress.updateStatus("technical_agent", ticker, "Requesting 6-trader AI analysis");
      const raw = await callLLM(metricsPrompt, systemPrompt, { maxTokens: 1500 });

      progress.updateStatus("technical_agent", ticker, "Processing AI response");
      const analysis = JSON.parse(raw || '{}');

      technicalAnalysis[ticker] = {
        signal: analysis.overall_signal ?? "neutral",
        confidence: analysis.overall_confidence ?? 50,
        metrics,
        trader_signals: {
          markminervini: analysis.markminervini ?? defaultTraderSignal,
          clement_ang: analysis.clement_ang ?? defaultTraderSignal,
          jfsrev: analysis.jfsrev ?? defaultTraderSignal,
          ted_zhang: analysis.ted_zhang ?? defaultTraderSignal,
          srx_trades: analysis.srx_trades ?? defaultTraderSignal,
          prime_trading: analysis.prime_trading ?? defaultTraderSignal,
        },
      };

      progress.updateStatus("technical_agent", ticker, "Analysis complete");
    } catch (error) {
      console.error(`Error analyzing ${ticker}:`, error);
      progress.updateStatus("technical_agent", ticker, "Analysis failed");
      technicalAnalysis[ticker] = {
        signal: "neutral",
        confidence: 50,
        metrics: {
          price: 0, volume: 0,
          moving_averages: { sma_20: 0, sma_50: 0, sma_200: 0 },
          rsi: 50,
          macd: { macd: 0, signal: 0, histogram: 0 },
        },
        trader_signals: {
          markminervini: defaultTraderSignal,
          clement_ang: defaultTraderSignal,
          jfsrev: defaultTraderSignal,
          ted_zhang: defaultTraderSignal,
          srx_trades: defaultTraderSignal,
          prime_trading: defaultTraderSignal,
        },
      };
    }
  }

  progress.updateStatus("technical_agent", "all", "All analyses completed");
  const message = new HumanMessage({
    content: JSON.stringify(technicalAnalysis),
    name: "technical_agent"
  });

  if (state.metadata.show_reasoning) {
    console.log(`\nTechnical Analysis Agent Reasoning:`);
    console.log(JSON.stringify(technicalAnalysis, null, 2));
  }

  state.data.analyst_signals.technical_agent = technicalAnalysis;

  return {
    messages: [message],
    data: state.data
  };
}
