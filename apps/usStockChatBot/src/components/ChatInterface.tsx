"use client";

import React, { useState, useRef, useEffect } from 'react';
import ChatMessage from './ChatMessage';

interface Message {
  text: string;
  isUser: boolean;
}

interface FundamentalEntry {
  signal: string;
  confidence: number;
  metrics: Record<string, unknown>;
  reasoning: {
    profitability_signal: { details: string };
    growth_signal: { details: string };
    financial_health_signal: { details: string };
    price_ratios_signal: { details: string };
  };
}

const ChatInterface: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const formatMetrics = (metrics: Record<string, unknown> | null | undefined) => {
    if (!metrics) return 'No metrics available';
    
    const formatNumber = (value: unknown, isPercentage = false, inMillions = false) => {
      if (value === null || value === undefined) return 'N/A';
      const num = Number(value);
      if (isNaN(num)) return 'N/A';
      
      let result = num;
      if (isPercentage) result *= 100;
      if (inMillions) result /= 1000000;
      
      return result.toFixed(2) + (isPercentage ? '%' : (inMillions ? 'M' : ''));
    };
    
    // Use template literal with backticks to preserve line breaks
    return [
      'Raw Financial Metrics:',
      '',
      'Price & Market Data:',
      `- Current Price: ${formatNumber(metrics.currentPrice)}`,
      `- Target High Price: ${formatNumber(metrics.targetHighPrice)}`,
      `- Target Low Price: ${formatNumber(metrics.targetLowPrice)}`,
      `- Target Mean Price: ${formatNumber(metrics.targetMeanPrice)}`,
      `- Number of Analyst Opinions: ${metrics.numberOfAnalystOpinions ?? 'N/A'}`,
      '',
      'Profitability:',
      `- Return on Equity: ${formatNumber(metrics.returnOnEquity, true)}`,
      `- Return on Assets: ${formatNumber(metrics.returnOnAssets, true)}`,
      `- Net Margin: ${formatNumber(metrics.profitMargins, true)}`,
      `- Operating Margin: ${formatNumber(metrics.operatingMargins, true)}`,
      `- Gross Margin: ${formatNumber(metrics.grossMargins, true)}`,
      `- EBITDA Margin: ${formatNumber(metrics.ebitdaMargins, true)}`,
      '',
      'Growth & Revenue:',
      `- Revenue Growth: ${formatNumber(metrics.revenueGrowth, true)}`,
      `- Revenue per Share: ${formatNumber(metrics.revenuePerShare)}`,
      `- Total Revenue: ${formatNumber(metrics.totalRevenue, false, true)}`,
      `- Gross Profits: ${formatNumber(metrics.grossProfits, false, true)}`,
      '',
      'Financial Health:',
      `- Current Ratio: ${formatNumber(metrics.currentRatio)}`,
      `- Quick Ratio: ${formatNumber(metrics.quickRatio)}`,
      `- Debt to Equity: ${formatNumber(metrics.debtToEquity)}`,
      `- Total Debt: ${formatNumber(metrics.totalDebt, false, true)}`,
      `- Total Cash: ${formatNumber(metrics.totalCash, false, true)}`,
      `- Cash per Share: ${formatNumber(metrics.totalCashPerShare)}`,
      '',
      'Cash Flow:',
      `- Free Cash Flow: ${formatNumber(metrics.freeCashflow, false, true)}`,
      `- Operating Cash Flow: ${formatNumber(metrics.operatingCashflow, false, true)}`,
      `- EBITDA: ${formatNumber(metrics.ebitda, false, true)}`,
      '',
      'Valuation Ratios:',
      `- Forward P/E: ${formatNumber(metrics.forwardPE)}`,
      `- Price to Book: ${formatNumber(metrics.priceToBook)}`,
      `- Price to Sales: ${formatNumber(metrics.priceToSalesTrailing12Months)}`
    ].join('\n');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    
    setMessages(prev => [...prev, { text: userMessage, isUser: true }]);
    setIsLoading(true);

    try {
      const tickerRegex = /\$([A-Za-z]+)/g;
      const tickers = Array.from(userMessage.matchAll(tickerRegex)).map(match => match[1]);
      
      if (tickers.length > 0) {
        console.log('Sending request with tickers:', tickers);
        const response = await fetch('/api/analysis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            tickers,
            end_date: new Date().toISOString().split('T')[0],
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error('API Error Response:', errorText);
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        console.log('API Response:', data);
        
        if (data.error) {
          throw new Error(data.error);
        }

        if (!data.data?.analyst_signals?.fundamentals_agent) {
          throw new Error('Invalid response format from API');
        }

        // Format the analysis response with both metrics and analysis
        const analysisResponse = Object.entries(
          data.data.analyst_signals.fundamentals_agent as Record<string, FundamentalEntry>,
        )
          .map(([ticker, analysis]) => {
            return [
              `${ticker.toUpperCase()}: ${analysis.signal.toUpperCase()} (${analysis.confidence}% confidence)`,
              '',
              formatMetrics(analysis.metrics),
              '',
              'Analysis:',
              `- Profitability: ${analysis.reasoning.profitability_signal.details}`,
              `- Growth: ${analysis.reasoning.growth_signal.details}`,
              `- Financial Health: ${analysis.reasoning.financial_health_signal.details}`,
              `- Price Ratios: ${analysis.reasoning.price_ratios_signal.details}`
            ].join('\n');
          })
          .join('\n\n');

        setMessages(prev => [...prev, { text: analysisResponse, isUser: false }]);
      } else {
        setMessages(prev => [...prev, { 
          text: "Please include stock tickers in your message using the $ symbol (e.g., $AAPL, $GOOGL)", 
          isUser: false 
        }]);
      }
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, { 
        text: `Error: ${error instanceof Error ? error.message : 'An error occurred'}`, 
        isUser: false 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[80vh] max-w-4xl mx-auto p-4">
      <div className="flex-1 overflow-y-auto mb-4 space-y-4">
        {messages.map((msg, idx) => (
          <ChatMessage key={idx} message={msg.text} isUser={msg.isUser} />
        ))}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about stocks using $ symbol (e.g., How is $AAPL performing?)"
          className="flex-1 p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading}
          className={`px-4 py-2 bg-blue-500 text-white rounded-lg ${
            isLoading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-600'
          }`}
        >
          {isLoading ? 'Analyzing...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

export default ChatInterface;
